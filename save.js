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

import { clearTownMemoryRows } from './memory-store.js';

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
//
// THE SLOT INVARIANT (Codex #58 stated it; everything here enforces it)
//
// A town snapshot lives in a SLOT keyed by seed. Two values identify a slot version:
//   generation (`gen:<seed>`) — the OCCUPANT's identity. Incremented whenever the slot changes hands, i.e.
//       whatever is in it is no longer a continuation of what was there (quarantine, restore, wipe, undo).
//       Lives on the slot, not in the snapshot: a reader learns it when it reads.
//   `_rev` — the ORDER of continuations of that one occupant. Lives in the snapshot.
//
// Together they are ONE compare-and-set token, and a live writer owns the pair it observed atomically. A save
// commits only when its pair EXACTLY matches the stored pair — equality, not `>=`. Being behind is a stale
// tab; being ahead is not a benign case but evidence of inconsistent provenance, and authorizing it fails
// open on exactly the corruption the check exists to catch. Committing preserves the generation and advances
// the revision by one. Claiming an EMPTY slot is its own transition: no bump, and only a rev-0 writer — one
// that actually observed the slot empty at this generation — may do it.
export async function saveTown(world) {
    // #Codex38 P0-1 — a WIPED town must never be recreated by ANY save path (autosave, saveNow(),
    // a late whisper/debrief callback). The guard is centralized here so every caller is covered, and
    // re-checked inside the transaction so a wipe landing mid-write can't slip a put past it.
    if (world._retired) return null;
    // Same argument for a NON-PERSISTING world, and it is not hypothetical: the flag was honoured at the
    // autosave, the on-hide save and the writeback, but `RYFARMS.saveNow()` calls this function directly and
    // bypassed all three. That matters most in the case it was added for — when a quarantine FAILS, the boot
    // marks the session non-persisting precisely so it cannot overwrite the unreadable town still sitting in
    // the slot, and a single manual save would have defeated that. Centralized here so every caller is covered.
    // Codex #60: `_persistenceDisabled`, NOT `_spectator` — the menu backdrop sets both, but a refused session
    // is only the former, and gating saves on "is this scenery" is what suppressed its founding scene.
    if (world._persistenceDisabled) return null;
    try {
        const data = world.serialize();               // data._rev = world._rev
        const key = 'town:' + world.seed, myRev = data._rev || 0, myGen = world._gen || 0;
        const db = await openDb();
        const outcome = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let why = null;
            // Codex #56-1 — read the slot's GENERATION in the same transaction as the CAS. A rev comparison
            // cannot see that the slot was vacated and restarted under this writer (quarantine/restore), so
            // without this a tab holding the superseded town overwrites its replacement.
            // ORDER MATTERS: IndexedDB fires success callbacks in REQUEST order, so the generation must be
            // requested BEFORE the snapshot or `storedGen` is still 0 when the check below runs.
            let storedGen = 0;
            const gg = store.get(genKey(world.seed));
            gg.onsuccess = () => { storedGen = gg.result || 0; };
            const g = store.get(key);
            g.onsuccess = () => {
                if (world._retired) { why = 'retired'; return; }   // wiped after we began — do not recreate the slot
                const stored = g.result;
                // Codex #58 — EXACT CAS, not `>=` authorization. `(generation, revision)` is one token
                // identifying the precise slot version this writer observed, and a commit is only valid against
                // that version. The old checks refused a writer BEHIND storage and allowed one AHEAD of it, but
                // being ahead is not a benign case — under every legitimate path a live writer's pair equals the
                // stored pair, so a writer ahead means its provenance is inconsistent (a snapshot paired with a
                // generation it was not read with, a hand-edited rev, a resurrected tab). `>=` failed OPEN on
                // exactly the corruption it should have caught. Equality fails closed.
                if (myGen !== storedGen) { why = `generation ${myGen} != stored ${storedGen}`; return; }
                if (stored) {
                    // occupied: this writer must be the direct continuation of what is there
                    if ((stored._rev || 0) !== myRev) { why = `revision ${myRev} != stored ${stored._rev || 0}`; return; }
                } else {
                    // EMPTY-SLOT CLAIM (Codex #58, inventory row 2). Changing empty -> occupied is its own
                    // transition: no generation bump, but the claimant must have OBSERVED the slot empty at this
                    // generation, which is exactly what rev 0 means. A writer arriving with a non-zero rev and no
                    // stored snapshot is not claiming an empty slot — it is a survivor of a vacated one, and
                    // letting it write is how a quarantined town used to come back.
                    if (myRev !== 0) { why = `revision ${myRev} on an EMPTY slot (only a rev-0 claimant may take it)`; return; }
                }
                data._rev = myRev + 1;
                store.put(data, key);
                // Codex #58 inventory row 3 — `latest` is written INSIDE this transaction now. It used to be a
                // second transaction after the commit, so a wipe landing in between let the stale saver recreate
                // the pointer to a town that had just been deleted.
                store.put({ seed: world.seed, day: data.day, season: data.season, year: data.year, savedAt: Date.now() }, 'latest');
            };
            g.onerror = () => reject(g.error);
            tx.oncomplete = () => resolve(why);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('save txn aborted'));
        });
        if (world._retired) return null;
        if (outcome) { console.warn(`ry-farms: save refused — ${outcome} (another tab or a slot change moved this town on; reload to catch up)`); return null; }
        world._rev = data._rev;                        // adopt the advanced rev in memory
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
// Codex #58 item 5 — `readGen`, `registerTownInWorld` and `saveWorldIndex` were REMOVED, not merely left
// unused. Each was a superseded shape: a bare generation read (the #57-1 bug), an index upsert with no
// generation fence, and a whole-index overwrite with no fence at all. Leaving them exported is how the unsafe
// pattern comes back — the same reasoning that deleted `loadTown`. Use `loadTownState` for a paired
// observation and `updateWorldIndex` for an atomic index mutation.



