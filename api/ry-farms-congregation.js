// api/ry-farms-congregation.js — the DAY-1 FOUNDING CONVERSATION (#132b). Given the founding cast (names +
// personalities + what each was grown from), the model writes the town's OPENING exchange: a short, natural,
// turn-taking conversation as the settlers/warband decide how they'll live on this new ground — survive, settle,
// and share a watch so none stands alone. DISPLAY TEXT ONLY: the sim never reads these lines (the words go into
// transient speech bubbles), so the seeded world stays byte-identical whether or not the model ever answers.
// Any failure returns { fallback: true } and the client's authored offline pools carry the scene instead.
//
// Same serverless shape as ry-farms-conscience.js / ry-farms-dm.js (mounted by server.mjs).

const LINE_MAX = 120;        // per-line hard cap after trimming
const LINE_SCHEMA_MAX = 160; // looser schema bound so a line finishes before we trim

// bitmap-font sanitize (drawText uppercases at render): straight quotes, spaced hyphens, printable ASCII only.
function cleanLine(text) {
    let s = String(text || '')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/[–—]/g, ' - ').replace(/…/g, '...')
        .replace(/\s+/g, ' ').trim()
        .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > LINE_MAX) {
        s = s.slice(0, LINE_MAX);
        const end = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?'));
        s = end > 12 ? s.slice(0, end + 1) : s.replace(/\s+\S*$/, '');
    }
    if (!/[.!?]$/.test(s)) s = s.replace(/[\s,;:\-]+$/, '') + '.';
    return s.trim();
}

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); } });
        req.on('error', reject);
    });
}

const { callLLM } = require('./_llm.js');
const { asText } = require('./_text.js');   // #111 P2 type boundary: coercion is not a type check

const scriptSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['script'],
    properties: {
        script: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['speaker', 'line'],
                properties: {
                    speaker: { type: 'string' },                    // one of the founder names
                    line: { type: 'string', maxLength: LINE_SCHEMA_MAX },
                },
            },
        },
    },
};

// The ten enforced mutter slots. Named rather than counted, because `required` is honoured and
// `minItems` is not — see ELECTION_SCHEMA.
const MUTTER_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'];

// `mutters` was added to `properties` but inherited `required: ['script']` from scriptSchema and
// carried no minItems — so a reply with two mutters, or none, was SCHEMA-VALID (Codex #110 P2-2).
// The client then discards anything under four and falls back to the canned pool, which is how a
// fallback model came up short in 1 of 4 measured runs.
//
// The first fix stated the invariant as `minItems: 10` and it changed NOTHING — gpt-oss-20b came
// back short again, with complete valid JSON (there is no truncation repair in _llm.js, so a cut-off
// body would have thrown rather than reached the count check). Groq's structured-output docs list
// the subset it honours — types, `required`, `additionalProperties`, `enum`, `$defs`/`$ref`, `anyOf`
// — and the count/length keywords are not in it. `minItems` was being dropped on the floor.
//
// So the count is expressed with the one keyword that IS enforced: ten NAMED, REQUIRED string
// properties. Every `maxLength` elsewhere in this codebase is ignored too, but those are harmless
// because a server-side clamp does the real work; this was the only place where a schema keyword
// was the sole thing standing between the prompt and the client's minimum.
const ELECTION_SCHEMA = {
    ...scriptSchema,
    required: [...(scriptSchema.required || ['script']), 'mutters'],
    properties: {
        ...scriptSchema.properties,
        mutters: {
            type: 'object', additionalProperties: false,
            required: [...MUTTER_KEYS],
            properties: Object.fromEntries(
                MUTTER_KEYS.map(k => [k, { type: 'string', maxLength: LINE_SCHEMA_MAX }])),
        },
    },
};

