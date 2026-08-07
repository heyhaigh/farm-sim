// tools/probe-llm.mjs — find out what a candidate model ACTUALLY does, before shipping it.
//
// WHY THIS EXISTS. On 2026-08-06 we migrated RY_FARMS_LLM_MODEL to openai/gpt-oss-20b by changing
// an env var in production, because there was no other way to try it. It broke whispers AND
// congregation for live visitors and had to be reverted. The failure was invisible from outside:
// classify (200 tokens) still worked while reply (320) and congregation (900) returned empty
// content, so the game looked half-alive.
//
// llama-3.1-8b-instant is shut down by Groq on 2026-08-16, so a migration is mandatory. This script
// is the local loop that makes it safe: it sends the REAL payload shapes each endpoint uses, against
// each candidate model, and reports a matrix — status, whether content came back empty, whether the
// answer hid in `reasoning`, how many tokens were actually spent, and whether the JSON parsed.
//
// It never writes to the repo and is not part of the test suite: it makes real, billable calls.
//
// USAGE (the key stays in your shell — this script only reads it):
//   GROQ_API_KEY=gsk_... node tools/probe-llm.mjs
//   GROQ_API_KEY=gsk_... node tools/probe-llm.mjs --models openai/gpt-oss-20b,llama-3.3-70b-versatile
//
// Add --verbose to dump the raw first choice for a failing case.

// Read .env if present, so the key never has to go on a command line (where it would land in shell
// history, and — if the command is run through an agent — in a transcript). .env is gitignored and
// has never been committed; verified 2026-08-07. Real env vars still win over the file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadDotEnv() {
    try {
        const file = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env');
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const eq = line.indexOf('=');
            if (eq < 1) continue;
            const k = line.slice(0, eq).trim();
            let v = line.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            if (!process.env[k]) process.env[k] = v;   // a real env var always wins
        }
    } catch { /* no .env — fall back to the shell */ }
}
loadDotEnv();

// CREDENTIAL AND PROVIDER MUST NOT DIVERGE (Codex #104 P2-5). The first version defaulted the BASE
// to Groq while falling back to OPENAI_API_KEY for the credential — so a developer holding only an
// OpenAI key would have transmitted that secret to Groq. A probe is not worth leaking a key to the
// wrong provider, so each base has exactly one acceptable key and there is no fallback between them.
const VERBOSE = process.argv.includes('--verbose');
const CUSTOM_BASE = process.env.PROBE_BASE_URL || null;
const BASE = CUSTOM_BASE || 'https://api.groq.com/openai/v1';
const KEY = CUSTOM_BASE ? process.env.PROBE_API_KEY : process.env.GROQ_API_KEY;

if (!KEY) {
    if (CUSTOM_BASE) {
        console.error(`PROBE_BASE_URL is set to ${CUSTOM_BASE}, so PROBE_API_KEY must be set too.

A key for one provider is never sent to another: set the key that belongs to THAT endpoint.`);
    } else {
        console.error(`No GROQ_API_KEY found.

Put it in ~/ry-farms/.env (gitignored, never committed) as:
    GROQ_API_KEY=gsk_...

then run:  node tools/probe-llm.mjs

That keeps the key out of your shell history and out of any transcript.
(OPENAI_API_KEY is deliberately NOT used here — this probe talks to Groq, and a
credential must never be sent to a provider it does not belong to.)`);
    }
    process.exit(2);
}

