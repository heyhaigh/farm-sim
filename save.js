// save.js — Ry Farms persistence (#88): IndexedDB storage for town snapshots.
//
// A town whose whole thesis is "little people who remember" must not forget itself on
// reload — so the lived world (chronicle, bonds, grudges, monuments, the charted map,
// every farmer's journal) survives across sessions. The sim side lives in farm.js
// (World.serialize / World.fromSave); this module is only the browser storage glue.
//
// Slots: one snapshot per world seed under 'town:<seed>', plus a 'latest' pointer so a
// plain visit resumes the last-played town. Everything here is best-effort: a storage
// failure must NEVER take down the game — worst case the town simply starts fresh.

const DB_NAME = 'ryfarms';
const DB_VER = 1;
const STORE = 'towns';

let dbPromise = null;
function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function idbReq(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

// Persist the world. Returns the saved day, or null if storage failed / was refused (never throws).
// Codex #22.1 — the town snapshot carries a monotonic `_rev`. The write is a COMPARE-AND-SET inside ONE
// transaction: read the stored snapshot; if another tab has advanced past our rev, REFUSE the write (don't
// clobber a newer snapshot with our stale state and regress the town's day). On success, advance our rev.
export async function saveTown(world) {
    try {
        const data = world.serialize();               // data._rev = world._rev
        const key = 'town:' + world.seed, myRev = data._rev || 0;
        const db = await openDb();
        const committed = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let ahead = false;
            const g = store.get(key);
            g.onsuccess = () => {
                const stored = g.result;
                if (stored && (stored._rev || 0) > myRev) { ahead = true; return; }   // another tab is ahead — don't put
                data._rev = myRev + 1;
                store.put(data, key);
            };
            g.onerror = () => reject(g.error);
            tx.oncomplete = () => resolve(!ahead);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('save txn aborted'));
        });
        if (!committed) { console.warn('ry-farms: save refused — another tab holds a newer snapshot of this town (reload to catch up)'); return null; }
        world._rev = data._rev;                        // adopt the advanced rev in memory
        await idbReq('readwrite', s => s.put({ seed: world.seed, day: data.day, season: data.season, year: data.year, savedAt: Date.now() }, 'latest'));
        return data.day;
    } catch (err) {
        console.warn('ry-farms: save failed (continuing unsaved)', err);
        return null;
    }
}

// Load a snapshot: by explicit seed, or the last-played town when seed is omitted.
// Returns the raw snapshot (or null) — the caller decides whether it can be hydrated.
export async function loadTown(seed) {
    try {
        if (seed == null) {
            const latest = await idbReq('readonly', s => s.get('latest'));
            if (!latest) return null;
            seed = latest.seed;
        }
        return (await idbReq('readonly', s => s.get('town:' + seed))) || null;
    } catch (err) {
        console.warn('ry-farms: load failed (starting fresh)', err);
        return null;
    }
}

// --- #2.1 the WORLD INDEX ---------------------------------------------------------------------------------
// A lightweight registry of every town this browser has grown — one small summary per town (name, day, pop,
// harvest, the towns it descends from, a memory fingerprint for its tint) plus the encounters between them.
// Updated incrementally on each save (not by loading heavy snapshots), it's the data the zoom-out world map
// renders. This is the LIVING WORLD tier: client-authoritative, explicitly non-reproducible (unlike a town's
// seeded sim). Best-effort throughout — a storage failure never touches the running town.
const WORLD_KEY = 'world';

export async function loadWorldIndex() {
    try { return (await idbReq('readonly', s => s.get(WORLD_KEY))) || { towns: {}, encounters: [] }; }
    catch { return { towns: {}, encounters: [] }; }
}

// Merge one town's current summary into the world index (upsert by seed), preserving firstSeen + accumulated
// encounters. Returns the merged index (so the caller can run encounter detection on it) or null on failure.
export async function registerTownInWorld(summary) {
    if (!summary || summary.seed == null) return null;
    try {
        const idx = await loadWorldIndex();
        idx.towns = idx.towns || {};
        idx.encounters = idx.encounters || [];
        const prev = idx.towns[summary.seed] || {};
        idx.towns[summary.seed] = {
            ...prev, ...summary,
            firstSeen: prev.firstSeen || summary.lastSeen || Date.now(),
        };
        await idbReq('readwrite', s => s.put(idx, WORLD_KEY));
        return idx;
    } catch (err) {
        console.warn('ry-farms: world-index update failed (map may be stale)', err);
        return null;
    }
}

// Persist the whole world index (used after encounter detection appends cross-town events).
export async function saveWorldIndex(idx) {
    try { await idbReq('readwrite', s => s.put(idx, WORLD_KEY)); return true; }
    catch { return false; }
}

// Codex r20 P1: ATOMIC read-modify-write of the world index in a SINGLE IndexedDB transaction. The old flow
// (loadWorldIndex -> mutate in memory -> saveWorldIndex) was a racy read-modify-write across separate txns —
// two open tabs registering different towns could each read the same index and clobber the other's summary /
// encounter / ledger / inbox. IndexedDB serializes readwrite transactions on a store, so doing the get + mutate
// + put inside ONE txn makes concurrent updates safe (each sees the prior's committed value). `mutator(cur)`
// mutates + returns the index; it must be SYNCHRONOUS (no awaits — the txn would auto-close). Returns the
// stored index, or null on failure (best-effort, never throws into the sim).
export function updateWorldIndex(mutator) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(WORLD_KEY);
        let out = null;
        getReq.onsuccess = () => {
            const cur = getReq.result || { towns: {}, encounters: [] };
            try { out = mutator(cur) || cur; } catch (e) { try { tx.abort(); } catch {} reject(e); return; }
            store.put(out, WORLD_KEY);
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('world-index txn aborted'));
    })).catch(err => { console.warn('ry-farms: atomic world-index update failed', err); return null; });
}

