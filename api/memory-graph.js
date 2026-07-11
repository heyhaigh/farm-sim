// api/memory-graph.js — the read side of the farmer-memory PORTAL (#95).
//
// Pulls the town's stored lives back out of self-hosted SuperMemory (the same store the writeback fills)
// and shapes them into a graph the portal page renders: one node per FARMER, the memories SuperMemory
// has distilled for each, and inferred EDGES between farmers (who nursed / traded / feuded with whom,
// read off the memory text). Best-effort: if SuperMemory is down, returns an empty graph and the page
// shows an "offline" state. Read-only; never writes.

const DEFAULT_URL = 'http://127.0.0.1:6767';
const DEADLINE_MS = 9000;

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

// relationship verbs we can read off a memory that names another farmer -> a short edge label
const RELS = [
    [/nursed|healed|tended|soup|back to health/i, 'nursed'],
    [/shortchang|lowball|cheat|hard bargain|robbed/i, 'chiselled'],
    [/stole|thiev|poach|blight|harm|poison/i, 'wronged'],
    [/taught|showed .* how|shown how/i, 'taught'],
    [/traded|barter|swap/i, 'traded'],
    [/stood with|pulled .* back|helped|lent .* a hand|dug .* well/i, 'stood by'],
    [/fell out|grudge|resent|turned .* away|refused to heal/i, 'fell out with'],
    [/grown close|bond|beloved/i, 'close to'],
];