async function generate(body) {
    const orc = body.culture === 'orc';
    const founders = (Array.isArray(body.founders) ? body.founders : []).slice(0, 8);
    const names = founders.map(f => f.name).filter(Boolean);
    if (!names.length) throw new Error('no founders');
    const place = orc ? 'a warband carving out a new hold' : 'settlers founding a new town';
    const post = orc ? 'the war-post' : 'the town well';
    const system = [
        `You write the OPENING CONVERSATION of ${place} in PROPAGATE, a pixel farming sim. It is day one: the founders have just arrived on empty ground and gather at ${post} to decide, in their own words, how they will live here - survive the first night, stake their plots, and agree to SHARE A WATCH by turns so none stands alone against the wilds (raiders, beasts).`,
        'Write it as a real, flowing, turn-taking conversation: they PROPOSE, AGREE, push BACK, build on each other, and address one another BY NAME. Distinct voices - each founder sounds like their own personality and past, never interchangeable. No two lines say the same thing.',
        'Rules:',
        '- EVERY founder speaks at least once. 12 to 16 short turns total.',
        '- Each line is ONE short sentence, under ~16 words, first person, plain and lived-in. Always a complete sentence.',
        '- speaker MUST be exactly one of the founder names given (match spelling).',
        '- Ground lines in who they ARE (their personality, creed, and what they were "grown from") and in the moment (new land, no walls, night coming). Reference each other and the shared watch.',
        orc ? '- These are orcs founding a hold: blunt, martial, loyal to the band. Not villains - a people.' : '- These are human settlers: hopeful, wary, neighbourly.',
        '- Plain ASCII only. No markdown, no em dashes (use " - "), straight quotes, no emojis, no stage directions, no narration, no modern/technological words.',
        'Return JSON only: { "script": [ { "speaker": "<name>", "line": "<what they say>" }, ... ] }.',
    ].join('\n');
    const cast = founders.map(f => ({
        name: f.name,
        trade: f.archetype || null,
        personality: f.personality || null,   // { label, creed }
        grownFrom: f.keepsake || null,         // the memory title they were seeded from
        dream: f.dream || null,
    }));
    const out = await callLLM({
        system,
        user: JSON.stringify({ culture: orc ? 'orc' : 'human', founders: cast }),
        // BACKGROUND (Codex #107 P1-3): nobody is synchronously waiting — the authored fallback scene plays immediately; this only enriches it.
        // Only DM was classified, so every other async caller could spend the whole minute and
        // starve a player waiting on a two-stage whisper.
        schema: scriptSchema, schemaName: 'ry_farms_congregation', maxTokens: 900, temperature: 0.8, priority: 'background',
    });
    return normalize(out, names);
}

// #vote-voice — the day-10 STUMP SPEECHES: each candidate makes their one case to the assembled town.
// Same display-only contract as the founding conversation; the client falls back to the authored
// STUMP_LINES pool on any failure.
async function generateElection(body) {
    const orc = body.culture === 'orc';
    const cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 8);
    const names = cands.map(c => c.name).filter(Boolean);
    if (!names.length) throw new Error('no candidates');
    const post = orc ? 'the war-post' : 'the town well';
    const offices = orc ? 'WARCHIEF (the manager) and the WATCH (the guard)' : 'MANAGER and the WATCH';
    const system = [
        `You write the STUMP SPEECHES of a founding election in PROPAGATE, a pixel farming sim. After ten days of shared watches, the whole ${orc ? 'warband' : 'town'} has downed tools and gathered at ${post} to choose its first officers: ${offices}. Each CANDIDATE steps up once and makes their case.`,
        'Rules:',
        '- EVERY candidate speaks EXACTLY once, in the order given.',
        '- Each speech is 1 to 2 short sentences, under ~22 words total, first person, addressed to the assembled crowd. Always complete sentences.',
        '- speaker MUST be exactly one of the candidate names given (match spelling).',
        '- Ground each speech in who they ARE (trade, personality, dream, what they were grown from) and the office they stand for. Distinct voices - a rival sounds nothing like a peacemaker. No two speeches share a shape.',
        '- No empty promises of specific outcomes; they pitch CHARACTER and intent, the way real stump speeches do.',
        orc ? '- These are orcs of a war-hoard: short, blunt, physical sentences - the hold, the band, iron, meat. Not villains - a people.' : '- These are human settlers: plain-spoken, wary, neighbourly.',
        '- Plain ASCII only. No markdown, no em dashes (use " - "), straight quotes, no emojis, no stage directions, no narration, no modern/technological words.',
        // #delib-variety — the crowd gets LLM voices too, replacing the canned deliberation chants
        'ALSO return "mutters": an object with EXACTLY the keys m1 through m10, each a distinct one-line inner murmur of the CROWD weighing their vote (each under 9 words, varied sentiments - resolve, doubt, loyalty, private calculation; no two share a shape; candidate names optional). All ten are required.',
        'Return JSON only: { "script": [ { "speaker": "<name>", "line": "<their speech>" }, ... ], "mutters": { "m1": "<line>", ... , "m10": "<line>" } }.',
    ].join('\n');
    const out = await callLLM({
        system,
        user: JSON.stringify({ culture: orc ? 'orc' : 'human', candidates: cands }),
        // BACKGROUND (Codex #107 P1-3): nobody is synchronously waiting — the authored fallback scene plays immediately; this only enriches it.
        // Only DM was classified, so every other async caller could spend the whole minute and
        // starve a player waiting on a two-stage whisper.
        schema: ELECTION_SCHEMA, schemaName: 'ry_farms_congregation', maxTokens: 900, temperature: 0.8, priority: 'background',
    });
    const result = normalize(out, names, 2);
    // crowd mutters ride along, cleaned + deduped (display pool; the client's authored pool is the net)
    const seenM = new Set();
    result.mutters = mutterList(out?.mutters)
        .map(m => cleanLine(m)).filter(m => m && m.length > 1 && !seenM.has(m) && seenM.add(m)).slice(0, 12);
    return result;
}

