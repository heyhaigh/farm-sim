// tests/encounters.mjs — the WORLD-LAYER determinism harness (#reconciliation Slice 0).
//
// The town sim has tests/determinism.mjs; the world layer had NO harness, yet the reconciliation feature puts
// seeded, outcome-bearing decisions there. This exercises the pure model in reconciliation.js: the outcome is
// byte-identical run-to-run, the disposition fold matches the pinned numbers, tiers hysteresis correctly, the
// parley gating + betrayal conditions hold, and the module reaches for NO banned inputs (Date.now/Math.random).
//
// Run: `node tests/encounters.mjs`  (exits non-zero on any failure)

import { readFileSync } from 'node:fs';
import {
    factionLineage, lineagePairKey, isCrossFaction, foldDisposition, dispositionTier, DISPOSITION,
    resolveEncounter, applyOutcome, ledgerCount, envoyDigest,
} from '../reconciliation.js';

let fails = 0;
const ok = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };
const approx = (a, b) => Math.abs(a - b) < 1e-9;

const human = { seed: 100, culture: 'human', lineage: [] };
const orc = { seed: 200, culture: 'orc', lineage: [] };
const humanHeir = { seed: 101, culture: 'human', lineage: ['100'] };   // descends from town 100

console.log('Lineage-pair keys (F1 — compound across generations):');
ok('pair key is symmetric', lineagePairKey(human, orc) === lineagePairKey(orc, human));
ok('cross-faction detected', isCrossFaction(human, orc) && !isCrossFaction(human, humanHeir));
ok('heir shares its forebear-lineage key with the same orc frontier',
    lineagePairKey(humanHeir, orc) === lineagePairKey(human, orc));   // gen-1 town + gen-2 heir -> SAME ledger
ok('faction lineage tags culture', factionLineage(orc).startsWith('orc:') && factionLineage(human).startsWith('human:'));

console.log('\nDisposition fold (Slice A — count-based, quantized, negativity bias):');
ok('fresh frontier is deeply hostile', foldDisposition(null) === DISPOSITION.fresh);
ok('a grievance lowers D', foldDisposition({ grievances: [{ ordinal: 1, kind: 'raid' }] }) === +(DISPOSITION.fresh + DISPOSITION.grievance).toFixed(3));
ok('a reconciliation raises D', foldDisposition({ reconciliations: [{ ordinal: 1 }] }) === +(DISPOSITION.fresh + DISPOSITION.reconciliation).toFixed(3));
ok('a betrayal is a bigger drop than a raid', DISPOSITION.betrayal < DISPOSITION.grievance);
ok('softening slower than hardening (negativity bias)', Math.abs(DISPOSITION.grievance) > DISPOSITION.reconciliation);
// ~3 grievances to undo a reconciliation surplus: recon +0.08 vs 3*grievance -0.36
ok('3 raids outweigh a reconciliation', foldDisposition({ grievances: [{ ordinal: 1, kind: 'raid' }, { ordinal: 2, kind: 'raid' }, { ordinal: 3, kind: 'raid' }], reconciliations: [{ ordinal: 4 }] }) < DISPOSITION.fresh);
ok('D is clamped to [-1,1]', foldDisposition({ grievances: Array.from({ length: 20 }, (_, i) => ({ ordinal: i, kind: 'raid' })) }) === -1);
ok('fold is order-insensitive (count-based)',
    foldDisposition({ grievances: [{ ordinal: 1, kind: 'raid' }, { ordinal: 2, kind: 'betrayal' }] }) ===
    foldDisposition({ grievances: [{ ordinal: 2, kind: 'betrayal' }, { ordinal: 1, kind: 'raid' }] }));

console.log('\nTier hysteresis (Slice A — no thrash at a boundary):');
ok('deeply hostile D -> hostile', dispositionTier(-0.6, 'hostile') === 'hostile');
ok('mild D from hostile -> wary (not yet open)', dispositionTier(0.0, 'hostile') === 'wary');
ok('must clear +0.15 to reach open', dispositionTier(0.1, 'wary') === 'wary' && dispositionTier(0.2, 'wary') === 'open');
ok('once open, a dip to +0.0 STAYS open (deadband)', dispositionTier(0.0, 'open') === 'open');
ok('open only falls to wary below -0.05', dispositionTier(-0.1, 'open') === 'wary');
ok('open falls all the way to hostile below -0.35', dispositionTier(-0.4, 'open') === 'hostile');

