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

// #94 P3: the town's evolving civic record is persisted separately from the one-shot farmer lives, because
// it KEEPS CHANGING (each election adds a term) long after every farmer has been written once. Re-posts
// only when the record actually changes (a cheap signature), upserting a single town-history document.
let historyInflight = false;
let lastHistorySig = null;
let lastHistoryFailAt = -Infinity;
function historySignature(world) {
    const r = world.roles || {};
    return `${(r.history || []).length}:${r.manager}:${r.watch}:${r.managerTerms}:${world.year}`;
}
export async function persistTownHistory(world, isCurrent = () => true) {
    if (typeof fetch !== 'function' || historyInflight) return false;
    if (Date.now() - lastHistoryFailAt < RETRY_COOLDOWN_MS) return false;
    const r = world.roles;
    if (!r || (!r.history?.length && r.manager == null)) return false;   // nothing civic to remember yet
    const sig = historySignature(world);
    if (sig === lastHistorySig) return false;                            // unchanged since last successful write

    historyInflight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const nameOf = seed => { const f = world.farmers.find(x => x.sheet.seed === seed); return f ? f.sheet.name : null; };
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ town: world.name || 'RY FARMS', townSeed: world.seed, townHistory: {
                manager: nameOf(r.manager), managerTerms: r.managerTerms, watch: nameOf(r.watch), year: world.year,
                history: (r.history || []).map(h => ({ office: h.office, name: h.name, fromYear: h.fromYear, toYear: h.toYear, endReason: h.endReason, why: h.why })),
            } }),
        });
        if (!res.ok) throw new Error(`town-history ${res.status}`);
        const data = await res.json();
        if (!isCurrent()) return false;
        if (!data || !data.townHistoryWritten) { lastHistoryFailAt = Date.now(); return false; }
        lastHistorySig = sig;
        return true;
    } catch (err) {
        lastHistoryFailAt = Date.now();
        console.warn('ry-farms: town-history writeback unavailable', err?.message || err);
        return false;
    } finally { clearTimeout(timer); historyInflight = false; }
}

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
