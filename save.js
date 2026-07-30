// save.js — Propagate persistence (#88): IndexedDB storage for town snapshots.
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

// Ask the browser to exempt this origin from storage eviction. IndexedDB already survives reloads, tab
// closes and browser restarts — it is not session storage — but it is still EVICTABLE: under storage
// pressure, and notably under Safari's policy of clearing script-writable storage for sites without enough
// user engagement, a town can vanish through no action of the player's. A granted persist() makes the origin
// exempt on Chromium and counts as an engagement signal elsewhere. Best-effort and fire-and-forget: the
// answer changes nothing about how we save, so nothing waits on it and a refusal is not an error.
// This is a mitigation, NOT a guarantee — the only real safety net for a town someone cares about is an
// exported copy, because no browser flag survives the player clearing site data or switching device.
let persistAsked = false;
export function requestPersistentStorage() {
    if (persistAsked || typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    persistAsked = true;
    navigator.storage.persist()
        .then(granted => console.log(`ry-farms: persistent storage ${granted ? 'GRANTED — towns are exempt from eviction' : 'not granted (towns may be evicted under storage pressure; export to be safe)'}`))
        .catch(() => {});
}

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
    // #Codex38 P0-1 — a WIPED town must never be recreated by ANY save path (autosave, saveNow(),
    // a late whisper/debrief callback). The guard is centralized here so every caller is covered, and
    // re-checked inside the transaction so a wipe landing mid-write can't slip a put past it.
    if (world._retired) return null;
    try {
        const data = world.serialize();               // data._rev = world._rev
        const key = 'town:' + world.seed, myRev = data._rev || 0;
        const db = await openDb();
        const committed = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let ahead = false, retired = false, superseded = false, storedGen = 0;
            // Codex #56-1 — read the slot's GENERATION in the same transaction as the CAS. A rev comparison
            // cannot see that the slot was vacated and restarted under this writer (quarantine/restore), so
            // without this a tab holding the superseded town overwrites its replacement.
            // ORDER MATTERS: IndexedDB fires success callbacks in REQUEST order, so the generation must be
            // requested BEFORE the snapshot or `storedGen` is still 0 when the check below runs.
            const gg = store.get(genKey(world.seed));
            gg.onsuccess = () => { storedGen = gg.result || 0; };
            const g = store.get(key);
            g.onsuccess = () => {
                if (world._retired) { retired = true; return; }   // wiped after we began — do not recreate the slot
                if ((world._gen || 0) < storedGen) { superseded = true; return; }   // this world is from an older epoch
                const stored = g.result;
                if (stored && (stored._rev || 0) > myRev) { ahead = true; return; }   // another tab is ahead — don't put
                data._rev = myRev + 1;
                store.put(data, key);
            };
            g.onerror = () => reject(g.error);
            tx.oncomplete = () => resolve(!ahead && !retired && !superseded);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('save txn aborted'));
        });
        if (world._retired) return null;
        if (!committed) { console.warn('ry-farms: save refused — another tab holds a newer snapshot of this town (reload to catch up)'); return null; }
        world._rev = data._rev;                        // adopt the advanced rev in memory
        await idbReq('readwrite', s => s.put({ seed: world.seed, day: data.day, season: data.season, year: data.year, savedAt: Date.now() }, 'latest'));
        return data.day;
    } catch (err) {
        console.warn('ry-farms: save failed (continuing unsaved)', err);
        return null;
    }
}

