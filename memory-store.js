// memory-store.js — THE BROWSER MEMORY STORE (#local-memory).
//
// The promise of the game is "a world that remembers itself" — and until now the remembering half
// (persisted farmer lives, the lineage pool heirs are grown from, the memory portal) only worked
// against a self-hosted SuperMemory that public players don't have. Their towns fell back to
// invented lives with NO memory across towns at all — tethered to nothing, remembering nothing.
//
// This module is the fix: an IndexedDB store IN THE PLAYER'S BROWSER holding the exact same
// compiled documents the SuperMemory write-back produces — farmer lives, town histories, battles,
// invention books. The write half (memory-writeback.js / memory-invent.js) writes here FIRST and
// treats local success as persistence (the server write stays as a best-effort side-channel for
// self-hosted dev setups); the read half surfaces:
//   - localLineage()    — past farmers in the exact shape api/knowledge-graph.js's lineage parser
//                         emits, so heirs grow from the player's OWN fallen towns.
//   - localGraphTowns() — the towns[] shape /api/memory-graph serves, so the memory portal renders
//                         the player's own graph when no server store answers.
//
// Doctrine unchanged: compile-don't-query. The sim NEVER reads this store mid-run — it feeds only
// the founding of FUTURE towns (lineage) and display (the portal) — so determinism is untouched by
// construction. Same echo-guard as the server store: lives feed LINEAGE (heirs), never the source
// corpus, so towns don't slowly fill with copies of themselves.
//
// Storage keys (mirroring the server's customId convention):
//   life:<townSeed>:<farmerSeed>   one living document per farmer, upserted as the life changes
//   town:<townSeed>                the town's civic history (elections, raids, wars)
//   battle:<rid>                   one document per real raid battle
//   invent:<townSeed>              the town's book of inventions
//
// Bounded: lives and battles are capped; the oldest (by updatedAt) are evicted first. Per-browser
// by nature — clearing site data clears the memory; export/import (queued) will carry it in a file.

const DB_NAME = 'ryfarms-memory';
const DB_VER = 1;
const STORE = 'docs';
const LIVES_CAP = 600;
const BATTLES_CAP = 200;

// ---------------------------------------------------------------------------
// Backend — IndexedDB in the browser; injectable for node tests (no IDB there).
// ---------------------------------------------------------------------------
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
// Codex #88 P1 — acknowledge the TRANSACTION, not the request: a request's `success` fires before
// the readwrite transaction commits, and an abort after that (quota, eviction race) would leave us
// having stamped a life or shown an inscription for data that never landed. Resolve only from
// tx.oncomplete; reject from onabort/onerror. Request results are captured along the way.
function idbTx(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));   // fn issues requests, returns a result carrier
        tx.oncomplete = () => resolve(typeof out === 'function' ? out() : out);
        tx.onabort = () => reject(tx.error || new Error('idb tx aborted'));
        tx.onerror = () => reject(tx.error || new Error('idb tx error'));
    }));
}
let backend = {
    put: (key, val) => idbTx('readwrite', s => { s.put(val, key); }),
    del: (key) => idbTx('readwrite', s => { s.delete(key); }),
    // Codex #88 P1 — keys + values from ONE transaction (one snapshot): two separate readonly
    // transactions could interleave with a write and pair keys against the wrong documents.
    all: () => idbTx('readonly', s => {
        const kq = s.getAllKeys(), vq = s.getAll();
        return () => kq.result.map((k, i) => [k, vq.result[i]]);
    }),
    // one transaction, acknowledged at tx.oncomplete like every other write here (IDB law #1)
    replaceTown: (delKeys, puts) => idbTx('readwrite', s => {
        for (const k of delKeys) s.delete(k);
        for (const [k, v] of puts) s.put(v, k);
    }),
};
export function _setBackendForTests(b) { backend = b; }   // tests inject a Map-based fake

