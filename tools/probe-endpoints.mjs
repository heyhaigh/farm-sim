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

// Bodies are CAPTURED, not written (Codex #108 P1-1). Fixture fidelity was a P1 finding in four
// consecutive rounds, and "write a better fixture" never converged — the reply body I hand-wrote
// last round was 349 characters against production's 1,326. tools/capture-payloads.mjs drives the
// real client entry points with fetch stubbed to record, so these bodies cannot drift: nobody typed
// them. Regenerate with `node tools/capture-payloads.mjs` if a client payload changes.
// FRESHNESS IS ENFORCED, not offered (Codex #110 P2-4). `--check` existed but nothing invoked it, so
// a client payload could change and this paid probe would keep measuring stale bytes and reporting
// green — which is the exact failure mode the capture work was meant to end. Re-capture and compare
// BEFORE spending a single request; `--stale-ok` exists only for deliberately probing an old artifact.
if (!process.argv.includes('--stale-ok')) {
    const { execFileSync } = await import('node:child_process');
    try {
        execFileSync(process.execPath, [join(ROOT, 'tools', 'capture-payloads.mjs'), '--check'],
            { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
        console.error('\npayloads.json is STALE — a client payload changed since it was captured.');
        console.error('Run: node tools/capture-payloads.mjs   (then re-run this probe)');
        console.error('Refusing to spend model requests measuring the wrong bodies. --stale-ok overrides.');
        process.exit(2);
    }
}

const CAPTURED = JSON.parse(readFileSync(join(ROOT, 'tools', 'payloads.json'), 'utf8')).requests;
// Chat is captured twice — once organically during the tick loop, once triggered afterwards. Take
// the LARGEST: a token budget should be validated against the biggest realistic prompt, not the
// smallest. (Both are production-shaped; only the amount of accumulated social history differs.)
const grabLargest = (endpointPart) => {
    const hits = CAPTURED.filter(r => r.endpoint.includes(endpointPart));
    if (!hits.length) throw new Error(`no captured payload for "${endpointPart}" — re-run tools/capture-payloads.mjs`);
    return hits.sort((a, b) => JSON.stringify(b.body).length - JSON.stringify(a.body).length)[0].body;
};
const grab = (label, pred = () => true) => {
    const hit = CAPTURED.find(r => r.label === label && pred(r.body));
    if (!hit) throw new Error(`no captured payload for "${label}" — re-run tools/capture-payloads.mjs`);
    return hit.body;
};

// A 200 is NOT proof of a usable answer (Codex #108 P1-2). Handlers NORMALISE malformed output, so a
// model that returns {} still yields `{kind:'none',target:'',tone:'suggest'}` with status 200 — and
// the probe would print OK for the unambiguous fixture "go and get some rest". That is precisely the
// degraded-format failure this tool exists to catch, so every shape asserts on MEANING.
const SHAPES = [
    { key: 'duel', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_duel_beat',
      body: grab('duel'),
      // Field names come from the handler's own schema (raid-council beatSchema: stunt/by/bark),
      // NOT from memory. Three validators in a row asserted invented keys — `who` where the schema
      // says `speaker`, `line` where it says `bark` — and each time the model's answer was perfectly
      // good while the check was wrong. Read the schema; do not recall it.
      ok: (r) => r.beat && ['shove', 'taunt'].includes(r.beat.stunt)
                 && r.beat.by && String(r.beat.bark || '').length > 8 },

    { key: 'invent', file: 'ry-farms-invent.js', schemaName: 'ry_farms_invent',
      body: grab('invent'),
      ok: (r) => String(r.name || '').length > 2 && String(r.lore || '').length > 15 },

    { key: 'classify', file: 'ry-farms-conscience.js', schemaName: 'ry_farms_conscience_classify',
      body: grab('whisper', b => b.stage === 'classify'),
      // The captured message is "go and get some rest". `none` is what a degraded model returns
      // through the handler's normaliser, so accepting it would defeat the whole probe.
      ok: (r) => r.kind === 'rest' },

    { key: 'reply', file: 'ry-farms-conscience.js', schemaName: 'ry_farms_conscience_reply',
      body: grab('whisper', b => b.stage === 'reply'),
      ok: (r) => String(r.line || '').length > 10 },

    { key: 'raidcouncil', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_raid_council',
      body: grab('raidcouncil'),
      ok: (r) => Array.isArray(r.script) && r.script.length >= 3 && r.script.every(t => t.speaker && t.line) },

    { key: 'raiddebrief', file: 'ry-farms-raid-council.js', schemaName: 'ry_farms_raid_council',
      body: grab('raiddebrief'),
      ok: (r) => Array.isArray(r.script) && r.script.length >= 3 && r.script.every(t => t.speaker && t.line) },

    { key: 'congregation', file: 'ry-farms-congregation.js', schemaName: 'ry_farms_congregation',
      body: grab('congregation'),
      ok: (r) => Array.isArray(r.script) && r.script.length >= 4 && r.script.every(t => t.speaker && t.line) },

    { key: 'election', file: 'ry-farms-congregation.js', schemaName: 'ry_farms_congregation',
      body: grab('election'),
      // its prompt asks candidates to speak to what they stand for, and to supply mutters
      // THIS SHAPE IS THE REASON THE PROBE EXISTS. It came back short on gpt-oss-20b in 1 of 4 runs,
      // was "fixed" with `minItems: 10`, and came back short AGAIN on the next run from complete
      // valid JSON — because Groq's structured outputs honour only a subset of JSON Schema and the
      // count keywords are not in it. The count is now carried by ten named REQUIRED properties,
      // which that subset does include. Two consecutive clean runs are not proof; a short run here
      // means the object form is not being enforced either, and the next move would be server-side
      // validation rather than a third schema rewrite.
      //
      // FOUR mutters, not one (Codex #109 P2-4): congregation.js:76 discards the array below four,
      // so a run with three would report OK while the enrichment was thrown away — the probe would
      // be certifying output the client never uses.
      ok: (r) => {
          const mutters = Array.isArray(r.mutters) ? r.mutters.filter(m => String(m || '').trim().length > 0) : null;
          // Throwing here is how a validator reports WHY: runShape catches it into the verdict line.
          // The previous version returned a bare false and printed 70 characters of the SCRIPT, which
          // is the half that was working — two runs were spent re-reading speeches to infer a count.
          if (!Array.isArray(r.script) || r.script.length < 3) throw new Error(`script had ${r.script?.length ?? 'no'} turns, needs 3`);
          if (mutters === null) throw new Error('mutters absent or not an array after normalisation');
          // TWO different questions, kept apart (Codex #111 P1). The CONTRACT asks for ten and the
          // format column above says whether it was enforced; the PRODUCT needs four, below which
          // the client discards the pool entirely. Accepting four here while the schema demands ten
          // is how a json_object fallback passed for an enforced contract.
          if (mutters.length < 4) throw new Error(`only ${mutters.length} usable mutters — under the client's minimum of 4`);
          if (mutters.length < 10) throw new Error(`${mutters.length} mutters: usable, but the contract requires 10`);
          return true;
      } },

    { key: 'chat', file: 'ry-farms-chat.js', schemaName: 'ry_farms_chat',
      body: grabLargest('ry-farms-chat'),
      // FIVE of these seven fields have a handler-side default (ry-farms-chat.js:57-61), so asserting
      // they are PRESENT asserts nothing: normalizeChat() guarantees presence. The first version of
      // this validator did exactly that and reported OK on a gpt-oss-20b run whose `memory` was the
      // literal fallback `${speakerLine} / ${listenerLine}` and whose tones were both the literal
      // default 'reflective'. Two real fields out of seven, certified green — which is the sentence
      // at the top of runShape ("a normalised default is a FAILURE dressed as success") coming true
      // in the validator written to enforce it.
      //
      // So each defaulted field is checked against the DEFAULT ITSELF. Presence proves the handler
      // ran; difference from the default proves the MODEL did.
      ok: (r) => {
          if (!(String(r.speakerLine || '').length > 8 && String(r.listenerLine || '').length > 8)) {
              throw new Error('dialogue lines missing or too short to be speech');
          }
          if (typeof r.relationshipDelta !== 'number') throw new Error('relationshipDelta is not a number');
          const defaulted = [];
          // memory falls back to the transcript. cleanText may truncate it, so compare on a prefix.
          const transcript = `${r.speakerLine} / ${r.listenerLine}`;
          const norm = (x) => String(x || '').replace(/\.\.$/, '').trim();
          if (norm(r.memory).length < 2 || transcript.startsWith(norm(r.memory))) defaulted.push('memory=transcript');
          if (String(r.relationshipReason || '') === 'opened up in conversation') defaulted.push('relationshipReason=default');
          // Both tones landing on the default is not PROOF the model omitted them, but it is the
          // signature of it, and it has never yet been a coincidence in a measured run.
          if (r.speakerTone === 'reflective' && r.listenerTone === 'reflective') defaulted.push('both tones=default');
          if (defaulted.length) throw new Error(`${defaulted.length}/7 fields are handler defaults, not model output: ${defaulted.join(', ')}`);
          return true;
      } },

    { key: 'dm', file: 'ry-farms-dm.js', schemaName: 'ry_farms_dm_tales',
      body: grab('dm'),
      ok: (r) => Array.isArray(r.tales) && r.tales.length >= 1 && String(r.tales[0].tale || '').length >= 200 },
];

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
    // #formatwitness Read from the module instance the HANDLER used, not from one captured earlier.
    //
    // The first version destructured lastFormatFor at the top of this file, and every shape reported
    // "unknown" — because runShape deletes globalThis.__ryFarmsLlmState three lines above, so each
    // handler builds a fresh state object with a fresh witness Map while the captured binding still
    // pointed at the first one, never written to again. An offline check missed it: it exercised the
    // require-cache purge and not the state wipe sitting next to it.
    const llm = require('../api/_llm.js');
    const witness = llm.lastFormatFor(shape.schemaName);
    const refusal = llm.lastRefusalFor(shape.schemaName);
    let parsed = null;
    try { parsed = JSON.parse(res.body || '{}'); } catch { /* not json */ }
    if (res.statusCode === 200 && parsed && !parsed.fallback) {
        // Semantic check, not just a status. A normalised default is a FAILURE dressed as success.
        let usable = false, why = '';
        try { usable = !!shape.ok(parsed); } catch (e) { why = String(e.message).slice(0, 40); }
        if (!usable) return { verdict: `WEAK   200 but not usable ${why || JSON.stringify(parsed).slice(0, 70)}`, ms, payload: parsed, witness, refusal };
        return { verdict: `OK     ${Object.keys(parsed).join(',')}`, ms, payload: parsed, witness, refusal };
    }
    const why = parsed?.error ? String(parsed.error).slice(0, 90) : `status ${res.statusCode}`;
    return { verdict: `FAIL   ${why}`, ms, payload: parsed, witness, refusal };
}

console.log(`\nprobe-endpoints — every production LLM shape, through the real handlers`);
console.log(`models: ${MODELS.join(', ')}`);
console.log('columns: shape / token budget / latency / FORMAT THAT PRODUCED IT / verdict\n');

const results = [];
for (const model of MODELS) {
    console.log(`=== ${model} ===`);
    process.env.RY_FARMS_LLM_MODELS = model;
    for (const shape of SHAPES) {
        if (ONLY && !shape.key.includes(ONLY)) continue;
        await sleep(DELAY_MS);
        const r = await runShape(shape);
        // Which format actually produced it — the difference between a contract that was ENFORCED
        // and one the model merely happened to satisfy. A shape that asks for a schema and answers
        // under json_object has not verified the schema at all, however good the output looks.
        const fmt = r.witness ? r.witness.format : 'unknown';
        let verdict = r.verdict;
        // THREE outcomes, not two. "I could not tell" is not "it was not enforced" — the first run of
        // this column reported all twenty shapes as unenforced when the witness was simply unwired,
        // which is the same conflation of absence with evidence that this column exists to end.
        if (fmt === 'unknown') {
            verdict = `BROKEN the probe could not observe the format — fix the witness before trusting any verdict`;
        } else if (verdict.startsWith('OK') && fmt !== 'json_schema') {
            verdict = `WEAK   usable, but produced under ${fmt} — the schema was NOT enforced`;
        }
        // Print the provider's reason whenever the strict format did not carry the call. Without it
        // "not enforced" is a symptom with no cause, and the only way to learn more is another run.
        if (r.refusal) {
            console.log(`      refused: ${r.refusal.status} ${r.refusal.scope}-scoped — ${r.refusal.message.slice(0, 150)}`);
        }
        results.push({ model, key: shape.key, verdict, format: fmt });
        console.log(`  ${shape.key.padEnd(13)} ${String(budgetFor(shape.file, shape.schemaName)).padStart(4)} tok  ${String(r.ms).padStart(5)}ms  ${String(fmt).padEnd(11)} ${verdict}`);
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
} else if (ONLY) {
    // A filtered run measures what was asked for and NOTHING else. Saying "can carry the whole game"
    // here would be the probe telling the same comfortable lie it was built to catch.
    console.log(`Shapes matching "${ONLY}" returned usable output — ${results.length} of ${SHAPES.length * MODELS.length} checks run.`);
    console.log('This is a partial run: it says nothing about the shapes it skipped.');
} else {
    console.log('Every production shape returned usable output. This model can carry the whole game.');
}
process.exit(failed.length ? 1 : 0);
