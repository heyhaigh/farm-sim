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

// #tokenbudget — requests are the wrong unit, and counting them protected nothing.
//
// Groq meters TOKENS PER MINUTE (6k on the outgoing model, 8k for each gpt-oss candidate) and counts
// the REQUESTED max_tokens, not the tokens actually produced. So 26 permitted requests could reserve
// well over 20,000 tokens against an 8k ceiling — the request cap was never the binding constraint
// (Codex #106 P1-2). Worse, the limit applies at ORGANISATION level: every browser runs its own
// enrichment cadence against one server-side key, so the protection has to live here, on the server,
// where all of them meet. A client timer cannot enforce a shared boundary.
//
// 5000 sits under BOTH published ceilings, leaving room for clock skew between our window and
// theirs, and for whatever else the org key is doing.
const TOKEN_BUDGET_MAX = Number(process.env.RY_FARMS_TOKEN_BUDGET || 5000);

// Interactive work outranks background work when the minute gets tight. A whisper is a player
// waiting on a reply; DM enrichment is a biography nobody has asked for yet, and it runs on a timer
// in every open tab. Without this the two compete as equals, and the background job — being far more
// frequent — wins by volume and starves the thing a human is actually watching.
const BACKGROUND_CEILING = 0.6;   // background calls are refused past 60% of the minute's tokens

// Rough but honest: ~4 characters per token is the standard estimate, and it only has to be good
// enough to stop a burst. Under-counting the prompt is safer than over-counting the reservation,
// because the reservation is the part Groq actually bills against the window.
const estimateTokens = (system, user, maxTokens) =>
    maxTokens + Math.ceil((String(system).length + String(user).length) / 4);
// global circuit breaker — after BREAKER_TRIP consecutive failures, block ALL calls for BREAKER_COOLDOWN_MS
// (one shared breaker, so N callers failing in parallel can't each keep hammering).
const BREAKER_TRIP = 4;
const BREAKER_COOLDOWN_MS = 20_000;   // cardless free tier: recover fast — a 60s all-off window after one TPM burst read as the feature dying mid-conversation

// #hotreload server.mjs deletes api/* from the require cache ON EVERY REQUEST (a dev convenience that
// shipped to prod), so this module's state was reborn per call — which silently killed the budget, the
// breaker, AND the sticky-format memory: the owner's Groq logs showed 400+200 pairs continuing straight
// through a session that was supposedly fixed. State that must outlive a reload lives on globalThis.
const _S = globalThis.__ryFarmsLlmState || (globalThis.__ryFarmsLlmState = {
    budget: { windowStart: 0, count: 0, tokens: 0 },
    breaker: { fails: 0, openUntil: 0 },
    formatSkip: new Set(),   // #stickyformat `${model}|${format}` proven unsupported — skip for the PROCESS lifetime, for real this time
    modelDead: new Set(),    // #modelchain models the provider has retired — skip for the PROCESS lifetime
});
const _budget = _S.budget;
const _breaker = _S.breaker;
const _formatSkip = _S.formatSkip;
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
// Ordered best-first from the 2026-08-07 probe (tools/probe-llm.mjs) against real Groq. Both accept
// STRICT json_schema — which both llama models reject, falling back to json_object and leaving the
// reply SHAPE unenforced (llama-3.3-70b duly failed the classify shape check, and classify is the
// one call whose output feeds the sim). 120b first: at reasoning_effort=low it used fewer tokens
// than 20b (reply 77 vs 102) and is the larger model, so better prose.
//
// llama-3.3-70b-versatile was REMOVED from this chain (Codex #104 P1-2). It shuts down on
// **2026-08-16 — the same day as llama-3.1-8b-instant** — so as a fallback it offered no resilience
// whatsoever against the exact event this chain exists to survive. I had claimed the opposite after
// asking the deprecation page a yes/no question; it lists that model BOTH as a replacement for older
// models AND as itself deprecated, and I read the first mention. A model's lifecycle is a POLICY
// fact: the probe can prove a model answers today, never that it will exist next week. Check the
// provider's deprecation schedule before adding anything here.
//
// Groq's other named replacement, qwen/qwen3.6-27b, is the obvious third link — but it is NOT here
// yet because it has not been probed, and adding an unmeasured model to a resilience chain is how
// you discover in production that your fallback never worked.
const DEFAULT_MODEL_CHAIN = 'openai/gpt-oss-120b,openai/gpt-oss-20b';

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

