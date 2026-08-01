// tests/whisper-backstop.mjs — the strict classify backstop's contract. Run: node tests/whisper-backstop.mjs
//
// The backstop (#classify-backstop, conscience.js) may overrule the model's `none` ONLY for clear,
// positive directives. Three review rounds hardened it (Codex #69-4, #70-2, #71 NO-SHIP):
//   - a topical noun alone must not promote ("that tree is beautiful" is not a chop order);
//   - an unrelated cue + noun must not re-combine ("you should be proud of that tree");
//   - POLARITY: a negated thought must NEVER promote ("don't chop that tree" is a prohibition — the
//     verdict layer receives only the kind and could HEED the very act the player forbade).
// Every case runs through the REAL whisper() orchestration with the model mocked to answer `none`, so
// what's asserted is exactly what conscienceCheck would receive in the failure mode that matters.

import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

// the model always answers `none` — the backstop's entire operating regime
globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.stage === 'classify') return { ok: true, json: async () => ({ kind: 'none', target: '', tone: 'suggest' }) };
    return { ok: true, json: async () => ({ line: 'mock', verdict: 'HEED' }) };
};

const { whisper } = await import('../conscience.js');

const m = generateCrew(1);
const used = new Set();
const pick = () => {
    const un = m.filter(x => !used.has(x.id));
    let b = un[0], bh = 0xffffffff;
    for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
    used.add(b.id); return b;
};
const w = new World(1, 'human');
for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
w.ensureFounderVariety();
for (let i = 0; i < 30 * 60; i++) w.tick(1 / 30);

const f = w.farmers[0];
const orig = f.conscienceCheck.bind(f);
let got = null;
f.conscienceCheck = (k, t, tn) => { got = k; return orig(k, t, tn); };

const CASES = [
    // Codex #72 (NO-SHIP) — SMART apostrophes (U+2019, what phones actually type) must not bypass polarity
    ['Don’t chop that tree.', 'none'],
    ['I won’t bring you meat.', 'none'],
    ['You shouldn’t cut that wood.', 'none'],
    // Codex #71 (NO-SHIP) — polarity + fresh promotions
    ["Don't chop that tree.", 'none'],
    ['Never bring me meat.', 'none'],
    ['My thoughts wander at night', 'none'],
    ['We should explore why she left', 'none'],
    ['I sell paintings to travelers', 'none'],
    // Codex #70 — cue/noun recombination
    ['You should be proud of that tree.', 'none'],
    ['The guard told a funny story.', 'none'],
    ['Raiders were frightening last winter.', 'none'],
    ['Why not admire the home?', 'none'],
    ['How about that deer?', 'none'],
    ['Go tell Carol the tree is beautiful.', 'none'],
    // Codex #69 — bare topical nouns
    ['That tree is beautiful.', 'none'],
    ['what a lovely home you have', 'none'],
    ['the meat here smells odd', 'none'],
    // the directives the backstop exists to rescue
    ['go chop some wood', 'chop'],
    ['you should get some sleep', 'rest'],
    ['raiders to the north!', 'watch'],
    ['those fields look thirsty', 'water'],
    ['put something in the ground', 'plant'],
    ['stand guard tonight', 'watch'],
    ['build the house bigger', 'build'],
    ['go hunt some meat', 'hunt'],
    ['swap some goods with a neighbour', 'trade'],
    ['go roam the frontier', 'explore'],
];

let pass = true;
for (const [msg, want] of CASES) {
    await whisper(w, f, msg, () => {});
    const okk = got === want;
    console.log((okk ? '  ✓ ' : '  ✗ FAIL ') + JSON.stringify(msg) + ' -> ' + got + (okk ? '' : ` (want ${want})`));
    if (!okk) pass = false;
}

if (!pass) { console.error('\nwhisper-backstop contract violated'); process.exit(1); }
console.log(`\nBackstop contract holds: ${CASES.length} cases — negations and smalltalk stay none, directives classify.`);
