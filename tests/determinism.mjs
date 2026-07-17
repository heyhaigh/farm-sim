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
    20260706: '76f81ef4',
    42: '20d5f94e',
    7: '64f39c7d',
    3: '3b8b9a8b',
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
