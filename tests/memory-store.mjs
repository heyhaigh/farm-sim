// #local-memory — the browser memory store's contract, tested with an injected Map backend (node
// has no IndexedDB; the IDB glue is a thin adapter over the same {put,del,all} surface).
// Run: node tests/memory-store.mjs
import { storePayload, localLineage, mergeLineage, localLifeCount, localGraphTowns, lifeToLineage, _setBackendForTests } from '../memory-store.js';

const mem = new Map();
// the fake mirrors REAL IndexedDB semantics: getAllKeys returns KEY-SORTED order, not insertion
// order — the #88 tie-eviction repro depends on exactly that (a lexically-early incoming key).
const sortedAll = async () => [...mem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
_setBackendForTests({
    put: async (k, v) => { mem.set(k, v); },
    del: async (k) => { mem.delete(k); },
    all: sortedAll,
});
let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

const life = (seed, name, creeds = ['I hold the line'], extra = {}) => ({
    seed, name, archetype: 'builder', dream: 'a roof of my own', sourceTitle: 'The first frost',
    creeds, beliefs: ['second place is just the first to be forgotten'],
    episodic: [`${name.split(' ')[0]} stood with Truss at the fence`, 'the storm took the north field'], ...extra,
});

console.log('A — lives round-trip into lineage entries (the knowledge-graph parser shape)');
{
    const r = await storePayload({ town: 'ASHMARCH', townSeed: 42, rev: 3, farmers: [life(101, 'Mercurial Mason'), life(102, 'Truss Ashfell')] });
    ok(r && r.written && r.persisted.length === 2, 'two lives written, both acknowledged');
    const lin = await localLineage();
    ok(lin.length === 2, `lineage carries both (${lin.length})`);
    const m = lin.find(l => l.name === 'Mercurial Mason');
    ok(!!m && m.id === 'ry-farms:42:101' && m.townSeed === '42' && m.farmerSeed === '101', 'identity fields are strings on the customId convention');
    ok(m.creed === 'I hold the line' && m.archetype === 'builder' && m.dream === 'a roof of my own' && m.town === 'ASHMARCH', 'creed/archetype/dream/town carried');
    ok(await localLifeCount() === 2, 'life count = 2');
}

console.log('B — upsert: a re-persisted life overwrites, never duplicates');
{
    await storePayload({ town: 'ASHMARCH', townSeed: 42, rev: 5, farmers: [life(101, 'Mercurial Mason', ['I carry what Truss believed'])] });
    const lin = await localLineage();
    ok(lin.length === 2, 'still two entries after re-persist');
    ok(lin.find(l => l.farmerSeed === '101').creed === 'I carry what Truss believed', 'the LIVING life won (creed refreshed)');
}

console.log('C — a life without a creed is not lineage (heirs need a creed to carry)');
{
    ok(lifeToLineage({ townSeed: '7', town: 'X', life: life(1, 'No Creed', []) }) === null, 'creedless life -> null');
    ok(lifeToLineage({ townSeed: '7', town: 'X', life: null }) === null, 'missing life -> null');
}

console.log('D — mergeLineage dedups by identity, stable order');
{
    const server = [{ id: 'zzz-doc-uuid', townSeed: '42', farmerSeed: '101', name: 'Mercurial Mason', creed: 'server copy' }];
    const merged = mergeLineage(server, await localLineage());
    ok(merged.length === 2, `server duplicate of 42:101 collapsed (${merged.length})`);
    ok(merged.find(l => l.farmerSeed === '101').creed === 'server copy', 'first source (server) wins the identity');
    const ids = merged.map(l => String(l.id));
    ok(JSON.stringify(ids) === JSON.stringify([...ids].sort()), 'stable id-sorted order (deterministic heir pairing)');
}

console.log('E — caps evict the OLDEST lives first');
{
    mem.clear();
    for (let k = 0; k < 30; k++) mem.set(`life:1:${k}`, { kind: 'life', townSeed: '1', town: 'OLD', updatedAt: 1000 + k, life: life(k, `Old Soul${k}`) });
    // a write that lands 600 fresh lives (the cap) must evict the 30 old ones
    const farmers = []; for (let k = 0; k < 600; k++) farmers.push(life(1000 + k, `New Soul${k}`));
    await storePayload({ town: 'NEW', townSeed: 2, rev: 1, farmers });
    const count = await localLifeCount();
    ok(count === 600, `cap held at 600 (${count})`);
    ok(![...mem.keys()].some(k => String(k).startsWith('life:1:')), 'the oldest (by updatedAt) were the evicted');
}

console.log('E2 — Codex #88: an updatedAt TIE must never evict the just-written row');
{
    mem.clear();
    // 600 existing rows at the SAME timestamp, all with keys lexically AFTER the incoming one —
    // a key-ordered backend + tie-blind eviction deleted the acknowledged write (the #88 repro).
    const T = 5000;
    for (let k = 0; k < 600; k++) mem.set(`life:9:${String(k + 10).padStart(4, '0')}`, { kind: 'life', townSeed: '9', town: 'FULL', updatedAt: T, life: life(k + 10, `Soul${k}`) });
    const origNow = Date.now; Date.now = () => T;   // force the tie
    let r;
    try { r = await storePayload({ town: 'FULL', townSeed: 0, rev: 1, farmers: [life(0, 'Fresh Soul')] }); }
    finally { Date.now = origNow; }
    ok(r && r.written && r.persisted.includes(0), 'the write was acknowledged');
    ok(mem.has('life:0:0'), 'the acknowledged row SURVIVES the tie eviction');
    ok(await localLifeCount() === 600, `cap still held (${await localLifeCount()})`);
}

console.log('E3 — a rejecting backend must never yield written:true (the tx-commit contract)');
{
    // simulates a transaction that ABORTS AFTER request success: put resolves are not enough —
    // the real backend acknowledges only tx.oncomplete, so an abort surfaces as a rejection here.
    _setBackendForTests({ put: async () => { throw new Error('tx aborted before commit'); }, del: async () => {}, all: async () => [] });
    const r = await storePayload({ town: 'X', townSeed: 1, farmers: [life(1, 'Ghost Write')] });
    ok(r === null, 'aborted commit -> null (nothing stamped for data that never landed)');
    _setBackendForTests({ put: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); }, all: sortedAll });
}

