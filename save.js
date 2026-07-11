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

// Persist the world. Returns the saved day, or null if storage failed (never throws).
export async function saveTown(world) {
    try {
        const data = world.serialize();
        await idbReq('readwrite', s => s.put(data, 'town:' + world.seed));
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
        return snap.seed;
    } catch (err) {
        console.warn('ry-farms: undo failed', err);
        return null;
    }
}
