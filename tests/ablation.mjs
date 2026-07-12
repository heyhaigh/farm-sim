// tests/ablation.mjs — #1.3 the ABLATION PROOF: memory is load-bearing, not decorative.
//
// The council's honesty challenge: does the SuperMemory integration actually EARN it, or would any random
// seed grow the same town? This harness answers by founding three towns from the SAME world seed but DIFFERENT
// memory sources — real corpus, the same corpus SHUFFLED (so each founder gets a different source doc), and the
// invented fallback crew — then ticking each 30 days and showing they diverge OBSERVABLY (different archetype
// mix, different creeds, different lived outcomes), not merely in a label. Same seed, different memories =>
// a different society. It is also a determinism check: each source self-compares byte-identical run-to-run.
//
// Run: `node tests/ablation.mjs`  (exits non-zero if a town is nondeterministic, or if the three fail to diverge)

import { World } from '../farm.js';
import { generateCrew, hashString, mulberry32 } from '../dna.js';

const DT = 1 / 30, DAYS = 30, N = 8;

// A small REAL-ish source corpus: ten distinct memories whose text leans toward different archetypes/stats, so
// which doc a founder is grown from visibly changes who they become (that's the whole point of the ablation).
const CORPUS = [
    { id: 'm01', title: 'Hosting the neighborhood block party', summary: 'welcoming everyone, greeting guests, making people feel at home and heard' },
    { id: 'm02', title: 'Marathon training log', summary: 'running, endurance, pushing the body, speed drills and raw strength on the track' },
    { id: 'm03', title: 'Redesigning the studio brand', summary: 'design, color, typography, careful craft and an eye for beautiful detail' },
    { id: 'm04', title: 'Framing the backyard workshop', summary: 'building, hammer and nails, foundations, raising a sturdy structure with my hands' },
    { id: 'm05', title: 'A quiet Sunday of baking bread', summary: 'home, comfort, tending the hearth, slow patient care and a warm kitchen' },
    { id: 'm06', title: 'Emceeing the community broadcast', summary: 'voice, herald, announcing, rallying a crowd and carrying the news across town' },
    { id: 'm07', title: 'Mapping the coastal trail', summary: 'exploring, wandering, charting new ground, restless curiosity and long journeys' },
    { id: 'm08', title: 'Organizing the food drive', summary: 'gathering people, generosity, sharing the harvest, everyone pitching in together' },
    { id: 'm09', title: 'Debugging the render pipeline', summary: 'precision, logic, systems, patient careful problem solving and clever engineering' },
    { id: 'm10', title: 'Winning the county strongman', summary: 'strength, power, lifting, competition and the will to outwork everyone else' },
];

function seededPerm(seed, n) {
    const idx = [...Array(n).keys()];
    const rand = mulberry32(hashString('ablation-shuffle:' + (seed >>> 0)));
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
}

// Found a town by handing founder i a specific source doc (memories[i]); tick DAYS; return world.
function grow(seed, memories) {
    const w = new World(seed);
    for (let i = 0; i < N; i++) w.addFarmer(memories[i % memories.length], 0);
    w.ensureFounderVariety();
    const target = w.day + DAYS;
    while (w.day < target) w.tick(DT);
    return w;
}

function fnv(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
}
// Identity-INDEPENDENT behavioral fingerprint (Codex r20 P2): the old digest included `seed`/`pos`, which
// change with the source document REGARDLESS of whether memory affects behavior — so it "proved" divergence
// from identity alone. This captures only the SOCIETY the memories grew: the sorted archetype distribution,
// the cast's aggregate memory-derived stats, and lived outcomes. If memory were inert these would be identical
// across real/shuffled/fallback; that they differ is the actual proof that memory is load-bearing.
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
function digest(w) {
    const mix = {};
    for (const f of w.farmers) mix[f.sheet.archetypeKey] = (mix[f.sheet.archetypeKey] || 0) + 1;
    const archMix = Object.entries(mix).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const statTotals = STAT_KEYS.map(k => w.farmers.reduce((s, f) => s + (f.sheet.stats[k] || 0), 0));
    const totalXP = w.farmers.reduce((s, f) => s + (f.sheet.xp || 0), 0);
    const totalHarv = w.farmers.reduce((s, f) => s + (f.sheet.harvested || 0), 0);
    return fnv(JSON.stringify({ archMix, statTotals, totalXP, totalHarv }));
}
// Human-legible fingerprint of the society that GREW — this is the demo beat, not just a hash.
function society(w) {
    const mix = {};
    for (const f of w.farmers) mix[f.sheet.archetypeKey] = (mix[f.sheet.archetypeKey] || 0) + 1;
    const archMix = Object.entries(mix).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(' ');
    const totalXP = w.farmers.reduce((s, f) => s + (f.sheet.xp || 0), 0);
    const totalHarv = w.farmers.reduce((s, f) => s + (f.sheet.harvested || 0), 0);
    const names = w.farmers.map(f => f.sheet.name.split(' ')[0]).join(', ');
    return { archMix, totalXP, totalHarv, names };
}

const SEED = 20260706;
const real = () => grow(SEED, CORPUS);
const perm = seededPerm(SEED, CORPUS.length);
const shuffled = () => grow(SEED, perm.map(i => CORPUS[i]));
const fallback = () => grow(SEED, generateCrew(SEED));

const sources = [['real', real], ['shuffled', shuffled], ['fallback', fallback]];
const digests = {};
let failed = 0;

console.log(`Ablation — same seed (${SEED}), three memory sources, ${DAYS}-day run:\n`);
for (const [name, build] of sources) {
    const a = digest(build()), b = digest(build());        // self-compare: memory-founding must be deterministic
    const sameTwice = a === b;
    digests[name] = a;
    const s = society(build());
    if (!sameTwice) failed++;
    console.log(`  ${name.padEnd(9)} ${a}  same-twice=${sameTwice}`);
    console.log(`    archetypes: ${s.archMix}`);
    console.log(`    lived:      ${s.totalXP} XP, ${s.totalHarv} harvested`);
    console.log(`    cast:       ${s.names}\n`);
}

// Divergence: the three towns must NOT collapse to the same fingerprint — if they did, memory wouldn't matter.
const uniq = new Set(Object.values(digests));
const diverged = uniq.size === sources.length;
console.log(`Determinism: ${failed ? `FAIL — ${failed} source(s) nondeterministic` : 'each source self-compares identical'}`);
console.log(`Divergence:  ${diverged ? 'PASS — real / shuffled / fallback each grew a DIFFERENT society' : `FAIL — only ${uniq.size} distinct town(s); memory is not load-bearing`}`);

if (failed || !diverged) { console.error('\nAblation proof FAILED.'); process.exit(1); }
console.log('\nAblation proof holds: the same seed grows a different society from different memories.');