console.log('F — the portal towns[] shape from local docs');
{
    mem.clear();
    await storePayload({ town: 'ASHMARCH', townSeed: 42, rev: 3, farmers: [life(101, 'Mercurial Mason'), life(102, 'Truss Ashfell')] });
    await storePayload({ town: 'ASHMARCH', townSeed: 42, townHistory: { manager: 'Mercurial Mason', managerTerms: 1, watch: 'Truss Ashfell', year: 1, history: [{ office: 'manager', name: 'Mercurial Mason', fromYear: 1 }], raidsSuffered: 2, learned: 'the fence holds', wars: { current: { name: 'Krul the Howler', raidCount: 2 }, past: [] } } });
    await storePayload({ town: 'ASHMARCH', townSeed: 42, battle: { rid: 'r1', day: 4, year: 1, clan: 'the Ashfang clan', outcome: { felled: 2, harvestLost: 9 }, hero: 'Mercurial' } });
    await storePayload({ town: 'ASHMARCH', townSeed: 42, townInventions: { recipes: [{ id: 'salve', name: 'Vital Salve of Honey', inventor: 'Pudding Willowes', lore: 'sweetness that mends' }] } });
    const towns = await localGraphTowns();
    ok(towns.length === 1 && String(towns[0].seed) === '42', 'one town, keyed by seed');
    const t = towns[0];
    ok(t.farmers.length === 2 && t.farmers.every(f => f.memories.length >= 3), 'farmers carry creeds+beliefs+episodic as memories');
    ok(t.links.some(l => l.label === 'stood by'), `mention heuristic built a labelled tie (${JSON.stringify(t.links)})`);
    ok(/2 raids/.test(t.townHistory) && /Krul the Howler/.test(t.townHistory), 'civic history text names the raids + the war');
    ok(t.battles.length === 1 && /2 raiders felled/.test(t.battles[0].text) && t.battles[0].foe === 'the Ashfang clan', 'battle doc rendered');
    ok(t.inventions.length === 1 && /Pudding Willowes/.test(t.inventions[0]), 'invention book rendered');
}

console.log('G — refusal shapes: no townSeed -> null; a failing backend -> null (treated as store-down)');
{
    ok(await storePayload({ town: 'X', farmers: [life(1, 'A B')] }) === null, 'missing townSeed refused');
    _setBackendForTests({ put: async () => { throw new Error('quota'); }, del: async () => {}, all: async () => [] });
    ok(await storePayload({ town: 'X', townSeed: 9, farmers: [life(1, 'A B')] }) === null, 'backend failure -> null, never throws');
}

console.log(pass ? '\nmemory-store: PASS' : '\nmemory-store: FAIL');
process.exit(pass ? 0 : 1);
