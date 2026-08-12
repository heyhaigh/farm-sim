// memory-writeback.js — client side of the memory loop's write half (#91).
//
// Sends each farmer's COMPILED inner life — creeds (inherited from their source doc), beliefs (earned
// from a lived life), and a few of their strongest episodic memories — to /api/memory-writeback, which
// persists them into self-hosted SuperMemory. Off the sim loop, best-effort, display/persistence only:
// the seeded world never reads these back, so determinism is untouched whether or not SuperMemory ever
// answers. Each farmer is persisted ONCE (stamped sheet.lifePersisted, which rides the save); while
// SuperMemory is unreachable (nothing lands) nothing is stamped, so it simply retries later and finally
// captures each life the first time the store is up.

// #local-memory — the BROWSER store is now the primary persistence: every payload lands in
// memory-store.js (IndexedDB) first and local success is what stamps/acknowledges. The server
// POST remains as a best-effort ECHO for self-hosted SuperMemory dev setups — fire-and-forget,
// its own cooldown, never consulted for success. Players get the full memory loop with no server.
import { storePayload } from './memory-store.js';

const ENDPOINT = '/api/memory-writeback';
const TIMEOUT_MS = 20000;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

// Codex #88 P2 — a QUEUE, not a drop: local success stamps/dedupes immediately, so a payload the
// echo dropped would never be re-offered by its writer. Payloads queue keyed per writer+town
// (battles per rid so distinct battles all land) and a single pump drains them in order. On
// failure the queue is retained and the pump re-arms after the cooldown. Memory-only by contract:
// the echo is a best-effort dev-store convenience — a page close may lose queued echoes, never
// local persistence.
//
// Codex #89 hardening (three P2s):
//   - lives MERGE per farmer seed (a lives payload is a ≤4-farmer PARTIAL batch, not a town
//     snapshot — latest-wins per town was discarding stamped farmers accumulated across passes);
//   - a success deletes the key ONLY if the queued body is still the exact one sent (a
//     replacement enqueued mid-flight survives for the next loop iteration);
//   - while the retry timer is armed, ALL pump calls hold — new work cannot bypass the cooldown.
const echoQueue = new Map();   // key -> body
let echoPumping = false;
let echoRetryTimer = null;
let ECHO_COOLDOWN_MS = RETRY_COOLDOWN_MS;
export function _setEchoCooldownForTests(ms) { ECHO_COOLDOWN_MS = ms; }
export function _resetEchoForTests() { echoQueue.clear(); if (echoRetryTimer) clearTimeout(echoRetryTimer); echoRetryTimer = null; echoPumping = false; }
function echoKey(body) {
    const ts = String(body.townSeed);
    if (body.battle && body.battle.rid) return `battle:${body.battle.rid}`;
    if (body.farmers) return `lives:${ts}`;
    if (body.townHistory) return `history:${ts}`;
    if (body.townInventions) return `invent:${ts}`;
    return `misc:${ts}`;
}
function mergeQueued(key, body) {
    const prev = echoQueue.get(key);
    if (prev && Array.isArray(prev.farmers) && Array.isArray(body.farmers)) {
        const bySeed = new Map();
        for (const l of [...prev.farmers, ...body.farmers]) if (l && l.seed != null) bySeed.set(l.seed, l);   // newest version of each farmer wins
        return { ...body, farmers: [...bySeed.values()].slice(0, 64) };   // the API's own MAX_FARMERS bound
    }
    return body;
}
async function pumpEchoes() {
    if (echoPumping || echoRetryTimer || typeof fetch !== 'function') return;   // the armed retry timer holds ALL pumps
    echoPumping = true;
    try {
        while (echoQueue.size) {
            const [key, sent] = echoQueue.entries().next().value;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            try {
                const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent), signal: controller.signal });
                if (!r.ok) throw new Error(String(r.status));
                if (echoQueue.get(key) === sent) echoQueue.delete(key);   // a mid-flight replacement stays queued
            } catch {
                if (!echoRetryTimer) echoRetryTimer = setTimeout(() => { echoRetryTimer = null; pumpEchoes(); }, ECHO_COOLDOWN_MS);
                break;
            } finally { clearTimeout(timer); }
        }
    } finally { echoPumping = false; }
}
export function echoToServer(body) {
    if (typeof fetch !== 'function' || !body) return;
    const key = echoKey(body);
    echoQueue.set(key, mergeQueued(key, body));
    if (echoQueue.size > 64) { for (const k of echoQueue.keys()) if (k !== key) { echoQueue.delete(k); break; } }   // bounded; never the fresh key
    pumpEchoes();
}

