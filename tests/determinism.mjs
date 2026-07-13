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
    // re-baselined 2026-07-12 for #106 founding ceremony + #111/#112 the WOUNDED SELF-CARE economy (rest cap
    // 0.6->0.78 and a proactive hunt/barter-for-meat drive shift the rng stream); same-twice held all seeds.
    20260706: '7d142951',
    42: '8e2c2899',
    7: '60e50036',
    3: 'ea4bc356',
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
    f0.healSeekCd = 4.25; f0.chatCooldown = 7.5; f0.poachCooldown = 3.1; f0.hp = Math.round(f0.maxHp * 0.4); f0._wasHurt = true;
    // an authoritative raid populates the inbox ledger + watermark + a monument + docks harvest (dormant path)
    w.harvestTotal = 100;
    w.applyInbox([{ id: 'rt-raid', kind: 'raided', day: w.day, pairKey: 'rt-raid', ordinal: 1, commit: 0.4, by: 'the Ashfang clan' }]);
    const before = {
        healSeekCd: f0.healSeekCd, chatCooldown: f0.chatCooldown, poachCooldown: f0.poachCooldown,
        hp: f0.hp, energy: f0.energy, sleepDebt: f0.sleepDebt,
        harvest: w.harvestTotal, ledger: (w._inboxApplied || []).length, wm: { ...(w._inboxWatermark || {}) },
        mons: w.monuments.length, roleManager: w.roles?.manager ?? null, seed: f0.sheet.seed,
    };
    const w2 = World.fromSave(structuredClone(w.serialize()));
    const g0 = w2.farmers.find(f => f.sheet.seed === before.seed);
    rt(g0 && g0.healSeekCd === before.healSeekCd, `healSeekCd preserved (${g0 && g0.healSeekCd} == ${before.healSeekCd})`);
    rt(g0 && g0.chatCooldown === before.chatCooldown, `chatCooldown preserved`);
    rt(g0 && g0.poachCooldown === before.poachCooldown, `poachCooldown preserved`);
    rt(g0 && g0.hp === before.hp && g0.energy === before.energy && g0.sleepDebt === before.sleepDebt, `health (hp/energy/sleepDebt) preserved`);
    rt(w2.harvestTotal === before.harvest, `harvest preserved (${w2.harvestTotal} == ${before.harvest})`);
    rt((w2._inboxApplied || []).length === before.ledger && before.ledger >= 1, `inbox ledger preserved (${(w2._inboxApplied || []).length})`);
    rt(JSON.stringify(w2._inboxWatermark || {}) === JSON.stringify(before.wm), `inbox watermark preserved`);
    rt(w2.monuments.length === before.mons, `monuments preserved (${w2.monuments.length})`);
    rt(w2.monuments.length <= 40, `monuments bounded (<=40)`);
    rt(!!w2.roles && ('manager' in w2.roles), `civic roles structure preserved`);
    rt((w2._inboxApplied || []).length <= 200, `inbox ledger bounded (<=200)`);
}
if (rtFail) { console.error(`\n${rtFail} save round-trip failure(s) — reload does not preserve lived state.`); process.exit(1); }
console.log('Save round-trip preserves health, cooldowns, civic roles, inbox ledger, and bounded collections.');
