// The conversation panel is canvas-rendered, so pin the DOM accessibility mirror and the explicit
// continuation path at source. Transport semantics themselves are exercised in whisper-retry.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

assert.match(main, /import \{ whisper, resumeWhisper, whisperLog, whisperNoticeText \}/);
assert.match(main, /wrapLine\('! ' \+ noticeText, maxChars\)/, 'status is inline in the transcript, not a toast');
assert.match(main, /aria-live', 'polite'/);
assert.match(main, /aria-label', 'Whisper a thought to the selected farmer'/);
assert.match(main, /el\.readOnly = true/, 'the original input remains intact while held');
assert.match(main, /Date\.now\(\) < Number\(chatPending\.data\.retryAt/);
assert.match(main, /await resumeWhisper\(held\.w, held\.f, held\.data/);
assert.doesNotMatch(main, /setInterval\([^\n]*resumeWhisper|setTimeout\([^\n]*resumeWhisper/,
    'a cooldown must never replay gameplay automatically');
assert.match(main, /if \(!chatReveal && !chatPending\) chatFreeze = null/,
    'an applied verdict remains frozen until its reply-only continuation completes');

console.log('whisper-ui: PASS');