// Accept EITHER shape. The object form is what the schema asks for, but callLLM degrades
// json_schema -> json_object when a provider rejects the schema, and json_object enforces nothing at
// all — so on that path the model is free to answer with the array the older prompt described. Reading
// only the object form would turn a soft format degradation into a silently empty crowd.
function mutterList(m) {
    // STRINGS ONLY, and that filter is load-bearing rather than defensive habit. cleanLine() coerces
    // with String(), so a nested value survives its way onto a speech bubble as garbage: ['a','b']
    // becomes "a,b." and an object becomes literally "[object Object]." — both longer than the
    // `length > 1` filter the caller uses, so both display. On the json_object fallback path nothing
    // constrains the value types at all, and the model is free to answer
    // { "mutters": { "crowd": [...] } }. This was reachable through the array form too, before the
    // object form existed.
    const strings = (v) => v.filter(x => typeof x === 'string');
    if (Array.isArray(m)) return strings(m);
    if (!m || typeof m !== 'object') return [];
    // Known slots first, in slot order rather than whatever order the JSON happened to arrive in, then
    // anything else the model volunteered (json_object again: additionalProperties can't stop it there).
    return strings([...MUTTER_KEYS.map(k => m[k]),
        ...Object.keys(m).filter(k => !MUTTER_KEYS.includes(k)).map(k => m[k])]);
}

function normalize(raw, names, minTurns = 4) {
    const lower = new Map(names.map(n => [n.toLowerCase(), n]));
    const script = [];
    for (const t of (raw && Array.isArray(raw.script) ? raw.script : [])) {
        const speaker = lower.get(asText(t?.speaker).trim().toLowerCase());
        const line = cleanLine(asText(t?.line));
        if (speaker && line && line.length > 1) script.push({ speaker, line });
        if (script.length >= 16) break;
    }
    if (script.length < minTurns) throw new Error('script too short');
    // #Codex29 P1 — COVERAGE: a script that only voices a couple of the founders isn't an ensemble conversation.
    // Require it to name a healthy fraction of the cast, else reject so the client falls back to the sim director's
    // authored pools (which cover every founder). The director ALSO guarantees coverage at runtime, so this is
    // defense-in-depth against a lopsided model answer, not the sole safeguard.
    // (#vote-voice: the election scene tolerates partial coverage — the sim director voices any candidate the
    // script skipped from the authored stump pool per-candidate, so minTurns doubles as the coverage floor.)
    const distinct = new Set(script.map(t => t.speaker)).size;
    const need = Math.min(names.length, Math.max(minTurns, minTurns >= 4 ? Math.ceil(names.length * 0.6) : minTurns));
    if (distinct < need) throw new Error(`script covers only ${distinct}/${names.length} speakers (need ${need})`);
    return { script };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });
    try {
        const body = await parseBody(req);
        return send(res, 200, await (body.scene === 'election' ? generateElection(body) : generate(body)));
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'congregation generation failed' });
    }
};

// Exported for tests only — the handler above stays the module's callable export. Reading the mutter
// slots is the one piece of this file whose correctness depends on a provider behaviour we cannot
// control (which schema keywords are honoured), so it gets tested directly rather than only through a
// paid probe run.
module.exports.mutterList = mutterList;
module.exports.MUTTER_KEYS = MUTTER_KEYS;
module.exports.ELECTION_SCHEMA = ELECTION_SCHEMA;
