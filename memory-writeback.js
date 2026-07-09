// memory-writeback.js — client side of the memory loop's write half (#91).
//
// Sends each farmer's COMPILED inner life — creeds (inherited from their source doc), beliefs (earned
// from a lived life), and a few of their strongest episodic memories — to /api/memory-writeback, which
// persists them into self-hosted SuperMemory. Off the sim loop, best-effort, display/persistence only:
// the seeded world never reads these back, so determinism is untouched whether or not SuperMemory ever
// answers. Each farmer is persisted ONCE (stamped sheet.lifePersisted, which rides the save); while
// SuperMemory is unreachable (nothing lands) nothing is stamped, so it simply retries later and finally
// captures each life the first time the store is up.

const ENDPOINT = '/api/memory-writeback';
const TIMEOUT_MS = 20000;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let inflight = false;
let lastFailAt = -Infinity;

function lifeOf(f) {
    const s = f.sheet;
    const episodic = (s.journal || []).slice().sort((a, b) => b.strength - a.strength).slice(0, 12).map(m => m.text);
    return {
        seed: s.seed,
        name: s.name,
        archetype: s.archetype,
        dream: s.dream ? s.dream.yearn : null,
        sourceTitle: (s.memory && s.memory.title) || null,
        sourceDocId: (s.memory && s.memory.id) || null,
        creeds: (f.creeds || []).map(c => c.quote || c.short).filter(Boolean),
        beliefs: (f.beliefs || []).map(b => b.text),
        episodic,
    };
}

// Persist every not-yet-persisted farmer's life. `isCurrent` guards a response landing after a NEW-town
// reset. Returns the count stamped this pass (0 = nothing to do, or the store was unreachable).
export async function persistLives(world, isCurrent = () => true) {
    if (typeof fetch !== 'function' || inflight) return 0;
    if (Date.now() - lastFailAt < RETRY_COOLDOWN_MS) return 0;
    const pending = world.farmers.filter(f => !f.sheet.lifePersisted);
    if (!pending.length) return 0;

    inflight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ town: world.name || 'RY FARMS', townSeed: world.seed, farmers: pending.map(lifeOf) }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`writeback ${res.status}`);
        const data = await res.json();
        if (!isCurrent()) return 0;                          // town was reset mid-write
        if (!data || !data.written) { lastFailAt = Date.now(); return 0; }   // store offline — retry later, stamp nothing

        const landed = new Set(data.persisted || []);
        let stamped = 0;
        for (const f of pending) if (landed.has(f.sheet.seed)) { f.sheet.lifePersisted = true; stamped++; }
        if (stamped) world.addLog(`${stamped} settlers' lives were set down in the town's long memory.`, '#8ad0e0');
        return stamped;
    } catch (err) {
        lastFailAt = Date.now();
        console.warn('ry-farms: memory writeback unavailable (lives stay local)', err?.message || err);
        return 0;
    } finally {
        clearTimeout(timer);
        inflight = false;
    }
}