function argOf(flag) {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
const argModels = argOf('--models') ? argOf('--models').split(',').map(s => s.trim()) : null;
const argCase = argOf('--case');            // run one row only, e.g. --case dm
const argEffort = argOf('--effort');        // pin one effort, e.g. --effort low
// Seconds to wait BEFORE each call. The free tier meters tokens per MINUTE, so a burst of probes
// starves its own later rows: the first run returned 429 on every dm row and it was impossible to
// tell a real ceiling from my own noise. --delay 65 gives the bucket a full minute to refill.
const argDelay = Number(argOf('--delay') || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Candidates. gpt-oss-20b is Groq's named replacement for llama-3.1-8b-instant; the others are here
// to compare prose quality and limits. The outgoing model is included as the control — if IT fails a
// probe, the probe is wrong, not the model.
const MODELS = argModels || [
    'llama-3.1-8b-instant',          // CONTROL: what production runs today, dies 2026-08-16
    'openai/gpt-oss-20b',            // Groq's recommended replacement
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
];

// The real shapes, with the real token budgets from each endpoint. These numbers are the point:
// a model that passes at 200 and fails at 320 looks healthy until a player whispers.
const CASES = [
    {
        name: 'classify  (200 tok)', maxTokens: 200, temperature: 0,
        system: 'You map a stray thought onto ONE bounded intention. kind MUST be one of: chop, plant, water, rest, explore, build, visit, trade, hunt, none, watch. tone MUST be one of: suggest, observe, press, praise, meta. Return JSON only.',
        user: JSON.stringify({ message: 'go and get some rest' }),
        schema: { type: 'object', additionalProperties: false, required: ['kind', 'target', 'tone'], properties: { kind: { type: 'string' }, target: { type: 'string' }, tone: { type: 'string' } } },
        schemaName: 'probe_classify',
        want: o => typeof o?.kind === 'string',
    },
    {
        name: 'reply     (320 tok)', maxTokens: 320,
        system: 'You write a farmer\'s in-character reply to a stray thought pushed into their head. One or two sentences, plain ASCII, no markdown. Return JSON only: {"line": "..."}',
        user: JSON.stringify({ verdict: 'dismiss', message: 'go and rest', character: { short: 'Grull', traits: ['stubborn'] } }),
        schema: { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } },
        schemaName: 'probe_reply',
        want: o => typeof o?.line === 'string' && o.line.length > 3,
    },
    {
        name: 'congregation (900 tok)', maxTokens: 900, temperature: 0.8,
        system: 'You are the chronicler of a frontier valley. Write a short gathering scene as JSON only: {"beats":[{"who":"<name>","line":"<one spoken line>"}]} with 4 beats.',
        user: JSON.stringify({ town: 'BIRCHGROVE', people: ['Grull', 'Hex', 'Peal', 'Rover'] }),
        schema: { type: 'object', additionalProperties: false, required: ['beats'], properties: { beats: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['who', 'line'], properties: { who: { type: 'string' }, line: { type: 'string' } } } } } },
        schemaName: 'probe_congregation',
        want: o => Array.isArray(o?.beats) && o.beats.length > 0,
    },
    {
        // REAL production payload (Codex #104 P1-1). The previous version sent one hand-written
        // stub character at 6000 tokens and "passed" — which proved nothing, because production
        // sent EIGHT generated founders (9,376 chars, truncated at callLLM's 8,000 cap) at a token
        // budget it could never satisfy. This case is now generated from the actual game: real
        // sheets, the real prompt, and the batch-of-one shape the endpoint now sends.
        name: 'dm tale x1 (1500 tok)', maxTokens: 1500,
        system: 'You are a town chronicler. Rewrite each character draft as a RICHER backstory: 6 to 9 sentences, roughly 120 to 180 words, of evocative fantasy prose. Third person, using the short name at least twice, ALWAYS they/them. Plain ASCII only. Return JSON only: {"tales":[{"seed":<number from the input>,"tale":"<prose>"}]} with one entry per character.',
        user: null,   // filled in below from a real generated town
        schema: { type: 'object', additionalProperties: false, required: ['tales'], properties: { tales: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['seed', 'tale'], properties: { seed: { type: 'number' }, tale: { type: 'string' } } } } } },
        schemaName: 'probe_dm',
        want: o => Array.isArray(o?.tales) && o.tales.length === 1 && String(o.tales[0].tale).length >= 200,
    },
    {
        // The OLD shape, kept as the control that shows why it had to change. Expect this to fail
        // or truncate — that is the finding, not a defect in the probe.
        name: 'dm FULL CAST (control)', maxTokens: 1500,
        system: 'You are a town chronicler. Rewrite each character draft as a RICHER backstory: 6 to 9 sentences, roughly 120 to 180 words each. Return JSON only: {"tales":[{"seed":<number>,"tale":"<prose>"}]} with one entry per character.',
        user: null,   // filled in below — the whole founding cast
        schema: { type: 'object', additionalProperties: false, required: ['tales'], properties: { tales: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['seed', 'tale'], properties: { seed: { type: 'number' }, tale: { type: 'string' } } } } } },
        schemaName: 'probe_dm_full',
        want: o => Array.isArray(o?.tales) && o.tales.length >= 8,
    },
];