// Does this failure mean "that model is gone" rather than "that request was wrong"?
//
// NARROW ON PURPOSE (Codex #104 P1-3). The first version matched loose prose — "no longer
// supported", "does not exist" — and Codex reproduced a HEALTHY model being retired by
// `400 response_format json_schema is no longer supported`. That is a parameter error, not a
// lifecycle event, and because `_modelDead` is process-lifetime the false verdict would persist
// until a redeploy: one bad request permanently demotes a working model.
//
// So: trust the STRUCTURED error code, which providers actually define, over prose they do not
// guarantee. Prose is accepted only when it *also* names the requested model — "the model
// `foo` has been decommissioned" is unambiguous in a way "no longer supported" never is.
// Only codes that are unambiguously about a MODEL. `does_not_exist` was here and is now gone: Codex
// #105 P1-4 reproduced a 400 schema error carrying that code retiring a healthy model, because it
// can equally describe a missing schema, tool or parameter.
const MODEL_GONE_CODES = /"code"\s*:\s*"(model_decommissioned|model_not_found|model_terminated)"/i;

function isModelGone(status, bodyText, model) {
    const body = String(bodyText || '');
    // EVERY status needs model evidence, including 404. The previous version accepted any 404 as
    // retirement, and Codex reproduced `404 route not found` killing a healthy model — providers
    // define 404 as "requested resource missing", which covers a mistyped path just as well as a
    // retired model. A structured model code, or the model's own name in the message, or nothing.
    if (status !== 400 && status !== 404 && status !== 410) return false;
    if (MODEL_GONE_CODES.test(body)) return true;
    // Prose fallback: only when the message names THIS model AND uses retirement wording. Both
    // halves are required — either alone is what produced the false positive.
    if (!model || !body.includes(model)) return false;
    // Codex #106 P2-4: `does not exist` / `not found` are SAFE here, and were only dangerous before
    // the model-name gate existed. Without them a provider that returns
    // `404 The model \`x\` does not exist` and no structured code would never advance the chain —
    // the failover would be decoration on the one day it matters. The gate above is what makes the
    // difference: this prose is only trusted when the body names THIS model.
    return /\b(decommissioned|deprecated and removed|has been removed|is retired|no longer available|does not exist|not found)\b/i.test(body);
}

