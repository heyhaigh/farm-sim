// tests/determinism.mjs — the project's #1 invariant, committed and reproducible.
//
// DOCTRINE: the SIM consumes only seeded rng (world.rand, per-farmer this.rand) + pure position hashes with
// stable, sorted iteration. Same seed => byte-identical town, twice. The LLM + SuperMemory are display/
// persistence side-channels the sim never reads in its loop (compile-don't-query), so this harness runs the
// sim headless with both OFF — which is exactly the deterministic core the doctrine describes.
//
// Run: `node tests/determinism.mjs`  (exits non-zero if any seed fails to self-compare)
//
// It boots the founder cast the way the game does (generateCrew -> addFarmer -> ensureFounderVariety), ticks
// N days, and hashes farmer + world state across TWO runs of the same seed. A same-seed run that differs
// run-to-run is a P0 determinism bug. The BASELINE hashes below fingerprint the current tree; a legitimate
// sim-affecting change re-baselines them (update the constant), but same-twice must ALWAYS hold.

import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30, DAYS = 30;
const SEEDS = [20260706, 42, 7, 3];

// Baseline digests at HEAD (LLM + SuperMemory off, 30-day run). Update deliberately when a sim change
// legitimately re-baselines; a DRIFT here on an unrelated change is a determinism regression to investigate.
const BASELINE = {
    // re-baselined 2026-07-14 for two behavioural fixes: (1) a fleeing farmer now bolts for the PLAZA when their
    // own fence isn't up (an open plot is no refuge — the threat just follows them in) instead of a false-safe
    // homestead; (2) the ACTION_ENERGY falsy-0 bug fixed (`?? 0.05`, not `|| 0.05`) so plant/harvest/clear are
    // truly FREE and tilling is a light 0.017 (was silently 0.05) — which shifts every farming day's energy curve.
    // same-twice held all seeds (fully reproducible; only the fingerprint moved).
    // re-baselined 2026-07-15 — FOE-vs-FENCE: a foe (orc/assassin) no longer breaks off when a farmer reaches
    // their fenced plot — it presses in and BASHES the fence down (property destruction), and a farmer flees for
    // help at the plaza rather than a false-safe fence (a wary one straight away, a naive one once it's breached).
    // Real behavioural changes to the encounter/flee loop; same-twice held all seeds.
    // re-baselined 2026-07-15 for Codex #31 P1 — a raider-BREACHED fence is now REPAIRED by its owner at any house
    // level (was stranded for housed plots), and #foeBashFence no longer nulls an in-progress upgrade — both shift
    // the day-2+ trajectory whenever a foe bashes a fence in the run. same-twice held all seeds.
    // re-baselined 2026-07-15 for the WATCH/FOE-CADENCE batch (all seeded, same-twice held): (1) lethal foes
    // (orc/assassin) are now gated behind their own long #foeCooldown so raids are rare + well-spaced (beasts still
    // wander in on the ordinary interval) — shifts the encounter timeline; (2) the day's SENTRY stands at arms —
    // charges to defend a townsfolk under attack (joins as a helper → changes clash resolution) instead of only
    // sounding the alarm; (3) a fleeing farmer runs TO the fit sentry (the guard is the refuge), and a sentry who's
    // the quarry never counts home safe; (4) a sick/felled watcher HANDS OFF to the founders' rotation (currentSentry
    // now skips the unfit), so the beat is never dark; (5) "no one came" excludes the on-duty sentry from the
    // resented bystanders (changes adjustOpinion/remember). All five touch day-2+ sim state → the fingerprint moves.
    // (foe kind-roll rebalanced same batch: assassin is now the RARE stalker (r<0.20, standout only), orc the usual
    // raider (r<0.65) — the fingerprint moved again; same-twice held.)
    // re-baselined 2026-07-15 for Codex #32 P1 (the sentry could not actually FIGHT while the quarry fled) — TWO
    // coupled fixes: (a) #resolveClash lets adjacent HELPERS swing even when the target flees (was a lone dodge +
    // early return); (b) the encounter now brings the foe to BAY — a standing defender within the <2.2 swing radius
    // HALTS the foe's chase and forces the clash (before, the foe only clashed when it caught the fleeing TARGET,
    // which at matched speed it rarely did, so an intercepting guard was inert). Together: a defended fleeing farmer's
    // foe now takes damage / is driven off. Verified: foe HP 4→1 while the quarry fled + the sentry fought. same-twice
    // held; the day-2+ trajectory shifts wherever a guard engages a foe in the run.
    // re-baselined 2026-07-15 — SLEEP-OUT SICKNESS reworked: (1) the on-duty SENTRY is exempt from the dawn illness
    // roll (standing watch = not sleeping is their duty — `stoodWatch` flag); (2) a single CALM rough night never
    // rolls — illness needs a STREAK (`roughStreak>=2`), roofless exposure past the grace, or a rough night in
    // inclement weather (storm/blizzard), always a CON save whose DC scales with the streak/exposure/weather. New
    // serialized farmer fields `roughStreak`/`nightsExposed`. Changes the day-2+ dawn-check trajectory; same-twice held.
    // re-pinned 2026-07-17d: #silo (towns start at level 0, cheap L0->L1) shifts town-XP timing. Prior: #crit (foe critical hits in wilderness clashes — a nat-20 double blow)
    // shifts the encounter trajectory. Prior: #health wound-recovery (Healer binds wounds incl. the sentry at post;
    // self-salve mends hp; red-health farmers don't hunt into danger; sentry stands down when critically
    // hurt) legitimately shifts the trajectory. Prior: #farmyard (facilities cluster at the house, crops buffered a tile
    // off every pen, yardV save marker) legitimately shifts placement + the serialized shape
    // re-pinned 2026-07-18 — P2.5 SEARCH PARTY + Codex #43 hardening. The search party is a REAL new behavior that
    // FIRES in normal 30-day play (a farmer downed far in the wilds is rescued: riders muster + think() + march),
    // legitimately shifting the trajectory. Codex #43 fixes compound it: off-field (onSortie) riders are now excluded
    // from civic selection/quorum/voting (#civicPresent), their wilderness encounters are DETACHED at departure (an
    // off-field target no longer draws world.rand), and departure revalidates riders. All same-twice held.
    // re-pinned 2026-07-28 — #paddock. Facilities are no longer squeezed into the homestead: each coop, pen,
    // fold, pond, mill and hatch house is raised in its own fenced enclosure ANNEXED OUTSIDE the existing fence
    // line, sited by direction and cleared of trees first, with the building centred on a real tile footprint
    // rather than pinned to one corner tile. That changes where ground gets claimed, what it costs in fence
    // wood, when the frontier and the cropland cap read as full, and the serialized plot shape (new padCells).
    // Every seed still held same-twice=true — the invariant is intact; only the fingerprint moved. Seed
    // 20260706 is unchanged (no farm reaches a facility inside the 30-day window).
    // Amended same day — paddocks now land on a LATTICE anchored to one side of the property line (fill a
    // lane, then the next lane out) instead of being scored one at a time, with kin facilities preferring
    // adjacent slots, and grazing livestock ambling across their pens rather than holding one spot. Only
    // seed 7 moved again; same-twice held throughout.
    // Amended again — PADDOCK_CELL 7 -> 9 (livestock pens needed real grazing room; the cell stays uniform
    // so the lattice keeps tiling), buildings anchored on their FOOTPRINT centre rather than the paddock's
    // so sprite and collision agree, stock turned out into the yard IN FRONT of the building instead of
    // the paddock centre, and an asymmetric containment inset scaled by build. All placement + producer
    // trajectories, so every seed but 20260706 re-fingerprints; same-twice held on all four.
    // re-pinned 2026-07-28 for the Codex #45 fixes, all of them sim-affecting: a facility's fence and
    // building are now quoted and paid as ONE bill (a farmer holding just the fence cost could build and
    // finish in debt), the paddock lattice anchors on the house-CONNECTED yard rather than all cropland
    // (a detached frontier field dragged the anchor off into open country), the lattice commits only once
    // ground has changed hands rather than at plan time, the kin weight is derived so it actually dominates
    // position + timber, and the house-upgrade acreage gate measures cropland to match its own cap.
    // same-twice held on all four seeds; 20260706 unchanged (no farm reaches a facility inside 30 days).
    // re-pinned 2026-07-29 — MOVEMENT, so this one moves every seed including 20260706, which had held
    // through the whole paddock series (that work only ever touched facilities, and no farm reaches one
    // inside 30 days; fleeing and fighting happen in every run). Two fixes, both the same shape: a fleeing
    // farmer's VEER around an obstacle was applied without checking where it landed, so a panic run could
    // sidestep into a pond; and closing to FIGHT walked to the foe's tile, which findPath permits as the
    // goal, so a foe standing in water was waded out to. Approaches now route through one #standNear
    // helper — the guard existed inline for producer work and had already been missed once for poaching
    // and twice more for fighting. same-twice held on all four seeds.
    // re-pinned again 2026-07-29 — the same movement class, found by review #50. SIX more approaches were
    // still walking to a live entity's tile + 0.5 without checking it (teaching, wound care, the herb run,
    // both barter paths, visiting), so a neighbour standing on a pond bank could produce a water goal that
    // findPath admits. And the flee veer, having been given a check last commit, tested only ONE
    // perpendicular: a farmer cornered where the forward step and that veer were both blocked stood
    // motionless for the whole 0.5s fleeTimer with the open direction untried — measured at 16 consecutive
    // frozen ticks before the fix, 1 after. Both are movement, so all four seeds move again. same-twice held.
    // 20260706 alone moved 2026-07-29: the SABOTAGE approach now stands outside the victim's house rather
    // than walking into it, and only that seed runs a sabotage inside 30 days. The workstation fix (millers
    // were targeting a tile inside their own 3x3 footprint) doesn't show here — no farm reaches a mill in
    // 30 days, which is exactly the blind spot tests/paddock.mjs exists to cover.
    // re-pinned 2026-07-29 — CREATURE MOVEMENT, the upstream half of the walk-on-water class. Prey and
    // foes wrote their positions unconditionally, so a deer grazed across ponds and a wolf chased through
    // barns; and a foe standing in water is what made an unguarded farmer approach reachable at all. Both
    // now move through World#creatureStep (heading, then either perpendicular, then stay put), and an
    // encounter that would spawn on blocked ground is relocated to the nearest open tile. Every run has
    // prey and encounters, so all four seeds move. Combat verified unweakened across four towns: 89 vs 90
    // encounters, 1309 vs 1130 damage dealt. same-twice held.
    // re-pinned 2026-07-29 for the Codex #52 fixes. Only 42 and 3 move: the fence-aware foe/beast stepping
    // (a perpendicular veer could carry a foe INTO an intact fenced plot without bashing it) and the swept
    // step (endpoint-only collision let a 2.5-tile hunt burst tunnel clean through a blocked tile) both
    // need the right geometry to bite, and only those two seeds hit it inside 30 days. The project-frontage
    // guard, the merchant target and the underfoot-terrain escape move nothing here. same-twice held.
    // re-pinned 2026-07-31 for the #rest-hold fix: a roofless farmer's NIGHT rest now holds until dawn (or
    // until the sleep urge clears / watch duty calls) instead of exiting the tick energy crosses 0.5 — which
    // had #decide re-resting them EVERY TICK all night (a rest<->decide flip-flop: bubble stuck at "EN|",
    // sprite twitching; the sibling of the V2 sleep<->walk flicker). Behavioural: early roofless nights now
    // hold rest through the night, so every seed's day-2+ energy/chore trajectory moves. Measured: worst
    // per-farmer rest-exit count over 3 days fell 822 -> 11. same-twice held all seeds.
    20260706: '856cfecb',
    42: '7fa06f3d',
    7: '11748a8c',
    3: 'ed0dd2b5',
};

