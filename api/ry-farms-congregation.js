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

async function generate(body) {
    const orc = body.culture === 'orc';
    const founders = (Array.isArray(body.founders) ? body.founders : []).slice(0, 8);
    const names = founders.map(f => f.name).filter(Boolean);
    if (!names.length) throw new Error('no founders');
    const place = orc ? 'a warband carving out a new hold' : 'settlers founding a new town';
    const post = orc ? 'the war-post' : 'the town well';
    const system = [
        `You write the OPENING CONVERSATION of ${place} in RY FARMS, a pixel farming sim. It is day one: the founders have just arrived on empty ground and gather at ${post} to decide, in their own words, how they will live here - survive the first night, stake their plots, and agree to SHARE A WATCH by turns so none stands alone against the wilds (raiders, beasts).`,
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
        schema: scriptSchema, schemaName: 'ry_farms_congregation', maxTokens: 900, temperature: 0.8,
    });
    return normalize(out, names);
}

function normalize(raw, names) {
    const lower = new Map(names.map(n => [n.toLowerCase(), n]));
    const script = [];
    for (const t of (raw && Array.isArray(raw.script) ? raw.script : [])) {
        const speaker = lower.get(String(t?.speaker || '').trim().toLowerCase());
        const line = cleanLine(t?.line);
        if (speaker && line && line.length > 1) script.push({ speaker, line });
        if (script.length >= 16) break;
    }
    if (script.length < 4) throw new Error('script too short');
    return { script };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });
    try {
        const body = await parseBody(req);
        return send(res, 200, await generate(body));
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'congregation generation failed' });
    }
};
