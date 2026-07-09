// api/ry-farms-dm.js — the LLM DUNGEON MASTER's writing desk (#92 stage 2).
//
// One-shot, out-of-band prose enrichment: the client sends the whole founding cast
// (each farmer's 5e-style sheet plus the procedural draft tale the in-game DM already
// composed), and a 5th-Edition-literate fantasy writer rewrites every draft as richer
// prose. Display text ONLY — nothing here feeds back into sim decisions, and every
// failure mode returns { fallback: true } so the procedural tale simply stands.
// Same handler shape as ry-farms-chat.js (serverless-style, mounted by server.mjs).

const TALE_MAX = 1200;

// Sanitize for the bitmap font: straight quotes, spaced hyphens for dashes, printable
// ASCII only. Case is preserved (drawText uppercases at render time).
function cleanTale(text) {
    let s = String(text || '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, ' - ')
        .replace(/…/g, '...')
        .replace(/\s+/g, ' ')
        .trim();
    s = s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length <= TALE_MAX) return s;
    const cut = s.slice(0, TALE_MAX);
    return cut.slice(0, cut.lastIndexOf('.') + 1) || cut;
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
        req.on('end', () => {
            try { resolve(raw ? JSON.parse(raw) : {}); }
            catch (err) { reject(err); }
        });
        req.on('error', reject);
    });
}

function extractOutputText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;
    const parts = [];
    for (const item of data?.output || []) {
        for (const c of item.content || []) {
            if (typeof c.text === 'string') parts.push(c.text);
            else if (typeof c.output_text === 'string') parts.push(c.output_text);
        }
    }
    return parts.join('\n');
}

function parseJson(text) {
    try { return JSON.parse(text); }
    catch {
        const match = String(text || '').match(/\{[\s\S]*\}/);
        if (!match) throw new Error('model did not return JSON');
        return JSON.parse(match[0]);
    }
}

const responseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tales'],
    properties: {
        tales: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['seed', 'tale'],
                properties: {
                    seed: { type: 'integer' },
                    tale: { type: 'string' },
                },
            },
        },
    },
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });

    try {
        const body = await parseBody(req);
        const characters = Array.isArray(body.characters) ? body.characters.slice(0, 16) : [];
        if (!characters.length) return send(res, 400, { fallback: true, error: 'no characters' });
        const model = process.env.RY_FARMS_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

        const system = [
            'You are the town chronicler of RY FARMS: a Dungeons and Dragons 5th Edition Dungeon Master and a gifted fantasy prose writer.',
            'You receive the founding cast of a frontier farming valley. Each character carries a 5e-style sheet - ability scores, a BACKGROUND, personality traits, an IDEAL, a BOND, a FLAW, a lifelong DREAM (with a named rival where relevant), a keepsake title (the memory that made them), and a procedural DRAFT of their origin tale.',
            'Rewrite each draft as a RICHER backstory: 6 to 9 sentences, roughly 120 to 180 words, of evocative fantasy prose. Named places, weather and seasons, omens, small losses, one vivid sensory detail. Third person, using the character\'s short name at least twice, and ALWAYS they/them pronouns - never he or she.',
            'Stay strictly consistent with the sheet: the background is where they came from, the flaw shows through the telling, the dream is where the tale is pointed. Never contradict or change a name, and never invent mechanical facts (no spells, magic items, ranks or titles).',
            'Let the ability scores color the telling - a STR 15 hermit and an INT 17 hermit left the mountain for different reasons.',
            'Weave the keepsake title into the tale VERBATIM exactly once, wrapped in double quotes, treated as a relic or talisman of the old life - the stranger the title reads, the more matter-of-factly the tale should treat it.',
            'Give each character a distinct voice and homeland so the cast reads as different lives that converged on one valley - not one life told eight ways. End every tale with their arrival in the valley, angled at their dream.',
            'Plain ASCII prose only: no markdown, no em dashes (write " - "), straight quotes, no emojis, no modern or technological references.',
            'Return JSON only: { "tales": [ { "seed": <number from the input>, "tale": "<the rewritten backstory>" } ] } with one entry per character.',
        ].join('\n');

        const openaiRes = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                input: [
                    { role: 'system', content: system },
                    { role: 'user', content: JSON.stringify({ town: body.town || {}, characters }).slice(0, 24000) },
                ],
                text: {
                    format: {
                        type: 'json_schema',
                        name: 'ry_farms_dm_tales',
                        strict: true,
                        schema: responseSchema,
                    },
                },
                max_output_tokens: 6000,
            }),
        });

        if (!openaiRes.ok) {
            return send(res, 502, { fallback: true, error: `OpenAI request failed (${openaiRes.status})` });
        }

        const data = await openaiRes.json();
        const raw = parseJson(extractOutputText(data));
        const wanted = new Set(characters.map(c => c.seed));
        const tales = (raw?.tales || [])
            .map(t => ({ seed: Number(t.seed), tale: cleanTale(t.tale) }))
            .filter(t => wanted.has(t.seed) && t.tale.length >= 200);
        if (!tales.length) return send(res, 502, { fallback: true, error: 'model returned no usable tales' });
        return send(res, 200, { tales });
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'tale generation failed' });
    }
};