module.exports = async function handler(req, res) {
    if (typeof fetch !== 'function') return send(res, 200, { farmers: [], links: [], source: 'error', error: 'fetch unavailable' });
    const base = (process.env.SUPERMEMORY_URL || DEFAULT_URL).replace(/\/+$/, '');
    const key = process.env.SUPERMEMORY_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    // /v4/search is SEMANTIC + query-ranked (no list-all endpoint), so a single query can't reliably pull
    // BOTH the farmer lives AND the one town-history doc — the civic record ranks below the farmer corpus.
    // Run two targeted searches: one for the lives, a small dedicated one for the town's political record.
    const search = async (q, limit, filters) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const body = { q, limit, containerTag: 'ry-farms' };
            if (filters) body.filters = filters;   // /v4/search honours metadata AND-filters (kind, townSeed)
            const r = await fetch(`${base}/v4/search`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(body) });
            if (!r.ok) throw new Error(`search ${r.status}`);
            return await r.json();
        } finally { clearTimeout(timer); }
    };
    // First pull the farmer corpus; the civic + invention records are fetched AFTER we know the active town
    // (below), scoped to it by townSeed — otherwise an older town's docs can crowd the active town's single
    // civic/invention doc out of a hard-capped, semantically-ranked result set and blank the hub.
    let data;
    try {
        data = await search('farmer creed belief memory dream town', 100);
    } catch (e) {
        return send(res, 200, { farmers: [], links: [], source: 'offline', error: e?.message || 'supermemory unreachable' });
    }

    // PER-FARMER FAN-OUT. /v4/search is semantically RANKED and hard-capped at 100, so one broad query
    // starves the roster: a popular farmer can eat 40+ of the 100 slots while a thin-ranking one gets a
    // single chunk — which is why the portal showed a couple of dense farmers and the rest bare. Every
    // farmer actually stores a full life; we just have to ASK for each one. Discover the roster from the
    // broad pass, then pull an even slice per farmer so all settlers are represented, not just whoever
    // ranked highest globally. Bounded (≤32 names, parallel) so it stays a single quick portal load.
    const rosterNames = [];
    for (const row of (data.results || [])) {
        const m = row.metadata || {};
        if (m.kind === 'farmer-life' && m.name && !rosterNames.includes(m.name)) rosterNames.push(m.name);
    }
    let perName = [];
    try {
        perName = await Promise.all(rosterNames.slice(0, 32).map(async (name) => {
            try { return await search(`${name} — memory belief creed dream journal`, 24); }
            catch { return null; }
        }));
    } catch { perName = []; }
    // merge the broad pass + every per-farmer slice into one row list; dedup is per-text below
    const allRows = (data.results || []).concat(...perName.map(r => (r && r.results) || []));

    // Choose ONE town to render — the NEWEST (the active/current town). Farmer NAMES recur across `?fresh`
    // boots, so grouping by name alone silently merges different towns' lives into one inflated node. Each
    // stored doc carries its townSeed + an updatedAt; partition farmer-life rows by townSeed, and keep only
    // the town whose most-recent doc is newest. (Deterministic tie-break by townSeed so it never flickers.)
    const townLatest = new Map();
    for (const row of allRows) {
        const m = row.metadata || {};
        if (m.kind !== 'farmer-life') continue;
        const ts = String(m.townSeed ?? ''), when = Date.parse(row.updatedAt || '') || 0;
        if (!townLatest.has(ts) || when > townLatest.get(ts)) townLatest.set(ts, when);
    }
    let activeTown = null, bestWhen = -1;
    for (const [ts, when] of townLatest) {
        if (when > bestWhen || (when === bestWhen && (activeTown == null || ts > activeTown))) { bestWhen = when; activeTown = ts; }
    }
    const inActiveTown = (m) => activeTown == null || String(m.townSeed ?? '') === activeTown;

    // Now fetch the active town's civic record + inventions SPECIFICALLY, filtered by townSeed so ranking
    // truncation can't blank them. (Falls back to an unfiltered search when there's no active town, e.g. a
    // store with civic docs but no farmer-life rows.) A failed sub-search degrades to empty, never 500s.
    const townFilter = (kind) => activeTown != null
        ? { AND: [{ key: 'kind', value: kind }, { key: 'townSeed', value: activeTown }] }
        : { AND: [{ key: 'kind', value: kind }] };
    let civicData = { results: [] }, inventData = { results: [] };
    try {
        [civicData, inventData] = await Promise.all([
            search('the town civic record - manager watch voted in out elected recalled served', 24, townFilter('town-history')).catch(() => ({ results: [] })),
            search('the town book of inventions recipes crafted brewed charm poultice tonic', 24, townFilter('town-inventions')).catch(() => ({ results: [] })),
        ]);
    } catch { civicData = { results: [] }; inventData = { results: [] }; }

    // group the distilled memories by farmer, WITHIN the chosen town. The TOWN-HISTORY doc (#94 P3 — the
    // civic record) has no farmer name, so it's pulled aside into its own node rather than dropped.
    const byName = new Map();
    for (const row of allRows) {
        const m = row.metadata || {};
        if (m.kind === 'town-history') continue;   // the civic record comes from the dedicated search
        if (!inActiveTown(m)) continue;            // one town only — the newest — so recurring names don't merge
        const name = m.name; if (!name) continue;
        const text = String(row.memory || '').trim(); if (!text) continue;
        let f = byName.get(name);
        if (!f) { f = { name, seed: String(m.farmerSeed ?? ''), town: String(m.townSeed ?? ''), memories: [] }; byName.set(name, f); }
        if (!f.memories.includes(text)) f.memories.push(text);
    }
    // the town's political record, pulled from its own targeted search. SuperMemory distils a doc into
    // several fact-chunks, so gather ALL the civic chunks into one record rather than a single line.
    let townHistory = null, civicTown = null;
    const civicLines = [];
    for (const row of (civicData?.results || [])) {
        const m = row.metadata || {};
        if (m.kind !== 'town-history' || !inActiveTown(m)) continue;   // the ACTIVE town's politics, not a prior boot's
        const text = String(row.memory || '').trim(); if (!text) continue;
        if (!civicLines.includes(text)) civicLines.push(text);
        if (!civicTown) civicTown = m.town || null;
    }
    if (civicLines.length) townHistory = { town: civicTown, text: civicLines.join('\n') };
    // #97 P5 — the town's inventions, as distilled fact-chunks, rendered as recipe nodes off the town hub
    const inventions = [];
    for (const row of (inventData?.results || [])) {
        const m = row.metadata || {};
        if (m.kind !== 'town-inventions' || !inActiveTown(m)) continue;   // the ACTIVE town's book, not a prior boot's
        const text = String(row.memory || '').trim(); if (!text || inventions.includes(text)) continue;
        inventions.push(text);
    }
    const farmers = [...byName.values()].filter(f => f.memories.length);
    const firsts = new Map(farmers.map(f => [f.name.split(' ')[0], f.name]));   // "Mercurial" -> "Mercurial Ry"

    // infer edges: a memory of A that names another farmer B (by first name) -> an edge A—B labelled by verb
    const seen = new Set(), links = [];
    for (const f of farmers) {
        const meFirst = f.name.split(' ')[0];
        for (const text of f.memories) {
            for (const [first, full] of firsts) {
                if (first === meFirst) continue;
                if (!new RegExp(`\\b${first}\\b`).test(text)) continue;
                const key2 = [f.name, full].sort().join('|');
                if (seen.has(key2)) continue;
                let label = 'knows';
                for (const [re, lab] of RELS) if (re.test(text)) { label = lab; break; }
                seen.add(key2); links.push({ a: f.name, b: full, label });
            }
        }
    }
    return send(res, 200, { farmers, links, townHistory, inventions, source: data.results ? 'supermemory-local' : 'empty', count: farmers.length });
};
