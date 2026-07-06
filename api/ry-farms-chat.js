const LINE_MAX = 34;
const MEMORY_MAX = 110;

function cleanText(text, max) {
    let s = String(text || '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    s = s.replace(/[^A-Z0-9 .,!?'"():+\-\/<>*&=#_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 2)).trimEnd()}..`;
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function send(res, status, payload) {
    const origin = process.env.RY_FARMS_CHAT_ORIGIN;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
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

function normalizeConversation(raw) {
    const first = Array.isArray(raw?.lines) ? raw.lines[0] : null;
    const second = Array.isArray(raw?.lines) ? raw.lines[1] : null;
    const speakerLine = cleanText(raw?.speakerLine || raw?.speaker_line || first?.text, LINE_MAX);
    const listenerLine = cleanText(raw?.listenerLine || raw?.listener_line || second?.text, LINE_MAX);
    if (!speakerLine || !listenerLine) throw new Error('model returned empty lines');
    return {
        speakerLine,
        listenerLine,
        speakerTone: cleanText(raw?.speakerTone || first?.tone || 'reflective', 18).toLowerCase(),
        listenerTone: cleanText(raw?.listenerTone || second?.tone || 'reflective', 18).toLowerCase(),
        memory: cleanText(raw?.memory || raw?.summary || `${speakerLine} / ${listenerLine}`, MEMORY_MAX),
        relationshipDelta: clamp(Number(raw?.relationshipDelta ?? raw?.relationship_delta ?? 0) || 0, -0.05, 0.05),
        relationshipReason: cleanText(raw?.relationshipReason || raw?.relationship_reason || 'opened up in conversation', 70),
    };
}

const responseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['speakerLine', 'listenerLine', 'speakerTone', 'listenerTone', 'memory', 'relationshipDelta', 'relationshipReason'],
    properties: {
        speakerLine: { type: 'string', maxLength: LINE_MAX },
        listenerLine: { type: 'string', maxLength: LINE_MAX },
        speakerTone: { type: 'string' },
        listenerTone: { type: 'string' },
        memory: { type: 'string', maxLength: MEMORY_MAX },
        relationshipDelta: { type: 'number', minimum: -0.05, maximum: 0.05 },
        relationshipReason: { type: 'string', maxLength: 70 },
    },
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        const origin = process.env.RY_FARMS_CHAT_ORIGIN;
        if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return send(res, 204, {});
    }
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });

    try {
        const body = await parseBody(req);
        const context = body.context || body;
        const model = process.env.RY_FARMS_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
        const system = [
            'You are the conversation engine for Ry Farms, a pixel farming simulation.',
            'Write one brief, lived-in exchange between the speaker and listener.',
            'Use the provided memories, goals, weather, relationships, and town state.',
            'Avoid generic greetings unless the context truly calls for one.',
            'No emojis, markdown, modern tech references, or narration.',
            `Each visible line must be ${LINE_MAX} characters or less.`,
            'Return JSON only.',
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
                    { role: 'user', content: JSON.stringify(context).slice(0, 18000) },
                ],
                text: {
                    format: {
                        type: 'json_schema',
                        name: 'ry_farms_chat',
                        strict: true,
                        schema: responseSchema,
                    },
                },
                max_output_tokens: 320,
            }),
        });

        if (!openaiRes.ok) {
            return send(res, 502, { fallback: true, error: `OpenAI request failed (${openaiRes.status})` });
        }

        const data = await openaiRes.json();
        const text = extractOutputText(data);
        const conversation = normalizeConversation(parseJson(text));
        return send(res, 200, conversation);
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'chat generation failed' });
    }
};
