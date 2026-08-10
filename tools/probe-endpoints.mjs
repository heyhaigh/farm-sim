// tools/probe-endpoints.mjs — run EVERY production LLM shape against a candidate model.
//
// WHY THIS EXISTS. tools/probe-llm.mjs reconstructs requests, and a reconstruction is a guess: it
// measured a 300-character prompt where production sends 1,947, and a `number` seed where production
// sends `integer`. Codex #106 P1-1 then pointed out the deeper problem — only 4 of the 9 production
// callLLM shapes were covered at all, so a model could pass the matrix and still fail the deployed
// workload. Which is exactly what happened on 2026-08-06, when gpt-oss-20b passed classification and
// silently broke replies and congregation scenes for live visitors.
//
// So this does not rebuild anything. It calls the REAL handlers with realistic bodies, which means
// the real prompt, the real schema, the real token budget, and the whole _llm.js path underneath —
// model chain, reasoning_effort, format fallback, breaker. It cannot drift from production because
// it IS production; the only fabricated part is the request body a browser would have sent.
//
// The shape most at risk is the one with the LEAST room: the raid duel beat runs on 120 tokens, and
// the failure that broke production was reasoning tokens eating the budget before any content came
// out. That call fires mid-raid, in the most dramatic moment the game has, and until now nobody had
// ever measured it.
//
// USAGE (key in .env, or inline):
//   node tools/probe-endpoints.mjs
//   node tools/probe-endpoints.mjs --models openai/gpt-oss-120b,openai/gpt-oss-20b
//   node tools/probe-endpoints.mjs --only duel --verbose
//
// Real, billable calls. Paced by --delay (default 8s) because the free tier meters tokens per
// MINUTE and a burst starves its own later rows — that mistake made a whole earlier matrix unreadable.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

// .env keeps the key off the command line and out of shell history.
try {
    for (const raw of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const k = line.slice(0, eq).trim();
        let v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
    }
} catch { /* no .env */ }

const KEY = process.env.GROQ_API_KEY;
if (!KEY) {
    console.error('No GROQ_API_KEY. Put it in ~/ry-farms/.env, or prefix the command.');
    process.exit(2);
}

// Point the real chokepoint at Groq with billing opted in — the same posture production runs.
process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
process.env.OPENAI_API_KEY = KEY;
process.env.RY_FARMS_ALLOW_PAID_LLM = '1';
// Do NOT delete RY_FARMS_LLM_OFF. It is the belt-and-suspenders kill switch, and a probe that
// silently overrides someone's deliberate "make no model calls" is the last thing this tool should
// do. Refuse instead, and say why.
if (process.env.RY_FARMS_LLM_OFF) {
    console.error('RY_FARMS_LLM_OFF is set — refusing to make model calls. Unset it to probe.');
    process.exit(2);
}