// A snapshot this build cannot hydrate is MOVED ASIDE, never overwritten. Two reasons, and the second one
// is subtler than it looks:
//
//  1. It may still be readable. A save from a newer build, or one that trips a bug this build has and the
//     next one fixes, is not garbage — it is the player's town. The old boot path logged a console warning
//     and founded a fresh town on the same seed, so the first autosave buried a town someone had played for
//     days. Keeping it costs a few hundred KB and is the difference between "we'll fix it" and "it's gone".
//
//  2. It unblocks saving. `saveTown` is a compare-and-set against the STORED snapshot's `_rev`, and it is
//     right to refuse a write from behind it — that guard is what stops a stale tab clobbering a newer town.
//     But a freshly founded world has no rev, so founding over a rev-47 snapshot meant every autosave for
//     the rest of the session was refused with only a console warning: the player was dropped into day 1 AND
//     could not save. Vacating the slot fixes that without weakening the CAS.
//
// One quarantine per seed, overwritten if it happens again (same one-deep discipline as the wipe backup).
//
// Codex #56-1 — VACATING A SLOT RESETS THE REVISION EPOCH, and `_rev` alone cannot detect that. saveTown
// refuses a write only when the STORED rev is AHEAD of the writer's, which is sound while revs climb
// monotonically in one slot. Quarantine breaks that assumption: the slot restarts at rev 0, so a tab still
// holding the quarantined town at rev 47 sails through the check (1 > 47 is false), overwrites the
// replacement town, resurrects the old snapshot at rev 48 — and every save from the new session is refused
// from then on. Exactly the state quarantine existed to prevent.
//
// Revs cannot distinguish the two generations, because both count in the same sequence. So the slot carries a
// durable GENERATION counter, bumped every time the slot's identity changes under it (quarantine, restore).
// It belongs to the SLOT, not to the snapshot: a reader learns the live generation when it loads, so nothing
// needs to be written into the save and SAVE_VERSION does not move. A writer whose generation is behind the
// stored one is from a superseded epoch and is refused no matter what its rev says.
const genKey = seed => 'gen:' + String(seed);

// The slot's current generation (0 when it has never changed hands). Read at load/found time into world._gen.
export async function readGen(seed) {
    try { return (await idbReq('readonly', s => s.get(genKey(seed)))) || 0; }
    catch { return 0; }
}

// Returns { ok, rec, gen }:
//   ok   — did the move actually commit? Codex #56-2: a storage failure used to be flattened to null, which
//          the caller could not tell apart from "there was nothing to move" — so boot carried on over a
//          snapshot that was STILL THERE, and the rev guard refused every save for the session. The caller
//          must be able to distinguish, and must not persist over a save it failed to preserve.
//   rec  — the preserved record, or null when the slot was already empty (which is a success, not a failure).
//   gen  — the slot's generation AFTER the bump, for the replacement world to adopt.
export async function quarantineTown(seed, reason) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let rec = null, gen = 0;
            // Generation FIRST — callbacks fire in request order, so reading it after the snapshot would
            // leave `gen` at 0 and the bump below would always write 1 instead of storedGen + 1.
            const gg = store.get(genKey(seed));
            gg.onsuccess = () => { gen = (gg.result || 0); };
            const g = store.get('town:' + seed);
            g.onsuccess = () => {
                const snap = g.result;
                if (!snap) return;                      // nothing stored — nothing to preserve
                rec = { seed, snap, reason: String(reason || 'unreadable'), at: Date.now(), v: snap.v ?? null, day: snap.day ?? null, rev: snap._rev ?? 0 };
                store.put(rec, 'unreadable:' + seed);
                store.delete('town:' + seed);           // vacate the slot so the new session can save
                gen = gen + 1;                          // the slot changed hands — supersede every older writer
                store.put(gen, genKey(seed));
            };
            g.onerror = () => reject(g.error);
            tx.oncomplete = () => resolve({ ok: true, rec, gen });
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('quarantine txn aborted'));
        });
    } catch (err) {
        console.warn('ry-farms: could not quarantine the unreadable save', err);
        return { ok: false, rec: null, gen: 0 };
    }
}

// Is there a quarantined town for this seed? (Metadata only — the caller decides whether to offer recovery.)
export async function peekQuarantined(seed) {
    try {
        const rec = await idbReq('readonly', s => s.get('unreadable:' + seed));
        return rec ? { seed: rec.seed, reason: rec.reason, at: rec.at, v: rec.v, day: rec.day } : null;
    } catch { return null; }
}

