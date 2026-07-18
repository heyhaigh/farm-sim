// api/ry-farms-invent.js — #97 P5: the LLM names + tells the lore of a farmer's GENERATIVE invention.
//
// The mechanics are already decided by the deterministic derivation (effect/tier/quality). This endpoint is
// handed those + the ingredients and invents ONLY the flavour: an evocative name and a one-line lore of why
// these things combine — CONSISTENT with the effect it was handed, never claiming a power it doesn't have.
// Display-only, off the sim loop: the client stores the result in a shadow store excluded from the digest,
// and the procedural name stands if the LLM is unavailable — so determinism is untouched either way.

const { callLLM } = require('./_llm.js');

const NAME_MAX = 30, LORE_MAX = 120;
// what each mechanical effect actually DOES — the LLM must stay within this, so the lore can't imply a
// healing potion for a charm or "resurrects the dead".
const EFFECT_MEANING = {
    mendhp: 'mends wounds and knits the body back together',
    cure: 'cures a real illness — a potent, rare remedy',
    refresh: 'restores energy and lifts tiredness',
    growboost: 'coaxes crops to grow faster for a while',
    workboost: 'sharpens the hands and quickens a day\'s labour',
    charm: 'a small lucky charm or ward — a little fortune, nothing grand',
    deeprest: 'brings a deep, restoring sleep',
    none: 'a curious trinket of no real use',
};

function clean(text, max) {
    let s = String(text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim().toUpperCase();
    s = s.replace(/[^A-Z0-9 .,!?'"():+\-\/&]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 2)).trimEnd()}..`;
}
// reject lore that claims a power the item doesn't have (banned mechanical claims)
const BANNED = /\bRESURRECT|REVIVE|IMMORTAL|NEVER DIE|GUARANTEE|INFINITE|ALL DISEASE|ANY WOUND|RICHES|GOLD\b/;

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
    res.statusCode = status; res.end(JSON.stringify(payload));
}
function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    return new Promise((resolve, reject) => { let raw = '';
        req.on('data', c => { raw += c; }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); req.on('error', reject); });
}

const schema = {
    type: 'object', additionalProperties: false, required: ['name', 'lore'],
    properties: { name: { type: 'string', maxLength: NAME_MAX }, lore: { type: 'string', maxLength: LORE_MAX } },
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });
    try {
        const b = await parseBody(req);
        const meaning = EFFECT_MEANING[b.effect] || 'has some minor use';
        const ingredients = Array.isArray(b.ingredients) ? b.ingredients.join(', ') : String(b.ingredients || 'a few things');
        const system = [
            'You name and tell the lore of an item a farmer just INVENTED in Propagate, a pixel farming sim.',
            'You are handed the item\'s fixed mechanical EFFECT. Invent ONLY the flavour — an evocative NAME and a one-line LORE of why these ingredients combine into it.',
            'The lore MUST be consistent with the given effect and must NOT claim any greater power (no cure-alls, riches, resurrection, guarantees).',
            'Rustic, folk, hand-made in tone — a hedge-remedy or a lucky trinket, not high fantasy. No emojis, markdown, or modern references.',
            `NAME <= ${NAME_MAX} chars. LORE <= ${LORE_MAX} chars. Return JSON only.`,
        ].join('\n');
        const user = JSON.stringify({
            ingredients, effect: b.effect, whatItDoes: meaning, tier: b.tier, quality: b.quality,
            dominantEssence: b.dominant, proceduralName: b.name || null,
        });
        const raw = await callLLM({ system, user, schema, schemaName: 'ry_farms_invent', maxTokens: 160 });
        const name = clean(raw?.name, NAME_MAX), lore = clean(raw?.lore, LORE_MAX);
        if (!name || !lore || BANNED.test(lore) || BANNED.test(name)) return send(res, 200, { fallback: true, error: 'invalid or over-claiming output' });
        return send(res, 200, { name, lore });
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'invent naming failed' });
    }
};
