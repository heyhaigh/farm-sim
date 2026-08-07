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

const { callLLM } = require('./_llm.js');

// Codex #106 P2-5: ONE definition. This was a literal in the call AND a separately exported
// 800, so editing either alone would silently recreate the probe/production mismatch that the
// shared contract exists to prevent.
//
// Groq counts the REQUESTED max_tokens against the per-minute budget, so this is a RESERVATION,
// not a limit, and the free tier meters 6k/min shared across the whole organization. One tale
// measured 331 completion tokens against the deployed 1,947-char prompt (re-probed 2026-08-07;
// earlier figures of 260 and 302 came from probes that were not sending the production request).
// 800 keeps 2.4x headroom while leaving most of the minute for whispers and congregations.
const DM_MAX_TOKENS = 800;

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

// Exported so tools/probe-llm.mjs measures the REAL prompt (Codex #105 P2-6). The probe previously
// used a shortened substitute and a `number`-typed seed where production sends `integer`, so its
// token measurements were not measurements of the deployed request at all.
function buildSystemPrompt(town) {
    return [
        'You are the town chronicler of PROPAGATE: a Dungeons and Dragons 5th Edition Dungeon Master and a gifted fantasy prose writer.',
        (town && town.culture === 'orc')
            ? 'CULTURE VOICE: these are ORCS of a war-hoard - their backstories are blunt, martial, loyal to the band; holds and hoards, war-posts and dens, never towns and villages. Not villains - a people with their own honour.'
            : 'CULTURE VOICE: these are human settlers of a frontier valley - hopeful, wary, neighbourly.',
        'You receive the founding cast of a frontier farming valley. Each character carries a 5e-style sheet - ability scores, a BACKGROUND, personality traits, an IDEAL, a BOND, a FLAW, a lifelong DREAM (with a named rival where relevant), a keepsake title (the memory that made them), and a procedural DRAFT of their origin tale.',
        'Rewrite each draft as a RICHER backstory: 6 to 9 sentences, roughly 120 to 180 words, of evocative fantasy prose. Named places, weather and seasons, omens, small losses, one vivid sensory detail. Third person, using the character\'s short name at least twice, and ALWAYS they/them pronouns - never he or she.',
        'Stay strictly consistent with the sheet: the background is where they came from, the flaw shows through the telling, the dream is where the tale is pointed. Never contradict or change a name, and never invent mechanical facts (no spells, magic items, ranks or titles).',
        'Let the ability scores color the telling - a STR 15 hermit and an INT 17 hermit left the mountain for different reasons.',
        'Weave the keepsake title into the tale VERBATIM exactly once, wrapped in double quotes, treated as a relic or talisman of the old life - the stranger the title reads, the more matter-of-factly the tale should treat it.',
        'Give each character a distinct voice and homeland so the cast reads as different lives that converged on one valley - not one life told eight ways. End every tale with their arrival in the valley, angled at their dream.',
        'Plain ASCII prose only: no markdown, no em dashes (write " - "), straight quotes, no emojis, no modern or technological references.',
        'Return JSON only: { "tales": [ { "seed": <number from the input>, "tale": "<the rewritten backstory>" } ] } with one entry per character.',
    ].join('\n');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });

    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });

    try {
        const body = await parseBody(req);
        const characters = Array.isArray(body.characters) ? body.characters.slice(0, 16) : [];
        if (!characters.length) return send(res, 400, { fallback: true, error: 'no characters' });

        const system = buildSystemPrompt(body.town);

        const raw = await callLLM({
            system,
            user: JSON.stringify({ town: body.town || {}, characters }),
            // Groq counts the REQUESTED max_tokens against the per-minute budget, so this number is
            // a RESERVATION, not a limit — and the free tier meters 6k/min shared across the whole
            // organization. 6000 reserved the entire minute for one founding.
            //
            // 800, not 1500 (Codex #105 P1-2). One tale measured 331 completion tokens against the
            // DEPLOYED prompt (1,947 chars) and payload — re-probed 2026-08-07 after an earlier
            // 302 figure turned out to come from a shortened stand-in prompt; the provider's own guidance is to set the completion limit
            // 10-20% above the expected length, and 1500 was ~5x. 800 leaves room for a longer draft
            // while freeing most of the minute for whispers, congregations and everything else.
            schema: responseSchema, schemaName: 'ry_farms_dm_tales', maxTokens: DM_MAX_TOKENS,
        });
        const wanted = new Set(characters.map(c => c.seed));
        const tales = (raw?.tales || [])
            .map(t => ({ seed: Number(t.seed), tale: cleanTale(t.tale) }))
            .filter(t => wanted.has(t.seed) && t.tale.length >= 200);
        if (!tales.length) return send(res, 502, { fallback: true, error: 'model returned no usable tales' });
        // Codex #104 P1-1: a PARTIAL response used to be accepted silently. A truncated completion
        // returns the first few tales and drops the rest, so the caller marked those farmers
        // enriched-and-done while the missing ones quietly kept their procedural draft forever —
        // indistinguishable from success. Demand one usable tale per requested seed; anything less
        // is a fallback, which the client already handles in character.
        const missing = [...wanted].filter(seed => !tales.some(t => t.seed === seed));
        if (missing.length) {
            return send(res, 502, {
                fallback: true,
                error: `incomplete: ${tales.length}/${wanted.size} tales (missing seeds ${missing.join(',')})`,
            });
        }
        return send(res, 200, { tales });
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'tale generation failed' });
    }
};

// Shared with tools/probe-llm.mjs so its measurements are of the DEPLOYED request rather than an
// approximation of it (Codex #105 P2-6). A probe that sends a different prompt and a different
// schema is not measuring production, however real its payload looks.
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.responseSchema = responseSchema;
module.exports.DM_MAX_TOKENS = DM_MAX_TOKENS;
