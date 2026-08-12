// tests/save-export.mjs — the town export file must round-trip the REAL snapshot, byte-faithfully.
//
// serialize()'s own comment documents the trap this format exists to avoid: snapshots carry Maps,
// Sets and typed arrays that survive IndexedDB's structured clone and are silently destroyed by
// JSON — a Map becomes `{}` and fromSave throws "d.chunks is not iterable". So the only honest test
// is against the real producer: run a real world long enough to populate the clone-only shapes, push
// its actual snapshot through encode → JSON.stringify → parse → decode → World.fromSave, and demand
// the rehydrated world serializes IDENTICALLY. Hand-built fixtures are how this project shipped
// fifteen vacuous tests; the sim is the fixture here.

import assert from 'node:assert';
import { World } from '../farm.js';
import { encodeSnapshot, decodeSnapshot, buildTownExport, importTownFile, parseTownFile } from '../save.js';
import { _setBackendForTests, townMemoryRows, replaceTownMemoryRows, validateTownMemoryRows, storePayload } from '../memory-store.js';

// memory rows ride the export now — a Map-backed fake, keys sorted like real IDB (LEARNINGS: fakes
// must mirror real semantics)
const memRows = new Map();
_setBackendForTests({
    put: async (k, v) => { memRows.set(k, v); },
    del: async (k) => { memRows.delete(k); },
    all: async () => [...memRows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
});

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

const DT = 1 / 30;

// deep structural equality that UNDERSTANDS the clone types JSON does not
function deepEq(a, b, path = '$') {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
    if (a === null || b === null || typeof a !== typeof b) throw new Error(`${path}: ${typeof a} vs ${typeof b}`);
    if (typeof a !== 'object') throw new Error(`${path}: ${a} vs ${b}`);
    if (a instanceof Map) {
        if (!(b instanceof Map) || a.size !== b.size) throw new Error(`${path}: Map mismatch`);
        for (const [k, v] of a) { if (!b.has(k)) throw new Error(`${path}.${k}: missing`); deepEq(v, b.get(k), `${path}.${String(k)}`); }
        return true;
    }
    if (a instanceof Set) {
        if (!(b instanceof Set) || a.size !== b.size) throw new Error(`${path}: Set mismatch`);
        for (const v of a) if (![...b].some(x => { try { return deepEq(v, x, path); } catch { return false; } })) throw new Error(`${path}: Set member missing`);
        return true;
    }
    if (ArrayBuffer.isView(a)) {
        if (a.constructor !== b.constructor || a.length !== b.length) throw new Error(`${path}: view mismatch`);
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${path}[${i}]: ${a[i]} vs ${b[i]}`);
        return true;
    }
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) throw new Error(`${path}: keys ${ak.length} vs ${bk.length} (${ak.filter(k => !bk.includes(k))} | ${bk.filter(k => !ak.includes(k))})`);
    for (const k of ak) deepEq(a[k], b[k], `${path}.${k}`);
    return true;
}

console.log('\n#save-export — the file format against the real snapshot\n');

// One matured world for every case: far enough in for elected roles, projects, chunks, journals.
const w = new World(4207, 'human');
// tick to a REAL day count, not a tick count guessed from DT — a fixed loop left this world on day 1
// and the metadata case caught it, which is the fixture-fidelity mistake this file warns about.
while (w.day < 12) w.tick(DT);

await check('a real matured snapshot contains the clone-only shapes this format exists for', () => {
    // Non-vacuous by construction: if the snapshot has no Map/Set/typed array anywhere, the whole
    // suite is testing a JSON pass-through and proving nothing. Walk and count.
    let maps = 0, sets = 0, views = 0;
    (function walk(v) {
        if (!v || typeof v !== 'object') return;
        if (v instanceof Map) { maps++; for (const [, x] of v) walk(x); return; }
        if (v instanceof Set) { sets++; for (const x of v) walk(x); return; }
        if (ArrayBuffer.isView(v)) { views++; return; }
        for (const k of Object.keys(v)) walk(v[k]);
    })(w.serialize());
    assert.ok(maps + sets + views > 0, `snapshot has no clone-only types (maps=${maps} sets=${sets} views=${views}) — this suite would be vacuous`);
});

await check('encode -> JSON -> decode returns a STRUCTURALLY IDENTICAL snapshot', () => {
    const snap = w.serialize();
    const wire = JSON.stringify(encodeSnapshot(snap));
    const back = decodeSnapshot(JSON.parse(wire));
    deepEq(snap, back);
});

await check('the rehydrated world SERIALIZES identically (the round trip the player lives through)', () => {
    const snap = w.serialize();
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(snap))));
    const w2 = World.fromSave(back);
    // fromSave -> serialize is not byte-identical to the input snapshot (transient state resets),
    // so compare like with like: hydrate BOTH paths and demand they agree with each other.
    const w1 = World.fromSave(structuredClone(snap));
    deepEq(w1.serialize(), w2.serialize());
});

await check('a naive JSON round trip really does destroy the snapshot (the trap is real)', () => {
    // The reason this format exists, demonstrated rather than asserted from the comment.
    const snap = w.serialize();
    let threw = false;
    try { World.fromSave(JSON.parse(JSON.stringify(snap))); } catch { threw = true; }
    assert.ok(threw, 'plain JSON round-tripped a snapshot cleanly — if this ever passes, the tagged format may be removable');
});

await check('buildTownExport carries identifying metadata outside the encoded blob', async () => {
    const file = await buildTownExport(w);
    assert.strictEqual(file.format, 'propagate-town');
    assert.strictEqual(file.seed, w.seed);
    assert.strictEqual(file.v, World.SAVE_VERSION);
    assert.ok(file.day >= 12, `day ${file.day}`);
    const back = decodeSnapshot(JSON.parse(JSON.stringify(file)).snap);
    World.fromSave(back);   // must hydrate
});

await check('a non-persisting session exports NOTHING (the quarantine-refusal contract)', async () => {
    const wq = new World(4208, 'human');
    wq._persistenceDisabled = true;
    assert.strictEqual(await buildTownExport(wq), null,
        'a session refusing to persist must not export the town it was refused over');
});

await check('import validates with the REAL hydrator and refuses what it cannot load', async () => {
    const hydrate = (s) => World.fromSave(s);
    for (const [file, label] of [
        [{ format: 'not-a-town' }, 'wrong format marker'],
        [{ format: 'propagate-town', snap: { v: 1 } }, 'no seed'],
        [{ format: 'propagate-town', snap: encodeSnapshot({ seed: 5, v: World.SAVE_VERSION + 1 }) }, 'newer schema than this build'],
        [{ format: 'propagate-town', snap: encodeSnapshot({ seed: 5, v: 'nope' }) }, 'unusable version'],
    ]) {
        const r = await importTownFile(file, hydrate);
        assert.strictEqual(r.ok, false, `${label} was accepted`);
    }
});

await check('a hydrator that MUTATES its input cannot poison the import', async () => {
    // migrate() mutates in place; importTownFile therefore validates a structuredClone. If it ever
    // validated the object it stores, a migration would run TWICE on imported saves. Provable
    // without IndexedDB: hydrate validates, then vandalises its argument — the import must still
    // proceed past validation to the write (which is what fails in Node, there being no IDB here).
    const file = await buildTownExport(w);
    let sawV = null;
    const hydrate = (s) => { sawV = s.v; const out = World.fromSave(structuredClone(s)); s.v = 999; s.snap = null; return out; };
    const r = await importTownFile(JSON.parse(JSON.stringify(file)), hydrate);
    assert.strictEqual(sawV, World.SAVE_VERSION, 'the validator never saw the snapshot');
    assert.strictEqual(r.ok, false);
    assert.match(r.error || '', /storage write failed/i,
        `the import should have reached the WRITE stage, got: ${JSON.stringify(r)}`);
});

await check('shapes the real snapshot happens to lack still round-trip (NaN, Infinity, $-keys)', () => {
    // Three mutations escaped because the matured snapshot contains none of these — coverage by
    // coincidence. Encode/decode are pure; test the shapes directly.
    const tricky = {
        seed: 1, nan: NaN, inf: Infinity, ninf: -Infinity,
        dollar: { $: 'i am data, not a tag', x: 1 },
        nested: new Map([['k', { $: 'M', v: 'spoofed tag as DATA' }]]),
    };
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(tricky))));
    assert.ok(Number.isNaN(back.nan), `NaN became ${back.nan}`);
    assert.strictEqual(back.inf, Infinity);
    assert.strictEqual(back.ninf, -Infinity);
    assert.deepStrictEqual(back.dollar, { $: 'i am data, not a tag', x: 1 });
    assert.deepStrictEqual(back.nested.get('k'), { $: 'M', v: 'spoofed tag as DATA' },
        'a $-keyed object INSIDE a Map was decoded as a tag instead of data');
});

await check('parseTownFile stores a snapshot the validator never touched (pure, so provable)', async () => {
    // The double-migration hazard, now assertable without IndexedDB: the returned snap must not be
    // the object hydrate saw, and vandalising hydrate's argument must not reach the returned snap.
    const file = JSON.parse(JSON.stringify(await buildTownExport(w)));
    let seen = null;
    const r = parseTownFile(file, (s) => { seen = s; World.fromSave(structuredClone(s)); s.v = 999; s.farmers = null; });
    assert.strictEqual(r.ok, true);
    assert.notStrictEqual(r.snap, seen, 'the validator was handed the object that gets stored');
    assert.strictEqual(r.snap.v, World.SAVE_VERSION, `the stored snapshot was mutated by validation: v=${r.snap.v}`);
    assert.ok(r.snap.farmers, 'the stored snapshot lost a field to validation');
});

await check('non-canonical seeds are refused — World would hydrate them under a DIFFERENT slot', async () => {
    // World canonicalizes seed >>> 0, so 1.5, -1 and 2^32+1 pass a finite check, hydrate as 1,
    // 4294967295 and 1, and the import then stores the town under a key its own saves never address.
    const base = await buildTownExport(w);
    for (const badSeed of [1.5, -1, 4294967297, Number.MAX_SAFE_INTEGER]) {
        const file = JSON.parse(JSON.stringify(base));
        const snap = decodeSnapshot(file.snap); snap.seed = badSeed; file.snap = encodeSnapshot(snap); file.seed = badSeed;
        // A hydrator that returns NOTHING, on purpose: the belt (hydrated.seed !== snap.seed) only
        // runs when the hydrator hands back a world, so with a void hydrator the uint32 check is the
        // ONLY line refusing these. A mutation reverting it to finite-only escaped the first version
        // of this case, which was passing on the belt instead of the braces.
        const r = parseTownFile(file, () => undefined);
        assert.strictEqual(r.ok, false, `seed ${badSeed} was accepted by the seed check itself`);
        // ...and with the real hydrator the belt agrees
        const r2 = parseTownFile(JSON.parse(JSON.stringify(file)), (x) => World.fromSave(x));
        assert.strictEqual(r2.ok, false, `seed ${badSeed} was accepted end to end`);
    }
});

await check('the envelope must AGREE with the snapshot it previews (the confirm beat shows the envelope)', async () => {
    const hydrate = (s) => World.fromSave(structuredClone(s));
    const base = await buildTownExport(w);
    for (const [mutate, label] of [
        [(f) => { f.formatV = 999; }, 'future formatV'],
        [(f) => { f.seed = 999999; }, 'preview seed lies'],
        [(f) => { f.town = 'HARMLESS PREVIEW'; }, 'preview name lies'],
        [(f) => { f.day = 1; }, 'preview day lies'],
        [(f) => { f.v = 99; }, 'preview schema lies'],
    ]) {
        const file = JSON.parse(JSON.stringify(base));
        mutate(file);
        const r = parseTownFile(file, hydrate);
        assert.strictEqual(r.ok, false, `${label} was accepted`);
    }
    // and the unmutated file must still pass, or this passes by refusing everything
    assert.strictEqual(parseTownFile(JSON.parse(JSON.stringify(base)), hydrate).ok, true);
});

await check('corrupt multi-byte typed arrays are REFUSED, not silently truncated', () => {
    // Three bytes as Uint16Array used to yield a one-element view with the third byte outside it —
    // corruption altered data instead of failing.
    const enc = encodeSnapshot(new Uint16Array([7, 9]));
    enc.v = btoa('abc');   // 3 bytes: not divisible by 2
    let threw = false;
    try { decodeSnapshot(enc); } catch { threw = true; }
    assert.ok(threw, '3 bytes decoded as Uint16Array without complaint');
});

await check('memory rows ride the export and REPLACE the seed\'s rows on import (Codex #121 repro)', async () => {
    // The reproduced bug: a different town imported onto the same seed kept exposing the displaced
    // town\'s lives. Stage OLD_* rows for the seed, import a file carrying NEW_* rows, and the
    // portal must show only NEW_*.
    memRows.clear();
    memRows.set(`life:${w.seed}:111`, { kind: 'life', townSeed: w.seed, life: { seed: 111, name: 'OLD_RESIDENT' } });
    memRows.set(`town:${w.seed}`, { kind: 'town', townSeed: w.seed, history: ['OLD_HISTORY'] });
    memRows.set('battle:r77', { kind: 'battle', townSeed: w.seed, battle: { rid: 'r77', tale: 'OLD_BATTLE' } });
    memRows.set('life:424242:5', { kind: 'life', townSeed: 424242, life: { name: 'NEIGHBOUR — MUST SURVIVE' } });

    const exported = await buildTownExport(w);   // carries the OLD rows (they are the seed's rows right now)
    const carried = decodeSnapshot(JSON.parse(JSON.stringify(exported)).memories);
    assert.strictEqual(carried.length, 3, `expected 3 town rows in the file, got ${carried.length}`);
    assert.ok(!JSON.stringify(carried).includes('NEIGHBOUR'), 'another town\'s row rode the export');

    // simulate the import-side replacement directly (the IDB slot write cannot run in Node):
    // stage DIFFERENT rows as the displaced occupant — one at a key the file also carries, and one
    // at a key it does NOT. The second is the one that matters: a replacement that only overwrites
    // (never deletes) leaves it behind, and a first version of this case used only shared keys, so
    // exactly that mutation escaped.
    memRows.set(`life:${w.seed}:111`, { kind: 'life', townSeed: w.seed, life: { seed: 111, name: 'DISPLACED_RESIDENT' } });
    memRows.set(`life:${w.seed}:222`, { kind: 'life', townSeed: w.seed, life: { seed: 222, name: 'EXTRA_RESIDENT' } });
    const wrote = await replaceTownMemoryRows(w.seed, carried);
    assert.strictEqual(wrote, 3);
    const after = await townMemoryRows(w.seed);
    const dump = JSON.stringify(after);
    assert.ok(dump.includes('OLD_RESIDENT') && !dump.includes('DISPLACED_RESIDENT'),
        'the displaced town\'s rows survived the import');
    assert.ok(!dump.includes('EXTRA_RESIDENT'),
        'a displaced row at a key the file does not carry survived — replacement is overwriting, not replacing');
    assert.ok(memRows.has('life:424242:5'), 'replacement deleted another town\'s rows');
});

await check('a crafted file cannot write rows into ANOTHER town\'s memories', async () => {
    memRows.clear();
    const wrote = await replaceTownMemoryRows(w.seed, [
        [`life:${w.seed}:9`, { kind: 'life', townSeed: w.seed, life: { seed: 9, name: 'LEGIT' } }],
        ['life:999999:1', { kind: 'life', townSeed: 999999, life: { name: 'FOREIGN' } }],
        ['battle:rX', { kind: 'battle', townSeed: 999999, battle: { tale: 'FOREIGN BATTLE' } }],
        ['latest', { evil: true }],
    ]);
    assert.strictEqual(wrote, 1, `wrote ${wrote} rows — the ownership filter is leaking`);
    assert.ok(!memRows.has('life:999999:1') && !memRows.has('battle:rX') && !memRows.has('latest'));
});

await check('a memory row whose DOCUMENT claims another town refuses the whole file (Codex r2)', async () => {
    // Reproduced: life:<target>:9 carrying townSeed 999999 inside the document — the key said one
    // owner, the document another, and the portal believed the document.
    const base = await buildTownExport(w);
    const file = JSON.parse(JSON.stringify(base));
    const rows = decodeSnapshot(file.memories);
    rows.push([`life:${w.seed}:13`, { kind: 'life', townSeed: 999999, life: { seed: 13, name: 'SMUGGLED' } }]);
    file.memories = encodeSnapshot(rows);
    const r = parseTownFile(file, (x) => World.fromSave(x));
    assert.strictEqual(r.ok, false, 'a document claiming another town was accepted');
});

await check('corrupt memories REFUSE the file; ABSENT memories import the town alone (Codex r2)', async () => {
    const base = await buildTownExport(w);
    // present-but-corrupt: an unknown future tag — used to become [] and DELETE the slot's rows
    const bad = JSON.parse(JSON.stringify(base));
    bad.memories = { $: 'FUTURE_MEMORY_TAG' };
    assert.strictEqual(parseTownFile(bad, (x) => World.fromSave(x)).ok, false, 'corrupt memories were accepted as empty');
    // absent: legal, and parse says "leave the device rows alone" via memories: null
    const trimmed = JSON.parse(JSON.stringify(base));
    delete trimmed.memories; delete trimmed.memoriesIncomplete;
    const r = parseTownFile(trimmed, (x) => World.fromSave(x));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.memories, null, 'absence must be distinguishable from an empty list');
});

await check('#memfence: a stale tab cannot revert imported memory rows', async () => {
    // Reproduced by Codex: replace a life with NEW under the import, then an ordinary stale
    // storePayload put STALE back. The floor written by the replacement refuses writers below it.
    memRows.clear();
    await replaceTownMemoryRows(w.seed, [
        [`life:${w.seed}:1`, { kind: 'life', townSeed: w.seed, life: { seed: 1, name: 'NEW' } }],
    ], 5);   // the import wrote generation 5
    const stale = await storePayload({ town: 'OLD TAB', townSeed: w.seed, gen: 4, rev: 9,
        farmers: [{ seed: 1, name: 'STALE' }] });
    assert.ok(stale && stale.stale === true && !stale.written, `a gen-4 writer got past a gen-5 floor: ${JSON.stringify(stale)}`);
    assert.ok(JSON.stringify([...memRows.values()]).includes('NEW'), 'the imported row was reverted');
    // ...and the CURRENT session (at or above the floor) still writes — else the fence bricks the store
    const live = await storePayload({ town: 'LIVE', townSeed: w.seed, gen: 5, rev: 10,
        farmers: [{ seed: 1, name: 'LIVE_UPDATE' }] });
    assert.ok(live && live.written > 0, `the live writer was refused by its own floor: ${JSON.stringify(live)}`);
});

await check('the fence row itself never rides an export', async () => {
    // memgen is a fence, not a document — exporting it would carry one town's floor into another
    // browser's store.
    const rows = await townMemoryRows(w.seed);
    assert.ok(!rows.some(([k]) => String(k).startsWith('memgen:')), 'the fence rode the export');
});

await check('replacement is ALL-OR-NOTHING when the backend is atomic (Codex r2)', async () => {
    // Reproduced: per-op transactions let a quota failure mid-delete leave one old life among the
    // new rows. With an atomic backend, a failure must leave the store untouched.
    const atomicStore = new Map([[`life:${w.seed}:1`, { kind: 'life', townSeed: w.seed, life: { seed: 1, name: 'BEFORE' } }]]);
    let fail = true;
    _setBackendForTests({
        put: async () => { throw new Error('direct put unused here'); },
        del: async () => { throw new Error('direct del unused here'); },
        all: async () => [...atomicStore.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
        replaceTown: async (delKeys, puts) => {
            if (fail) throw new Error('quota');
            for (const k of delKeys) atomicStore.delete(k);
            for (const [k, v] of puts) atomicStore.set(k, v);
        },
    });
    await assert.rejects(() => replaceTownMemoryRows(w.seed, [
        [`life:${w.seed}:2`, { kind: 'life', townSeed: w.seed, life: { seed: 2, name: 'AFTER' } }],
    ], 7));
    assert.ok(atomicStore.has(`life:${w.seed}:1`), 'a failed atomic replacement still deleted rows');
    fail = false;
    await replaceTownMemoryRows(w.seed, [
        [`life:${w.seed}:2`, { kind: 'life', townSeed: w.seed, life: { seed: 2, name: 'AFTER' } }],
    ], 7);
    assert.ok(!atomicStore.has(`life:${w.seed}:1`) && atomicStore.has(`life:${w.seed}:2`));
    // restore the shared fake for any later case
    _setBackendForTests({
        put: async (k, v) => { memRows.set(k, v); },
        del: async (k) => { memRows.delete(k); },
        all: async () => [...memRows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    });
});

await check('a PARTIAL export is disclosed, and its import leaves the device rows alone', async () => {
    // The memory store being unreadable must not produce a file that LOOKS like a complete backup —
    // battle docs are irreconstructible, so "complete" is a promise the file could not keep.
    _setBackendForTests({ put: async () => {}, del: async () => {}, all: async () => { throw new Error('store unreachable'); } });
    const file = await buildTownExport(w);
    assert.strictEqual(file.memoriesIncomplete, true, 'a failed memory read produced a file claiming completeness');
    _setBackendForTests({
        put: async (k, v) => { memRows.set(k, v); },
        del: async (k) => { memRows.delete(k); },
        all: async () => [...memRows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    });
    const r = parseTownFile(JSON.parse(JSON.stringify(file)), (x) => World.fromSave(x));
    assert.strictEqual(r.ok, true, 'a partial file must still import its town');
    assert.strictEqual(r.memoriesIncomplete, true, 'the partial flag must survive parsing');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('The town file would not survive the trip.'); process.exit(1); }
console.log('Save export: clone-only shapes round-trip, hydration validates, refusals hold.');
process.exit(0);