function boot(seed, culture) {
    const m = generateCrew(seed);
    const used = new Set();
    // stable, seed-ordered founder pick (mirrors the game's founder selection; no Math.random)
    const pick = () => {
        const un = m.filter(x => !used.has(x.id));
        let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b;
    };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return w;
}

function fnv(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
}

function digest(seed) {
    const w = boot(seed);
    const target = w.day + DAYS;
    while (w.day < target) w.tick(DT);
    const snap = {
        day: w.day, year: w.year, season: w.season,
        recipes: Object.keys(w.recipes || {}).sort(),
        tales: (w.tales || []).map(x => [x.ingredient, x.originSeed]).sort(),
        roles: w.roles ? { manager: w.roles.manager?.sheet?.seed ?? null, watch: w.roles.watch?.sheet?.seed ?? null } : null,
        farmers: w.farmers.map(f => ({
            seed: f.sheet.seed, xp: f.sheet.xp, lvl: f.sheet.level,
            inv: (f.sheet.recipes || []).slice().sort(), belief: f.sheet.rareBelief || {},
            goods: f.sheet.goods || {}, produce: f.sheet.produce || 0, i: f.pos.i, j: f.pos.j,
            // #reconciliation Slice 0: creed authority (weight) + earned-belief strength are the state the
            // creed-overwrite mechanic mutates — they MUST be in the fingerprint or a regression self-compares
            // clean. Kept in natural (deterministic) order so an ordering bug is caught too, not hidden.
            creeds: (f.creeds || []).map(c => [c.theme, c.weight]),
            beliefs: (f.sheet.beliefs || []).map(b => [b.tag, b.strength || 0]),
        })),
    };
    return fnv(JSON.stringify(snap));
}

