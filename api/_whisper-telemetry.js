// api/_whisper-telemetry.js — the ONE recorder for whisper LLM-hit vs fallback.
//
// WHY THIS MODULE EXISTS (Codex #100 P1-1). Whisper attempts fail in two places:
//   * inside the conscience handler (upstream error, breaker, budget, bad output)
//   * BEFORE it, in server.mjs's per-IP limiter, which rejects without loading the handler
// Both must land in the same counters AND reach the same sink. The production sink is Railway
// stdout and nothing else — so incrementing a counter without emitting a line is not telemetry, it
// is a number nobody will ever see. The first version of the limiter fix did exactly that: it
// bumped `globalThis` and never called the formatter, so a burst of throttled whispers followed by
// quiet or a restart vanished silently. A test read the global directly and reported success.
//
// State lives on globalThis because server.mjs deletes every cached module under /api before each
// request (see loadHandler), so module-level state is rebuilt per request. `_llm.js` does the same.
//
// CJS on purpose: server.mjs reaches it through createRequire, the handlers through require.

const STATS_LOG_MS = 60_000;   // at most one line a minute; a per-whisper line would drown the log

const T = globalThis.__ryFarmsWhisperStats || (globalThis.__ryFarmsWhisperStats = {
    classify: { ok: 0, fail: 0 },
    reply: { ok: 0, fail: 0 },
    // A legitimate client attempt whose stage could not be determined — in practice a request the
    // per-IP limiter rejected before the body was ever read. Counts toward product health.
    unattributed: { ok: 0, fail: 0 },
    // Malformed bodies and unknown stages (Codex #100 P2-3). The shipped client cannot produce
    // these, so they are protocol noise — scanners, stale tabs, hand-rolled requests. Counted and
    // visible, but EXCLUDED from the headline rate, because letting them dilute it would make the
    // whisper channel look unhealthy for reasons that have nothing to do with whispers.
    invalid: { ok: 0, fail: 0 },
    reasons: {},
    lastLog: 0,
});

// Which reason strings mean "not a real whisper attempt".
//
// ADDING A REASON HERE IS LOAD-BEARING: a new invalid-traffic reason that is not listed silently
// lands in the product-health headline instead. Keep this next to the call sites that use them —
// currently 'bad-body' (unparseable OR non-object), 'unknown-stage', 'empty-message'.
const INVALID_REASONS = new Set(['bad-body', 'unknown-stage', 'empty-message']);

// Map a thrown error message onto a bounded reason bucket. Bounded on purpose: raw upstream
// messages would make the reasons map grow without limit.
//
// Ordering is most-specific-first, and the first three matter most: they are OUR OWN throttling
// (circuit breaker, per-process budget, disabled config). Folding those into a generic 'upstream'
// made a self-inflicted outage read as the provider being down.
function bucketReason(message) {
    const msg = String(message || '');
    if (/circuit breaker/i.test(msg)) return 'breaker-open';
    if (/budget exceeded/i.test(msg)) return 'budget-exhausted';
    if (/LLM off/i.test(msg)) return 'llm-off';
    if (/429|rate.?limit/i.test(msg)) return 'rate-limit-upstream';
    if (/timeout|abort/i.test(msg)) return 'timeout';
    if (/empty (reply|classification)|schema|did not return JSON/i.test(msg)) return 'bad-output';
    return 'upstream';
}

const pct = (ok, fail) => ((ok + fail) ? `${Math.round(ok / (ok + fail) * 100)}%` : 'n/a');

// The line that actually reaches Railway. Exported so a test can assert on the real formatter
// rather than reimplementing the arithmetic and proving only that it can do division.
function formatLine(t = T) {
    const c = t.classify, r = t.reply, u = t.unattributed, x = t.invalid;
    // The headline counts genuine attempts only: both stages plus unattributed (a throttled
    // whisper IS a whisper the player did not get). `invalid` is reported beside it, never inside.
    const okAll = c.ok + r.ok + u.ok;
    const failAll = c.fail + r.fail + u.fail;
    return `[whisper-telemetry] OVERALL ${okAll}/${okAll + failAll} hit (${pct(okAll, failAll)}) · `
        + `classify ${c.ok}/${c.ok + c.fail} (${pct(c.ok, c.fail)}) · `
        + `reply ${r.ok}/${r.ok + r.fail} (${pct(r.ok, r.fail)}) · `
        + `throttled ${u.fail} · invalid ${x.fail} (excluded from OVERALL) · `
        + `reasons ${JSON.stringify(t.reasons)}`;
}

// Record one attempt and emit the throttled line. EVERY caller uses this — recording without
// emitting is the defect this module was extracted to prevent.
//
// `Date.now()` is fine: server-side, outside the sim, and nothing about a town depends on it. The
// determinism ban on wall-clock applies to farm.js, not to a log throttle.
function noteWhisper(stage, ok, reason) {
    const key = (!ok && INVALID_REASONS.has(reason)) ? 'invalid' : stage;
    const bucket = T[key];
    if (bucket) bucket[ok ? 'ok' : 'fail']++;
    if (!ok && reason) T.reasons[reason] = (T.reasons[reason] || 0) + 1;

    const now = Date.now();
    if (now - T.lastLog < STATS_LOG_MS) return;
    T.lastLog = now;
    console.log(formatLine());
}

module.exports = { noteWhisper, bucketReason, formatLine, stats: T, STATS_LOG_MS, INVALID_REASONS };
