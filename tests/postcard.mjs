// tests/postcard.mjs — #postcard the share-link contract, pinned at both ends.
//
// The postcard's whole promise is that the LINK is the TOWN: `?seed=N` (+`&orc=1` for a warband)
// founds the identical world on the recipient's browser. So the things worth pinning are exact:
//   - the minted URL's shape, including the culture flag an orc town must carry (a resumed orc
//     town's own URL drops ?orc, so the link builder cannot lean on location.search);
//   - the seed coercion mirroring main.js's boot (`parseInt >>> 0`, junk → 0) so the server names
//     the SAME town the client would found from the same query;
//   - the OG injection against the REAL index.html (producer-fidelity: the served file, not a
//     hand-written fixture), swapping exactly the five share-card values and nothing else.
//
// Run: `node tests/postcard.mjs`

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildPostcard, postcardMeta, injectOgTags, queryTown } from '../postcard.js';
import { generateTownName } from '../farm.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// ---- buildPostcard: the sender's half -------------------------------------------------------
{
    const card = buildPostcard({ seed: 424242, name: 'Stonestead', day: 12, year: 1, culture: 'human', origin: 'https://propagate.heyhaigh.ai' });
    assert.equal(card.url, 'https://propagate.heyhaigh.ai/?seed=424242&pc=1');
    assert.ok(!card.url.includes('orc'), 'a human town link carries no culture flag');
    ok('human link is exactly origin/?seed=N&pc=1');

    assert.ok(card.text.includes('Stonestead'), 'text names the town');
    assert.ok(card.text.includes('day 12'), 'text carries the day');
    assert.ok(!card.text.includes('year'), 'year 1 stays quiet');
    assert.ok(card.text.includes(card.url), 'text carries the link itself');
    assert.ok(card.text.includes('This exact town will grow for you too'), 'the promise line');
    ok('postcard text carries name, day, promise, and the link');
}
{
    const card = buildPostcard({ seed: 424242, name: 'Bloodfang', day: 3, year: 2, culture: 'orc', origin: 'https://propagate.heyhaigh.ai' });
    assert.equal(card.url, 'https://propagate.heyhaigh.ai/?seed=424242&orc=1&pc=1');
    assert.ok(card.text.includes('year 2, day 3'), 'a later year is spelled out');
    ok('orc link carries &orc=1 (the recipient must not found a human town on this seed)');
}
{
    const card = buildPostcard({ seed: -1, name: 'X', day: 1, year: 1, culture: 'human', origin: 'http://o' });
    assert.equal(card.url, 'http://o/?seed=4294967295&pc=1');
    ok('seed is coerced uint32, matching World and the boot');
}

// ---- postcardMeta: the scraper's half -------------------------------------------------------
{
    assert.equal(postcardMeta(new URLSearchParams('')), null);
    assert.equal(postcardMeta(new URLSearchParams('seed=')), null);
    assert.equal(postcardMeta(new URLSearchParams('fresh=1')), null);
    ok('no seed in the query → null (the static tags stand)');
}
{
    const human = postcardMeta(new URLSearchParams('seed=424242'));
    const humanName = generateTownName(424242, 'human');
    assert.equal(human.title, `${humanName} — Propagate`);
    assert.ok(human.description.includes(humanName), 'description names the town');
    assert.equal(human.url, 'https://propagate.heyhaigh.ai/?seed=424242');

    const orc = postcardMeta(new URLSearchParams('seed=424242&orc=1'));
    const orcName = generateTownName(424242, 'orc');
    assert.notEqual(orcName, humanName, 'seed 424242 must distinguish the cultures or this pin is vacuous');
    assert.equal(orc.title, `${orcName} — Propagate`);
    assert.equal(orc.url, 'https://propagate.heyhaigh.ai/?seed=424242&orc=1');
    ok('meta names the exact town the boot would found, per culture');
}
{
    // parseInt('abc') >>> 0 === 0 — junk names a real town (seed 0), it does not error, because the
    // click through the same URL founds that town.
    const junk = postcardMeta(new URLSearchParams('seed=abc'));
    assert.equal(junk.title, `${generateTownName(0, 'human')} — Propagate`);
    assert.ok(junk.url.endsWith('?seed=0'));
    ok('junk seed coerces to seed 0, same as the boot founds');
}