// One readwrite transaction for a whole-town replacement (Codex #121 r2): per-op transactions let a
// quota failure mid-delete leave a PARTIALLY replaced set — one old life surviving among the new
// town's rows was reproduced. A backend without replaceTown (test fakes) falls back to per-op, which
// keeps the fakes simple; the production backend below is atomic.
async function backendReplace(delKeys, puts) {
    if (typeof backend.replaceTown === 'function') return backend.replaceTown(delKeys, puts);
    for (const k of delKeys) await backend.del(k);
    for (const [k, v] of puts) await backend.put(k, v);
}

// ---------------------------------------------------------------------------
// Write half — accepts the SAME body shapes /api/memory-writeback accepts, so the
// writers hand one payload to both stores.
// ---------------------------------------------------------------------------
// Codex #88 P2 — `protect` = keys just written in THIS payload: an updatedAt tie must never let
// key order evict the very row we are about to acknowledge. Protected rows are simply not
// candidates (the cap can only be exceeded by a bounded batch, far below the cap itself).
async function evict(prefix, cap, protect = new Set()) {
    const rows = (await backend.all()).filter(([k]) => String(k).startsWith(prefix));
    if (rows.length <= cap) return;
    const candidates = rows.filter(([k]) => !protect.has(String(k)));
    candidates.sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));   // oldest first
    for (const [k] of candidates.slice(0, Math.min(candidates.length, rows.length - cap))) await backend.del(k);
}

