// memory-backfill.js — seed the browser memory store from towns that ALREADY EXIST (#memory-backfill).
//
// The store shipped empty for everyone: the write-back only compiles the ACTIVE town going forward,
// behind a maturity throttle — so players with living worlds saw "no memories" despite their saves
// holding exactly the data the memory promises (owner: "at least there is some data that supports
// what already exists"). This module walks the world index once per boot and, for any saved town not
// yet CLAIMED, hydrates the save through the standard World.fromSave and compiles it through the
// SAME builders the live writers use (lifeOf / townHistoryOf / inventionsOf) — one life shape, one
// code path, zero drift.
//
// Deliberate choices:
//   - The maturity throttle is SKIPPED here: a farmer's name, archetype, and founding creeds are a
//     real identity worth representing (the local store is free; the throttle guards paid ingest).
//   - LOCAL ONLY — no server echo. Backfilling a dozen town histories into a self-hosted
//     SuperMemory's extraction pipeline in one burst is exactly what the live cadence exists to
//     avoid; matured lives still echo through the normal writers.
//   - ATOMIC CLAIMS (Codex #92 P1): a COMPLETION MARKER lands only after every required payload
//     succeeded. A mid-batch storage failure leaves no marker; the next boot retries the whole
//     town — already-landed rows fill in by upsert, so a town can never be permanently partial.
//   - ATTEMPT-BASED BUDGET + ROTATION (Codex #92 P2): hydration attempts (not successes) consume
//     the per-boot bound, and the candidate order rotates per boot, so corrupt snapshots can
//     neither blow the budget nor permanently starve the towns behind them.
//   - The ACTIVE-town completion pass runs INDEPENDENTLY of the index (Codex #92 P2): a brand-new
//     town before its first autosave still gets its farmers represented. It fills only MISSING
//     life docs — the live cadence's fresher copies are never overwritten — and leaves history/
//     inventions to the live writers, which compile them fresher than any save could.
//   - Battles cannot be backfilled — they are display-derived records that were never saved; the
//     war record accrues from the moment the store shipped.
//
// Off-sim, boot-idle, display/persistence only — determinism untouched by construction.

import { loadWorldIndex, loadTownState } from './save.js';
import { storePayload, lifeKeysForTown, setBackfillMarker, backfillMarkers } from './memory-store.js';
import { lifeOf, townHistoryOf } from './memory-writeback.js';
import { inventionsOf } from './memory-invent.js';
import { World } from './farm.js';

const MAX_TOWNS_PER_BOOT = 6;

// Claim one hydrated town: fill its MISSING lives (upsert-safe under retry), then history and
// inventions, and set the marker ONLY when everything required has landed. Returns true on a
// completed claim.
async function claimTown(w) {
    const town = w.name || 'PROPAGATE';
    const rev = w._rev || w.day || 0;
    const haveKeys = await lifeKeysForTown(w.seed);
    if (haveKeys === null) return false;                              // store refused — claim nothing
    const missing = w.farmers.filter(f => !haveKeys.has(String(f.sheet.seed))).map(lifeOf);
    if (missing.length) {
        const wrote = await storePayload({ town, townSeed: w.seed, rev, farmers: missing });
        if (!wrote || !wrote.written) return false;                   // partial rows are upserts; no marker -> full retry next boot
    }
    const h = townHistoryOf(w);
    if (h) { const r = await storePayload({ town, townSeed: w.seed, rev, townHistory: h }); if (!r || !r.written) return false; }
    const inv = inventionsOf(w);
    if (inv) { const r = await storePayload({ town, townSeed: w.seed, rev, townInventions: inv }); if (!r || !r.written) return false; }
    return setBackfillMarker(w.seed);                                 // claimed ONLY now
}

// io is injectable for tests (node has no IndexedDB): { loadIndex, loadState } default to save.js;
// io.rotationNonce pins the per-boot rotation for deterministic tests. `activeWorld` (optional) is
// the ALREADY-HYDRATED live world — its completion runs even when the index is empty.
export async function backfillMemory({ maxTowns = MAX_TOWNS_PER_BOOT, io = {}, activeWorld = null } = {}) {
    const loadIndex = io.loadIndex || loadWorldIndex;
    const loadState = io.loadState || loadTownState;
    let done = 0;
    // ---- the SWEEP over saved towns (skips the active seed — its pass below owns it) ----
    try {
        const idx = await loadIndex();
        const activeSeed = activeWorld ? String(activeWorld.seed) : null;
        let seeds = Object.keys((idx && idx.towns) || {}).filter(s => String(s) !== activeSeed);
        if (seeds.length) {
            const claimed = await backfillMarkers();
            if (claimed !== null) {                                    // null = store refused — sweep nothing this boot
                seeds = seeds.filter(s => !claimed.has(String(s)));
                if (seeds.length > 1) {                                // rotate so a corrupt head never starves the tail
                    const off = Number(io.rotationNonce != null ? io.rotationNonce : Math.floor(Date.now() / 60000)) % seeds.length;
                    seeds = [...seeds.slice(off), ...seeds.slice(0, off)];
                }
                let attempts = 0;
                for (const seedStr of seeds) {
                    if (attempts >= maxTowns) break;
                    attempts++;                                        // hydration ATTEMPTS consume the budget
                    let st = null;
                    try { st = await loadState(Number(seedStr)); } catch { continue; }
                    if (!st || !st.ok || !st.snap) continue;
                    let w = null;
                    try { w = World.fromSave(st.snap); } catch { continue; }   // a corrupt save never blocks the sweep
                    if (!w || !w.farmers || !w.farmers.length) continue;
                    if (await claimTown(w)) done++;
                }
            }
        }
    } catch { /* refused index — the completion pass below still runs */ }
    // ---- the ACTIVE town's completion pass (no hydration needed; independent of the index) ----
    try {
        if (activeWorld && !activeWorld._persistenceDisabled && activeWorld.farmers && activeWorld.farmers.length) {
            const haveKeys = await lifeKeysForTown(activeWorld.seed);
            if (haveKeys !== null) {
                const missing = activeWorld.farmers.filter(f => !haveKeys.has(String(f.sheet.seed))).map(lifeOf);
                if (missing.length) {
                    const wrote = await storePayload({ town: activeWorld.name || 'PROPAGATE', townSeed: activeWorld.seed, rev: activeWorld._rev || activeWorld.day || 0, farmers: missing });
                    if (wrote && wrote.written) done++;
                }
            }
        }
    } catch { /* best-effort — next boot self-heals */ }
    return done;
}
