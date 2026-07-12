// reconciliation.js — the PURE, SEEDED model under the human/orc grievance/parley system (#reconciliation).
//
// See ORC_HUMAN_RECONCILIATION_PLAN.md (v2, post-council) + ORC_HUMAN_LORE.md. This module is the
// determinism-critical CORE the council demanded be isolated and harnessed FIRST: faction-lineage pair keys
// (so grievance and reconciliation compound ACROSS generations, not one-shot per town-pair), the count-based
// disposition fold (integer counts, quantized — never a float accumulator), and the seeded 3-branch encounter
// resolution. Every function here is a PURE function of its arguments; the seed is drawn ONLY from
// (pairKey, ordinal, quantized disposition, envoy digests) — NEVER Date.now/at/world.rand/LLM text/array index
// (F2 banned inputs). Live wiring (world-index ledger, save migration, town inbox, sim effects) layers on top
// of this core in a later slice; keeping the decision math pure is what makes the whole thing testable.

import { hashString, mulberry32 } from './dna.js';

// --- F1: the faction-lineage pair key --------------------------------------------------------------------
// A town's faction-lineage identity = its culture + a stable lineage ROOT (the earliest ancestor town it
// descends from — from heir lineage — else itself). Two towns on the same frontier ACROSS GENERATIONS share a
// key, so a gen-1 raid and a gen-3 parley accumulate in one ledger. This is the only structure where the
// reconciliation arc has a second act (a town-pair meets exactly once).
export function factionLineage(town) {
    // Codex r20 P1: use the PROPAGATED lineage root (stable across all generations from one origin) when present,
    // so a gen-3 town keyed to the same ledger as gen-1. Fall back to the immediate ancestor / own seed for
    // legacy summaries that predate lineageRoot.
    const root = town.lineageRoot != null ? String(town.lineageRoot)
        : (Array.isArray(town.lineage) && town.lineage.length ? town.lineage.map(String).filter(Boolean).sort()[0] : String(town.seed));
    return `${town.culture === 'orc' ? 'orc' : 'human'}:${root}`;
}
export function lineagePairKey(a, b) {
    const la = factionLineage(a), lb = factionLineage(b);
    return la < lb ? `${la}|${lb}` : `${lb}|${la}`;
}
export function isCrossFaction(a, b) { return (a.culture === 'orc') !== (b.culture === 'orc'); }

// --- Slice A: disposition (count-based fold, hysteresis tiers) --------------------------------------------
export const DISPOSITION = {
    fresh: -0.6,            // a fresh human<->orc frontier is deeply, inheritedly hostile (headroom left, not -1)
    grievance: -0.12,       // a raid
    reconciliation: 0.08,   // an honored parley (softening is deliberately slower than hardening = negativity bias)
    betrayal: -0.25,        // a betrayed parley (a big shock; ~3 grievances to undo)
    openAt: 0.15, fallBelow: -0.05, openToHostile: -0.35,   // hysteresis deadband
};
// D in [-1,1] — a pure fold over integer event COUNTS in the pair ledger. Quantized so float order can't flip
// a tier. `grievances` entries with kind:'betrayal' count as betrayals; the rest as raids.
export function foldDisposition(ledger) {
    const g = (ledger && ledger.grievances) || [];
    const r = (ledger && ledger.reconciliations) || [];
    const betrayals = g.reduce((n, x) => n + (x && x.kind === 'betrayal' ? 1 : 0), 0);
    const raids = g.length - betrayals;
    const d = DISPOSITION.fresh + raids * DISPOSITION.grievance + betrayals * DISPOSITION.betrayal + r.length * DISPOSITION.reconciliation;
    return +Math.max(-1, Math.min(1, d)).toFixed(3);
}
// tier with hysteresis: to REACH 'open' you must clear +0.15; to LEAVE 'open' you must fall past -0.05
// (and to fall all the way to 'hostile' from open, past -0.35). Prevents thrash at a boundary.
export function dispositionTier(d, prev = 'hostile') {
    if (prev === 'open') {
        if (d < DISPOSITION.openToHostile) return 'hostile';
        if (d < DISPOSITION.fallBelow) return 'wary';
        return 'open';
    }
    if (d > DISPOSITION.openAt) return 'open';
    if (d > DISPOSITION.fallBelow) return 'wary';
    return 'hostile';
}

// --- Slice B: seeded 3-branch encounter resolution -------------------------------------------------------
// An envoy digest is the decision-relevant traits, quantized, + the envoy seed — a stable string fed into the
// outcome seed. (The counterpart town isn't loaded at resolve time, so this digest is baked at register time.)
export function envoyDigest(e) {
    return `${e.seed}:${(e.curiosity || 0).toFixed(2)}:${(e.honesty || 0).toFixed(2)}:${(e.collaboration || 0).toFixed(2)}`;
}
// parley is ATTEMPTED only if a willing envoy comes to the table on each side (else auto-raid). Willingness is
// CURIOSITY/openness, NOT honesty — because a FALSE extender must still be able to attend in order to betray
// ("used the overture as cover"). Honesty gates whether an attendee BETRAYS, below — not whether they show up.
// (This resolves an internal contradiction in the council's spec, which gated orc attendance on honesty>0.45
// while also requiring honesty<0.3 to betray, making orc betrayal impossible.) Humans have two ways to the
// table (curiosity OR collaboration); orcs a single, tighter one.
function humanWillParley(e) { return (e.curiosity || 0) > 0.6 || (e.collaboration || 0) > 0.6; }
function orcWillParley(e) { return (e.curiosity || 0) > 0.6; }