// Codex #90 P0 — this support block was accidentally swallowed by the #89 queue amendment's range
// replacement (every exported writer threw ReferenceError on its first line; the queue-only test
// stayed green). Restored verbatim; tests/writeback-smoke.mjs now exercises all three entry points
// so a missing definition can never again pass the suite.
// #101 writeback THROTTLE (cost + fan-out control): a farmer's life is only worth persisting once it has
// actually accumulated something (a formed belief or a few real memories) — this stops a fresh-town boot
// from ingesting 16 near-empty day-one snapshots at once. And even when many lives mature together, at most
// MAX_PER_PASS are written per pass so writeback trickles out over successive ticks instead of a 16-way burst.
const MIN_EPISODIC_TO_PERSIST = 3;
const MAX_PER_PASS = 4;
function worthPersisting(life) {
    return (life.beliefs?.length || 0) >= 1 || (life.episodic?.length || 0) >= MIN_EPISODIC_TO_PERSIST;
}

let inflight = false;
let lastFailAt = -Infinity;
const writeAttemptGen = new Map();   // #101 seed -> pass# this life was last SUBMITTED (fair round-robin scheduler, off-sim)
let writeGen = 0;

// #94 P3: the town's evolving civic record is persisted separately from the one-shot farmer lives, because
// it KEEPS CHANGING (each election adds a term) long after every farmer has been written once. Re-posts
// only when the record actually changes (a cheap signature), upserting a single town-history document.
let historyInflight = false;
let lastHistorySig = null;
let lastHistoryFailAt = -Infinity;
function historySignature(world) {
    const r = world.roles || {};
    const nem = world.nemesis;
    // #134 raid-learnings fold into the signature so the town's SuperMemory record re-writes when it learns;
    // #nemesis the named-war arc folds in too — every return, sworn grudge, and ending re-writes the record.
    return `${(r.history || []).length}:${r.manager}:${r.watch}:${r.managerTerms}:${world.year}:${world.raidsSuffered || 0}:${world.learned || ''}` +
           `:${nem ? `${nem.pairKey}.${nem.raidCount}.${nem.sworeAgainst ?? ''}.${nem.ended ? 1 : 0}` : ''}:${(world.nemesisLog || []).length}`;
}

// Codex #60 — a session that must not WRITE must not write HERE either. The three entry points below all
// push into the shared memory store, which outlives the tab, so a menu backdrop or a session we refused
// to persist (unreadable storage, a stale quarantine) must be silent. Centralized in the module rather than
// left to each caller, for the reason saveTown's own guard exists: the caller that forgets is the one that
// matters, and this was already missed once — persistBattle was called from the raid path with no guard at
// all, so a non-persisting session could still inscribe a battle into the shared store.
function mayWrite(world) { return !!world && !world._persistenceDisabled; }

