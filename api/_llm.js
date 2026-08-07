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
// #groq-rpm — sized UNDER the upstream ceiling, not over it: Groq's free tier meters llama-3.1-8b-instant
// at 30 requests/minute, and the old value (90) let bursts (a congregation scene = one call per speaker
// turn, a whisper = classify+reply) sail 3x past that straight into 429s. 26 leaves headroom for window
// skew between our clock and theirs; past the cap callers get the in-character fallback, same as a 429 —
// but without burning Groq's goodwill or the log noise.
const BUDGET_MAX = 26;
// global circuit breaker — after BREAKER_TRIP consecutive failures, block ALL calls for BREAKER_COOLDOWN_MS
// (one shared breaker, so N callers failing in parallel can't each keep hammering).
const BREAKER_TRIP = 4;
const BREAKER_COOLDOWN_MS = 20_000;   // cardless free tier: recover fast — a 60s all-off window after one TPM burst read as the feature dying mid-conversation

// #hotreload server.mjs deletes api/* from the require cache ON EVERY REQUEST (a dev convenience that
// shipped to prod), so this module's state was reborn per call — which silently killed the budget, the
// breaker, AND the sticky-format memory: the owner's Groq logs showed 400+200 pairs continuing straight
// through a session that was supposedly fixed. State that must outlive a reload lives on globalThis.
const _S = globalThis.__ryFarmsLlmState || (globalThis.__ryFarmsLlmState = {
    budget: { windowStart: 0, count: 0 },
    breaker: { fails: 0, openUntil: 0 },
    formatSkip: new Set(),   // #stickyformat `${model}|${format}` proven unsupported — skip for the PROCESS lifetime, for real this time
    tokenCap: new Map(),     // #stickycap model -> the largest max_tokens it has actually ACCEPTED (see below)
    modelDead: new Set(),    // #modelchain models the provider has retired — skip for the PROCESS lifetime
});
const _budget = _S.budget;
const _breaker = _S.breaker;
const _formatSkip = _S.formatSkip;
const _tokenCap = _S.tokenCap;
const _modelDead = _S.modelDead;

// #modelchain — a provider retiring a model must not take the whole game's voice with it.
//
// Found 2026-08-06, ten days before the axe: llama-3.1-8b-instant — the single hardcoded model
// every LLM feature ran on — was scheduled for shutdown on 2026-08-16. Whispers, congregation
// speeches, election voices, raid council, duel beats, inventions and DM tales all resolve through
// this one function, so that one date would have silently emptied the entire game of thought. It
// would not have crashed; every caller soft-falls back to procedural text, which is exactly how DM
// enrichment stayed dead for weeks without anyone noticing.
//
// So the model is now a CHAIN, ordered best-first, configurable without a deploy. A model the
// provider has retired is detected from the error body, remembered for the process, and skipped —
// the same shape as #stickyformat and #stickycap. The fallback is announced loudly, because a
// silent fallback is how you end up running on your third-choice model for a month.
// Ordered best-first, from the 2026-08-07 probe (tools/probe-llm.mjs) against real Groq — not from
// guesswork. All three passed classify/reply/congregation; the gpt-oss pair additionally accept
// STRICT json_schema, which both llama models reject (they fall back to json_object, paying a 400
// and leaving the reply shape unenforced — llama-3.3-70b duly failed the classify shape check, and
// classify is the one call whose output feeds the sim). 120b before 20b: at reasoning_effort=low it
// used FEWER tokens than 20b (reply 77 vs 102) and it is the larger model, so better prose.
const DEFAULT_MODEL_CHAIN = 'openai/gpt-oss-120b,openai/gpt-oss-20b,llama-3.3-70b-versatile';

// #reasoning — gpt-oss-* charge their thinking against max_tokens. Sending reasoning_effort to a
// model that does not support it is a hard 400 ("`reasoning_effort` is not supported with this
// model" — measured on both llama models), so it must be sent ONLY to models that take it.
const REASONING_MODEL_RE = /gpt-oss/i;
const REASONING_EFFORT = process.env.RY_FARMS_REASONING_EFFORT || 'low';

