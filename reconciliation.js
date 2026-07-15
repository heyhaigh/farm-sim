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
    // #Codex24-4: the fold is over integer COUNTS, so a compacted ledger (aggregate counters + a bounded recent
    // tail) yields the SAME disposition as the old full-array ledger — determinism-preserving by construction.
    // Support both shapes: counters when present, else fall back to counting legacy arrays.
    let raids, betrayals, recon;
    if (ledger && ledger.raidN != null) {
        raids = ledger.raidN | 0; betrayals = ledger.betrayalN | 0; recon = ledger.reconcileN | 0;
    } else {
        const g = (ledger && ledger.grievances) || [], r = (ledger && ledger.reconciliations) || [];
        betrayals = g.reduce((n, x) => n + (x && x.kind === 'betrayal' ? 1 : 0), 0);
        raids = g.length - betrayals; recon = r.length;
    }
    const d = DISPOSITION.fresh + raids * DISPOSITION.grievance + betrayals * DISPOSITION.betrayal + recon * DISPOSITION.reconciliation;
    return +Math.max(-1, Math.min(1, d)).toFixed(3);
}
// #Codex24-4: total recorded events in a ledger (= the next encounter ordinal). Works for both shapes.
export function ledgerCount(ledger) {
    if (ledger && ledger.raidN != null) return (ledger.raidN | 0) + (ledger.betrayalN | 0) + (ledger.reconcileN | 0);
    return (((ledger && ledger.grievances) || []).length) + (((ledger && ledger.reconciliations) || []).length);
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
// #134 `suePeace` = the town LEARNED (from repeated raids) to seek a truce, so its envoy comes to the table
// willing even if their raw curiosity/collaboration wouldn't otherwise carry them there.
function humanWillParley(e) { return !!e.suePeace || (e.curiosity || 0) > 0.6 || (e.collaboration || 0) > 0.6; }
function orcWillParley(e) { return !!e.suePeace || (e.curiosity || 0) > 0.6; }

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

// Pure ledger append (returns a NEW COMPACTED ledger) — grievance for raid/betrayal, reconciliation for honored.
// #Codex24-4: the ledger is now aggregate COUNTERS (raidN/betrayalN/reconcileN — all foldDisposition needs) plus
// a BOUNDED recent tail for display, instead of two ever-growing arrays. Idempotent per (pairKey, ordinal): the
// ordinal is monotonic (= the ledger's total event count at detection time), so a replay whose ordinal is below
// the current total is a no-op — same guarantee the old per-ordinal `has()` scan gave, without the unbounded array.
const LEDGER_RECENT_CAP = 24;
export function applyOutcome(ledger, outcome, meta) {
    // migrate a legacy array-shaped ledger to counters (exact counts → identical disposition + ordinal)
    let raidN, betrayalN, reconcileN;
    if (ledger && ledger.raidN != null) {
        raidN = ledger.raidN | 0; betrayalN = ledger.betrayalN | 0; reconcileN = ledger.reconcileN | 0;
    } else {
        const g = (ledger && ledger.grievances) || [];
        betrayalN = g.reduce((n, x) => n + (x && x.kind === 'betrayal' ? 1 : 0), 0);
        raidN = g.length - betrayalN; reconcileN = (((ledger && ledger.reconciliations) || [])).length;
    }
    const recent = [...((ledger && ledger.recent) || [])];
    const l = { raidN, betrayalN, reconcileN, recent, tier: ledger && ledger.tier, firstTrustDone: ledger && ledger.firstTrustDone };
    // #Codex25-4 idempotency: accept ONLY the exact next ordinal. A repeat (ordinal < total) is a replay and a
    // gap (ordinal > total) is out-of-order — both are no-ops. `< total` alone double-counted a repeated nonzero
    // ordinal. The real caller always passes ledgerCount(led) (= total), so sequential appends still land.
    if (meta.ordinal !== raidN + betrayalN + reconcileN) return l;
    if (outcome === 'raid') l.raidN++;
    else if (outcome === 'betrayed') l.betrayalN++;
    else if (outcome === 'honored') l.reconcileN++;
    else return l;   // 'raid'|'betrayed'|'honored' only — anything else records nothing
    recent.push({ ordinal: meta.ordinal, day: meta.day, kind: outcome === 'honored' ? 'reconcile' : outcome === 'betrayed' ? 'betrayal' : 'raid', name: meta.name || null });
    while (recent.length > LEDGER_RECENT_CAP) recent.shift();
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

// #doctrine (strategist v1) — a town's war/movement posture, four historical models. `commit` = fraction of
// the DEFENDER's stores a raid takes (replaces the flat 0.2); `scouts` = 0 silent/surprise, 1 normal, 2
// telegraphed+reliable; `biteReduce` = the walled town's defensive reduction of an incoming raid. Pure data.
export const DOCTRINE_DEFS = {
    comitatus:   { commit: 0.15, scouts: 1, biteReduce: 1 },    // Germanic sworn band — orc default; disciplined raid
    strandhogg:  { commit: 0.30, scouts: 0, biteReduce: 1 },    // Viking shore-snatch — silent, surprise, gone by tide
    greatMuster: { commit: 0.55, scouts: 2, biteReduce: 1 },    // fyrd/hoplite levy — the whole host, slow + telegraphed
    palisade:    { commit: 0,    scouts: 2, biteReduce: 0.5 },  // Pueblo/Swiss turtle — never raids; halves an incoming one
};
export function doctrineDef(id) { return DOCTRINE_DEFS[id] || DOCTRINE_DEFS.comitatus; }
export function journeyDays(dist) {
    return Math.max(TRAVELER.minDays, Math.min(TRAVELER.maxDays, Math.round(dist * TRAVELER.daysPerUnit)));
}
const BEARING = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north'));

// Pure. Returns the whole traveler up front: origin/destination town seeds, fate, the sim-DAY it arrives, and
// the procedural warning the destination will hear. `dx,dy` point origin->? we pass the raw vector A->B and
// resolve bearing from the destination's side below.
export function seedTraveler({ pairKey, ordinal, aSeed, bSeed, aCulture, bCulture, aName, bName, ax, ay, bx, by, discoveryDay, dist, aScouts = 1, bScouts = 1 }) {
    const rand = mulberry32(hashString(`trav:${pairKey}:${ordinal}:${aSeed}:${bSeed}`));
    let originIsA = rand() < 0.5;
    // #doctrine scouting: the warning is carried by whoever SENDS scouts. A silent town (scouts=0) never
    // originates one, so flip to the scouting side; if NEITHER scouts, no warning is ever carried -> the fate
    // is forced 'lost' -> guaranteed surprise contact. A redundant pair (scouts=2) makes the warning reliable.
    if ((originIsA ? aScouts : bScouts) === 0 && (originIsA ? bScouts : aScouts) > 0) originIsA = !originIsA;
    const bothSilent = aScouts === 0 && bScouts === 0;
    const origin = originIsA ? aSeed : bSeed, destination = originIsA ? bSeed : aSeed;
    const fromCulture = originIsA ? aCulture : bCulture, toCulture = originIsA ? bCulture : aCulture;
    const fromName = originIsA ? aName : bName;
    // bearing FROM the destination TOWARD the origin (where the danger/kin lies)
    const [ox, oy] = originIsA ? [ax, ay] : [bx, by];
    const [tx, ty] = originIsA ? [bx, by] : [ax, ay];
    const bearing = BEARING(ox - tx, oy - ty);
    const loseOdds = (originIsA ? aScouts : bScouts) >= 2 ? TRAVELER.loseOdds * 0.5 : TRAVELER.loseOdds;
    const roll = rand();   // always drawn (keeps the rng stream stable) — bothSilent just overrides the result
    const fate = (bothSilent || roll < loseOdds) ? 'lost' : 'arrives';
    const lostAt = fate === 'lost' ? +(0.3 + rand() * 0.5).toFixed(3) : 1;   // where along the path a lost one falls
    const arrivalDay = discoveryDay + journeyDays(dist);
    const cross = (fromCulture === 'orc') !== (toCulture === 'orc');
    const warning = cross
        ? (fromCulture === 'orc'
            ? `an orc warband stirs to the ${bearing}`
            : `smoke from human hearths to the ${bearing}`)
        : `kin are near — a ${toCulture === 'orc' ? 'warband' : 'village'} to the ${bearing}`;
    return { origin, destination, fromCulture, toCulture, fromName, bearing, fate, lostAt, arrivalDay, warning, ordinal, pairKey };
}

// Slice D — NEWS PROPAGATION. When two towns clash (or keep faith), word of it travels to a THIRD town: memory
// moving across the whole graph, the SuperMemory showpiece. Same seeded-carrier machinery, payload.type='news'.
export function newsLine(kind, orcName, humanName) {
    const o = String(orcName || 'a warband').split(' ')[0], h = String(humanName || 'a village').split(' ')[0];
    if (kind === 'raid') return `the ${o} warband fell upon ${h}`;
    if (kind === 'reconciled') return `${h} and the ${o} warband kept faith at the frontier`;
    if (kind === 'betrayed') return `a parley between ${h} and the ${o} warband was broken`;
    return `${h} and ${o} came into each other's reach`;
}
export function seedNews({ eventKey, ordinal, toSeed, discoveryDay, dist }) {
    const rand = mulberry32(hashString(`news:${eventKey}:${ordinal}:${toSeed}`));
    const fate = rand() < TRAVELER.loseOdds ? 'lost' : 'arrives';
    const lostAt = fate === 'lost' ? +(0.3 + rand() * 0.5).toFixed(3) : 1;
    const arrivalDay = discoveryDay + journeyDays(dist);
    return { fate, lostAt, arrivalDay };
}