// Codex #58 — an AUTOMATIC discontinuity must CAS its target. This is not an explicit destructive command
// like a wipe (where targeting "whatever occupies the slot" is the user's intent); it is triggered BY a
// specific snapshot failing to hydrate, so it must move that snapshot and no other. Without the check the
// sequence is: loadTownState observes A -> hydration of A fails -> another tab saves B -> quarantineTown reads
// whatever is present and files B away under A's failure reason. B was fine; it is now in the unreadable pile
// and its player is on a fresh town. `expect` is the { gen, rev } pair the caller observed; a mismatch aborts
// and reports `stale`, and the caller must re-observe rather than proceed.
//
// Returns { ok, rec, gen, stale }:
//   ok   — did the move actually commit? Codex #56-2: a storage failure used to be flattened to null, which
//          the caller could not tell apart from "there was nothing to move" — so boot carried on over a
//          snapshot that was STILL THERE, and the rev guard refused every save for the session. The caller
//          must be able to distinguish, and must not persist over a save it failed to preserve.
//   rec  — the preserved record, or null when the slot was already empty (which is a success, not a failure).
//   gen  — the slot's generation AFTER the bump, for the replacement world to adopt.
export async function quarantineTown(seed, reason, expect) {
    // Codex #59 — `expect` is REQUIRED. It was optional, which silently restored the unfenced behaviour the
    // comment above forbids; the sole caller always has the observed pair.
    if (!expect || typeof expect.gen !== 'number' || typeof expect.rev !== 'number') {
        console.error('ry-farms: quarantineTown requires the observed { gen, rev } pair — refusing');
        return { ok: false, rec: null, gen: 0, stale: false };
    }
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let rec = null, gen = 0, stale = false;
            // Generation FIRST — callbacks fire in request order, so reading it after the snapshot would
            // leave `gen` at 0 and the bump below would always write 1 instead of storedGen + 1.
            const gg = store.get(genKey(seed));
            gg.onsuccess = () => { gen = (gg.result || 0); };
            // Codex #58(a) — the index slice moves WITH the town. Quarantine used to leave it entirely alone, so
            // the replacement inherited the dead town's summary (a ghost on the world map that its own rev guard
            // then refused to overwrite), and also its inbox, pairs, encounters and news. Read the index here so
            // the capture happens in the same transaction as the move.
            let widx = null;
            const rw = store.get(WORLD_KEY); rw.onsuccess = () => { widx = rw.result || { towns: {}, encounters: [] }; };
            const g = store.get('town:' + seed);
            g.onsuccess = () => {
                const snap = g.result;
                if (!snap) return;                      // nothing stored — nothing to preserve
                // CAS the target: only quarantine the exact slot version whose hydration failed.
                if (expect.gen !== gen || expect.rev !== (snap._rev ?? 0)) {
                    stale = true;
                    return;                             // a different occupant arrived — leave it alone
                }
                const slice = sliceKeyed(widx, seed);   // capture BEFORE pruning
                rec = { seed, snap, slice, reason: String(reason || 'unreadable'), at: Date.now(), v: snap.v ?? null, day: snap.day ?? null, rev: snap._rev ?? 0 };
                store.put(rec, 'unreadable:' + seed);
                store.put(pruneKeyed(widx, seed), WORLD_KEY);   // the replacement starts with a clean sheet
                store.delete('town:' + seed);           // vacate the slot so the new session can save
                gen = gen + 1;                          // the slot changed hands — supersede every older writer
                store.put(gen, genKey(seed));
            };
            g.onerror = () => reject(g.error);
            tx.oncomplete = () => resolve({ ok: !stale, rec, gen, stale });
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('quarantine txn aborted'));
        });
    } catch (err) {
        console.warn('ry-farms: could not quarantine the unreadable save', err);
        return { ok: false, rec: null, gen: 0, stale: false };
    }
}

