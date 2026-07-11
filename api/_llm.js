// api/_llm.js — THE single chokepoint where the expressive channels (chat / dm / conscience / invent) talk to
// a model. It speaks the universal Chat Completions API, so it works against OpenAI, Ollama, LM Studio, etc.
//
// COST-SAFETY POSTURE (fail-closed, after the $27 incident + council review):
//   * DEFAULT IS OFF. An unset OPENAI_BASE_URL no longer silently bills OpenAI — it disables the LLM.
//   * LOCAL is free + allowed: a localhost/127.0.0.1 base URL runs with no opt-in.
//   * PAID is opt-IN ONLY: a non-local base URL requires RY_FARMS_ALLOW_PAID_LLM=1, or it stays OFF.
//   * RY_FARMS_LLM_OFF=1 hard-disables everything regardless of the above (belt-and-suspenders kill switch).
//   * Every request has an 8s timeout, a per-process wall-clock budget, and a global circuit breaker, so no
//     burst of tabs / reloads / fast-forward / hung endpoint can run away.
// Callers ALWAYS have a procedural fallback and the sim is byte-identical with the LLM off, so failing closed
// only ever costs flavor text, never correctness.
//
// Env: OPENAI_BASE_URL · OPENAI_API_KEY (only sent for paid) · RY_FARMS_LLM_MODEL|OPENAI_MODEL (default
// gpt-4.1-mini) · RY_FARMS_LLM_OFF · RY_FARMS_ALLOW_PAID_LLM.

const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;
const REQUEST_TIMEOUT_MS = 8000;
// server-side wall-clock budget — the ONLY cost control that survives tabs/reloads/fast-forward (sim-time
// cooldowns don't): at most BUDGET_MAX model requests per rolling BUDGET_WINDOW_MS across the whole process.
const BUDGET_WINDOW_MS = 60_000;
const BUDGET_MAX = 90;
// global circuit breaker — after BREAKER_TRIP consecutive failures, block ALL calls for BREAKER_COOLDOWN_MS
// (one shared breaker, so N callers failing in parallel can't each keep hammering).
const BREAKER_TRIP = 4;
const BREAKER_COOLDOWN_MS = 60_000;

const _budget = { windowStart: 0, count: 0 };
const _breaker = { fails: 0, openUntil: 0 };

// Resolve the mode from config. FAIL-CLOSED: anything not explicitly local-or-opted-into-paid is 'off'.
function resolveLLM() {
    if (process.env.RY_FARMS_LLM_OFF) return { mode: 'off', reason: 'RY_FARMS_LLM_OFF' };
    const base = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
    if (!base) return { mode: 'off', reason: 'no OPENAI_BASE_URL (fail-closed — set a local URL, or opt into paid)' };
    if (LOCAL_HOST_RE.test(base)) return { mode: 'local', base };
    if (process.env.RY_FARMS_ALLOW_PAID_LLM === '1') return { mode: 'paid', base };
    return { mode: 'off', reason: `paid endpoint ${base} blocked — set RY_FARMS_ALLOW_PAID_LLM=1 to allow billing` };
}

// For the server startup log — human-readable, never asserts $0 for a remote URL it can't verify.
function llmStatus() {
    const r = resolveLLM();
    if (r.mode === 'off') return `OFF (${r.reason})`;
    if (r.mode === 'local') return `ON - LOCAL ${r.base} - $0`;
    return `ON - PAID ${r.base} (RY_FARMS_ALLOW_PAID_LLM=1) - BILLING`;
}

function extractContent(data) {
    const msg = data?.choices?.[0]?.message;
    if (typeof msg?.content === 'string') return msg.content;
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

class LLMDisabledError extends Error {}   // typed so callers can suppress permanently, not treat as transient

// Call the model and return the parsed JSON object. Throws LLMDisabledError when off/blocked/over-budget/tripped
// (callers fall back to procedural). `schema` requests structured output; we degrade json_schema -> json_object.
async function callLLM({ system, user, schema, schemaName = 'ry_farms', maxTokens = 400, temperature }) {
    if (typeof fetch !== 'function') throw new LLMDisabledError('fetch unavailable');
    const cfg = resolveLLM();
    if (cfg.mode === 'off') throw new LLMDisabledError(`LLM off: ${cfg.reason}`);

    const now = Date.now();
    // circuit breaker
    if (now < _breaker.openUntil) throw new LLMDisabledError('LLM circuit breaker open (recent failures)');
    // wall-clock budget
    if (now - _budget.windowStart >= BUDGET_WINDOW_MS) { _budget.windowStart = now; _budget.count = 0; }
    if (_budget.count >= BUDGET_MAX) throw new LLMDisabledError(`LLM budget exceeded (${BUDGET_MAX}/${BUDGET_WINDOW_MS / 1000}s)`);
    _budget.count++;

    const model = process.env.RY_FARMS_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.mode === 'paid' && process.env.OPENAI_API_KEY) headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;

    const baseBody = {
        model,
        messages: [
            { role: 'system', content: String(system).slice(0, 6000) },
            { role: 'user', content: String(user).slice(0, 8000) },   // hard char cap (~2k tokens)
        ],
        max_tokens: maxTokens,
    };
    if (typeof temperature === 'number') baseBody.temperature = temperature;

    const formats = schema
        ? [{ type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }, { type: 'json_object' }, null]
        : [null];

    let lastErr;
    try {
        for (const response_format of formats) {
            const body = response_format ? { ...baseBody, response_format } : baseBody;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const r = await fetch(`${cfg.base}/chat/completions`, {
                    method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
                });
                if (r.ok) { const out = parseJson(extractContent(await r.json())); _breaker.fails = 0; return out; }
                lastErr = new Error(`LLM request failed (${r.status})`);
                if (r.status !== 400 && r.status !== 422) break;   // only a format-rejection is worth retrying
            } finally { clearTimeout(timer); }
        }
        throw lastErr || new Error('LLM request failed');
    } catch (err) {
        // a real failure (network/timeout/5xx/bad-json) trips the shared breaker after a few in a row
        if (++_breaker.fails >= BREAKER_TRIP) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
        throw err;
    }
}

module.exports = { callLLM, parseJson, resolveLLM, llmStatus, LLMDisabledError };