// Build the REAL DM payloads from a real generated town, so the probe measures what production
// actually sends rather than a stub someone imagined. This is the lesson from 2026-08-06/07: a
// fabricated input produced a fabricated verdict, twice.
{
    const { World } = await import('../farm.js');
    const { generateCrew, hashString } = await import('../dna.js');
    // The DEPLOYED prompt, schema and token budget — not an approximation of them.
    const { createRequire } = await import('node:module');
    const requireCjs = createRequire(import.meta.url);
    const DM = requireCjs('../api/ry-farms-dm.js');
    const m = generateCrew(20260706); const used = new Set();
    const pick = () => { const un = m.filter(x => !used.has(x.id)); let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b; };
    const w = new World(20260706);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    const charOf = (f) => { const s = f.sheet, p = s.personality;
        return { seed: s.seed, name: s.name, shortName: s.name.split(' ')[0], trade: s.archetype,
            background: s.story.bg, stats: s.stats, personality: { label: p.label, creed: p.creed },
            ideal: s.story.ideal, bond: s.story.bond, flaw: s.story.flaw,
            dream: { yearn: s.dream.yearn, rivalName: s.dream.rivalName || null },
            keepsake: String((s.memory && s.memory.title) || 'a life before the valley').slice(0, 40),
            draft: s.story.tale }; };
    const town = { name: w.name, seed: w.seed, day: w.day, season: w.seasonName, culture: w.culture };
    const one = JSON.stringify({ town, characters: [charOf(w.farmers[0])] });
    const all = JSON.stringify({ town, characters: w.farmers.map(charOf) });
    const sys = DM.buildSystemPrompt(town);
    for (const c of CASES.filter(x => x.schemaName.startsWith('probe_dm'))) {
        c.system = sys;                       // the real 1,947-char prompt
        c.schema = DM.responseSchema;         // seed: integer, not number
        c.maxTokens = DM.DM_MAX_TOKENS;       // the real reservation
    }
    CASES.find(c => c.name.startsWith('dm tale x1')).user = one;
    CASES.find(c => c.name.startsWith('dm FULL CAST')).user = all;
    console.log(`  using the DEPLOYED dm prompt (${sys.length} chars), schema and ${DM.DM_MAX_TOKENS}-token budget`);
    console.log(`  real payloads: 1 farmer = ${one.length} chars, full cast (${w.farmers.length}) = ${all.length} chars`);
    console.log(`  callLLM truncates user content at 8000 -> full cast is ${all.length > 8000 ? 'CUT MID-JSON' : 'fine'}\n`);
}

// Mirrors _llm.js: strict schema first, then json_object, then nothing.
function formatsFor(c) {
    return [
        { label: 'json_schema', value: { type: 'json_schema', json_schema: { name: c.schemaName, strict: true, schema: c.schema } } },
        { label: 'json_object', value: { type: 'json_object' } },
        { label: 'none', value: null },
    ];
}

function parseJson(text) {
    try { return JSON.parse(text); }
    catch {
        const m = String(text || '').match(/\{[\s\S]*\}/);
        if (!m) return null;
        try { return JSON.parse(m[0]); } catch { return null; }
    }
}

