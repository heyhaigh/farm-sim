// #memory-backfill — existing saved towns seed the browser memory store (owner: players with
// living worlds saw "no memories" though their saves hold names, creeds, civic records, recipes).
// Real Worlds are grown + serialized, then fed through the injectable IO; the store is a Map fake.
// Run: node tests/memory-backfill.mjs
import { backfillMemory } from '../memory-backfill.js';
import { localLineage, localLifeCount, localGraphTowns, _setBackendForTests } from '../memory-store.js';
import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const mem = new Map();
const sortedAll = async () => [...mem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
_setBackendForTests({ put: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); }, all: sortedAll });
globalThis.fetch = () => { throw new Error('backfill must NEVER echo to the server'); };

let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

const DT = 1 / 30;
function grow(seed, culture, days) {
    const m = generateCrew(seed); const used = new Set();
    const pick = () => { const un = m.filter(x => !used.has(x.id)); let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } } used.add(b.id); return b; };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    let g = 90000; while (w.day < days && g-- > 0) w.tick(DT);
    return w;
}
// two saved towns: one mature (civic record), one day-1 thin (the throttle would have skipped it —
// backfill must NOT: founding creeds are already an identity worth representing)
const wA = grow(42, 'human', 3);
const wB = grow(7, 'orc', 1);
const snaps = new Map([[String(wA.seed), structuredClone(wA.serialize())], [String(wB.seed), structuredClone(wB.serialize())]]);
const io = {
    loadIndex: async () => ({ towns: { [String(wA.seed)]: {}, [String(wB.seed)]: {} } }),
    loadState: async (seed) => ({ ok: true, snap: snaps.get(String(seed)) || null, gen: 1, seed }),
    rotationNonce: 0,
};

console.log('A — both existing towns backfill: lives, lineage, portal presence');
{
    const n = await backfillMemory({ io });
    ok(n === 2, `two towns backfilled (${n})`);
    ok(await localLifeCount() === 16, `all 16 farmers represented (${await localLifeCount()}) — the thin day-1 town INCLUDED`);
    const lin = await localLineage();
    ok(lin.length === 16, `all lives are lineage (founding creeds carry) (${lin.length})`);
    const towns = await localGraphTowns();
    ok(towns.length === 2, `the portal shows both towns (${towns.length})`);
    ok(towns.every(t => t.farmers.length === 8 && t.farmers.every(f => f.name && f.memories.length >= 1)), 'every farmer named with at least a creed as memory');
}

console.log('B — idempotent: a second sweep claims nothing');
{
    const n = await backfillMemory({ io });
    ok(n === 0, `second sweep backfilled ${n} (store already owns both towns)`);
}

console.log('C — the per-boot bound holds and self-heals across sweeps');
{
    mem.clear();
    const n1 = await backfillMemory({ io, maxTowns: 1 });
    ok(n1 === 1, `bounded sweep took one town (${n1})`);
    const n2 = await backfillMemory({ io, maxTowns: 1 });
    ok(n2 === 1, `next sweep healed the remainder (${n2})`);
    ok(await localLifeCount() === 16, 'both towns present after the second sweep');
}

console.log('D — a corrupt snapshot never blocks the sweep');
{
    mem.clear();
    const badIo = {
        loadIndex: async () => ({ towns: { '999': {}, [String(wA.seed)]: {} } }),
        loadState: async (seed) => String(seed) === '999' ? { ok: true, snap: { garbage: true }, gen: 1, seed } : io.loadState(seed),
        rotationNonce: 0,
    };
    const n = await backfillMemory({ io: badIo });
    ok(n === 1, `the good town landed despite the corrupt one (${n})`);
}

console.log('E — a refusing store claims no towns (retry next boot, no false ownership)');
{
    mem.clear();
    _setBackendForTests({ put: async () => { throw new Error('quota'); }, del: async () => {}, all: sortedAll });
    const n = await backfillMemory({ io });
    ok(n === 0, `nothing claimed against a refusing store (${n})`);
    _setBackendForTests({ put: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); }, all: sortedAll });
}