// The NEW TOWN hatch: retire a seed's snapshot (and the latest-pointer if it points there).
// NOT a hard delete — the save (and the wiped pointer) move to backup keys, so one accidental
// "NEW -> SURE?" is always undoable (learned the hard way, day one). Each wipe overwrites the
// previous backup: one-deep undo, zero ceremony.
export async function wipeTown(seed) {
    try {
        const snap = await idbReq('readonly', s => s.get('town:' + seed));
        const latest = await idbReq('readonly', s => s.get('latest'));
        if (snap) await idbReq('readwrite', s => s.put(snap, 'backup:town'));
        if (latest) await idbReq('readwrite', s => s.put(latest, 'backup:latest'));
        await idbReq('readwrite', s => s.delete('town:' + seed));
        if (latest && latest.seed === seed) await idbReq('readwrite', s => s.delete('latest'));
        // Codex #22.3 — retire the town from the WORLD index too (atomically), else it lingers as a zombie:
        // still on the map, still in encounter detection, its inbox/pair records growing forever. Summaries
        // regenerate on next play; ledgers are lineage-keyed and intentionally persist. detectEncounters GCs
        // any pair/news records orphaned by this removal.
        const s = String(seed);
        // #Codex24-2: CAPTURE the town's world-index slice before deleting it, so undo can atomically restore
        // its inbox (incl. a future-dated traveler mid-journey), pair state, news, encounters, AND summary —
        // not just the town snapshot. Without this, undo silently loses pending cross-town state, and the
        // re-registered town is re-detected as "new", letting an old neighbor mint a fresh raid/reconciliation.
        let slice = null;
        await updateWorldIndex(index => {
            const inPair = k => { const [a, b] = k.split(':'); return a === s || b === s; };
            slice = {
                town: index.towns ? index.towns[s] : undefined,
                inbox: (index.inbox && index.inbox[s] !== undefined) ? index.inbox[s] : undefined,
                pairs: index.pairs ? Object.fromEntries(Object.entries(index.pairs).filter(([k]) => inPair(k))) : {},
                news: Array.isArray(index.news) ? index.news.filter(n => String(n.origin) === s || String(n.destination) === s) : [],
                encounters: Array.isArray(index.encounters) ? index.encounters.filter(e => String(e.a) === s || String(e.b) === s) : [],
            };
            if (index.towns) delete index.towns[s];
            if (index.inbox) delete index.inbox[s];
            if (index.pairs) for (const k of Object.keys(index.pairs)) { if (inPair(k)) delete index.pairs[k]; }
            if (Array.isArray(index.news)) index.news = index.news.filter(n => String(n.origin) !== s && String(n.destination) !== s);
            if (Array.isArray(index.encounters)) index.encounters = index.encounters.filter(e => String(e.a) !== s && String(e.b) !== s);
            return index;
        });
        await idbReq('readwrite', st => st.put(slice || null, 'backup:worldslice'));   // one-deep, alongside backup:town/latest
    } catch (err) {
        console.warn('ry-farms: wipe failed', err);
    }
}

// Undo the last wipe: put the backed-up town (and its latest-pointer) back. Returns the
// restored seed, or null if there's nothing to restore. Reload after calling to resume it.
export async function undoWipe() {
    try {
        const snap = await idbReq('readonly', s => s.get('backup:town'));
        if (!snap) return null;
        await idbReq('readwrite', s => s.put(snap, 'town:' + snap.seed));
        const latest = await idbReq('readonly', s => s.get('backup:latest'));
        await idbReq('readwrite', s => s.put(latest && latest.seed === snap.seed ? latest
            : { seed: snap.seed, day: snap.day, season: snap.season, year: snap.year, savedAt: Date.now() }, 'latest'));
        // #Codex24-2: atomically restore the town's world-index slice (summary/inbox/pairs/news/encounters) the
        // wipe backed up, so the resumed town keeps its pending traveler and isn't re-detected as a new neighbor.
        const slice = await idbReq('readonly', s => s.get('backup:worldslice'));
        if (slice) {
            const sk = String(snap.seed);
            await updateWorldIndex(index => {
                index.towns = index.towns || {}; index.inbox = index.inbox || {}; index.pairs = index.pairs || {};
                index.news = Array.isArray(index.news) ? index.news : []; index.encounters = Array.isArray(index.encounters) ? index.encounters : [];
                if (slice.town !== undefined) index.towns[sk] = slice.town;
                if (slice.inbox !== undefined) index.inbox[sk] = slice.inbox;
                for (const [k, v] of Object.entries(slice.pairs || {})) index.pairs[k] = v;
                const encKey = e => `${e.a}:${e.b}:${e.kind || ''}:${e.day ?? ''}:${e.ordinal ?? ''}`;
                const haveEnc = new Set(index.encounters.map(encKey));
                for (const e of (slice.encounters || [])) if (!haveEnc.has(encKey(e))) index.encounters.push(e);
                const newsKey = nn => `${nn.origin}:${nn.destination}:${nn.ordinal ?? ''}`;
                const haveNews = new Set(index.news.map(newsKey));
                for (const nn of (slice.news || [])) if (!haveNews.has(newsKey(nn))) index.news.push(nn);
                return index;
            });
        }
        // #Codex24-2: consume the one-deep backup after a successful restore so a second undo can't re-restore
        for (const key of ['backup:town', 'backup:latest', 'backup:worldslice']) await idbReq('readwrite', s => s.delete(key));
        return snap.seed;
    } catch (err) {
        console.warn('ry-farms: undo failed', err);
        return null;
    }
}