// Put a quarantined snapshot back in the live slot, so a build that CAN read it opens the real town.
// Deliberately manual: it overwrites whatever has been played since, so only ever call it on an explicit ask.
// Codex #56-4 — ONE transaction for the get + put + delete, matching the discipline the #25/#26/#27 rounds
// established for wipe/undo. Across three separate transactions the read-modify-write was racy: tab A reads
// quarantine A, tab B replaces it with quarantine B, then tab A deletes B after restoring A — losing B
// entirely. It also bumps the slot's GENERATION, because restoring changes the slot's identity under any tab
// still holding the replacement town, and that tab must not be able to write over the town just recovered.
export async function restoreQuarantined(seed) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let day = null;
            const gg = store.get(genKey(seed));      // generation first — callbacks fire in request order
            let gen = 0;
            gg.onsuccess = () => { gen = gg.result || 0; };
            const r = store.get('unreadable:' + seed);
            r.onsuccess = () => {
                const rec = r.result;
                if (!rec || !rec.snap) return;       // nothing to restore — leave everything untouched
                store.put(rec.snap, 'town:' + seed);
                store.delete('unreadable:' + seed);  // consume the SAME record we just read, never a newer one
                store.put(gen + 1, genKey(seed));
                day = rec.snap.day ?? true;
            };
            r.onerror = () => reject(r.error);
            tx.oncomplete = () => resolve(day);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('restore txn aborted'));
        });
    } catch (err) {
        console.warn('ry-farms: restore of the quarantined save failed', err);
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
// #Codex25-2 — the whole wipe runs in ONE readwrite transaction (all keys live in the same 'towns' store): read
// snapshot + latest + world index, prune the town from the index, delete it, and write ONE coherent backup
// (#Codex26-2) — atomically. No crash window that could leave the slice unbacked or the town half-removed.
export async function wipeTown(seed) {
    try {
        const db = await openDb();
        const s = String(seed);
        const inPair = k => { const [a, b] = k.split(':'); return a === s || b === s; };
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let snap, latest;
            const rSnap = store.get('town:' + seed); rSnap.onsuccess = () => { snap = rSnap.result; };
            const rLatest = store.get('latest'); rLatest.onsuccess = () => { latest = rLatest.result; };
            const rWorld = store.get(WORLD_KEY);
            rWorld.onsuccess = () => {
                const index = rWorld.result || { towns: {}, encounters: [] };
                // CAPTURE the town's whole world-index slice — summary, inbox (incl. a future traveler mid-journey),
                // pairs, news, encounters, AND #Codex25-3 the DURABLE metPairs dedup keys. Without metPairs, GC
                // drops the wiped town's met-pairs while it's absent and undo lets every old pair re-detect.
                const slice = {
                    town: index.towns ? index.towns[s] : undefined,
                    inbox: (index.inbox && index.inbox[s] !== undefined) ? index.inbox[s] : undefined,
                    pairs: index.pairs ? Object.fromEntries(Object.entries(index.pairs).filter(([k]) => inPair(k))) : {},
                    metPairs: index.metPairs ? Object.keys(index.metPairs).filter(inPair) : [],
                    news: Array.isArray(index.news) ? index.news.filter(n => String(n.origin) === s || String(n.destination) === s) : [],
                    encounters: Array.isArray(index.encounters) ? index.encounters.filter(e => String(e.a) === s || String(e.b) === s) : [],
                };
                if (index.towns) delete index.towns[s];
                if (index.inbox) delete index.inbox[s];
                if (index.pairs) for (const k of Object.keys(index.pairs)) if (inPair(k)) delete index.pairs[k];
                if (index.metPairs) for (const k of Object.keys(index.metPairs)) if (inPair(k)) delete index.metPairs[k];
                if (Array.isArray(index.news)) index.news = index.news.filter(n => String(n.origin) !== s && String(n.destination) !== s);
                if (Array.isArray(index.encounters)) index.encounters = index.encounters.filter(e => String(e.a) !== s && String(e.b) !== s);
                store.put(index, WORLD_KEY);          // the town is ALWAYS removed from the index (an unsaved town too — no zombie)
                store.delete('town:' + seed);
                if (latest && latest.seed === seed) store.delete('latest');
                // #Codex26-2: ONE coherent one-deep backup object, written ONLY when there is committed state to
                // restore. An UNSAVED town (no snapshot) has nothing to undo — leave the PREVIOUS backup intact
                // rather than half-overwrite it (the old 3-key scheme could keep an old backup:town while
                // replacing backup:worldslice for a different seed, so undo combined unrelated generations).
                if (snap) {
                    store.put({ seed, snap, latest, slice }, 'backup:wipe');
                    // #Codex27-2: a new coherent backup supersedes any pre-upgrade 3-key backup — drop the legacy keys
                    store.delete('backup:town'); store.delete('backup:latest'); store.delete('backup:worldslice');
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('wipe txn aborted'));
        });
    } catch (err) {
        console.warn('ry-farms: wipe failed', err);
    }
}