let failed = 0;
for (const seed of SEEDS) {
    const a = digest(seed), b = digest(seed);
    const sameTwice = a === b;
    const baseline = BASELINE[seed];
    const matchesBaseline = baseline == null || a === baseline;
    const status = !sameTwice ? 'FAIL (nondeterministic)' : !matchesBaseline ? `DRIFT (baseline ${baseline})` : 'ok';
    // #Codex24-6: an UNINTENDED sim change (baseline drift) must fail CI too — not only a same-twice break.
    // A legitimate sim change re-pins BASELINE deliberately; an accidental one should never pass silently.
    if (!sameTwice || !matchesBaseline) failed++;
    console.log(`seed ${String(seed).padEnd(9)} ${a}  same-twice=${sameTwice}  ${status}`);
}

if (failed) { console.error(`\n${failed} seed(s) failed determinism (same-twice break OR baseline drift). If the drift is intentional, re-pin BASELINE deliberately.`); process.exit(1); }
console.log('\nAll seeds self-compare identical. Determinism holds.');

// #names — no two living farmers in a town may share a FIRST name (both cultures), and the assignment is
// stable per seed. Guards the per-town de-dup against regressions (e.g. a global set sneaking back in).
let nameFail = 0;
for (const seed of SEEDS) {
    for (const culture of ['human', 'orc']) {
        const a = boot(seed, culture).farmers.map(f => String(f.sheet.name).split(' ')[0]);
        const b = boot(seed, culture).farmers.map(f => String(f.sheet.name).split(' ')[0]);
        const dup = a.length - new Set(a).size;
        const stable = a.join(',') === b.join(',');
        if (dup > 0) { nameFail++; console.log(`  NAME COLLISION seed ${seed} ${culture}: ${dup} dup — ${a.join(',')}`); }
        if (!stable) { nameFail++; console.log(`  NAME NONDETERMINISM seed ${seed} ${culture}`); }
    }
}
if (nameFail) { console.error(`\n${nameFail} name-uniqueness/stability failure(s).`); process.exit(1); }
console.log('Names unique within every town (human + orc), stable per seed.');