// The town's civic record, compiled once for BOTH the live writer and the backfill (#memory-backfill).
// Returns null when there is nothing worth remembering yet.
export function townHistoryOf(world) {
    const r = world.roles;
    if (!r || (!r.history?.length && r.manager == null && !world.learned && !(world.raidsSuffered > 0) && !world.nemesis)) return null;
    const nameOf = seed => { const f = world.farmers.find(x => x.sheet.seed === seed); return f ? f.sheet.name : null; };
    return {
        manager: nameOf(r.manager), managerTerms: r.managerTerms, watch: nameOf(r.watch), year: world.year,
        history: (r.history || []).map(h => ({ office: h.office, name: h.name, fromYear: h.fromYear, toYear: h.toYear, endReason: h.endReason, why: h.why })),
        raidsSuffered: world.raidsSuffered || 0, learned: world.learned || null,   // #134 the town's raid memory + what it learned
        // #nemesis THE BOOK OF WARS — the named-foe arcs, current + ended (the hackathon loop closing:
        // a town grown from memories writes its wars back as memories)
        wars: {
            current: world.nemesis ? {
                name: world.nemesis.name, raidCount: world.nemesis.raidCount, ended: !!world.nemesis.ended,
                lastOutcome: world.nemesis.lastOutcome || null,
                sworeAgainst: world.nemesis.sworeAgainst != null ? (nameOf(world.nemesis.sworeAgainst) || null) : null,
            } : null,
            past: (world.nemesisLog || []).map(x => ({ name: x.name, raidCount: x.raidCount, sworeAgainst: x.sworeAgainst || null, outcome: x.outcome, year: x.year })),
        },
    };
}

export async function persistTownHistory(world, isCurrent = () => true) {
    if (!mayWrite(world)) return false;   // #60 non-persisting session: never touch the shared store
    if (typeof fetch !== 'function' || historyInflight) return false;
    if (Date.now() - lastHistoryFailAt < RETRY_COOLDOWN_MS) return false;
    const r = world.roles;
    // #134/#nemesis also worth remembering once the town has weathered a raid, learned, or has a named war
    if (!r || (!r.history?.length && r.manager == null && !world.learned && !(world.raidsSuffered > 0) && !world.nemesis)) return false;   // nothing to remember yet
    const sig = historySignature(world);
    if (sig === lastHistorySig) return false;                            // unchanged since last successful write

    historyInflight = true;
    try {
        const body = { town: world.name || 'PROPAGATE', townSeed: world.seed, gen: world._gen || 0, rev: world._rev || world.day || 0, townHistory: townHistoryOf(world) };
        const local = await storePayload(body);          // #local-memory the browser store is the authority
        echoToServer(body);                              // best-effort echo for a self-hosted SuperMemory
        if (!isCurrent()) return false;
        if (!local || !local.written) { lastHistoryFailAt = Date.now(); return false; }
        lastHistorySig = sig;
        return true;
    } catch (err) {
        lastHistoryFailAt = Date.now();
        console.warn('ry-farms: town-history writeback unavailable', err?.message || err);
        return false;
    } finally { historyInflight = false; }
}