export const PARLEY = {
    hostile: { honored: 0.25, betrayed: 0.10 },   // rest -> raid
    wary: { honored: 0.50, betrayed: 0.15 },      // betrayal risk peaks mid: enough contact to try, enough distrust to exploit
    open: { honored: 0.80, betrayed: 0.05 },
};

// Returns { outcome: 'raid'|'honored'|'betrayed', attempted, betrayer? }. Fully seeded + pure.
export function resolveEncounter({ pairKey, ordinal, humanEnvoy, orcEnvoy, disposition, tier }) {
    const rand = mulberry32(hashString(`${pairKey}:${ordinal}:${(+disposition).toFixed(3)}:${envoyDigest(humanEnvoy)}:${envoyDigest(orcEnvoy)}`));
    if (!(humanWillParley(humanEnvoy) && orcWillParley(orcEnvoy))) return { outcome: 'raid', attempted: false };
    const p = PARLEY[tier] || PARLEY.hostile;
    const roll = rand();
    // betrayal only if the attempting extender is FALSE (honesty < 0.3) — "used the overture as cover"
    const humanFalse = (humanEnvoy.honesty ?? 1) < 0.3, orcFalse = (orcEnvoy.honesty ?? 1) < 0.3;
    if ((humanFalse || orcFalse) && roll < p.betrayed) return { outcome: 'betrayed', attempted: true, betrayer: humanFalse ? 'human' : 'orc' };
    if (roll < p.betrayed + p.honored) return { outcome: 'honored', attempted: true };   // when neither is false, this window is all honored
    return { outcome: 'raid', attempted: true };   // an honest attempt that simply fizzled
}

// Pure ledger append (returns a NEW ledger) — grievance for raid/betrayal, reconciliation for honored. Idempotent
// per (pairKey, ordinal): re-recording the same encounter ordinal is a no-op (mirrors the world layer's `met` set).
export function applyOutcome(ledger, outcome, meta) {
    const l = { grievances: [...((ledger && ledger.grievances) || [])], reconciliations: [...((ledger && ledger.reconciliations) || [])] };
    const has = (arr) => arr.some(x => x.ordinal === meta.ordinal);
    if (outcome === 'raid' || outcome === 'betrayed') {
        if (!has(l.grievances)) l.grievances.push({ ordinal: meta.ordinal, day: meta.day, kind: outcome === 'betrayed' ? 'betrayal' : 'raid', name: meta.name || null });
    } else if (outcome === 'honored') {
        if (!has(l.reconciliations)) l.reconciliations.push({ ordinal: meta.ordinal, day: meta.day, name: meta.name || null });
    }
    return l;
}

// ── Slice B: the weary traveler ────────────────────────────────────────────────────────────────────────────
// The AWARENESS step before an encounter. Everything a traveler "is" — who set out, from where, whether they
// make it, and WHICH SIM-DAY they arrive — is decided the moment two towns come within rumor range, as a PURE
// seeded fn. The world-map marker only interpolates toward that pre-decided arrival; the animation decides
// nothing. So the mechanical effect (Slice C) lands deterministically no matter the wall-clock/reload/tab.
export const TRAVELER = {
    rumorMult: 1.9,      // rumor radius = reach-sum * this (wider than the raid radius, so a warning gets lead time)
    loseOdds: 0.20,      // ~1 in 5 travelers is lost en route -> the warning never comes -> surprise contact (Slice C)
    daysPerUnit: 0.045,  // sim-days of journey per world-map distance unit
    minDays: 2, maxDays: 16,
};
export function journeyDays(dist) {
    return Math.max(TRAVELER.minDays, Math.min(TRAVELER.maxDays, Math.round(dist * TRAVELER.daysPerUnit)));
}
const BEARING = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north'));

// Pure. Returns the whole traveler up front: origin/destination town seeds, fate, the sim-DAY it arrives, and
// the procedural warning the destination will hear. `dx,dy` point origin->? we pass the raw vector A->B and
// resolve bearing from the destination's side below.
export function seedTraveler({ pairKey, ordinal, aSeed, bSeed, aCulture, bCulture, aName, bName, ax, ay, bx, by, discoveryDay, dist }) {
    const rand = mulberry32(hashString(`trav:${pairKey}:${ordinal}:${aSeed}:${bSeed}`));
    const originIsA = rand() < 0.5;
    const origin = originIsA ? aSeed : bSeed, destination = originIsA ? bSeed : aSeed;
    const fromCulture = originIsA ? aCulture : bCulture, toCulture = originIsA ? bCulture : aCulture;
    const fromName = originIsA ? aName : bName;
    // bearing FROM the destination TOWARD the origin (where the danger/kin lies)
    const [ox, oy] = originIsA ? [ax, ay] : [bx, by];
    const [tx, ty] = originIsA ? [bx, by] : [ax, ay];
    const bearing = BEARING(ox - tx, oy - ty);
    const fate = rand() < TRAVELER.loseOdds ? 'lost' : 'arrives';
    const arrivalDay = discoveryDay + journeyDays(dist);
    const cross = (fromCulture === 'orc') !== (toCulture === 'orc');
    const warning = cross
        ? (fromCulture === 'orc'
            ? `an orc warband stirs to the ${bearing}`
            : `smoke from human hearths to the ${bearing}`)
        : `kin are near — a ${toCulture === 'orc' ? 'warband' : 'village'} to the ${bearing}`;
    return { origin, destination, fromCulture, toCulture, fromName, bearing, fate, arrivalDay, warning, ordinal, pairKey };
}
