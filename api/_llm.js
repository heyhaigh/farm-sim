// api/_llm.js — the one place the expressive channels (chat / dm / conscience) talk to a model,
// so they work against ANY OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, etc.
//
// It speaks the universal Chat Completions API (`/chat/completions`), not OpenAI's proprietary
// Responses API — so pointing OPENAI_BASE_URL at a local server (e.g. http://localhost:11434/v1
// for Ollama) makes the whole game run with no external services. Env:
//   OPENAI_API_KEY      (blank is fine for most local servers)
//   OPENAI_BASE_URL     (default https://api.openai.com/v1)
//   RY_FARMS_LLM_MODEL | OPENAI_MODEL   (default gpt-4.1-mini)
// Everything here is display-text only; callers always have a procedural fallback.

function extractContent(data) {
    const msg = data?.choices?.[0]?.message;
    if (typeof msg?.content === 'string') return msg.content;
    // some servers return content as an array of parts
    if (Array.isArray(msg?.content)) return msg.content.map(p => p?.text || '').join('');
    return '';
}

function parseJson(text) {
    try { return JSON.parse(text); }
    catch {
        const match = String(text || '').match(/\{[\s\S]*\}/);
        if (!match) throw new Error('model did not return JSON');
        return JSON.parse(match[0]);
    }
}

// Call the model and return the parsed JSON object. `schema` (a JSON Schema) is requested via
// structured outputs; if the server rejects json_schema (older local runtimes) we retry with a
// plain json_object — the prompts all say "return JSON only", so parseJson still recovers it.
async function callLLM({ system, user, schema, schemaName = 'ry_farms', maxTokens = 400, temperature }) {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.RY_FARMS_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.OPENAI_API_KEY) headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;

    const baseBody = {
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: String(user).slice(0, 24000) },
        ],
        max_tokens: maxTokens,
    };
    if (typeof temperature === 'number') baseBody.temperature = temperature;

    const formats = schema
        ? [{ type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }, { type: 'json_object' }, null]
        : [null];

    let lastErr;
    for (const response_format of formats) {
        const body = response_format ? { ...baseBody, response_format } : baseBody;
        const r = await fetch(`${base}/chat/completions`, {
            method: 'POST', headers, body: JSON.stringify(body),
        });
        if (r.ok) return parseJson(extractContent(await r.json()));
        // a 400 usually means this server won't take that response_format — try the next fallback
        lastErr = new Error(`LLM request failed (${r.status})`);
        if (r.status !== 400 && r.status !== 422) break;
    }
    throw lastErr || new Error('LLM request failed');
}

module.exports = { callLLM, parseJson };