// Codex #57-1 — LOAD THE SNAPSHOT AND ITS EPOCH TOGETHER, in ONE readonly transaction.
//
// Reading them separately is not merely untidy, it reopens the exact hole the epoch closes. If another tab
// quarantines or restores between the two reads, this tab hydrates the OLD rev-47 snapshot while adopting the
// NEW generation — so its next save passes the epoch check and overwrites the replacement town. The pairing is
// the invariant: a snapshot is only safe to write back under the generation it was READ WITH. IndexedDB holds
// a readonly transaction's view constant, so one transaction makes the pair coherent by construction.
//
// Returns { ok, snap, gen, seed }.
//   ok    — did we actually OBSERVE the slot? Codex #58: a failed transaction used to be flattened to
//           `{snap: null, gen: 0}`, which is indistinguishable from a genuinely empty slot — so boot could
//           treat "storage could not be inspected" as "nothing is stored" and found a writable replacement
//           without ever establishing the slot was free. Absence and read-failure are different states and
//           the caller must fail closed on the second, exactly as it already does for a failed quarantine.
//   snap  — the snapshot, or null when the slot is genuinely empty (with ok true).
//   gen   — the slot's generation, paired with `snap` by construction.
//   seed  — RESOLVED (the caller may pass undefined to mean "whatever `latest` points at"), because callers
//           need to know which slot they actually got.
export async function loadTownState(seed) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            let out = { ok: true, snap: null, gen: 0, seed: seed ?? null };
            const finish = (s) => {
                const gg = store.get(genKey(s));           // generation first, then the snapshot
                gg.onsuccess = () => { out.gen = gg.result || 0; };
                const g = store.get('town:' + s);
                g.onsuccess = () => { out.snap = g.result || null; out.seed = s; };
                g.onerror = () => reject(g.error);
            };
            if (seed == null) {
                const l = store.get('latest');             // same transaction, so `latest` cannot move under us
                l.onsuccess = () => { if (l.result) finish(l.result.seed); };
                l.onerror = () => reject(l.error);
            } else finish(seed);
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('load txn aborted'));
        });
    } catch (err) {
        // NOT `{ snap: null }` — see the `ok` contract above. A caller that cannot tell a failed observation
        // from an empty slot will happily found a savable town over one it never managed to look at.
        console.warn('ry-farms: could not read the town slot', err);
        return { ok: false, snap: null, gen: 0, seed: seed ?? null };
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
            let widx = null;
            const rw = store.get(WORLD_KEY); rw.onsuccess = () => { widx = rw.result || { towns: {}, encounters: [] }; };
            const r = store.get('unreadable:' + seed);
            r.onsuccess = () => {
                const rec = r.result;
                if (!rec || !rec.snap) return;       // nothing to restore — leave everything untouched
                store.put(rec.snap, 'town:' + seed);
                // Codex #58(a) — bring the town's index slice back with it, so a recovered town rejoins the world
                // with its own history rather than as a stranger. `rec.slice` is absent on quarantines taken by
                // the build that did not capture one; applyKeyed treats that as nothing to restore.
                if (rec.slice) store.put(applyKeyed(widx, rec.slice, seed), WORLD_KEY);
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

// NOTE: there is deliberately no non-atomic `loadTown()` any more. It read the snapshot in one transaction
// and its generation in another, and that split is exactly Codex #57-1: a quarantine or restore landing
// between the two reads pairs a stale snapshot with a fresh generation, which then passes saveTown's epoch
// check and overwrites the replacement town. Leaving it exported would be an invitation to reintroduce the
// bug, so the atomic loadTownState() above is the only way to read a town.

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



// Codex r20 P1: ATOMIC read-modify-write of the world index in a SINGLE IndexedDB transaction. The old flow
// (loadWorldIndex -> mutate in memory -> saveWorldIndex) was a racy read-modify-write across separate txns —
// two open tabs registering different towns could each read the same index and clobber the other's summary /
// encounter / ledger / inbox. IndexedDB serializes readwrite transactions on a store, so doing the get + mutate
// + put inside ONE txn makes concurrent updates safe (each sees the prior's committed value). `mutator(cur)`
// mutates + returns the index; it must be SYNCHRONOUS (no awaits — the txn would auto-close). Returns the
// stored index, or null on failure (best-effort, never throws into the sim).
//
// Codex #58 — `fence` extends the SLOT INVARIANT to derived state. Any mutation carrying data derived from a
// slot's occupant (a town summary, encounters resolved from it, its inbox) must only land while that occupant
// is still the authoritative one. Pass `{ seed, gen }`; the generation is read in THIS transaction and the
// mutator is skipped entirely on a mismatch (returns null, which every caller already treats as "did not
// happen").
//
// Why the index needed this at all: it has its own rev-monotonic guard, so it inherited the whole #56-1 bug.
// After a quarantine the entry kept the SUPERSEDED town's revision and silently rejected the replacement's
// summaries — reproduced on seed 313131, live world at rev 2 while the index still read rev 8, leaving a ghost
// of a dead town on the world map. And per the review, generation-in-the-summary alone is not enough: a
// DELAYED generation-0 write can still land after the quarantine if the old entry was pruned, which is why the
// fence is checked against the authoritative `gen:<seed>` here rather than against whatever the index holds.
export function updateWorldIndex(mutator, fence) {
    // Codex #59 — the fence is MANDATORY and carries the FULL PAIR. It was optional and generation-only, and
    // both halves of that were wrong:
    //   optional — the same unsafe-shape hazard that got `loadTown`/`readGen`/`saveWorldIndex` deleted. A
    //     future occupant-derived caller that forgets the argument silently gets unfenced behaviour.
    //   generation-only — it could not see that the authoritative SNAPSHOT had moved on. Schedule: rev N
    //     commits and its publication is delayed; another tab loads N, commits N+1 and closes before
    //     publishing; the delayed N publication then sees the same generation and an index revision below N,
    //     so it lands — and detectEncounters makes DURABLE decisions (inbox, metPairs, encounters, news,
    //     ledgers) from that stale summary's doctrine/envoy/day.
    // So both `gen:<seed>` and `town:<seed>` are read in THIS transaction and both must match exactly.
    // A genuinely global, non-occupant-derived maintenance pass should get its own named API (repairWorldIndex)
    // rather than a sentinel here.
    if (!fence || fence.seed == null || typeof fence.gen !== 'number' || typeof fence.rev !== 'number') {
        // Codex #60-3 — fail closed and LOUD, but resolve rather than reject. This check runs before the
        // function's own catch, and `registerWorld` is called fire-and-forget by the autosave, so rejecting
        // produced an unhandled rejection: a bug in index publication escaping into the game loop, which is
        // exactly what this file's best-effort contract exists to prevent. A missing fence is a programming
        // error — it must never write unfenced, and it must never take the game down either.
        console.error('ry-farms: updateWorldIndex requires a { seed, gen, rev } fence — write refused', fence);
        return Promise.resolve(null);
    }
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        // Fence reads FIRST — callbacks fire in request order, so these must precede the index read or the
        // comparison below runs against zeroes.
        let fenceGen = 0, storedRev = null;
        const fg = store.get(genKey(fence.seed)); fg.onsuccess = () => { fenceGen = fg.result || 0; };
        const ft = store.get('town:' + fence.seed); ft.onsuccess = () => { storedRev = ft.result ? (ft.result._rev || 0) : null; };
        const getReq = store.get(WORLD_KEY);
        let out = null, fenced = false;
        getReq.onsuccess = () => {
            if (fence.gen !== fenceGen || fence.rev !== storedRev) {
                fenced = true;
                console.warn(`ry-farms: world-index write skipped — town ${fence.seed} is at (gen ${fenceGen}, rev ${storedRev}), this writer holds (gen ${fence.gen}, rev ${fence.rev})`);
                return;                        // a superseded or stale occupant must not publish derived state
            }
            const cur = getReq.result || { towns: {}, encounters: [] };
            try { out = mutator(cur) || cur; } catch (e) { try { tx.abort(); } catch {} reject(e); return; }
            store.put(out, WORLD_KEY);
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => resolve(fenced ? null : out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('world-index txn aborted'));
    })).catch(err => { console.warn('ry-farms: atomic world-index update failed', err); return null; });
}