console.log('F — the active town completes: thin farmers land even where SOME lives exist');
{
    mem.clear();
    // the live cadence wrote only 2 of 8 farmers (the matured ones) — the sweep skips the town
    // (lives exist), and without the completion pass the other 6 would wait on the throttle forever
    const partial = { town: wA.name || 'PROPAGATE', townSeed: wA.seed, rev: 3,
        farmers: wA.farmers.slice(0, 2).map(f => ({ seed: f.sheet.seed, name: f.sheet.name, archetype: f.sheet.archetype, creeds: ['live-cadence copy'], beliefs: ['x'], episodic: ['a','b','c'] })) };
    const { storePayload } = await import('../memory-store.js');
    await storePayload(partial);
    const n = await backfillMemory({ io: { loadIndex: io.loadIndex, loadState: io.loadState, rotationNonce: 0 }, activeWorld: wA });
    ok(n >= 1, `completion pass ran (${n})`);
    const lin = await localLineage();
    const mine = lin.filter(l => l.townSeed === String(wA.seed));
    ok(mine.length === 8, `all 8 active-town farmers represented (${mine.length})`);
    const kept = mine.find(l => l.farmerSeed === String(wA.farmers[0].sheet.seed));
    ok(kept && kept.creed === 'live-cadence copy', 'the cadence-written doc was NOT overwritten (fresher copy kept)');
}

console.log('G — a spectator active world is never completed');
{
    mem.clear();
    const ghost = { ...wA, _persistenceDisabled: true, farmers: wA.farmers, seed: wA.seed, name: wA.name };
    await backfillMemory({ io: { loadIndex: async () => ({ towns: {} }), loadState: io.loadState }, activeWorld: ghost });
    ok(await localLifeCount() === 0, 'nothing written for a persistence-disabled session');
}

console.log('H — Codex #92 P1: a mid-batch failure never leaves a town PERMANENTLY partial');
{
    mem.clear();
    // the store dies after 3 successful puts (Codex left 1 of 8 lives + a skip forever)
    let putBudget = 3;
    _setBackendForTests({ put: async (k, v) => { if (putBudget-- <= 0) throw new Error('quota mid-batch'); mem.set(k, v); }, del: async (k) => { mem.delete(k); }, all: sortedAll });
    const n1 = await backfillMemory({ io });
    ok(n1 === 0, `the failed claim reported no town (${n1})`);
    const partial = await localLifeCount();
    ok(partial > 0 && partial < 16, `rows landed partially (${partial}) — the repro's precondition`);
    // next boot, the store recovered — the town must COMPLETE, not be skipped
    _setBackendForTests({ put: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); }, all: sortedAll });
    const n2 = await backfillMemory({ io });
    ok(n2 === 2, `the recovered boot claimed both towns (${n2})`);
    ok(await localLifeCount() === 16, `every life present after recovery (${await localLifeCount()})`);
    ok((await backfillMemory({ io })) === 0, 'and the markers make the third sweep a no-op');
}

console.log('I — Codex #92 P2: hydration ATTEMPTS consume the budget (corrupt entries cannot blow it)');
{
    mem.clear();
    let stateCalls = 0;
    const towns = {}; for (let k = 0; k < 20; k++) towns['9' + String(k).padStart(3, '0')] = {};
    const corruptIo = {
        loadIndex: async () => ({ towns }),
        loadState: async (seed) => { stateCalls++; return { ok: true, snap: { garbage: true }, gen: 1, seed }; },
        rotationNonce: 0,
    };
    await backfillMemory({ io: corruptIo, maxTowns: 6 });
    ok(stateCalls === 6, `exactly the budget's worth of hydration attempts (${stateCalls}, was 20 pre-fix)`);
    // rotation: a different boot nonce starts the sweep elsewhere — the tail gets its turn
    stateCalls = 0; const seen = new Set();
    const trackIo = { ...corruptIo, loadState: async (seed) => { stateCalls++; seen.add(String(seed)); return { ok: true, snap: { garbage: true }, gen: 1, seed }; } };
    await backfillMemory({ io: { ...trackIo, rotationNonce: 0 }, maxTowns: 6 });
    await backfillMemory({ io: { ...trackIo, rotationNonce: 10 }, maxTowns: 6 });
    ok(seen.size === 12, `two boots with different nonces reached 12 distinct towns (${seen.size})`);
}

console.log('J — Codex #92 P2: the completion pass runs even with an EMPTY index (pre-first-autosave)');
{
    mem.clear();
    const n = await backfillMemory({ io: { loadIndex: async () => ({ towns: {} }), loadState: io.loadState, rotationNonce: 0 }, activeWorld: wA });
    ok(n === 1, `the active world completed despite the empty index (${n})`);
    ok(await localLifeCount() === 8, `all 8 farmers of the unsaved town represented (${await localLifeCount()})`);
}

console.log(pass ? '\nmemory-backfill: PASS' : '\nmemory-backfill: FAIL');
process.exit(pass ? 0 : 1);
