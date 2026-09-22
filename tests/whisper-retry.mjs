import assert from 'node:assert/strict';
import { World } from '../farm.js';
import { generateCrew } from '../dna.js';
import { whisper, resumeWhisper, formatWhisperWait, whisperNoticeText } from '../conscience.js';

const response = (status, body, retryAfter = null) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => body,
});

const w = new World(424242);
for (const person of generateCrew(424242).slice(0, 2)) w.addFarmer(person, 0);
const f = w.farmers[0];
const realCheck = f.conscienceCheck.bind(f);
let checks = 0;
f.conscienceCheck = (...args) => { checks++; return realCheck(...args); };

let now = 1_800_000_000_000;
const originalNow = Date.now;
Date.now = () => now;

try {
    // Classification paused: the player's line is kept, but NO verdict is applied and no procedural
    // refusal is manufactured. Explicit retry runs classification, verdict, and reply exactly once.
    let calls = 0;
    globalThis.fetch = async (_url, opts) => {
        calls++;
        const stage = JSON.parse(opts.body).stage;
        if (calls === 1) return response(429, { fallback: true, reason: 'budget', retryAfter: 600 }, '600');
        return stage === 'classify'
            ? response(200, { kind: 'rest', target: '', tone: 'suggest' })
            : response(200, { line: 'I will rest when this row is done.' });
    };
    const first = await whisper(w, f, 'please rest');
    assert.equal(first.pending.stage, 'classify');
    assert.equal(first.notice.kind, 'service');
    assert.equal(checks, 0, 'a paused classifier must not apply a gameplay verdict');
    assert.equal(f.conscience.log.filter(e => e.who === 'voice').length, 1);
    assert.equal(f.conscience.log.filter(e => e.who === 'ry').length, 0);

    let held = await resumeWhisper(w, f, first.pending);
    assert.equal(calls, 1, 'retry before Retry-After must not hit the endpoint');
    assert.equal(checks, 0);
    now += 600_001;
    const resumed = await resumeWhisper(w, f, held.pending);
    assert.equal(calls, 3, 'expired retry performs the missing classify and reply calls');
    assert.equal(checks, 1, 'classification continuation applies the verdict once');
    assert.equal(resumed.reply, 'I will rest when this row is done.');
    assert.equal(f.conscience.log.filter(e => e.who === 'voice').length, 1, 'the held thought is not duplicated');
    assert.equal(f.conscience.log.filter(e => e.who === 'ry').length, 1);

    // Reply paused after a verdict: retry ONLY the prose stage. Pressure, asks, seeds, and the
    // deterministic outcome cannot run a second time.
    let replyCalls = 0;
    globalThis.fetch = async (_url, opts) => {
        replyCalls++;
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return response(200, { kind: 'rest', target: '', tone: 'suggest' });
        if (replyCalls === 2) return response(429, { fallback: true, reason: 'budget', retryAfter: 120 }, '120');
        return response(200, { line: 'The thought can wait until I finish.' });
    };
    const beforeChecks = checks;
    const beforeVoices = f.conscience.log.filter(e => e.who === 'voice').length;
    const beforeReplies = f.conscience.log.filter(e => e.who === 'ry').length;
    const replyHeld = await whisper(w, f, 'rest after this');
    assert.equal(replyHeld.pending.stage, 'reply');
    assert.equal(checks, beforeChecks + 1, 'the verdict happened before reply capacity ran out');
    assert.equal(f.conscience.log.filter(e => e.who === 'voice').length, beforeVoices + 1);
    assert.equal(f.conscience.log.filter(e => e.who === 'ry').length, beforeReplies, 'no fake farmer reply is logged');
    now += 120_001;
    const replyDone = await resumeWhisper(w, f, replyHeld.pending);
    assert.equal(replyCalls, 3, 'reply continuation makes only one new request');
    assert.equal(checks, beforeChecks + 1, 'reply continuation never replays the verdict');
    assert.equal(replyDone.reply, 'The thought can wait until I finish.');

    // A disabled model is a real offline-mode case, not a timed pause. The procedural line remains
    // available but is explicitly marked and accompanied by a system notice.
    globalThis.fetch = async () => response(200, { fallback: true, reason: 'disabled' });
    const offline = await whisper(w, f, 'please rest');
    assert.equal(offline.notice.kind, 'offline');
    assert.ok(offline.reply);
    assert.equal(f.conscience.log.at(-1).offline, true);

    assert.equal(formatWhisperWait(1_000), '1 second');
    assert.equal(formatWhisperWait(120_000), '2 minutes');
    assert.equal(formatWhisperWait(83_400_000), '23 hours 10 minutes');
    assert.equal(formatWhisperWait(86_400_000), '1 day');
    assert.match(whisperNoticeText({ kind: 'service', retryAt: now + 12_000 }, now), /TRY AGAIN IN 12 SECONDS/i);
    assert.match(whisperNoticeText({ kind: 'limit', retryAt: now + 86_400_000 }, now), /1 DAY/i);
    assert.match(whisperNoticeText({ kind: 'service', retryAt: now - 1 }, now), /PRESS ENTER TO RETRY/);
} finally {
    Date.now = originalNow;
}

console.log('whisper-retry: PASS');
