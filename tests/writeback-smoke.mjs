// #local-memory — SMOKE the three memory-writeback entry points end-to-end (Codex #90 P0: an
// amendment deleted the writers' support block and every entry point threw ReferenceError on its
// first line, while the queue-only test stayed green — module-level coverage of the actual
// exported writers is the regression net).
// Run: node tests/writeback-smoke.mjs
import { persistLives, persistTownHistory, persistBattle } from '../memory-writeback.js';
import { _setBackendForTests } from '../memory-store.js';

const mem = new Map();
_setBackendForTests({
    put: async (k, v) => { mem.set(k, v); },
    del: async (k) => { mem.delete(k); },
    all: async () => [...mem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
});
globalThis.fetch = () => Promise.resolve({ ok: true });   // the echo lands silently

let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

function stubFarmer(seed, name) {
    return {
        sheet: { seed, name, archetype: 'builder', dream: { yearn: 'a roof' }, memory: { title: 'The first frost', id: 'doc1' } },
        journal: [{ text: 'stood with Truss at the fence', strength: 3 }, { text: 'the storm took the north field', strength: 2 }, { text: 'planted the first row', strength: 1 }],
        creeds: [{ quote: 'I hold the line', short: 'hold' }],
        beliefs: [{ text: 'second place is just the first to be forgotten' }],
    };
}
const logs = [];
const world = {
    name: 'SMOKETON', seed: 4242, day: 5, year: 1, _rev: 5,
    farmers: [stubFarmer(1, 'Mercurial Mason'), stubFarmer(2, 'Truss Ashfell')],
    roles: { manager: 1, managerTerms: 1, watch: 2, history: [{ office: 'manager', name: 'Mercurial Mason', fromYear: 1 }] },
    raidsSuffered: 1, learned: 'the fence holds', nemesis: null, nemesisLog: [],
    addLog: (t) => logs.push(t),
};

console.log('1 — persistLives runs, stamps on local success, stores the docs');
{
    const stamped = await persistLives(world, () => true);
    ok(stamped === 2, `stamped both lives (${stamped})`);
    ok(world.farmers.every(f => f.sheet.lifePersisted && f.sheet.lifeSig), 'lifePersisted + lifeSig stamped');
    ok(mem.has('life:4242:1') && mem.has('life:4242:2'), 'both life docs in the store');
    ok(logs.some(t => /long memory/.test(t)), 'the on-screen receipt fired');
    const again = await persistLives(world, () => true);
    ok(again === 0, 'unchanged lives are not re-persisted (sig gate)');
}

console.log('2 — persistTownHistory runs and stores the civic record');
{
    const wrote = await persistTownHistory(world, () => true);
    ok(wrote === true, 'history written');
    ok(mem.has('town:4242'), 'town doc in the store');
    ok(await persistTownHistory(world, () => true) === false, 'unchanged record is not re-posted (signature gate)');
}

console.log('3 — persistBattle runs, stores, and dedupes by rid');
{
    const battle = { rid: 'smoke-1', day: 5, year: 1, clan: 'the Ashfang clan', outcome: { felled: 1, harvestLost: 3 }, hero: 'Mercurial', rounds: [] };
    ok(await persistBattle(world, battle) === true, 'battle written');
    ok(mem.has('battle:smoke-1'), 'battle doc in the store');
    ok(await persistBattle(world, { ...battle }) === false, 'same rid refused (one shot per raid)');
}

console.log('4 — the persistence-disabled guard silences all three');
{
    mem.clear();
    const ghost = { ...world, _persistenceDisabled: true, farmers: [stubFarmer(9, 'Ghost Writer')] };
    ok(!(await persistLives(ghost, () => true)), 'lives silent');   // the guard path returns false (pre-existing), the success path numbers
    ok(await persistTownHistory(ghost, () => true) === false, 'history silent');
    ok(await persistBattle(ghost, { rid: 'ghost-1' }) === false, 'battle silent');
    ok(mem.size === 0, 'nothing touched the store');
}

console.log(pass ? '\nwriteback-smoke: PASS' : '\nwriteback-smoke: FAIL');
process.exit(pass ? 0 : 1);