// #stickycap — a 413 halves the ask and retries, WITHIN THIS CALL ONLY.
//
// The first version also REMEMBERED the accepted ceiling per model, to avoid paying the 413 twice.
// Codex #105 P1-1 reproduced the harm: a DM request that discovered 750 then throttled an unrelated
// 900-token congregation call to 750 — permanently, for the process, even after upstream capacity
// recovered. A cap keyed by model is applied to callers with completely different prompts and output
// needs, and quietly under-budgeting a reasoning model is exactly what produced empty replies.
//
// The deeper problem is that the signal was never trustworthy. Groq documents 413 as a REQUEST-SIZE
// error and 429 as rate-limit exhaustion, so a 413 seen during a busy minute may say nothing durable
// about the model at all. Learning a permanent fact from a possibly-transient error is how you get a
// silent, self-inflicted ceiling. Retry smaller now; remember nothing.
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
async function callLLM({ system, user, schema, schemaName = 'ry_farms', maxTokens = 400, temperature, priority = 'interactive' }) {
    if (typeof fetch !== 'function') throw new LLMDisabledError('fetch unavailable');
    const cfg = resolveLLM();
    if (cfg.mode === 'off') throw new LLMDisabledError(`LLM off: ${cfg.reason}`);

    const now = Date.now();
    // circuit breaker
    if (now < _breaker.openUntil) throw new LLMDisabledError('LLM circuit breaker open (recent failures)');
    // wall-clock budget — BOTH units. Requests guard the per-minute request cap; tokens guard the
    // per-minute token cap, which is the one that actually binds (see #tokenbudget above).
    if (now - _budget.windowStart >= BUDGET_WINDOW_MS) { _budget.windowStart = now; _budget.count = 0; _budget.tokens = 0; }
    if (_budget.count >= BUDGET_MAX) throw new LLMDisabledError(`LLM budget exceeded (${BUDGET_MAX}/${BUDGET_WINDOW_MS / 1000}s)`);

    const cost = estimateTokens(system, user, maxTokens);
    const ceiling = priority === 'background' ? TOKEN_BUDGET_MAX * BACKGROUND_CEILING : TOKEN_BUDGET_MAX;
    if (_budget.tokens + cost > ceiling) {
        throw new LLMDisabledError(
            `LLM token budget exceeded (${_budget.tokens}+${cost} > ${Math.round(ceiling)} of ${TOKEN_BUDGET_MAX}/min${priority === 'background' ? ', background' : ''})`);
    }
    // Charged BEFORE the call, because Groq reserves against the window at request time too — and
    // because a failed request still consumed the provider's allowance.
    _budget.tokens += cost;
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

            // #stickycap the halving is per-CALL only — nothing is remembered across calls. See the
            // note at CAP_MIN_TOKENS for why persisting it was wrong.
            let askTokens = maxTokens;
            let halvings = 0;
            let modelGone = false;
            let tryNextModel = false;   // model-scoped 429/403: this model is unusable, others may not be
            let giveUp = false;         // a non-retryable status: stop trying formats too, not just sizes

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
                            return out;
                        }
                        const errText = await r.text().catch(() => '');
                        lastErr = new Error(`LLM request failed (${r.status})`);
                        const lastModel = model === chain[chain.length - 1];
                        // #modelchain (Codex #104 P1-4) a 429 or a 403 can be MODEL-SCOPED: Groq publishes
                        // per-model rate limits and per-model permissions, so an exhausted or blocked first
                        // model can sit beside a perfectly usable second one. Opening the shared breaker
                        // here muted the entire chain before the alternatives were ever tried.
                        //
                        // So: try the next candidate first, and only fall back to the global breaker once
                        // there is nothing left to try. A provider-wide outage still trips it — it just
                        // trips at the END of the chain instead of the start.
                        if (r.status === 429 || r.status === 403) {
                            if (!lastModel) { tryNextModel = true; }
                            else {
                                // TERMINAL (Codex #105 P2-5): nothing left to try. Opening the breaker
                                // is not enough — without giveUp the format loop kept going and a
                                // single logical call fired THREE identical 429s (json_schema,
                                // json_object, none) before returning. A rate limit is not a format
                                // problem; stop immediately.
                                giveUp = true;
                                if (r.status === 429) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
                            }
                        }
                        // #modelchain retirement — read the BODY and require a structured code (or the
                        // model's own name), because a 400 is also how a format rejection arrives.
                        else if (isModelGone(r.status, errText, model)) {
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
                if (giveUp || modelGone || tryNextModel) break;
            }
            // Advance the chain for MODEL-SCOPED failures only — retirement, permission, or a rate
            // limit that may apply to this model alone. A provider-wide failure (upstream 5xx, bad
            // JSON, timeout) would just be paid again on the next model for nothing.
            if (!modelGone && !tryNextModel) break;
        }
        throw lastErr || new Error('LLM request failed');
    } catch (err) {
        // a real failure (network/timeout/5xx/bad-json) trips the shared breaker after a few in a row
        if (++_breaker.fails >= BREAKER_TRIP) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
        throw err;
    }
}

module.exports = { callLLM, parseJson, resolveLLM, llmStatus, LLMDisabledError, modelChain, isModelGone };
