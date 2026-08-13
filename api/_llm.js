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
// NOT configurable. It briefly was, and the honest reason was making one test fast — I justified it
// afterwards as "a slow deployment could raise it", which is the shape of a rationalisation rather
// than a requirement. Codex #118 then showed the validation was not safe for a TIMER: `1` aborted a
// whole two-model chain in 2ms, and `2147483648` passed a positive-and-finite check while Node
// overflowed it to 1ms. Positive and finite is not the same as sane.
//
// A production knob should not exist to save eight seconds in a test. The test pays the eight
// seconds instead.
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
// Validated, not merely parsed (Codex #107 P2-4). `Number('5_000')` is NaN, and every comparison
// against NaN is false — so a typo in an env var silently turned the whole guard off and let all 26
// requests through, reserving 23,400 tokens. A cost control that can be disabled by a typo is not a
// cost control. Anything not finite and positive falls back to the safe default, loudly.
const TOKEN_BUDGET_DEFAULT = 5000;
const TOKEN_BUDGET_MAX = (() => {
    const raw = process.env.RY_FARMS_TOKEN_BUDGET;
    if (raw == null || raw === '') return TOKEN_BUDGET_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        console.warn(`[llm] RY_FARMS_TOKEN_BUDGET="${raw}" is not a positive number - using ${TOKEN_BUDGET_DEFAULT}`);
        return TOKEN_BUDGET_DEFAULT;
    }
    return n;
})();

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
    budget: { spend: [] },   // rolling [{at, cost}] — BOTH the request count and the token sum derive from this
    breaker: { fails: 0, openUntil: 0 },
    // #stickyformat key -> { until, strikes }. NOT a permanent Set any more (Codex #112 P1): a
    // TRANSIENT validation 400 was being remembered for the life of the process, so a single bad
    // moment downgraded a schema to json_object until redeploy. Model-wide entries keep until:Infinity.
    formatSkip: new Map(),
    // #modelchain model -> { until, strikes }. NOT permanent (Codex #115): every signal that sets
    // this is unverified — synthetic codes and prose patterns, no captured retirement response — and
    // a permanent verdict on unverified evidence demotes a working primary model until redeploy.
    modelDead: new Map(),
});
const _budget = _S.budget;
const _breaker = _S.breaker;
const _formatSkip = _S.formatSkip;

// A refusal that is about the SCHEMA is provisional: providers return transient validation failures,
// and Groq's own guidance is to retry them. So a schema-scoped skip EXPIRES, backing off if the
// refusal repeats, and a genuinely unacceptable schema settles at one probe every half hour instead
// of being retried on every call. A refusal about the FORMAT ITSELF is a property of the model and
// never expires — that is the llama case #stickyformat was built for.
//
// I claimed in review #111 that scoping the key per-schema made chat "self-repair on the next call".
// It did not, and nothing in the scoping fix ever provided that: the Set was permanent, and the test
// I wrote asserted the permanent downgrade rather than catching it.
const SKIP_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
function skipActive(key) {
    const e = _formatSkip.get(key);
    if (!e) return false;
    if (Date.now() < e.until) return true;
    return false;   // expired — keep the strike count so the next refusal backs off further
}
function noteSkip(key, permanent) {
    const prev = _formatSkip.get(key);
    const strikes = (prev?.strikes || 0) + 1;
    const until = permanent
        ? Infinity
        : Date.now() + SKIP_BACKOFF_MS[Math.min(strikes - 1, SKIP_BACKOFF_MS.length - 1)];
    _formatSkip.set(key, { until, strikes });
}
// #formatwitness Which response_format actually PRODUCED the answer, per schema name.
//
// Codex #111 P1: the probe could not tell a strict-schema success from a json_object fallback that
// happened to look right, because Groq's response documents no "applied format" field. So a 400 on
// json_schema followed by a usable fallback printed OK and certified a contract that was never
// enforced. Nothing in the response tells you; only the caller knows, so the caller records it.
// Read by tools/probe-endpoints.mjs; never read by production code.
const _lastFormat = _S.lastFormat || (_S.lastFormat = new Map());
// #formatwitness ...and WHY, when a format was refused. The scope classifier already reads the 400
// body and then dropped it, so "produced under json_object" arrived with no cause attached and the
// only way to learn more was another paid run. Keyed by schema, holding the provider's own words.
const _lastRefusal = _S.lastRefusal || (_S.lastRefusal = new Map());
const _modelDead = _S.modelDead;
// Same ladder as the format skip, and for the same reason: a wrong verdict must heal itself. A model
// that really is decommissioned settles at one probe per half hour; one wrongly demoted comes back.
const deadActive = (model) => { const e = _modelDead.get(model); return !!e && Date.now() < e.until; };
function noteDead(model) {
    const strikes = (_modelDead.get(model)?.strikes || 0) + 1;
    _modelDead.set(model, {
        until: Date.now() + SKIP_BACKOFF_MS[Math.min(strikes - 1, SKIP_BACKOFF_MS.length - 1)],
        strikes,
    });
}

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
    const live = all.filter(m => !deadActive(m));
    // If EVERY model is dead, do not silently give up — retry the whole chain. A provider blip that
    // looked like a retirement should not permanently mute the game until someone redeploys.
    return live.length ? live : all;
}