// Store whatever the payload carries. Returns { written, persisted:[farmerSeeds] } like the API,
// or null on storage failure (private browsing with IDB blocked, quota) — callers treat null as
// "store unavailable" exactly as they treat a down server.
export async function storePayload(body) {
    if (!body || body.townSeed == null) return null;
    const townSeed = String(body.townSeed);
    // #memfence — a writer below the floor is a STALE TAB: an import (or its undo) has replaced this
    // seed's rows under a newer slot generation, and this writer's world predates that. Refusing here
    // is what makes the town-slot CAS and the memory store agree about who the occupant is.
    const floor = await memFloor(townSeed);
    if (floor > 0 && (body.gen || 0) < floor) return { written: 0, stale: true };
    const now = Date.now();
    try {
        const persisted = [];
        if (Array.isArray(body.farmers)) {
            const wrote = new Set();
            for (const life of body.farmers) {
                if (life == null || life.seed == null) continue;
                const key = `life:${townSeed}:${life.seed}`;
                await backend.put(key, {
                    kind: 'life', town: body.town || null, townSeed, rev: body.rev || 0, updatedAt: now, life,
                });
                wrote.add(key);
                persisted.push(life.seed);
            }
            if (persisted.length) await evict('life:', LIVES_CAP, wrote);
        }
        if (body.townHistory) await backend.put(`town:${townSeed}`, { kind: 'town', town: body.town || null, townSeed, updatedAt: now, history: body.townHistory });
        if (body.battle && body.battle.rid) {
            const bkey = `battle:${String(body.battle.rid)}`;
            await backend.put(bkey, { kind: 'battle', town: body.town || null, townSeed, updatedAt: now, battle: body.battle });
            await evict('battle:', BATTLES_CAP, new Set([bkey]));
        }
        if (body.townInventions) await backend.put(`invent:${townSeed}`, { kind: 'invent', town: body.town || null, townSeed, updatedAt: now, inventions: body.townInventions });
        return { written: true, persisted };
    } catch (err) {
        console.warn('ry-farms: browser memory store unavailable', err?.message || err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Read half
// ---------------------------------------------------------------------------

// One life document -> the lineage-entry shape api/knowledge-graph.js emits (parseLineageLife):
// heirs need a named forebear + a creed to carry; entries missing either are not lineage.
export function lifeToLineage(doc) {
    const l = doc && doc.life;
    if (!l || !l.name) return null;
    const creed = (l.creeds && l.creeds[0]) || null;
    if (!creed) return null;
    return {
        id: `ry-farms:${doc.townSeed}:${l.seed}`,
        farmerSeed: String(l.seed),
        townSeed: String(doc.townSeed),
        name: String(l.name),
        archetype: l.archetype || 'farmer',
        town: doc.town || null,
        creed: String(creed),
        dream: l.dream || null,
        sourceTitle: l.sourceTitle || null,
    };
}

export async function localLineage() {
    try {
        const rows = await backend.all();
        const out = [];
        for (const [k, v] of rows) {
            if (!String(k).startsWith('life:')) continue;
            const entry = lifeToLineage(v);
            if (entry) out.push(entry);
        }
        out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // stable order -> deterministic heir pairing
        return out;
    } catch { return []; }
}

// Merge server + local lineage, dedup by real identity (townSeed:farmerSeed — both sides carry it),
// stable-sorted so the pool order (which planHeirs' pairing keys off) is deterministic for a given state.
export function mergeLineage(server, local) {
    const key = l => (l.townSeed != null && l.farmerSeed != null) ? `${l.townSeed}:${l.farmerSeed}` : String(l.id || l.name || '');
    const seen = new Set();
    const out = [];
    for (const l of [...(server || []), ...(local || [])]) {
        const k = key(l);
        if (seen.has(k)) continue;
        seen.add(k); out.push(l);
    }
    out.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    return out;
}

// #memory-backfill — which towns already have life docs (the backfill's skip set: presence of ANY
// life for a townSeed means the store owns that town and the live cadence keeps it fresh).
export async function townSeedsWithLives() {
    try {
        const out = new Set();
        for (const [k, v] of await backend.all()) if (String(k).startsWith('life:')) out.add(String(v?.townSeed ?? String(k).split(':')[1]));
        return out;
    } catch { return new Set(); }
}

// #memory-backfill — the farmer seeds a town already has life docs for (per-farmer completion checks;
// unlike localLineage this counts creedless docs too, so a stored life is never re-claimed).
export async function lifeKeysForTown(townSeed) {
    try {
        const ts = String(townSeed), out = new Set();
        for (const [k] of await backend.all()) {
            const key = String(k);
            if (key.startsWith('life:' + ts + ':')) out.add(key.slice(('life:' + ts + ':').length));
        }
        return out;
    } catch { return null; }   // null = store refused (distinct from "none")
}

// #memory-backfill — the COMPLETION MARKERS (Codex #92 P1): a town is "claimed" only when every
// required payload landed; the marker is what the sweep skips on. Partial writes (a mid-batch put
// failure) leave no marker, so the next boot retries the whole town — the missing rows are filled
// by upsert and the marker lands only at the end. backfillMarkers() returns null on a refused
// store (distinct from "none"), so a refusal never reads as "nothing claimed yet, claim away".
export async function setBackfillMarker(townSeed) {
    try { await backend.put('backfill:' + String(townSeed), { kind: 'backfill', townSeed: String(townSeed), updatedAt: Date.now() }); return true; }
    catch { return false; }
}
export async function backfillMarkers() {
    try {
        const out = new Set();
        for (const [k, v] of await backend.all()) if (String(k).startsWith('backfill:')) out.add(String(v?.townSeed ?? String(k).slice(9)));
        return out;
    } catch { return null; }
}

export async function localLifeCount() {
    try { return (await backend.all()).filter(([k]) => String(k).startsWith('life:')).length; } catch { return 0; }
}

// The portal's towns[] shape (api/memory-graph.js townsOut), built from local docs. Same
// relationship heuristic as the server: a memory of A naming farmer B by first name -> an edge.
const RELS = [
    [/nursed|healed|tended|soup|back to health/i, 'nursed'],
    [/shortchang|lowball|cheat|hard bargain|robbed/i, 'chiselled'],
    [/stole|thiev|poach|blight|harm|poison/i, 'wronged'],
    [/taught|showed .* how|shown how/i, 'taught'],
    [/traded|barter|swap/i, 'traded'],
    [/stood with|pulled .* back|helped|lent .* a hand|dug .* well/i, 'stood by'],
    [/fell out|grudge|resent|turned .* away|refused to heal/i, 'fell out with'],
    [/grown close|bond|beloved/i, 'close to'],
];
function historyText(h) {
    if (!h) return null;
    const lines = [];
    for (const t of h.history || []) lines.push(`${t.name} held the ${t.office} office, year ${t.fromYear}${t.toYear != null ? `-${t.toYear}` : ' on'}${t.endReason ? ` (${t.endReason})` : ''}.`);
    if (h.manager) lines.push(`${h.manager} manages the town${h.managerTerms > 1 ? ` (term ${h.managerTerms})` : ''}; ${h.watch || 'no one'} keeps the watch.`);
    if (h.raidsSuffered) lines.push(`The town has weathered ${h.raidsSuffered} raid${h.raidsSuffered === 1 ? '' : 's'}${h.learned ? ` — and learned: ${h.learned}` : ''}.`);
    const w = h.wars || {};
    if (w.current) lines.push(`${w.current.name} wars upon the town — ${w.current.raidCount} raid${w.current.raidCount === 1 ? '' : 's'}${w.current.ended ? ' (ended)' : ''}.`);
    for (const p of w.past || []) lines.push(`The war of ${p.name} ended: ${p.outcome || 'faded'} (year ${p.year}).`);
    return lines.length ? lines.join('\n') : null;
}
export async function localGraphTowns() {
    try {
        const rows = await backend.all();
        const towns = new Map();
        const getTown = (ts, name) => {
            let t = towns.get(ts);
            if (!t) { t = { seed: ts, name: name || null, farmers: [], links: [], townHistory: null, inventions: [], battles: [] }; towns.set(ts, t); }
            if (!t.name && name) t.name = name;
            return t;
        };
        for (const [k, v] of rows) {
            const key = String(k);
            if (key.startsWith('life:')) {
                const l = v.life || {};
                const memories = [...(l.creeds || []), ...(l.beliefs || []), ...(l.episodic || [])].filter(Boolean).slice(0, 18);
                if (l.name && memories.length) getTown(v.townSeed, v.town).farmers.push({ name: l.name, memories });
            } else if (key.startsWith('town:')) {
                getTown(v.townSeed, v.town).townHistory = historyText(v.history);
            } else if (key.startsWith('battle:')) {
                const b = v.battle || {};
                const text = `${b.clan || 'A warband'} fell on the town — ${b.outcome ? `${b.outcome.felled || 0} raider${(b.outcome.felled || 0) === 1 ? '' : 's'} felled, ${b.outcome.harvestLost || 0} harvest lost` : 'the record is torn'}${b.hero ? `; ${b.hero} led the stand` : ''}.`;
                getTown(v.townSeed, v.town).battles.push({ foe: (b.nemesis && b.nemesis.name) || b.clan || null, day: b.day || '', year: b.year || '', text });
            } else if (key.startsWith('invent:')) {
                const recs = (v.inventions && v.inventions.recipes) || [];
                getTown(v.townSeed, v.town).inventions = recs.map(r => `${r.name}${r.inventor ? ` — first made by ${r.inventor}` : ''}${r.lore ? `: ${r.lore}` : ''}`).slice(0, 24);
            }
        }
        const out = [];
        for (const t of towns.values()) {
            if (!t.farmers.length && !t.townHistory && !t.inventions.length && !t.battles.length) continue;
            // relationship edges from first-name mentions, exactly the server heuristic
            const firsts = new Map(t.farmers.map(f => [f.name.split(' ')[0], f.name]));
            const seen = new Set();
            for (const f of t.farmers) {
                const meFirst = f.name.split(' ')[0];
                for (const text of f.memories) for (const [first, full] of firsts) {
                    if (first === meFirst) continue;
                    if (!new RegExp(`\\b${first}\\b`).test(text)) continue;
                    const k2 = [f.name, full].sort().join('|'); if (seen.has(k2)) continue;
                    let label = 'knows';
                    for (const [re, lab] of RELS) if (re.test(text)) { label = lab; break; }
                    seen.add(k2); t.links.push({ a: f.name, b: full, label });
                }
            }
            out.push(t);
        }
        out.sort((a, b) => (b.farmers.length - a.farmers.length) || String(a.seed).localeCompare(String(b.seed)));
        return out;
    } catch { return []; }
}

// ---------------------------------------------------------------------------
// #saveport — a town's memory rows travel with its save file (Codex #121).
//
// The export used to carry serialize() alone, and two findings landed on the same seam: battle
// documents are explicitly IRRECONSTRUCTIBLE (backfill's own comment — their display-derived detail
// was never saved), so moving a town lost part of its memory portal; and rows are addressed by seed
// with no occupant identity, so importing a DIFFERENT town onto the same seed left it wearing the
// displaced town's lives ("IMPORTED_* exposing OLD_* lives", reproduced). Rows are therefore part of
// the town file, and import REPLACES the seed's rows wholesale.
// ---------------------------------------------------------------------------

// Everything in this store that belongs to one town. Battle docs are keyed by raid id, so ownership
// for those is the document's own townSeed.
function ownsRow(townSeed, key, value) {
    // Key AND document (Codex #121 r2): ownership by key prefix alone let an imported
    // `life:<target>:9` carry `townSeed: 999999` inside the document, and the portal exposed it
    // under town 999999 — the key said one owner, the document claimed another, and the graph reader
    // believes documents. The row's own identity must agree with the key, its kind must match its
    // prefix, and its payload must have the minimum shape the reader dereferences — a null life
    // makes the graph fail closed to empty.
    const s = String(townSeed), k = String(key);
    if (!value || typeof value !== 'object' || String(value.townSeed) !== s) return false;
    if (k.startsWith(`life:${s}:`)) return value.kind === 'life' && !!value.life && typeof value.life === 'object'
        && k === `life:${s}:${value.life.seed}`;   // the farmer seed in the key is the one in the document
    if (k === `town:${s}`) return value.kind === 'town' && Array.isArray(value.history);
    if (k === `invent:${s}`) return value.kind === 'invent' && Array.isArray(value.inventions);
    if (k.startsWith('battle:')) return value.kind === 'battle' && !!value.battle && typeof value.battle === 'object'
        && k === `battle:${String(value.battle.rid)}`;
    return false;
}

// Refusal-side twin of the write filter: parseTownFile calls this so a file carrying ANY row that
// fails ownership is refused whole at parse time, where the UI can say so — silently dropping rows
// on write would import a town while quietly shedding parts of its memory.
export function validateTownMemoryRows(townSeed, rows) {
    if (!Array.isArray(rows)) return { ok: false, error: 'memories are not a list' };
    for (const entry of rows) {
        if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, error: 'malformed memory row' };
        if (!ownsRow(townSeed, entry[0], entry[1])) return { ok: false, error: `memory row does not belong to this town (${String(entry[0]).slice(0, 40)})` };
    }
    return { ok: true };
}

export async function townMemoryRows(townSeed) {
    return (await backend.all()).filter(([k, v]) => ownsRow(townSeed, k, v));
}

// Delete every row the town owns, then write the provided ones — FILTERED by the same ownership
// predicate. A crafted file must not be able to write keys into another town's rows (a life for a
// different seed, a battle claiming a different townSeed): a row that does not belong to this town
// is dropped, not written.
export async function replaceTownMemoryRows(townSeed, rows, fenceGen) {
    const delKeys = (await townMemoryRows(townSeed)).map(([k]) => String(k));
    const puts = [];
    for (const [k, v] of (Array.isArray(rows) ? rows : [])) {
        if (!ownsRow(townSeed, k, v)) continue;   // defense in depth; parse already refused bad files
        puts.push([String(k), v]);
    }
    // #memfence (Codex #121 r2): the floor that makes the replacement STICK. Ordinary storePayload
    // writes had no generation fence, so a stale tab still holding the displaced town could persist
    // and overwrite the imported rows — reproduced as NEW reverting to STALE. The floor is the slot
    // generation the replacement was written under; every writer below it is refused.
    if (Number.isFinite(fenceGen)) puts.push([`memgen:${String(townSeed)}`, { gen: fenceGen }]);
    await backendReplace(delKeys, puts);
    return puts.length - (Number.isFinite(fenceGen) ? 1 : 0);
}

async function memFloor(townSeed) {
    try {
        const rows = await backend.all();
        const hit = rows.find(([k]) => String(k) === `memgen:${String(townSeed)}`);
        return hit ? (hit[1]?.gen || 0) : 0;
    } catch { return 0; }
}
