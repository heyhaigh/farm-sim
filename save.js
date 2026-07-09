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

// The NEW TOWN hatch: wipe a seed's snapshot (and the latest-pointer if it points there).
export async function wipeTown(seed) {
    try {
        await idbReq('readwrite', s => s.delete('town:' + seed));
        const latest = await idbReq('readonly', s => s.get('latest'));
        if (latest && latest.seed === seed) await idbReq('readwrite', s => s.delete('latest'));
    } catch (err) {
        console.warn('ry-farms: wipe failed', err);
    }
}