// Does a 400 mean "this model cannot do structured output AT ALL", or only "that particular schema
// was unacceptable"? The distinction decides the blast radius of #stickyformat.
//
// It went unasked until 2026-08-10, when the skip key named only the model and the format. One
// endpoint's schema being refused therefore downgraded EVERY LATER CALL for that model to
// json_object — which enforces nothing — and since every handler normalises missing fields to
// defaults, the endpoints kept returning 200 with hollow content. Two probe runs on identical
// captured input produced real output and then handler fallbacks, from the same model, because a
// schema earlier in the run had been refused. In production `_S` lives on globalThis in a
// long-lived server, so that state is permanent until redeploy.
//
// NARROW, and biased the safe way. A wrong "format unsupported" verdict silently mutes ten
// endpoints for the life of the process; a wrong "schema refused" verdict costs one extra 400 per
// schema, once. So only unambiguous prose about the PARAMETER counts, and everything else — every
// schema validation complaint, every message we have never seen — is treated as schema-specific.
// ONLY THE SENTENCE PRODUCTION ACTUALLY SENT.
//
// Captured from Railway on 2026-08-11, twenty seconds after the deploy that added refusal logging:
//
//     "This model does not support response format `json_schema`."
//
// Two earlier versions of this pattern were wrong in opposite directions, and both were written by
// reasoning about what a provider might say:
//
//   #112  too loose  — any "response_format ... not supported" became a process-wide verdict.
//   #114  too strict — required an UNDERSCORE where Groq writes a SPACE, so the real refusal was
//                      classified schema-scoped and every schema rediscovered it separately.
//
// The third attempt was too loose again in a subtler way: `model ... does not support ... response
// format` inside a 60-character window does not check that "model" is the SUBJECT. Codex #114
// reproduced two sentences it promoted to a permanent process-wide skip —
// "This model request does not support response format json_schema" and "The model-generated schema
// does not support nested objects in this response format" — neither of which says the model cannot
// do structured output.
//
// The underscore branch is deleted rather than kept "just in case". Its justification was
// `response_format json_schema is no longer supported`, quoted in this file as though it were a
// provider message; `git log -S` shows that string entering the repository exactly once, in 497055e,
// as a SYNTHETIC fixture I wrote for the retirement classifier. A pattern branch cannot rest on a
// precedent I invented, and I cited it in the #114 directive as if it were evidence.
//
// So: match the captured template and nothing else. A future provider wording that this misses is
// classified schema-scoped, which costs one extra 400 per schema on a backoff — the safe direction.
// Widen only when another real refusal is captured, and add it here verbatim when it is.
const FORMAT_UNSUPPORTED_RE = /\bthis\s+model\s+does\s+not\s+support\s+response\s+format\b/i;
// Only the provider's own diagnostic. Passing the raw body here let generated content decide whether
// structured output was disabled for the whole process (Codex #115 P1).
// Is this 400 plausibly a complaint about the FORMAT, or just a failure that happens to be a 400?
//
// Codex #116 P1: the format ladder (json_schema -> json_object -> none) is walked on every 400, so a
// dead primary answering with an unrecognised 400 burned THREE requests per schema before the chain
// advanced. With seven distinct schemas that reached the 26-request ceiling and the healthy fallback
// was never tried at all — which is how "recognition is only an optimisation", a thing I asserted
// twice, turned out to be false: under model-outer/format-inner ordering, recognition is what stops
// a dead model eating the failover budget.
//
// So the ladder now requires evidence that the format is what upset the provider. Anything else is
// treated as a model-level failure and moves to the next model immediately, while alternatives
// remain. On the LAST model the ladder is still walked in full, because by then degrading is the
// only thing left to try.
// EXPLICIT signals only. The first version of this ended with a bare `|schema`, which recreated the
// very bug it was written to fix (Codex #117 P1): "deployment does not match the provider API schema"
// is a model-level 400 that happens to contain the word, so the ladder was walked again, and seven
// production-shaped schemas once more exhausted the request ceiling before the healthy fallback was
// reached. `schema` appears in plenty of sentences that are not about structured output.
//
// This is the fourth prose classifier in this file and the fourth to be wrong, always in the same
// way: a term broad enough to match the thing I meant also matches things I did not think of.
const FORMAT_COMPLAINT_CODES = new Set(['json_validate_failed']);
const looksFormatComplaint = (err) =>
    // EXACT code match — `upstream_response_format_invalid` must not pass on a substring.
    FORMAT_COMPLAINT_CODES.has(String(err?.code || '').trim().toLowerCase())
    // ...or the captured refusal sentence, which is the same evidence isFormatUnsupported works from.
    || isFormatUnsupported(err);