const argOf = (f) => {
    const i = process.argv.indexOf(f);
    return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const MODELS = (argOf('--models') || 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',').map(s => s.trim());
const ONLY = argOf('--only');
const DELAY_MS = Number(argOf('--delay') || 8) * 1000;
const VERBOSE = process.argv.includes('--verbose');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- realistic request bodies, one per production shape -----------------------------------------
const FOUNDERS = ['Grull', 'Hex', 'Peal', 'Rover', 'Mera', 'Nomad', 'Chaos', 'Bell'].map((name, i) => ({
    name, archetype: ['builder', 'greeter', 'homebody', 'athlete', 'designer', 'herald', 'builder', 'greeter'][i],
    personality: { label: 'quiet', creed: 'the valley keeps what it is given' },
    keepsake: 'a life before the valley',
    dream: { yearn: 'a harvest that lasts the winter', rivalName: i === 0 ? 'Hex' : null },
}));

// The token column is READ FROM THE SOURCE, never hand-written. A hardcoded label drifted from the
// real budget three times in this arc — a probe row reading "1500 tok" after the code moved to 800,
// and a "320" printed for a chat call that actually used 600. A number that describes what ran must
// come from what ran.
function budgetFor(file, schemaName) {
    const src = readFileSync(join(ROOT, 'api', file), 'utf8');
    const re = new RegExp(`schemaName: '${schemaName}'[^}]*?maxTokens: (\\d+|[A-Z_]+)`, 's');
    const m = src.match(re) || src.match(new RegExp(`maxTokens: (\\d+|[A-Z_]+)[^}]*?schemaName: '${schemaName}'`, 's'));
    if (!m) return '?';
    if (/^\d+$/.test(m[1])) return m[1];
    const c = src.match(new RegExp(`const ${m[1]} = (\\d+)`));   // e.g. DM_MAX_TOKENS
    return c ? c[1] : m[1];
}

// Bodies mirror what the CLIENT actually sends (Codex #107 P1-2). The first version was thin
// enough to be misleading: `foe` was an object where the handler does String(body.foe), so the
// prompt read "[object Object]"; chat omitted the listener, relationship, memories and town state
// that make up most of its prompt; invent sent only `culture` and none of the mechanical fields.
// A green matrix built on those would not have proved compatibility with the deployed prompts.
// Shapes derived from farm.js #chatPayload/#chatProfile and each handler's own reads.
const profile = (name, other) => ({
    name, shortName: name, trade: 'builder',
    personality: { label: 'quiet', creed: 'the valley keeps what it is given' },
    traits: { teamwork: 0.6, drive: 0.4, honesty: 0.7, workEthic: 0.55 },
    level: 2, health: 1, energy: 0.72, state: 'walking', thought: 'the fence line needs seeing to',
    harvests: 6, cropsOnHand: 3, wood: 12, ore: 1, tilesExplored: 240,
    opinionOfOther: 0.31, trusts: ['Peal'], wary: [],
    rumorsHeard: [`Mera warned against ${other}`],
    strongestSharedMemories: [`d3 they hauled water together when the well ran low`],
    recentMemories: ['d4 a storm took part of the south fence'],
});

const SHAPES = [
    { key: 'duel', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_duel_beat',
      body: { phase: 'beat', culture: 'human', town: 'BIRCHGROVE',
              nemesis: { name: 'Skarn', raidCount: 3, sworeAgainst: 'Grull' },
              foe: 'Skarn and his warband', cast: FOUNDERS.slice(0, 4) } },

    { key: 'invent', file: 'ry-farms-invent.js', schemaName: 'ry_farms_invent',
      // every mechanical field the prompt is built from, not just culture
      body: { culture: 'human', effect: 'charm', tier: 2, quality: 3, dominant: 'ember',
              ingredients: ['a river stone', 'dried emberleaf', 'a scrap of hide'],
              name: 'ROUGH LUCK-KNOT' } },

    { key: 'classify', file: 'ry-farms-conscience.js', schemaName: 'ry_farms_conscience_classify',
      body: { stage: 'classify', message: 'go and get some rest', names: ['Grull', 'Hex'], recent: [] } },

    { key: 'reply', file: 'ry-farms-conscience.js', schemaName: 'ry_farms_conscience_reply',
      body: { stage: 'reply', verdict: 'dismiss', kind: 'rest', tone: 'suggest', message: 'go and rest',
              pressure: 0.4, history: [{ who: 'voice', text: 'you have been at it since dawn' }],
              character: { name: 'Grull Longfield', short: 'Grull', traits: ['stubborn'], creed: 'the hold stands' },
              snapshot: { day: 3, season: 'SPRING', doing: 'walking to the well' } } },

    { key: 'chat', file: 'ry-farms-chat.js', schemaName: 'ry_farms_chat',
      body: { context: {
          culture: 'human', day: 4, season: 'SPRING', weather: 'CLOUDY', leader: 'Peal Ashfield',
          harvestTotal: 21, boardBuilt: true,
          townProject: { label: 'TOOLSHED', points: 12, needed: 20, builders: ['Grull Longfield'] },
          recentTownLog: ['A storm took part of the south fence.', 'Peal was named leader.'],
          relationship: {
              speakerToListener: 0.31, listenerToSpeaker: -0.12,
              vividMemory: { day: 3, kind: 'help', text: 'they hauled water together when the well ran low', strength: 0.62 },
              gossipTarget: { name: 'Mera Stonecroft', regard: -0.4 },
          },
          speaker: profile('Grull', 'Hex'),
          listener: profile('Hex', 'Grull'),
          fallback: { speakerLine: 'Hex, that fence needs seeing to.', listenerLine: 'It can wait a day.' },
      } } },

    { key: 'raidmuster', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_raid_council',
      body: { phase: 'muster', culture: 'human', town: 'BIRCHGROVE', dir: 'north',
              foe: 'a warband out of the northern pines', cast: FOUNDERS.slice(0, 6),
              nemesis: { name: 'Skarn', raidCount: 2, sworeAgainst: 'Grull' } } },

    // The debrief builds a MATERIALLY DIFFERENT prompt from muster and was missing entirely — by the
    // same standard that makes founding and election separate rows, these are separate rows.
    { key: 'raiddebrief', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_raid_council',
      body: { phase: 'debrief', culture: 'human', town: 'BIRCHGROVE', dir: 'north',
              foe: 'a warband out of the northern pines', cast: FOUNDERS.slice(0, 6),
              nemesis: { name: 'Skarn', raidCount: 2, sworeAgainst: 'Grull' },
              battle: { felled: 3, n: 5, harvestLost: 2, hero: 'Grull', wounded: ['Hex', 'Peal'] } } },

    { key: 'congregation', file: 'ry-farms-congregation.js', schemaName: 'ry_farms_congregation',
      body: { scene: 'founding', culture: 'human', founders: FOUNDERS } },

    { key: 'election', file: 'ry-farms-congregation.js', schemaName: 'ry_farms_congregation',
      body: { scene: 'election', culture: 'human', founders: FOUNDERS, candidates: FOUNDERS.slice(0, 3) } },

    { key: 'dm', file: 'ry-farms-dm.js', schemaName: 'ry_farms_dm_tales',
      body: null },   // built from a real generated town below
];

// The DM body comes from a real town, because its payload size was the whole dispute.
{
    const { World } = await import('../farm.js');
    const { generateCrew, hashString } = await import('../dna.js');
    const m = generateCrew(20260706); const used = new Set();
    const pick = () => { const un = m.filter(x => !used.has(x.id)); let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b; };
    const w = new World(20260706);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    const f = w.farmers[0], s = f.sheet, p = s.personality;
    SHAPES.find(x => x.key === 'dm').body = {
        town: { name: w.name, seed: w.seed, day: w.day, season: w.seasonName, culture: w.culture },
        characters: [{
            seed: s.seed, name: s.name, shortName: s.name.split(' ')[0], trade: s.archetype,
            background: s.story.bg, stats: s.stats, personality: { label: p.label, creed: p.creed },
            ideal: s.story.ideal, bond: s.story.bond, flaw: s.story.flaw,
            dream: { yearn: s.dream.yearn, rivalName: s.dream.rivalName || null },
            keepsake: String((s.memory && s.memory.title) || 'a life before the valley').slice(0, 40),
            draft: s.story.tale,
        }],
    };
}

// --- drive a real handler ------------------------------------------------------------------------
function fakeRes() {
    const r = { statusCode: 0, headers: {}, body: null };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.end = (s) => { r.body = s; };
    return r;
}

async function runShape(shape) {
    // Fresh module each time so _llm.js's per-process state (breaker, dead models, format skips)
    // cannot carry a verdict from one model into the next.
    for (const k of Object.keys(require.cache)) if (k.includes('/api/')) delete require.cache[k];
    delete globalThis.__ryFarmsLlmState;
    const handler = require(`../api/${shape.file}`);
    const res = fakeRes();
    const started = Date.now();
    try {
        await handler({ method: 'POST', body: shape.body }, res);
    } catch (err) {
        return { verdict: `THREW  ${String(err?.message || err).slice(0, 80)}`, ms: Date.now() - started };
    }
    const ms = Date.now() - started;
    let parsed = null;
    try { parsed = JSON.parse(res.body || '{}'); } catch { /* not json */ }
    if (res.statusCode === 200 && parsed && !parsed.fallback) {
        const keys = Object.keys(parsed).join(',');
        return { verdict: `OK     ${keys}`, ms, payload: parsed };
    }
    const why = parsed?.error ? String(parsed.error).slice(0, 90) : `status ${res.statusCode}`;
    return { verdict: `FAIL   ${why}`, ms, payload: parsed };
}

console.log(`\nprobe-endpoints — every production LLM shape, through the real handlers`);
console.log(`models: ${MODELS.join(', ')}\n`);

const results = [];
for (const model of MODELS) {
    console.log(`=== ${model} ===`);
    process.env.RY_FARMS_LLM_MODELS = model;
    for (const shape of SHAPES) {
        if (ONLY && !shape.key.includes(ONLY)) continue;
        await sleep(DELAY_MS);
        const r = await runShape(shape);
        results.push({ model, key: shape.key, verdict: r.verdict });
        console.log(`  ${shape.key.padEnd(13)} ${String(budgetFor(shape.file, shape.schemaName)).padStart(4)} tok  ${String(r.ms).padStart(5)}ms  ${r.verdict}`);
        if (VERBOSE && r.payload) console.log(`      ${JSON.stringify(r.payload).slice(0, 240)}`);
    }
    console.log('');
}

const failed = results.filter(r => !r.verdict.startsWith('OK'));
if (failed.length) {
    console.log(`${failed.length} FAILING shape(s) — this model cannot carry the whole game:`);
    for (const f of failed) console.log(`  ${f.model}  ${f.key}  ${f.verdict}`);
    console.log(`\nA model that passes some shapes and fails others is the 2026-08-06 outage exactly:`);
    console.log(`classification kept working while replies and congregations went silent, so the game`);
    console.log(`looked half-alive rather than broken.`);
} else {
    console.log('Every production shape returned usable output. This model can carry the whole game.');
}
process.exit(failed.length ? 1 : 0);