// #Codex24-6 — SAVE ROUND-TRIP fidelity. The rng is DELIBERATELY re-seeded on load (saving must not be
// observable to the sim), so this is a FIELD-VALUE round-trip, not a digest-equality one: the lived, non-
// derivable state a reload must preserve — health + the rng-GATING cooldowns (#24-5), civic roles, the
// exactly-once inbox ledger/watermark (#22), and BOUNDED collection sizes (#23/#24-4) — must survive
// serialize -> structuredClone (mimics the IndexedDB write) -> fromSave unchanged.
let rtFail = 0; const rt = (c, m) => { if (!c) { rtFail++; console.log(`  ROUND-TRIP FAIL: ${m}`); } };
{
    const w = boot(20260706);
    for (let i = 0; i < 15 * 30 * 4; i++) w.tick(DT);   // ~15 days: elect officers, accrue state
    // stamp the rng-gating cooldowns + a wound so we can prove they survive (they gate seeded rand() draws)
    const f0 = w.farmers[0];
    // stamp EVERY rng-gating cooldown/timer the sweeps cover (#Codex24-5 + #Codex25-5), world + farmer
    Object.assign(f0, { healSeekCd: 4.25, chatCooldown: 7.5, poachCooldown: 3.1, teachCooldown: 6.2, sabotageCooldown: 9.1,
        barterCooldown: 2.7, tradeCooldown: 8.3, coopCooldown: 5.5, helpCooldown: 3.9, wellAskCooldown: 4.4,
        oreExpedCooldown: 7.1, annexCooldown: 6.6, thoughtBubbleTimer: 2.2, wanderTimer: 1.3, assembleT: 4.75, hp: Math.round(f0.maxHp * 0.4), _wasHurt: true });
    w.lightningTimer = 3.7;   // #Codex25-5 world-level storm-strike gate
    // an authoritative raid populates the inbox ledger + watermark + a monument + docks harvest (dormant path)
    w.harvestTotal = 100;
    w.applyInbox([{ id: 'rt-raid', kind: 'raided', day: w.day, pairKey: 'rt-raid', ordinal: 1, commit: 0.4, by: 'the Ashfang clan' }]);
    const CDS = ['healSeekCd', 'chatCooldown', 'poachCooldown', 'teachCooldown', 'sabotageCooldown', 'barterCooldown',
        'tradeCooldown', 'coopCooldown', 'helpCooldown', 'wellAskCooldown', 'oreExpedCooldown', 'annexCooldown', 'thoughtBubbleTimer', 'wanderTimer', 'assembleT'];
    const before = {
        cds: Object.fromEntries(CDS.map(k => [k, f0[k]])), lightningTimer: w.lightningTimer,
        hp: f0.hp, energy: f0.energy, sleepDebt: f0.sleepDebt,
        harvest: w.harvestTotal, ledger: (w._inboxApplied || []).length, wm: { ...(w._inboxWatermark || {}) },
        mons: w.monuments.length, roleManager: w.roles?.manager ?? null, seed: f0.sheet.seed,
    };
    const w2 = World.fromSave(structuredClone(w.serialize()));
    const g0 = w2.farmers.find(f => f.sheet.seed === before.seed);
    const cdMiss = CDS.filter(k => !(g0 && g0[k] === before.cds[k]));
    rt(g0 && cdMiss.length === 0, `all ${CDS.length} rng-gating cooldowns preserved${cdMiss.length ? ' (missed: ' + cdMiss.join(',') + ')' : ''}`);
    rt(w2.lightningTimer === before.lightningTimer, `world lightningTimer preserved (${w2.lightningTimer} == ${before.lightningTimer})`);
    rt(g0 && g0.hp === before.hp && g0.energy === before.energy && g0.sleepDebt === before.sleepDebt, `health (hp/energy/sleepDebt) preserved`);
    rt(w2.harvestTotal === before.harvest, `harvest preserved (${w2.harvestTotal} == ${before.harvest})`);
    rt((w2._inboxApplied || []).length === before.ledger && before.ledger >= 1, `inbox ledger preserved (${(w2._inboxApplied || []).length})`);
    rt(JSON.stringify(w2._inboxWatermark || {}) === JSON.stringify(before.wm), `inbox watermark preserved`);
    rt(w2.monuments.length === before.mons, `monuments preserved (${w2.monuments.length})`);
    rt(w2.monuments.length <= 40, `monuments bounded (<=40)`);
    rt(!!w2.roles && ('manager' in w2.roles), `civic roles structure preserved`);
    rt((w2._inboxApplied || []).length <= 200, `inbox ledger bounded (<=200)`);

    // #Codex33 P1 — OLD-SAVE fidelity for the health fields added this batch. A save written before roughStreak/
    // nightsExposed existed must restore them to 0 (NOT undefined): undefined+1 → NaN would PERMANENTLY disable the
    // homelessness-exposure + shelter-pressure comparisons for that farmer. Simulate an old save by DELETING both
    // fields from a serialized farmer, restore, run one dawn, and assert the fields are finite (0), not NaN.
    const legacy = structuredClone(w.serialize());
    for (const fd of legacy.farmers) { delete fd.roughStreak; delete fd.nightsExposed; }
    const w3 = World.fromSave(legacy);
    const h0 = w3.farmers[0];
    rt(h0 && h0.nightsExposed === 0 && h0.roughStreak === 0, `old save (no roughStreak/nightsExposed) restores to 0, not undefined`);
    const day0 = w3.day; while (w3.day < day0 + 1) w3.tick(DT);   // advance one dawn — the health check runs nightsExposed+1
    const allFinite = w3.farmers.every(f => Number.isFinite(f.nightsExposed) && Number.isFinite(f.roughStreak));
    rt(allFinite, `after one dawn on an old save, nightsExposed/roughStreak stay FINITE (no undefined+1 → NaN)`);
}
if (rtFail) { console.error(`\n${rtFail} save round-trip failure(s) — reload does not preserve lived state.`); process.exit(1); }
console.log('Save round-trip preserves health, cooldowns, civic roles, inbox ledger, and bounded collections.');
