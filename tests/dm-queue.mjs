// tests/dm-queue.mjs — the client-side enrichment queue in dm.js.
//
// This file exists because Codex #106 P2-3 pointed out that NOTHING exercised this queue, and two
// separate defects had already shipped through it:
//
//   #105 P1-3  HEAD-OF-LINE BLOCKING. Selection always took the lowest waiting seed with no failure
//              rotation, so one farmer whose draft reliably produced an unusable tale was retried
//              after every cooldown while the other seven were never attempted. Reproduced as [1,1].
//   #106 P2-3  THE COOLDOWN DEFEATED ITSELF. `ready.length ? ready : waiting` looked like a safety
//              net, but once the rest of the cast was enriched the single failing farmer was the
//              only entry left in `waiting` and came straight back on the scheduler's 5-minute tick.
//              Reproduced as [1,2,1] at minutes 0, 5 and 6 — nine minutes early.
//
// Both are scheduling bugs: the code looked correct and the wrong farmer was chosen. Only a test
// that watches WHICH SEED goes out, over TIME, catches that — which is why time is injectable here.

import assert from 'node:assert';

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// A farmer is only what the queue actually reads.
function farmer(seed, name = `F${seed}`) {
    return {
        sheet: {
            seed, name: `${name} Longfield`,
            story: { v: 2, tale: 'a procedural draft that is already on screen', llm: false, bg: 'hermit', ideal: 'i', bond: 'b', flaw: 'f' },
            dream: { yearn: 'a good harvest', rivalName: null },
            stats: {}, archetype: 'builder', personality: { label: 'quiet', creed: 'the valley keeps' },
            memory: { title: 'a life before' },
        },
    };
}
const makeWorld = (n) => ({
    name: 'TESTBURY', seed: 1, day: 1, seasonName: 'SPRING', culture: 'human',
    farmers: Array.from({ length: n }, (_, i) => farmer(i + 1)),
    addLog() {},
});

// Fresh module per case: seedFailAt is module state and would leak between cases.
let seq = 0;
const freshDm = () => import(`../dm.js?case=${seq++}`);

// `respond` decides what the endpoint returns for the seed it was asked about.
function stubEndpoint({ respond, sent }) {
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        const seed = body.characters[0].seed;
        sent.push(seed);
        const ok = respond(seed);
        if (!ok) return { ok: false, status: 502, json: async () => ({ fallback: true, error: 'no usable tales' }) };
        return {
            ok: true, status: 200,
            json: async () => ({ tales: [{ seed, tale: 'x'.repeat(400) }] }),
        };
    };
}

// The queue's cooldowns are wall-clock. Rather than sleep for 15 real minutes, move Date.now.
const realNow = Date.now;
const atMinute = (m) => { const base = realNow(); Date.now = () => base + m * 60_000; };
const restoreClock = () => { Date.now = realNow; };

console.log('\n#dm-queue — which farmer gets enriched, and when\n');

await check('P1-3: a failing farmer does not starve the rest of the cast', async () => {
    // Seed 1 always fails. Without rotation the sequence is [1,1,1...] and seeds 2-3 never run.
    const sent = [];
    stubEndpoint({ respond: (seed) => seed !== 1, sent });
    const { enrichStories } = await freshDm();
    const w = makeWorld(3);
    atMinute(0);  await enrichStories(w);          // picks 1, fails
    atMinute(6);  await enrichStories(w);          // 1 is cooling -> must pick 2
    atMinute(12); await enrichStories(w);          // 2 is enriched -> must pick 3
    restoreClock();
    assert.deepStrictEqual(sent, [1, 2, 3], `expected rotation past the failure, got ${JSON.stringify(sent)}`);
});

await check('P2-3: a cooling seed is NOT retried early when it is the only one left', async () => {
    // Codex's exact reproduction. Seed 1 fails; seed 2 succeeds; seed 1 must not return until its
    // 15-minute cooldown expires, even though it is now the only farmer still waiting.
    const sent = [];
    stubEndpoint({ respond: (seed) => seed !== 1, sent });
    const { enrichStories } = await freshDm();
    const w = makeWorld(2);
    atMinute(0); await enrichStories(w);           // 1 fails
    atMinute(5); await enrichStories(w);           // 2 succeeds
    atMinute(6); const n = await enrichStories(w); // 1 is still cooling: must send NOTHING
    restoreClock();
    assert.deepStrictEqual(sent, [1, 2], `seed 1 was retried early: ${JSON.stringify(sent)}`);
    assert.strictEqual(n, 0, 'a pass with nobody ready should apply nothing');
});

await check('a cooled-off seed IS retried once its 15 minutes are up', async () => {
    // The counterpart: the cooldown must expire, or a transient failure would bench a farmer forever.
    const sent = [];
    let failFirst = true;
    stubEndpoint({ respond: (seed) => !(seed === 1 && failFirst), sent });
    const { enrichStories } = await freshDm();
    const w = makeWorld(1);
    atMinute(0);  await enrichStories(w);          // 1 fails
    atMinute(10); await enrichStories(w);          // still cooling -> nothing
    failFirst = false;
    atMinute(16); await enrichStories(w);          // cooldown expired -> retried, succeeds
    restoreClock();
    assert.deepStrictEqual(sent, [1, 1], `expected a retry after the cooldown, got ${JSON.stringify(sent)}`);
    assert.strictEqual(w.farmers[0].sheet.story.llm, true, 'the retry should have enriched the farmer');
});

await check('preferSeed jumps the queue (the open sheet gets written first)', async () => {
    // "The budget follows the player's attention" is only true if this actually reorders the queue.
    const sent = [];
    stubEndpoint({ respond: () => true, sent });
    const { enrichStories } = await freshDm();
    const w = makeWorld(4);
    atMinute(0); await enrichStories(w, () => true, 3);   // player is looking at seed 3
    restoreClock();
    assert.deepStrictEqual(sent, [3], `preferSeed ignored; sent ${JSON.stringify(sent)}`);
});

await check('exactly ONE farmer per pass (the batch-of-one contract)', async () => {
    // The whole rework rests on this: eight at once truncated the prompt and blew the token budget.
    const sent = [];
    let bodySeen = null;
    globalThis.fetch = async (_url, opts) => {
        bodySeen = JSON.parse(opts.body);
        sent.push(bodySeen.characters.length);
        return { ok: true, status: 200, json: async () => ({ tales: [{ seed: bodySeen.characters[0].seed, tale: 'x'.repeat(400) }] }) };
    };
    const { enrichStories } = await freshDm();
    const w = makeWorld(8);
    atMinute(0); await enrichStories(w);
    restoreClock();
    assert.deepStrictEqual(sent, [1], `sent ${sent[0]} characters in one request, not 1`);
    assert.ok(JSON.stringify(bodySeen).length < 8000,
        `payload ${JSON.stringify(bodySeen).length} chars would be truncated by callLLM's 8000 cap`);
});

await check('an already-enriched cast sends nothing at all', async () => {
    const sent = [];
    stubEndpoint({ respond: () => true, sent });
    const { enrichStories } = await freshDm();
    const w = makeWorld(2);
    w.farmers.forEach(f => { f.sheet.story.llm = true; });
    atMinute(0); const n = await enrichStories(w);
    restoreClock();
    assert.deepStrictEqual(sent, [], 'nothing should be requested when every tale is written');
    assert.strictEqual(n, 0);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('The enrichment queue picks the wrong farmer, or picks one too early.'); process.exit(1); }
console.log('DM queue: rotates past failures, honours its cooldown, one farmer per pass.');
process.exit(0);