async function call(model, c, format, reasoningEffort) {
    const body = {
        model,
        messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }],
        max_tokens: c.maxTokens,
    };
    if (typeof c.temperature === 'number') body.temperature = c.temperature;
    if (format) body.response_format = format;
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
        const r = await fetch(`${BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const text = await r.text();
        if (!r.ok) return { status: r.status, error: text.slice(0, 200) };
        const data = JSON.parse(text);
        const msg = data?.choices?.[0]?.message;
        const content = typeof msg?.content === 'string' ? msg.content : '';
        const reasoning = typeof msg?.reasoning === 'string' ? msg.reasoning : '';
        return {
            status: 200,
            content, reasoning,
            usage: data?.usage || {},
            // production's extractContent() reads message.content ONLY. Parsing `reasoning` here
            // would let a reasoning-only model pass this gate and fail every real call (Codex #105
            // P2-6), so the probe accepts exactly what production accepts — and reports separately
            // when the answer was sitting in `reasoning`, because that is a finding, not a pass.
            parsed: parseJson(content),
            parsedFrom: parseJson(content) ? 'content' : null,
            reasoningHeldJson: !parseJson(content) && !!parseJson(reasoning),
        };
    } catch (err) {
        return { status: 0, error: String(err?.message || err).slice(0, 120) };
    } finally { clearTimeout(t); }
}

function verdictFor(c, res) {
    if (res.status === 0) return `NET  ${res.error}`;
    if (res.status === 413) return 'FAIL 413 request too large (TPM ceiling)';
    if (res.status === 404) return 'GONE 404 model not available';
    if (res.status !== 200) return `FAIL ${res.status} ${String(res.error).slice(0, 90)}`;
    if (!res.parsed) {
        const why = res.reasoningHeldJson ? 'JSON was in `reasoning`, which production does NOT read'
            : !res.content && res.reasoning ? 'content EMPTY, reasoning populated'
            : !res.content ? 'content EMPTY'
            : 'unparseable content';
        return `FAIL 200 but no JSON - ${why}`;
    }
    if (!c.want(res.parsed)) return 'FAIL 200, JSON parsed, but wrong shape';
    const ct = res.usage?.completion_tokens ?? '?';
    const rt = res.usage?.reasoning_tokens;
    return `OK   from ${res.parsedFrom}, ${ct} completion tok${rt ? ` (${rt} reasoning)` : ''}`;
}

console.log(`\nprobe-llm — ${BASE}\ncandidates: ${MODELS.join(', ')}\n`);

const RUN_CASES = argCase ? CASES.filter(c => c.name.toLowerCase().includes(argCase.toLowerCase())) : CASES;
const RUN_EFFORTS = argEffort ? [argEffort === 'default' ? null : argEffort] : [null, 'low'];
if (!RUN_CASES.length) { console.error(`No case matches --case ${argCase}`); process.exit(2); }

for (const model of MODELS) {
    console.log(`\n=== ${model} ===`);
    // A reasoning model is the trap that broke production: it spends max_tokens THINKING and returns
    // empty content. Probe default effort AND 'low' so we can see whether the knob rescues it.
    for (const effort of RUN_EFFORTS) {
        const label = effort ? `reasoning_effort=${effort}` : 'default';
        let printedHeader = false;
        for (const c of RUN_CASES) {
            let line = null;
            for (const f of formatsFor(c)) {
                if (argDelay) await sleep(argDelay * 1000);
                const res = await call(model, c, f.value, effort);
                // A 400 on a format is the documented fallback path, not a failure — try the next.
                if (res.status === 400 && f.label !== 'none') continue;
                line = `  ${label.padEnd(20)} ${c.name.padEnd(22)} [${f.label.padEnd(11)}] ${verdictFor(c, res)}`;
                if (VERBOSE && !res.parsed && res.status === 200) {
                    line += `\n      content(${res.content.length}): ${JSON.stringify(res.content.slice(0, 160))}`;
                    line += `\n      reasoning(${res.reasoning.length}): ${JSON.stringify(res.reasoning.slice(0, 160))}`;
                }
                break;
            }
            if (!printedHeader) printedHeader = true;
            console.log(line ?? `  ${label.padEnd(20)} ${c.name.padEnd(22)} FAIL every format rejected`);
        }
        // A non-reasoning model ignores reasoning_effort entirely; one pass is enough.
        if (!effort) continue;
    }
}

console.log(`
Read the matrix like this:
  * a model that is OK on classify but FAILs on reply/congregation is a REASONING model eating its
    token budget - the exact failure that broke production on 2026-08-06.
  * "content EMPTY, reasoning populated" means extractContent() must learn to fall back to
    message.reasoning.
  * 413 on dm tales only = the 6k TPM ceiling, which #stickycap already handles by halving.
  * whichever model is OK on ALL FOUR rows, at the LOWEST reasoning effort, is the migration target.
`);