export function lifeOf(f) {   // #memory-backfill shares this compiler — one life shape, one code path
    const s = f.sheet;
    // episodic memories live on the FARMER instance (`remember()` pushes to f.journal), NOT the sheet —
    // reading s.journal silently dropped every lived memory from the writeback (so the portal had only
    // creeds/beliefs and almost no ties). Read f.journal, strongest first.
    const episodic = (f.journal || []).slice().sort((a, b) => b.strength - a.strength).slice(0, 12).map(m => m.text);
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

// A cheap change-detector for a farmer's life: their creeds + beliefs + strongest memories. When it
// changes (a new belief forms, a relationship memory lands, a fresh episodic beat), the life is RE-persisted
// so SuperMemory holds the LIVING farmer, not a first-day snapshot. The customId upsert means each refresh
// overwrites the same doc (no pile-up), and the read side still excludes these, so no echo loop.
function lifeSig(f) {
    const l = lifeOf(f);
    return `${l.beliefs.length}|${l.creeds.length}|${l.episodic.join('¦')}`;
}

// Persist each farmer whose life has CHANGED since it was last written. `isCurrent` guards a response
// landing after a NEW-town reset. Returns the count refreshed this pass (0 = nothing changed / store down).
export async function persistLives(world, isCurrent = () => true) {
    if (!mayWrite(world)) return false;   // #60 non-persisting session: never touch the shared store
    if (typeof fetch !== 'function' || inflight) return 0;
    if (Date.now() - lastFailAt < RETRY_COOLDOWN_MS) return 0;
    const pending = [];
    for (const f of world.farmers) {
        const sig = lifeSig(f);
        if (sig === f.sheet.lifeSig) continue;          // unchanged since last write — skip
        if (!worthPersisting(lifeOf(f))) continue;      // #101 still a thin day-one life — don't spend on it yet
        pending.push({ f, sig });
    }
    if (!pending.length) return 0;
    // #101 FAIRNESS: submit the LEAST-RECENTLY-SUBMITTED lives first, then trickle at most MAX_PER_PASS. A fixed
    // prefix would let a few always-changing farmers (0-3) hold the cap every pass and starve farmer 4+ out of the
    // portal forever; round-robin by attempt-generation guarantees every pending life gets its turn. Off-sim, so
    // ordering needn't be deterministic — the seed tiebreak just keeps it stable.
    pending.sort((a, b) =>
        (writeAttemptGen.get(a.f.sheet.seed) ?? -1) - (writeAttemptGen.get(b.f.sheet.seed) ?? -1)
        || a.f.sheet.seed - b.f.sheet.seed);
    if (pending.length > MAX_PER_PASS) pending.length = MAX_PER_PASS;
    writeGen++;
    for (const p of pending) writeAttemptGen.set(p.f.sheet.seed, writeGen);   // mark this turn taken (even if the store is down)

    inflight = true;
    try {
        const body = { town: world.name || 'PROPAGATE', townSeed: world.seed, gen: world._gen || 0, rev: world._rev || world.day || 0, farmers: pending.map(p => lifeOf(p.f)) };
        const local = await storePayload(body);          // #local-memory the browser store is the authority
        echoToServer(body);                              // best-effort echo for a self-hosted SuperMemory
        if (!isCurrent()) return 0;                          // town was reset mid-write
        if (!local || !local.written) { lastFailAt = Date.now(); return 0; }   // IDB refused (private mode/quota) — retry later, stamp nothing

        const landed = new Set(local.persisted || []);
        let stamped = 0;
        for (const { f, sig } of pending) if (landed.has(f.sheet.seed)) { f.sheet.lifeSig = sig; f.sheet.lifePersisted = true; stamped++; }
        if (stamped) world.addLog(`${stamped} settlers' lives were set down in the town's long memory.`, '#8ad0e0');
        return stamped;
    } catch (err) {
        lastFailAt = Date.now();
        console.warn('ry-farms: memory writeback unavailable (lives stay unstamped)', err?.message || err);
        return 0;
    } finally {
        inflight = false;
    }
}

// #nemesis THE BATTLE RECORD — one document per REAL raid battle, written the moment the show ends: the
// round-by-round exchanges (from the duel fx stream), who fell, who broke off, what was carried away, and
// whose war it was. Display-derived data persisted through the side-channel (never sim state — dormant
// raids get no battle doc, exactly as they got no show). Deduped per raid id; rehearsals never call this.
const battlesSent = new Set();
let battleInflight = false;
export async function persistBattle(world, battle) {
    if (!mayWrite(world)) return false;   // #60 non-persisting session: never touch the shared store
    if (typeof fetch !== 'function' || !battle || !battle.rid || battlesSent.has(battle.rid) || battleInflight) return false;
    battlesSent.add(battle.rid);   // one shot per raid — a failed write is a lost tale, not a retry storm
    battleInflight = true;
    try {
        const body = { town: world.name || 'PROPAGATE', townSeed: world.seed, gen: world._gen || 0, rev: world._rev || world.day || 0, battle };
        const local = await storePayload(body);          // #local-memory the browser store is the authority
        echoToServer(body);                              // best-effort echo for a self-hosted SuperMemory
        return !!(local && local.written);               // the inscription card now fires for EVERY player
    } catch (err) {
        console.warn('ry-farms: battle writeback unavailable', err?.message || err);
        return false;
    } finally { battleInflight = false; }
}