// Codex #58 — the world-index SLICE, extracted so every path that vacates a slot handles derived state the
// same way. `wipeTown`/`undoWipe` already did this correctly and `quarantineTown` did not touch the index at
// all, which is how a replacement town inherited the dead one's summary, inbox, pairs, encounters and news.
// Writing a second copy for quarantine is exactly the duplication that produced the sim/render hash divergence,
// so both now call these.
//
// A slice is everything in the index keyed to one seed: its summary, its inbox (including a traveler still
// mid-journey), the pair records and #Codex25-3 the DURABLE metPairs dedup keys (without those, GC drops the
// absent town's met-pairs and a restore lets every old pair re-detect), plus news and encounters naming it.
function sliceKeyed(index, seed) {
    const s = String(seed);
    const inPair = k => { const [a, b] = k.split(':'); return a === s || b === s; };
    return {
        town: index.towns ? index.towns[s] : undefined,
        inbox: (index.inbox && index.inbox[s] !== undefined) ? index.inbox[s] : undefined,
        pairs: index.pairs ? Object.fromEntries(Object.entries(index.pairs).filter(([k]) => inPair(k))) : {},
        metPairs: index.metPairs ? Object.keys(index.metPairs).filter(inPair) : [],
        news: Array.isArray(index.news) ? index.news.filter(n => String(n.origin) === s || String(n.destination) === s) : [],
        encounters: Array.isArray(index.encounters) ? index.encounters.filter(e => String(e.a) === s || String(e.b) === s) : [],
    };
}