// #Codex25-2 — undo runs in ONE readwrite transaction too: restore the town + latest + the full index slice
// (incl. metPairs) AND consume the one coherent backup atomically, so a crash can't half-restore and a second
// undo can't re-apply a stale backup over newer state. Returns the restored seed (or null).
export async function undoWipe() {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let backup, lgTown, lgLatest, lgSlice, restoredSeed = null;
            const rBackup = store.get('backup:wipe'); rBackup.onsuccess = () => { backup = rBackup.result; };
            // #Codex27-2 also read the pre-upgrade 3-key backup so a wipe done by the OLD build is still undoable
            const rLgTown = store.get('backup:town'); rLgTown.onsuccess = () => { lgTown = rLgTown.result; };
            const rLgLatest = store.get('backup:latest'); rLgLatest.onsuccess = () => { lgLatest = rLgLatest.result; };
            const rLgSlice = store.get('backup:worldslice'); rLgSlice.onsuccess = () => { lgSlice = rLgSlice.result; };
            const rWorld = store.get(WORLD_KEY);
            rWorld.onsuccess = () => {
                // prefer the new coherent backup; else MIGRATE a pending legacy 3-key backup into the same shape
                if (!backup || !backup.snap) backup = lgTown ? { seed: lgTown.seed, snap: lgTown, latest: lgLatest, slice: lgSlice } : null;
                if (!backup || !backup.snap) return;   // nothing to restore — leave everything, resolve null
                const { snap, latest, slice } = backup;   // #Codex26-2 one coherent generation: same seed's snap+latest+slice
                restoredSeed = snap.seed;
                const sk = String(snap.seed);
                store.put(snap, 'town:' + snap.seed);
                store.put(latest && latest.seed === snap.seed ? latest
                    : { seed: snap.seed, day: snap.day, season: snap.season, year: snap.year, savedAt: Date.now() }, 'latest');
                if (slice) {
                    const index = rWorld.result || { towns: {}, encounters: [] };
                    index.towns = index.towns || {}; index.inbox = index.inbox || {}; index.pairs = index.pairs || {};
                    index.metPairs = index.metPairs || {};
                    index.news = Array.isArray(index.news) ? index.news : []; index.encounters = Array.isArray(index.encounters) ? index.encounters : [];
                    if (slice.town !== undefined) index.towns[sk] = slice.town;
                    if (slice.inbox !== undefined) index.inbox[sk] = slice.inbox;
                    for (const [k, v] of Object.entries(slice.pairs || {})) index.pairs[k] = v;
                    for (const k of (slice.metPairs || [])) index.metPairs[k] = 1;   // #Codex25-3 restore the durable dedup keys
                    const encKey = e => `${e.a}:${e.b}:${e.kind || ''}:${e.day ?? ''}:${e.ordinal ?? ''}`;
                    const haveEnc = new Set(index.encounters.map(encKey));
                    for (const e of (slice.encounters || [])) if (!haveEnc.has(encKey(e))) index.encounters.push(e);
                    const newsKey = nn => `${nn.origin}:${nn.destination}:${nn.ordinal ?? ''}`;
                    const haveNews = new Set(index.news.map(newsKey));
                    for (const nn of (slice.news || [])) if (!haveNews.has(newsKey(nn))) index.news.push(nn);
                    store.put(index, WORLD_KEY);
                }
                // #Codex27-2 consume the coherent backup AND any legacy keys (whichever we restored from)
                store.delete('backup:wipe'); store.delete('backup:town'); store.delete('backup:latest'); store.delete('backup:worldslice');
            };
            tx.oncomplete = () => resolve(restoredSeed);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('undo txn aborted'));
        });
    } catch (err) {
        console.warn('ry-farms: undo failed', err);
        return null;
    }
}