console.log('\nEncounter resolution (Slice B — seeded, gated, 3 branches):');
const peaceHuman = { seed: 1, curiosity: 0.8, honesty: 0.7, collaboration: 0.7 };
const peaceOrc = { seed: 2, curiosity: 0.8, honesty: 0.6, collaboration: 0.3 };
const brute = { seed: 3, curiosity: 0.2, honesty: 0.5, collaboration: 0.2 };
const liarOrc = { seed: 4, curiosity: 0.8, honesty: 0.2, collaboration: 0.3 };
const base = { pairKey: 'human:100|orc:200', ordinal: 1, disposition: 0.0, tier: 'wary' };

const r1 = resolveEncounter({ ...base, humanEnvoy: peaceHuman, orcEnvoy: peaceOrc });
const r2 = resolveEncounter({ ...base, humanEnvoy: peaceHuman, orcEnvoy: peaceOrc });
ok('resolution is DETERMINISTIC (same inputs -> same outcome)', JSON.stringify(r1) === JSON.stringify(r2));
ok('no peacemaker -> auto-raid, not attempted', resolveEncounter({ ...base, humanEnvoy: brute, orcEnvoy: peaceOrc }).attempted === false);
ok('two peacemakers -> parley attempted', resolveEncounter({ ...base, humanEnvoy: peaceHuman, orcEnvoy: peaceOrc }).attempted === true);
// betrayal can ONLY happen when an extender is false (honesty<0.3). Sweep ordinals; an honest pair must never betray.
let honestBetray = 0, liarBetray = 0;
for (let o = 0; o < 200; o++) {
    if (resolveEncounter({ ...base, ordinal: o, humanEnvoy: peaceHuman, orcEnvoy: peaceOrc }).outcome === 'betrayed') honestBetray++;
    if (resolveEncounter({ ...base, ordinal: o, humanEnvoy: peaceHuman, orcEnvoy: liarOrc }).outcome === 'betrayed') liarBetray++;
}
ok('an honest pair NEVER betrays', honestBetray === 0);
ok('a false extender CAN betray', liarBetray > 0);
// distribution sanity: an open frontier honors far more than a hostile one
const honoredAt = (tier) => { let n = 0; for (let o = 0; o < 400; o++) if (resolveEncounter({ ...base, tier, ordinal: o, humanEnvoy: peaceHuman, orcEnvoy: peaceOrc }).outcome === 'honored') n++; return n; };
ok('open honors more than hostile', honoredAt('open') > honoredAt('hostile'));

// #Codex24-4 the ledger is now compact COUNTERS (raidN/betrayalN/reconcileN) + a bounded recent tail; the
// ordinal must be applied EXACTLY once and strictly in sequence (= ledgerCount). This guards #Codex25-4.
console.log('\nLedger append (idempotent, exact-ordinal-only):');
let led = applyOutcome(null, 'raid', { ordinal: 0, day: 10 });        // fresh ledger -> next ordinal is 0
ok('first raid recorded', led.raidN === 1 && ledgerCount(led) === 1);
led = applyOutcome(led, 'raid', { ordinal: 0, day: 10 });             // REPLAY of ordinal 0 -> no double count
ok('idempotent: a repeated ordinal does not double-count', led.raidN === 1 && ledgerCount(led) === 1);
led = applyOutcome(led, 'raid', { ordinal: 7, day: 10 });             // GAP (ordinal ahead of count) -> no-op
ok('a gapped/out-of-order ordinal is a no-op', ledgerCount(led) === 1);
led = applyOutcome(led, 'honored', { ordinal: 1, day: 20 });         // the exact next ordinal -> lands
ok('honored -> reconcileN', led.reconcileN === 1 && ledgerCount(led) === 2);
ok('recent tail is bounded + present', Array.isArray(led.recent) && led.recent.length >= 1);
ok('betrayed -> betrayalN', applyOutcome(null, 'betrayed', { ordinal: 0, day: 1 }).betrayalN === 1);

console.log('\nBanned inputs (F2 — no clock / no unseeded rng in the model):');
// strip comments first — we care about CODE, not the doc-comment that literally names the banned inputs
const src = readFileSync(new URL('../reconciliation.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('no Date.now / new Date', !/Date\.now|new Date\b/.test(src));
ok('no Math.random', !/Math\.random/.test(src));

console.log(`\n${fails ? `${fails} FAILURE(S)` : 'All world-layer checks pass — resolution is seeded, gated, hysteretic, and idempotent.'}`);
if (fails) process.exit(1);