// ---- queryTown: THE shared ?seed/?orc reading (Codex #123-3) ---------------------------------
{
    assert.deepEqual(queryTown(new URLSearchParams('')), { hasSeed: false, seed: null, culture: 'human' });
    assert.deepEqual(queryTown(new URLSearchParams('seed=')), { hasSeed: false, seed: null, culture: 'human' });
    assert.deepEqual(queryTown(new URLSearchParams('seed=424242')), { hasSeed: true, seed: 424242, culture: 'human' });
    assert.deepEqual(queryTown(new URLSearchParams('seed=-1')), { hasSeed: true, seed: 4294967295, culture: 'human' });
    assert.deepEqual(queryTown(new URLSearchParams('seed=zzz')), { hasSeed: true, seed: 0, culture: 'human' });
    assert.equal(queryTown(new URLSearchParams('seed=1&orc=1')).culture, 'orc');
    assert.equal(queryTown(new URLSearchParams('seed=1&orc')).culture, 'orc');          // bare flag counts, like the boot
    assert.equal(queryTown(new URLSearchParams('seed=1&culture=orc')).culture, 'orc');  // the long spelling too
    assert.equal(queryTown(new URLSearchParams('seed=1&culture=human')).culture, 'human');
    ok('queryTown: seed coercion (uint32, junk→0, empty→none) and both culture spellings');
}
{
    // The helper only guarantees agreement if BOTH sides consume it. main.js cannot be imported
    // headless, so this is a source-level pin (the llm-chokepoint precedent). Codex #123 r2: pin
    // CONSUMPTION, not helper presence — a boot that calls queryTown but computes worldSeed from
    // its own `bootParams.get('seed')` read passes a presence check while diverging. So: the two
    // identity assignments must consume the helper's result, and every direct value-read of the
    // identity params is banned outright (presence checks like `has('seed')` stay legitimate —
    // they route, they don't name). False failures from harmless refactors are the accepted cost.
    const mainSrc = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.ok(mainSrc.includes('queryTown(bootParams)'), 'the boot consumes the shared helper');
    assert.ok(mainSrc.includes('const worldSeed = townQ.hasSeed ? townQ.seed'), 'worldSeed is assigned FROM the helper result');
    assert.ok(mainSrc.includes('const bootCulture = townQ.culture'), 'bootCulture is assigned FROM the helper result');
    // Quote- and whitespace-agnostic (Codex #123 r3): a double-quoted `get("seed")` or spaced
    // member access is the same read — the ban must recognize the SYNTAX CLASS, not the repo's
    // current formatting, or an innocent style choice defeats a fail-closed pin.
    assert.ok(!/bootParams\s*\.\s*get\s*\(\s*["']seed["']\s*\)/.test(mainSrc), 'no direct seed value read survives in the boot');
    assert.ok(!/bootParams\s*\.\s*(get|has)\s*\(\s*["']orc["']\s*\)|bootParams\s*\.\s*get\s*\(\s*["']culture["']\s*\)/.test(mainSrc), 'no direct culture read survives in the boot');
    assert.ok(!/parseInt\(\s*urlSeed/.test(mainSrc), 'no duplicate seed coercion survives in the boot');
    ok('main.js boot CONSUMES queryTown (assignments pinned, direct identity reads banned)');
}
{
    // Codex #123 r2-1 — the arrival marker is durable state; an UNSAVED boot must not spend it.
    // Same source-pin trade-off as above: exact-predicate, false-failure over silent-pass.
    const mainSrc = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.ok(mainSrc.includes("bootParams.get('pc') != null && !noPersistReason"),
        'the postcard arrival gates on a persisting session');
    ok('an unsaved boot cannot spend the postcard marker');
}

// ---- injectOgTags: against the file production actually serves ------------------------------
{
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const meta = postcardMeta(new URLSearchParams('seed=424242'));
    const out = injectOgTags(html, meta);
    for (const tag of [
        `property="og:title" content="${meta.title}"`,
        `property="og:description" content="${meta.description}"`,
        `property="og:url" content="${meta.url}"`,
        `name="twitter:title" content="${meta.title}"`,
        `name="twitter:description" content="${meta.description}"`,
    ]) assert.ok(out.includes(tag), `injected: ${tag.slice(0, 40)}...`);
    assert.ok(!out.includes('property="og:title" content="Propagate"'), 'the generic title is gone');
    assert.ok(out.includes('property="og:site_name" content="Propagate"'), 'site_name untouched');
    assert.ok(out.includes('og-image.png'), 'the static card image stands');
    assert.equal(out.split('<meta').length, html.split('<meta').length, 'no tags added or eaten');
    ok('all five share-card values land in the real index.html, nothing else moves');
}
{
    const out = injectOgTags(
        '<meta property="og:title" content="Propagate">',
        { title: 'A "B" & C <D> $& $1', description: '', url: '' });
    assert.ok(out.includes('content="A &quot;B&quot; &amp; C &lt;D&gt; $&amp; $1"'),
        'attribute value is entity-escaped and replacement-pattern-proof');
    ok('injected values are escaped (quotes cannot break out of the attribute)');
}

console.log(`postcard: ${passed} checks passed`);