const isFormatUnsupported = (err) => FORMAT_UNSUPPORTED_RE.test(String(err?.message || ''));

// What may be REMEMBERED and LOGGED from a provider error body — an allow-list, not a truncation.
//
// Codex #112 P2: the first version kept 300 raw characters and printed 200 of them. Groq documents
// 400 bodies that carry `failed_generation` — the model's attempted output — and that output is
// derived from the prompt, which for a whisper is the player's own typed message. Truncating it does
// not make it safe; it just makes it shorter. So parse, take the three diagnostic fields providers
// actually define, and never touch payload-shaped ones.
const REFUSAL_MESSAGE_MAX = 200;
// THE SINGLE PARSE. Every classifier consumes this and none of them sees the raw body again.
//
// Codex #115 P1 reproduced both halves of why that matters. `failed_generation` carries the model's
// ATTEMPTED OUTPUT, which is derived from the prompt, which for a whisper is the player's own words —
// so a body whose diagnostic was a plain schema-validation failure, but whose generated content
// happened to contain "This model does not support response format json_schema", was recorded
// format-scoped and downgraded the next schema. The same trick retires a model: a
// `failed_generation` of "The model openai/gpt-oss-120b is retired", or a NESTED `code` of
// `model_not_found`, both passed classifiers that searched the whole body as a string.
//
// Player-influenced text was steering permanent, process-wide state. Parse first, classify only the
// fields the provider defines as its own diagnostic.
function parseProviderError(bodyText) {
    let err = null;
    try { err = JSON.parse(String(bodyText || ''))?.error; } catch { /* not JSON */ }
    if (!err || typeof err !== 'object') {
        // Unparseable: say so rather than quoting bytes of unknown provenance.
        return { type: null, code: null, message: '(unparseable error body — not logged)' };
    }
    const pick = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null);
    return {
        type: pick(err.type),
        code: pick(err.code),
        // `message` is the provider's human-readable diagnostic. `failed_generation`, `content`, and
        // anything else on the object are deliberately dropped.
        message: (pick(err.message) || '(no message)').slice(0, REFUSAL_MESSAGE_MAX),
    };
}
// The logger wants the same allow-listed view; there is deliberately only one way to read a body.
const describeRefusal = parseProviderError;

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
// Retirement codes. NONE of these is a captured Groq response — the provenance audit Codex ran in
// #115 traces `model_decommissioned` and `model_not_found` to b86f82d and `model_terminated` to
// 497055e, all three synthetic fixtures I wrote, and Groq's error documentation defines `error.type`
// and `error.message` rather than these codes. They are kept because a structured code is cheap to
// check and low-risk to match, NOT because anything here is evidence.
//
// The consequence of that admission is below: a retirement verdict is no longer permanent, and the
// chain no longer depends on recognising one.
const MODEL_GONE_CODES = /^(model_decommissioned|model_not_found|model_terminated)$/i;