// Remove that slice from the index, in place. Always safe to call: an unsaved town has nothing to remove and
// leaves no zombie entry either way.
function pruneKeyed(index, seed) {
    const s = String(seed);
    const inPair = k => { const [a, b] = k.split(':'); return a === s || b === s; };
    if (index.towns) delete index.towns[s];
    if (index.inbox) delete index.inbox[s];
    if (index.pairs) for (const k of Object.keys(index.pairs)) if (inPair(k)) delete index.pairs[k];
    if (index.metPairs) for (const k of Object.keys(index.metPairs)) if (inPair(k)) delete index.metPairs[k];
    if (Array.isArray(index.news)) index.news = index.news.filter(n => String(n.origin) !== s && String(n.destination) !== s);
    if (Array.isArray(index.encounters)) index.encounters = index.encounters.filter(e => String(e.a) !== s && String(e.b) !== s);
    return index;
}

// Put a captured slice back, in place. Encounters and news are merged by key rather than appended, so an undo
// cannot duplicate an event a concurrent tab already re-detected.
function applyKeyed(index, slice, seed) {
    if (!slice) return index;
    const sk = String(seed);
    index.towns = index.towns || {}; index.inbox = index.inbox || {}; index.pairs = index.pairs || {};
    index.metPairs = index.metPairs || {};
    index.news = Array.isArray(index.news) ? index.news : [];
    index.encounters = Array.isArray(index.encounters) ? index.encounters : [];
    if (slice.town !== undefined) index.towns[sk] = slice.town;
    if (slice.inbox !== undefined) index.inbox[sk] = slice.inbox;
    for (const [k, v] of Object.entries(slice.pairs || {})) index.pairs[k] = v;
    for (const k of (slice.metPairs || [])) index.metPairs[k] = 1;
    const encKey = e => `${e.a}:${e.b}:${e.kind || ''}:${e.day ?? ''}:${e.ordinal ?? ''}`;
    const haveEnc = new Set(index.encounters.map(encKey));
    for (const e of (slice.encounters || [])) if (!haveEnc.has(encKey(e))) index.encounters.push(e);
    const newsKey = nn => `${nn.origin}:${nn.destination}:${nn.ordinal ?? ''}`;
    const haveNews = new Set(index.news.map(newsKey));
    for (const nn of (slice.news || [])) if (!haveNews.has(newsKey(nn))) index.news.push(nn);
    return index;
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
            // Codex #57 judgment — a WIPE changes the slot's identity just as a quarantine does, so it bumps
            // the generation too. Without it, another tab still holding the wiped town (its `_retired` flag is
            // per-world, so only the tab that wiped is covered) could save and resurrect it. Read early:
            // callbacks fire in request order, so this must precede the write phase below.
            let wGen = 0;
            const rGen = store.get(genKey(seed)); rGen.onsuccess = () => { wGen = rGen.result || 0; };
            const rSnap = store.get('town:' + seed); rSnap.onsuccess = () => { snap = rSnap.result; };
            const rLatest = store.get('latest'); rLatest.onsuccess = () => { latest = rLatest.result; };
            const rWorld = store.get(WORLD_KEY);
            rWorld.onsuccess = () => {
                const index = rWorld.result || { towns: {}, encounters: [] };
                const slice = sliceKeyed(index, seed);   // capture BEFORE pruning
                pruneKeyed(index, seed);
                store.put(index, WORLD_KEY);          // the town is ALWAYS removed from the index (an unsaved town too — no zombie)
                store.delete('town:' + seed);
                store.put(wGen + 1, genKey(seed));    // supersede any tab still holding this town
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
                store.put(snap, 'town:' + snap.seed);
                // Codex #57 judgment — undo puts a town BACK, which supersedes any tab holding whatever
                // occupied the slot meanwhile, so it bumps the generation too. Unlike the other call sites the
                // seed is not known until the backup has been read (undoWipe takes no argument — it restores
                // whatever was last wiped), so the generation is read NESTED here rather than up front. That is
                // legal and still atomic: the transaction stays active while its requests are outstanding.
                const rGen = store.get(genKey(snap.seed));
                rGen.onsuccess = () => { store.put((rGen.result || 0) + 1, genKey(snap.seed)); };
                store.put(latest && latest.seed === snap.seed ? latest
                    : { seed: snap.seed, day: snap.day, season: snap.season, year: snap.year, savedAt: Date.now() }, 'latest');
                if (slice) store.put(applyKeyed(rWorld.result || { towns: {}, encounters: [] }, slice, snap.seed), WORLD_KEY);
                // #Codex27-2 consume the coherent backup AND any legacy keys (whichever we restored from)
                store.delete('backup:wipe'); store.delete('backup:town'); store.delete('backup:latest'); store.delete('backup:worldslice');
            };
            tx.oncomplete = () => resolve(restoredSeed);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('undo txn aborted'));
        }).then(async (restoredSeed) => {
            // #saveport — undoing an import restores the TOWN; its memory rows were cleared by the
            // import and will regenerate via backfill, the same as the imported town's did. Clearing
            // again here removes anything the interim occupant wrote under this seed.
            if (restoredSeed != null) {
                try { await clearTownMemoryRows(restoredSeed); }
                catch (err) { console.warn('ry-farms: undo restored the town; stale memory rows remain until backfill', err); }
            }
            return restoredSeed;
        });
    } catch (err) {
        console.warn('ry-farms: undo failed', err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// #saveport — town export/import (a file the player holds).
//
// The snapshot is structured-clone data: Maps, Sets and typed arrays ride IndexedDB fine and are
// DESTROYED by JSON — a Map silently becomes `{}` and fromSave throws "d.chunks is not iterable"
// (the exact trap serialize()'s own comment documents). So the file format is tagged JSON: every
// clone-only type is wrapped as { $: tag, v } and reversed on import. Plain objects that happen to
// own a `$` key are escaped too, so the tagging cannot be spoofed by data.
// ---------------------------------------------------------------------------

const TYPED = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };

function b64FromBytes(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
function bytesFromB64(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

export function encodeSnapshot(v) {
    if (v === undefined) return { $: 'U' };
    if (typeof v === 'number' && !Number.isFinite(v)) return { $: 'N', v: String(v) };   // JSON turns NaN/Infinity into null SILENTLY
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Map) return { $: 'M', v: [...v].map(([k, x]) => [encodeSnapshot(k), encodeSnapshot(x)]) };
    if (v instanceof Set) return { $: 'S', v: [...v].map(encodeSnapshot) };
    if (v instanceof Date) return { $: 'D', v: v.toISOString() };
    if (v instanceof ArrayBuffer) return { $: 'B', v: b64FromBytes(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) {
        const t = v.constructor.name;
        if (!TYPED[t]) throw new Error(`unencodable view ${t}`);
        return { $: 'T', t, v: b64FromBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (Array.isArray(v)) return v.map(encodeSnapshot);
    const out = {};
    for (const k of Object.keys(v)) out[k] = encodeSnapshot(v[k]);
    // escape a plain object that owns `$`, or decode would misread it as a tag
    return Object.prototype.hasOwnProperty.call(v, '$') ? { $: 'O', v: out } : out;
}

export function decodeSnapshot(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decodeSnapshot);
    if (typeof v.$ === 'string') {
        switch (v.$) {
            case 'U': return undefined;
            case 'N': return Number(v.v);
            case 'M': return new Map(v.v.map(([k, x]) => [decodeSnapshot(k), decodeSnapshot(x)]));
            case 'S': return new Set(v.v.map(decodeSnapshot));
            case 'D': return new Date(v.v);
            case 'B': return bytesFromB64(v.v).buffer;
            case 'T': {
                const Ctor = TYPED[v.t];
                if (!Ctor) throw new Error(`unknown typed array ${v.t}`);
                const bytes = bytesFromB64(v.v);
                // The constructor does not reject every fractional element count (Codex #121): three
                // bytes as Uint16Array yielded a ONE-element view with the third byte silently outside
                // it — corruption altered the data instead of refusing. Exactness is the check.
                if (bytes.byteLength % Ctor.BYTES_PER_ELEMENT !== 0) throw new Error(`corrupt ${v.t}: ${bytes.byteLength} bytes`);
                return new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
            }
            case 'O': {
                // per-KEY, not whole: the wrapped object owns a '$' of its own — that is the entire
                // reason it was escaped — and decoding it whole re-read that '$' as a tag and threw
                // "unknown tag <data>". Found by the direct-shape test, not by the matured snapshot,
                // which happens to contain no $-keyed objects at all.
                const o = {};
                for (const k of Object.keys(v.v)) o[k] = decodeSnapshot(v.v[k]);
                return o;
            }
            default: throw new Error(`unknown tag ${v.$}`);
        }
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = decodeSnapshot(v[k]);
    return out;
}

// The file the player downloads. Metadata first so a human (or a future build) can identify it
// without decoding; the snapshot itself stays exactly what serialize() produced.
export async function buildTownExport(world) {
    // A non-persisting session is running a SCRATCH world founded over a slot that could not be
    // read. Exporting it would hand the player a file they will treat as their real town's backup —
    // worse than no file. The check lives in saveTown for saves; export needs its own, because
    // serialize() itself always answers.
    if (world._persistenceDisabled) return null;
    const snap = world.serialize();
    if (!snap) return null;
    // SNAPSHOT-ONLY, by decision rather than omission (Codex #121 r3). The memory transport took
    // ten findings across three rounds — occupant identity, fences, cross-database atomicity — and
    // the root cause was structural: two databases cannot share a transaction. A town file carries
    // the town; memories regenerate from it via backfill on the destination, and battle tales, which
    // are display-derived and irreconstructible, stay behind. Disclosed in the UI, not silent.
    return {
        format: 'propagate-town',
        formatV: 1,
        exported: new Date().toISOString(),
        seed: world.seed,
        town: world.name || null,
        day: world.day,
        v: snap.v,
        snap: encodeSnapshot(snap),
    };
}

// Import: validate EVERYTHING before touching storage, then write like the other occupancy-change
// paths (COMPATIBILITY.md): one readwrite transaction, generation bump, coherent 'backup:wipe' of
// whatever the slot held — so RYFARMS.undoWipe() restores the pre-import town, same as after a wipe.
//
// `hydrate` is the real consumer (World.fromSave), passed in because save.js deliberately does not
// import farm.js. Validation IS hydration: if the real boot path accepts a deep copy, boot will
// accept the stored one; anything less re-opens the reasoned-about-instead-of-executed hole.
// The pure half of import: decode + validate, no storage. Split out (Codex-discipline: a mutation
// making validation run on the STORED object escaped every test, because the difference is invisible
// without IndexedDB — as a pure function the copy property is directly assertable).
export function parseTownFile(parsed, hydrate) {
    if (!parsed || parsed.format !== 'propagate-town') return { ok: false, error: 'not a Propagate town file' };
    // formatV gates the ENVELOPE the way snap.v gates the schema (Codex #121): a file from a future
    // build whose envelope we cannot interpret is refused, not guessed at.
    if (parsed.formatV !== 1) return { ok: false, error: `file format v${parsed.formatV} is newer than this build` };
    let snap;
    try { snap = decodeSnapshot(parsed.snap); } catch (err) { return { ok: false, error: `unreadable file: ${err.message}` }; }
    // EXACT uint32, not merely finite (Codex #121): World canonicalizes seed >>> 0, so 1.5, -1 and
    // 2^32+1 all pass a finite check, hydrate as a DIFFERENT seed, and the import then stores the
    // town under a key its own saves will never address again.
    if (!snap || typeof snap !== 'object' || !Number.isInteger(snap.seed) || snap.seed !== (snap.seed >>> 0)) {
        return { ok: false, error: 'file has no usable town seed' };
    }
    // The human-readable preview must AGREE with the snapshot it previews (Codex #121): a file whose
    // envelope claims one town while its payload imports another is exactly how a player gets tricked
    // into replacing the wrong save. The preview is what the confirm beat shows.
    if (parsed.seed !== snap.seed) return { ok: false, error: 'file preview does not match its town' };
    if (parsed.v !== snap.v) return { ok: false, error: 'file preview does not match its town' };
    if ((parsed.town ?? null) !== (snap.name ?? null)) return { ok: false, error: 'file preview does not match its town' };
    if (parsed.day !== snap.day) return { ok: false, error: 'file preview does not match its town' };
    let hydrated;
    try {
        hydrated = hydrate(structuredClone(snap));   // migrate() mutates in place — validate a copy, store the original
    } catch (err) {
        return { ok: false, error: String(err && err.message || 'town failed to load') };
    }
    // belt over the uint32 braces: whatever the hydrator canonicalized, it must still be THIS slot
    if (hydrated && typeof hydrated.seed === 'number' && hydrated.seed !== snap.seed) {
        return { ok: false, error: 'town hydrates under a different seed' };
    }
    // No memories section: the file carries the town alone (see buildTownExport). A dev-era file
    // with a `memories` field imports its town and the field is ignored — import clears the seed's
    // rows regardless, so nothing foreign is ever installed or preserved.
    return { ok: true, snap };
}

export async function importTownFile(parsed, hydrate) {
    const p = parseTownFile(parsed, hydrate);
    if (!p.ok) return p;
    const snap = p.snap;
    const seed = snap.seed;
    let replacedFlag = false;
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let gen = 0, existing, latest, oldBackup, lgBackup;
            replacedFlag = false;
            const rGen = store.get(genKey(seed)); rGen.onsuccess = () => { gen = rGen.result || 0; };
            const rSnap = store.get('town:' + seed); rSnap.onsuccess = () => { existing = rSnap.result; };
            const rLatest = store.get('latest'); rLatest.onsuccess = () => { latest = rLatest.result; };
            const rBk = store.get('backup:wipe'); rBk.onsuccess = () => { oldBackup = rBk.result; };
            const rLg = store.get('backup:town'); rLg.onsuccess = () => { lgBackup = rLg.result; };
            const rWorld = store.get(WORLD_KEY);
            rWorld.onsuccess = () => {
                const index = rWorld.result || { towns: {}, encounters: [] };
                // preserve what the slot held, exactly as wipeTown does — one coherent undoable object
                if (existing) {
                    replacedFlag = true;
                    store.put({ seed, snap: existing, latest, slice: sliceKeyed(index, seed) }, 'backup:wipe');
                } else if (oldBackup && oldBackup.seed === seed) {
                    // EMPTY-slot import over a same-seed backup (Codex #121 r2): the backup's
                    // coherence window closed when this import claimed the slot; supersede it. A
                    // DIFFERENT seed's backup is untouched.
                    store.delete('backup:wipe');
                }
                if (lgBackup && lgBackup.seed === seed && !existing) {
                    // ...and the PRE-UPGRADE 3-key backup equally (Codex #121 r3): undoWipe still
                    // honours it, so leaving it standing lets a legacy undo restore snapshot A over
                    // whatever this import installs.
                    store.delete('backup:town'); store.delete('backup:latest'); store.delete('backup:worldslice');
                }
                // the imported town's index summary is unknown until its first save — a stale slice is
                // the danger COMPATIBILITY.md documents, so prune rather than carry it
                pruneKeyed(index, seed);
                store.put(index, WORLD_KEY);
                store.put(snap, 'town:' + seed);
                store.put(gen + 1, genKey(seed));                  // occupancy changed: supersede every live tab
                store.put({ seed, day: snap.day || 1, season: snap.season, year: snap.year, savedAt: Date.now() }, 'latest');
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('import txn aborted'));
        });
        // The slot committed; now the memory rows. A different database, so not atomic with the slot
        // — the failure mode is an imported town with stale rows, surfaced rather than silent.
        // The seed's memory rows and its backfill marker are CLEARED — one memory-db transaction,
        // discovery included. The imported town must not wear the displaced town's lives, and the
        // marker must not suppress the new occupant's backfill sweep. Not atomic with the slot
        // (different database, structurally): a failure means stale rows survive until backfill or
        // the next import, and it is SURFACED so the UI never presents this as a clean import.
        let memoryError = null;
        try { await clearTownMemoryRows(seed); }
        catch (err) { memoryError = String(err && err.message || 'old memory rows not cleared'); }
        return { ok: true, seed, replaced: replacedFlag, memoryError };
    } catch (err) {
        return { ok: false, error: `storage write failed: ${err && err.message}` };
    }
}
