// api/ry-farms-raid-council.js — the MUSTER COUNSEL (#raid-council). When a raid is telegraphed ("a warband
// is massing to the north"), the roused townsfolk form a line at the frontier and have ~30 seconds before the
// blow lands. Given the cast + the situation (who's coming, from where, what's at stake), the model writes
// that exchange: urgent, in-character strategy and nerve — who holds where, who watches the flank, what to do
// if the line gives. DISPLAY TEXT ONLY: the sim never reads these lines (they go into transient speech bubbles
// via the muster-talk director), so the seeded world stays byte-identical whether or not the model answers.
// Any failure returns { fallback: true } and the authored MUSTER_TALK pools carry the scene instead.
//
// Same serverless shape as ry-farms-congregation.js (mounted by server.mjs).

const LINE_MAX = 110;
const LINE_SCHEMA_MAX = 150;

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
                    speaker: { type: 'string' },
                    line: { type: 'string', maxLength: LINE_SCHEMA_MAX },
                },
            },
        },
    },
};

async function generate(body) {
    const orc = body.culture === 'orc';
    const cast = (Array.isArray(body.cast) ? body.cast : []).slice(0, 8);
    const names = cast.map(f => f.name).filter(Boolean);
    if (!names.length) throw new Error('no cast');
    const town = String(body.town || (orc ? 'the hold' : 'the town')).slice(0, 40);
    const foe = String(body.foe || 'a warband').slice(0, 60);
    const dir = String(body.dir || 'the dark').slice(0, 20);
    const system = [
        `You write the MUSTER COUNSEL in RY FARMS, a pixel farming sim. ${foe} has been sighted massing to the ${dir} of ${town}; the alarm is up and these ${orc ? 'orcs of the hold' : 'farmer-neighbours'} have formed a defensive line at the frontier with only moments before the raiders reach them.`,
        'Write their urgent exchange while they wait: real, flowing, turn-taking — they set STRATEGY (who holds the middle, who takes the flank, fall back to the well if the line gives, protect the stores/the sick), steady each other\'s NERVE, and speak to each other BY NAME. Distinct voices — each sounds like their own personality; a bold one is eager, a timid one is scared and says so, a wise one thinks two steps ahead.',
        'Rules:',
        '- 8 to 12 short turns total. Most of the cast should speak.',
        '- Each line is ONE short sentence, under ~14 words, first person, urgent and lived-in. A complete sentence.',
        '- speaker MUST be exactly one of the names given (match spelling).',
        `- Ground lines in the MOMENT: raiders minutes away from the ${dir}, night fields, the harvest at stake. No greetings, no small talk, no weather.`,
        orc ? '- These are orcs defending their own hold: blunt, martial, eager. Not villains - a people defending home.' : '- These are farmers, not soldiers: brave but scared, practical, protective of each other.',
        '- Plain ASCII only. No markdown, no em dashes (use " - "), straight quotes, no emojis, no stage directions, no narration.',
        'Return JSON only: { "script": [ { "speaker": "<name>", "line": "<what they say>" }, ... ] }.',
    ].join('\n');
    const view = cast.map(f => ({
        name: f.name,
        trade: f.archetype || null,
        personality: f.personality || null,   // { label, creed }
        role: f.role || null,                 // 'sentry' | 'manager' | null — the watch talks like the watch
    }));
    const out = await callLLM({
        system,
        user: JSON.stringify({ culture: orc ? 'orc' : 'human', town, foe, dir, cast: view }),
        schema: scriptSchema, schemaName: 'ry_farms_raid_council', maxTokens: 700, temperature: 0.8,
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
        if (script.length >= 12) break;
    }
    if (script.length < 4) throw new Error('script too short');
    const distinct = new Set(script.map(t => t.speaker)).size;
    if (distinct < Math.min(names.length, 3)) throw new Error(`script covers only ${distinct} voices`);
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
        return send(res, 500, { fallback: true, error: err?.message || 'raid council generation failed' });
    }
};