// Does this failure mean "that model is gone" rather than "that request was wrong"?
//
// Takes the PARSED error. The previous version searched the whole body as a string, so Codex #115
// reproduced a nested `failed_generation.code` of `model_not_found` retiring a healthy primary model,
// and a `failed_generation` reading "The model openai/gpt-oss-120b is retired" doing the same.
// Model-generated text could retire the model that generated it.
function isModelGone(status, err, model) {
    if (status !== 400 && status !== 404 && status !== 410) return false;
    // TOP-LEVEL code only, matched whole rather than as a substring of the body.
    if (MODEL_GONE_CODES.test(String(err?.code || ''))) return true;
    const message = String(err?.message || '');
    if (!model || !message.includes(model)) return false;
    // The model must be the SUBJECT of the retirement, not merely mentioned in it. Codex #115
    // reproduced "The response schema for model openai/gpt-oss-120b was not found" returning true —
    // the subject there is the schema, and the model name sits in a prepositional phrase.
    //
    // `not found` and `does not exist` are gone from this list entirely. They were the ambiguous
    // pair: they describe a missing route, schema or parameter as readily as a retired model, and
    // they were what made that sentence match. Losing them costs nothing now, because failover no
    // longer depends on this function recognising anything (see the chain loop).
    const name = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
        `(?:^|[.;]\\s*|\\bthe\\s+)model\\s+\`?${name}\`?\\s+`
        + `(?:has\\s+been\\s+|was\\s+|is\\s+|been\\s+)?`
        + `(?:decommissioned|retired|terminated|discontinued|removed|no\\s+longer\\s+available)`,
        'i').test(message);
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
    // ROLLING, not a fixed bucket (Codex #107 P1-1). The first version zeroed the whole allowance at
    // a single boundary, so 4,998 tokens at t=59.999s and another 4,998 at t=60.001s both passed —
    // 9,996 reserved inside two milliseconds against a 5,000 ceiling, over the provider's limit and
    // exactly the burst the guard exists to stop. A ledger of timestamped reservations, with
    // anything older than the window evicted, has no boundary to exploit: the last 60 seconds are
    // always the last 60 seconds.
    //
    // Bounded by the request cap above, so this holds at most BUDGET_MAX entries.
    while (_budget.spend.length && now - _budget.spend[0].at >= BUDGET_WINDOW_MS) _budget.spend.shift();
    const spent = _budget.spend.reduce((n, e) => n + e.cost, 0);

    // The REQUEST cap rolls off the same ledger (Codex #108 P2-3). It used to reset wholesale at a
    // boundary while the comment above it promised a rolling limit — 25 calls at t=59.999s and 26 at
    // t=60.001s were all admitted, 51 inside two milliseconds. One ledger, one window, no edge.
    if (_budget.spend.length >= BUDGET_MAX) {
        throw new LLMDisabledError(`LLM budget exceeded (${BUDGET_MAX}/${BUDGET_WINDOW_MS / 1000}s)`);
    }

    // ADMISSION control only — the actual charge happens per upstream attempt below. This refuses
    // work that could never fit the window before any request is made.
    const cost = estimateTokens(system, user, maxTokens);
    const ceiling = priority === 'background' ? TOKEN_BUDGET_MAX * BACKGROUND_CEILING : TOKEN_BUDGET_MAX;
    if (spent + cost > ceiling) {
        throw new LLMDisabledError(
            `LLM token budget exceeded (${spent}+${cost} > ${Math.round(ceiling)} of ${TOKEN_BUDGET_MAX}/min${priority === 'background' ? ', background' : ''})`);
    }

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
            ).filter(f => {
                const type = f ? f.type : 'none';
                // two scopes: the format refused outright, or refused for THIS schema only
                return !skipActive(`${model}|${type}`)
                    && !skipActive(`${model}|${type}|${schemaName}`);
            });

            // #stickycap the halving is per-CALL only — nothing is remembered across calls. See the
            // note at CAP_MIN_TOKENS for why persisting it was wrong.
            let askTokens = maxTokens;
            let halvings = 0;
            let modelGone = false;
            let tryNextModel = false;   // model-scoped 429/403: this model is unusable, others may not be
            let giveUp = false;         // a non-retryable status: stop trying formats too, not just sizes

            // Hoisted above the request: the r.ok path now reads it too, and as a `const` declared
            // further down it sat in the temporal dead zone — a ReferenceError on the first
            // unparseable 200. This project has shipped that exact shape before (a const inside
            // boot() read at module scope, which froze the game while every test stayed green).
            const lastModel = model === chain[chain.length - 1];
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

                    // Charge the ledger PER UPSTREAM ATTEMPT (Codex #109 P2-3). It used to be charged
                    // once per logical callLLM, outside these loops — so a 413-halving path or a model
                    // failover made two, three or more provider requests against a single reservation.
                    // Codex reproduced 26 logical calls issuing 52 upstream fetches while the stated
                    // ceiling was 26. The provider counts attempts, so we must too; askTokens is the
                    // size of THIS attempt, which is what the halving path changes.
                    const attemptAt = Date.now();
                    while (_budget.spend.length && attemptAt - _budget.spend[0].at >= BUDGET_WINDOW_MS) _budget.spend.shift();
                    const spentNow = _budget.spend.reduce((n, e) => n + e.cost, 0);
                    const attemptCost = estimateTokens(system, user, askTokens);
                    if (_budget.spend.length >= BUDGET_MAX || spentNow + attemptCost > ceiling) {
                        lastErr = new LLMDisabledError(
                            `LLM budget exceeded mid-call (${_budget.spend.length} reqs, ${spentNow}+${attemptCost} tokens)`);
                        giveUp = true;
                        break;
                    }
                    const attemptEntry = { at: attemptAt, cost: attemptCost };
                    _budget.spend.push(attemptEntry);

                    const controller = new AbortController();
                    // OWNERSHIP, recorded rather than inferred (Codex #118). `controller.signal.aborted`
                    // means "this signal aborted", which today can only be our timer because the
                    // controller is private — but the moment a caller's cancellation signal is combined
                    // with it, that flag would start meaning "any abort", and a user cancelling would
                    // silently spend a second model's request. A flag set by the timer itself cannot
                    // drift that way.
                    let timedOut = false;
                    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
                    let retrySmaller = false;
                    try {
                        const r = await fetch(`${cfg.base}/chat/completions`, {
                            method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
                        });
                        if (r.ok) {
                            // A 200 whose body is not usable JSON is a failure of THIS MODEL, and it
                            // used to escape to the outer catch — so the chain never advanced and the
                            // fallback was never asked (Codex #116 P1). Reasoning models returning
                            // empty content has already happened once in this migration, which is
                            // exactly the shape this now survives.
                            const rawBody = await r.json();
                            // #tokenbudget RECONCILE TO ACTUALS (owner-found disconnect, 2026-08-13):
                            // the reservation charges chars/4 + FULL maxTokens, but Groq bills the
                            // real usage it reports on every response — so the budget was starving
                            // callers while the Groq console sat clean (canned replies at ~2 whispers/
                            // min against a meter reading far under the ceiling). The estimate remains
                            // the ADMISSION price; the ledger keeps the PROVIDER'S bill. Failures keep
                            // the conservative estimate; an actual LARGER than the estimate (reasoning
                            // bursts) is kept too — the window mirrors Groq's in both directions.
                            const actual = rawBody && rawBody.usage && Number.isFinite(rawBody.usage.total_tokens)
                                ? rawBody.usage.total_tokens : 0;
                            if (actual > 0) attemptEntry.cost = actual;
                            let out;
                            try {
                                out = parseJson(extractContent(rawBody));
                            } catch (parseErr) {
                                lastErr = parseErr;
                                if (!lastModel) { tryNextModel = true; break; }
                                throw parseErr;
                            }
                            _breaker.fails = 0;
                            // #formatwitness record the format that WORKED, not the one we hoped for
                            _lastFormat.set(schemaName, { format: response_format ? response_format.type : 'none', model });
                            // A PROVEN strict success clears this schema's history (Codex #113 P2).
                            // The backoff kept `strikes` across expiry so a repeat offender would not
                            // be probed every minute — but nothing ever cleared it, so a schema that
                            // failed three times in January sat permanently on the 30-minute step and
                            // every later blip cost half an hour of fallback, however many healthy
                            // months lay between. Evidence that the schema WORKS should outweigh
                            // stale evidence that it once did not. A genuinely invalid schema never
                            // takes this branch, so it still reaches the cap on its own.
                            //
                            // Only the schema-scoped key: a model-wide entry never expires, so it
                            // would have prevented this attempt entirely and cannot be stale here.
                            if (response_format?.type === 'json_schema') {
                                _formatSkip.delete(`${model}|json_schema|${schemaName}`);
                            }
                            // ...and this model's retirement history, for the same reason (Codex
                            // #116 P2). The expiring verdict inherited the stale-strike problem fixed
                            // for schemas in #113: a model that answered correctly a moment ago is
                            // not a repeat offender, and letting old strikes stand meant the next
                            // blip skipped it for five minutes instead of sixty seconds.
                            _modelDead.delete(model);
                            return out;
                        }
                        const errText = await r.text().catch(() => '');
                        // Parse ONCE. Every classifier below reads this, never errText (Codex #115 P1).
                        const providerErr = parseProviderError(errText);
                        lastErr = new Error(`LLM request failed (${r.status})`);
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
                        // #modelchain retirement — the PARSED diagnostic only, never the raw body.
                        else if (isModelGone(r.status, providerErr, model)) {
                            if (!deadActive(model)) {
                                const next = chain.filter(m => m !== model)[0];
                                console.warn(`[llm] model "${model}" looks gone (${r.status}) - falling back to "${next || 'nothing'}". Update RY_FARMS_LLM_MODELS.`);
                            }
                            noteDead(model);
                            lastErr = new Error(`LLM model unavailable (${model})`);
                            modelGone = true;
                        } else if (r.status === 413 && halvings < CAP_MAX_HALVINGS && askTokens > CAP_MIN_TOKENS) {
                            // #stickycap the completion size was refused. Halve and retry the same format.
                            askTokens = Math.max(CAP_MIN_TOKENS, Math.floor(askTokens / 2));
                            halvings++;
                            retrySmaller = true;
                        } else if (r.status !== 400 && r.status !== 422) {
                            giveUp = true;   // only a format-rejection is worth trying another format for
                        } else if (!looksFormatComplaint(providerErr) && !lastModel) {
                            // A 400 that says nothing about the format is not worth degrading for.
                            // Try the next MODEL instead of spending two more requests proving that
                            // this one is still broken (Codex #116 P1).
                            tryNextModel = true;
                        } else {
                            // A format rejection costs no TOKENS but is still a REQUEST (Codex #110 P1-1).
                            //
                            // The first version spliced the whole entry, which refunded the request count
                            // as well — so alternating a refused format with a success issued 54 upstream
                            // requests while the ledger held 26, and every success reset the breaker. RPM
                            // is requests per minute; the provider counts the ones it rejects.
                            //
                            // So: zero the cost, KEEP the entry. And only for a 400 — Groq documents 422
                            // as potentially involving model hallucinations, so tokens may well have been
                            // produced, and assuming otherwise is the kind of convenient guess that put
                            // this ledger wrong twice already.
                            if (r.status === 400) attemptEntry.cost = 0;
                            // #stickyformat SCOPE: model-wide only when the provider says the
                            // PARAMETER is unsupported; otherwise remember just this schema, so one
                            // refused shape cannot mute the other nine.
                            if (response_format) {
                                const wide = isFormatUnsupported(providerErr);
                                noteSkip(wide
                                    ? `${model}|${response_format.type}`
                                    : `${model}|${response_format.type}|${schemaName}`, wide);
                                const why = providerErr;
                                _lastRefusal.set(schemaName, {
                                    model, format: response_format.type, status: r.status,
                                    scope: wide ? 'format' : 'schema', ...why,
                                });
                                console.warn(`[llm] ${model} refused ${response_format.type} for "${schemaName}" (${r.status}, ${wide ? 'format' : 'schema'}-scoped): ${why.type || '?'}/${why.code || '?'} ${why.message}`);
                            }
                        }
                    } catch (netErr) {
                        // OUR OWN TIMEOUT is a property of THIS MODEL (Codex #117 P1). Inference
                        // latency differs per model and the default chain deliberately puts the
                        // larger, slower one first — so an abort on gpt-oss-120b is exactly the case
                        // a fallback to gpt-oss-20b exists to rescue, and it was escaping to the
                        // shared breaker with the healthy model never asked.
                        //
                        // Everything else stays provider-wide on purpose: DNS, TLS and a wrong base
                        // URL fail identically for every model behind the same host, and retrying a
                        // connection reset is a provider retry policy, not a failover.
                        if (timedOut && !lastModel) {
                            lastErr = netErr;
                            tryNextModel = true;
                            clearTimeout(timer);
                            break;
                        }
                        throw netErr;
                    } finally { clearTimeout(timer); }
                    if (!retrySmaller) break;   // fall through to the next format (or out, if giveUp)
                }
                if (giveUp || modelGone || tryNextModel) break;
            }
            // Advance the chain for MODEL-SCOPED failures only — retirement, permission, or a rate
            // limit that may apply to this model alone. A provider-wide failure (upstream 5xx, bad
            // JSON, timeout) would just be paid again on the next model for nothing.
            // ADVANCE WHILE ALTERNATIVES REMAIN. This used to break out of the chain unless a
            // retirement message had been RECOGNISED — which made failover depend on the invented
            // codes above. On 2026-08-16 Groq decommissions llama-3.1-8b-instant, and if its refusal
            // does not match a pattern I fabricated, the chain would never reach gpt-oss on the one
            // day the chain exists for. Recognition is an optimisation; having somewhere else to go
            // is the actual failover.
            //
            // Cost: one extra request per genuinely failing call, bounded by the chain length, and
            // only on a path that was about to return nothing anyway.
            if (model === chain[chain.length - 1]) break;
        }
        throw lastErr || new Error('LLM request failed');
    } catch (err) {
        // a real failure (network/timeout/5xx/bad-json) trips the shared breaker after a few in a row
        if (++_breaker.fails >= BREAKER_TRIP) { _breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS; _breaker.fails = 0; }
        throw err;
    }
}

// #formatwitness DIAGNOSTIC ONLY — tools/probe-endpoints.mjs asks which format produced the last
// answer for a schema, so a paid run can distinguish an enforced contract from a fallback that
// merely looked right. Production never calls this.
const lastFormatFor = (schemaName) => _lastFormat.get(schemaName) || null;
const lastRefusalFor = (schemaName) => _lastRefusal.get(schemaName) || null;

module.exports = { callLLM, parseJson, resolveLLM, llmStatus, LLMDisabledError, modelChain, isModelGone, parseProviderError, lastFormatFor, lastRefusalFor };