function modelChain() {
    const raw = process.env.RY_FARMS_LLM_MODELS
        || process.env.RY_FARMS_LLM_MODEL
        || process.env.OPENAI_MODEL
        || DEFAULT_MODEL_CHAIN;
    const all = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    const live = all.filter(m => !_modelDead.has(m));
    // If EVERY model is dead, do not silently give up — retry the whole chain. A provider blip that
    // looked like a retirement should not permanently mute the game until someone redeploys.
    return live.length ? live : all;
}

// Does this failure mean "that model is gone" rather than "that request was wrong"? Providers
// signal retirement with 404, or with a 400 whose body names the model — and a 400 is ALSO how a
// format rejection arrives, so the body must be read. Confusing the two would retire a healthy
// model on the first strict-schema rejection.
function isModelGone(status, bodyText) {
    if (status === 404) return true;
    if (status !== 400) return false;
    return /model_decommissioned|model_not_found|does not exist|has been (deprecated|decommissioned|removed)|no longer (available|supported)/i.test(String(bodyText || ''));
}

// #stickycap — a 413 means the model refused the REQUESTED COMPLETION SIZE, not the prompt.
//
// Found live 2026-08-06: every endpoint asks for 120-900 tokens and works; the DM tale-writer asked
// for 6000 and got a hard 413 on every single call, so backstory enrichment had been silently dead
// in production — soft-failing to procedural tales, which is why nobody noticed. The retry loop
// below only ever retried 400/422 (format rejections), so a 413 broke out immediately with no
// degradation path at all.
//
// Rather than hardcode a ceiling for a model we cannot see from here (RY_FARMS_LLM_MODEL is set in
// the deploy env, and providers change these limits), halve and retry: the first call to a new model
// DISCOVERS the ceiling and remembers it for the process, exactly as #stickyformat remembers an
// unsupported response_format. Subsequent calls start at the known-good cap and pay nothing.
const CAP_MIN_TOKENS = 256;    // below this a structured reply cannot complete; give up honestly instead
const CAP_MAX_HALVINGS = 4;    // 6000 -> 3000 -> 1500 -> 750 -> 375, then stop

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
    // #modelchain the CHAIN is printed at boot. It was not, and that cost real time: after changing
    // RY_FARMS_LLM_MODEL there was no way to confirm from the logs which model the process had
    // actually picked up — and an env change only reaches the process on restart, so "did it take?"
    // was unanswerable without making a call and inferring from the result.
    const chain = modelChain().join(' -> ');
    if (r.mode === 'local') return `ON - LOCAL ${r.base} - $0 - models: ${chain}`;
    return `ON - PAID ${r.base} (RY_FARMS_ALLOW_PAID_LLM=1) - BILLING - models: ${chain}`;
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

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.mode === 'paid' && process.env.OPENAI_API_KEY) headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;

    const messages = [
        { role: 'system', content: String(system).slice(0, 6000) },
        { role: 'user', content: String(user).slice(0, 8000) },   // hard char cap (~2k tokens)
    ];

    // #modelchain try each live model in turn. A model the provider has RETIRED is remembered and
    // skipped; anything else (a format rejection, a size rejection) is handled per-model below.
    const chain = modelChain();
    let lastErr;

    try {
        for (const model of chain) {
            // #stickyformat Groq's llama-3.1-8b rejects strict json_schema with a 400 — and this loop was
            // paying that 400 on EVERY call before succeeding with json_object: each whisper burned DOUBLE
            // the requests against a free tier metered per minute. Once a format draws invalid_request from
            // a model, remember and never send it to that model again — paid once per process, not per call.
            const formats = (schema
                ? [{ type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }, { type: 'json_object' }, null]
                : [null]
            ).filter(f => !_formatSkip.has(`${model}|${f ? f.type : 'none'}`));

            // #stickycap start at whatever this model has already proven it will accept. Per-model,
            // because a ceiling learned from one model says nothing about the next one in the chain.
            const known = _tokenCap.get(model);
            let askTokens = (typeof known === 'number') ? Math.min(maxTokens, known) : maxTokens;
            let halvings = 0;
            let modelGone = false;
            let giveUp = false;   // a non-retryable status: stop trying formats too, not just sizes

            for (const response_format of formats) {
                // Inner loop retries the SAME format with a smaller ask on 413. It must be nested rather
                // than folded into the format loop: a size rejection says nothing about the format, and
                // halving inside the format loop would wrongly blame (and skip) a format that was fine.
                for (;;) {
                    const body = { model, messages, max_tokens: askTokens };
                    if (typeof temperature === 'number') body.temperature = temperature;
                    if (response_format) body.response_format = response_format;
                    // #reasoning gpt-oss-* are REASONING models: thinking tokens are charged against
                    // max_tokens, and the default effort ('medium') ate the entire budget — 320-token
                    // replies and 900-token congregation scenes came back with EMPTY content, which
                    // broke production on 2026-08-06. Measured 2026-08-07: 'low' roughly halves spend
                    // (reply 252 -> 102 tokens on 20b, 191 -> 77 on 120b) and every case passed.
                    if (REASONING_MODEL_RE.test(model)) body.reasoning_effort = REASONING_EFFORT;

                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
                    let retrySmaller = false;
                    try {
                        const r = await fetch(`${cfg.base}/chat/completions`, {
                            method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
                        });
                        if (r.ok) {
                            const out = parseJson(extractContent(await r.json()));
                            _breaker.fails = 0;
                            // #stickycap remember the ceiling ONLY when we had to find it. Recording every
                            // success would let a 200-token whisper pin the cap at 200 and then throttle a
                            // later 900-token congregation call that would have been fine.
                            if (halvings > 0) _tokenCap.set(model, askTokens);
                            return out;
                        }
                        const errText = await r.text().catch(() => '');
                        lastErr = new Error(`LLM request failed (${r.status})`);
                        // #groq-rpm — a 429 means the upstream minute is BURNED: open the shared breaker at
                        // once instead of letting two more callers pay failed requests to trip it slowly.
                        if (r.status === 429) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
                        // #modelchain retirement — read the BODY, because a 400 is also how a format
                        // rejection arrives and confusing the two would retire a perfectly healthy model.
                        if (isModelGone(r.status, errText)) {
                            if (!_modelDead.has(model)) {
                                _modelDead.add(model);
                                const next = chain.filter(m => m !== model)[0];
                                console.warn(`[llm] model "${model}" is gone (${r.status}) - falling back to "${next || 'nothing'}". Update RY_FARMS_LLM_MODELS.`);
                            }
                            lastErr = new Error(`LLM model unavailable (${model})`);
                            modelGone = true;
                        } else if (r.status === 413 && halvings < CAP_MAX_HALVINGS && askTokens > CAP_MIN_TOKENS) {
                            // #stickycap the completion size was refused. Halve and retry the same format.
                            askTokens = Math.max(CAP_MIN_TOKENS, Math.floor(askTokens / 2));
                            halvings++;
                            retrySmaller = true;
                        } else if (r.status !== 400 && r.status !== 422) {
                            giveUp = true;   // only a format-rejection is worth trying another format for
                        } else if (response_format) {
                            _formatSkip.add(`${model}|${response_format.type}`);   // #stickyformat
                        }
                    } finally { clearTimeout(timer); }
                    if (!retrySmaller) break;   // fall through to the next format (or out, if giveUp)
                }
                if (giveUp || modelGone) break;
            }
            // Only a RETIRED model is worth re-trying on the next model in the chain. Every other
            // failure (rate limit, upstream 500, bad JSON) would just be paid again for no reason.
            if (!modelGone) break;
        }
        throw lastErr || new Error('LLM request failed');
    } catch (err) {
        // a real failure (network/timeout/5xx/bad-json) trips the shared breaker after a few in a row
        if (++_breaker.fails >= BREAKER_TRIP) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
        throw err;
    }
}

module.exports = { callLLM, parseJson, resolveLLM, llmStatus, LLMDisabledError };
