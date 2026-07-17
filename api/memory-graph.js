// api/memory-graph.js — the read side of the farmer-memory PORTAL (#95).
//
// Pulls EVERY town's stored lives back out of self-hosted SuperMemory (the same store the writeback fills)
// and shapes them into a multi-town graph the portal renders: one hub per TOWN, its FARMERS orbiting, the
// memories SuperMemory has distilled for each, that town's civic record + inventions, and inferred EDGES
// between farmers (who nursed / traded / feuded with whom, read off the memory text). Farmers are grouped by
// (townSeed + name) so same-named settlers across towns / `?fresh` boots never merge. Best-effort: if
// SuperMemory is down, returns an empty graph and the page shows an "offline" state. Read-only; never writes.

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

    // MULTI-TOWN (portal shows the WHOLE world now). Farmer NAMES recur across towns / `?fresh` boots, so we
    // partition every farmer-life row by townSeed and key farmers by (townSeed + name) — grouping stays
    // town-scoped and never merges two towns' same-named settlers into one inflated node.
    const townsMap = new Map();   // townSeed -> { seed, name, byName, civic[], inventions[] }
    const getTown = (ts) => { let t = townsMap.get(ts); if (!t) { t = { seed: ts, name: null, byName: new Map(), civic: [], inventions: [], battles: [] }; townsMap.set(ts, t); } return t; };
    for (const row of allRows) {
        const m = row.metadata || {};
        if (m.kind !== 'farmer-life') continue;
        const name = m.name; if (!name) continue;
        const text = String(row.memory || '').trim(); if (!text) continue;
        const t = getTown(String(m.townSeed ?? ''));
        let f = t.byName.get(name);
        if (!f) { f = { name, seed: String(m.farmerSeed ?? ''), memories: [] }; t.byName.set(name, f); }
        if (!f.memories.includes(text)) f.memories.push(text);
    }

    // civic records + inventions ACROSS ALL TOWNS: one broad search each (kind-filtered, high limit), then
    // partition by townSeed. Bigger cap than the single-town path so several towns' records survive ranking.
    // Best-effort; a failed sub-search degrades to empty and never 500s.
    let civicData = { results: [] }, inventData = { results: [] };
    try {
        [civicData, inventData] = await Promise.all([
            search('the town civic record - manager watch voted in out elected recalled served', 80, { AND: [{ key: 'kind', value: 'town-history' }] }).catch(() => ({ results: [] })),
            search('the town book of inventions recipes crafted brewed charm poultice tonic', 80, { AND: [{ key: 'kind', value: 'town-inventions' }] }).catch(() => ({ results: [] })),
        ]);
    } catch { civicData = { results: [] }; inventData = { results: [] }; }
    for (const row of (civicData?.results || [])) {
        const m = row.metadata || {}; if (m.kind !== 'town-history') continue;
        const t = getTown(String(m.townSeed ?? ''));
        if (m.town && !t.name) t.name = m.town;   // the civic doc carries the town's display name
        const text = String(row.memory || '').trim(); if (text && !t.civic.includes(text)) t.civic.push(text);
    }
    for (const row of (inventData?.results || [])) {
        const m = row.metadata || {}; if (m.kind !== 'town-inventions') continue;
        const t = getTown(String(m.townSeed ?? ''));
        const text = String(row.memory || '').trim(); if (text && !t.inventions.includes(text)) t.inventions.push(text);
    }
    // #nemesis THE BATTLE RECORDS: search chunks battle docs into fragments and GET-by-rootMemoryId 404s
    // on this self-host build, so discovery goes through the LIST api (metadata intact, ids GET-able), then
    // each battle document is fetched WHOLE. Bounded (2 pages, 24 docs) + best-effort throughout.
    const battleMetas = [];
    try {
        for (let page = 1; page <= 2; page++) {
            const controller = new AbortController(); const t = setTimeout(() => controller.abort(), DEADLINE_MS);
            let listed = null;
            try {
                const r = await fetch(`${base}/v3/documents/list`, { method: 'POST', headers, signal: controller.signal,
                    body: JSON.stringify({ limit: 100, page, containerTags: ['ry-farms'], sort: 'createdAt', order: 'desc' }) });
                listed = r.ok ? await r.json() : null;
            } finally { clearTimeout(t); }
            if (!listed) break;
            for (const m of (listed.memories || [])) if ((m.metadata || {}).kind === 'battle') battleMetas.push(m);
            const pg = listed.pagination || {}; if (!pg.totalPages || page >= pg.totalPages) break;
        }
    } catch { /* best-effort */ }
    const battleFull = await Promise.all(battleMetas.slice(0, 24).map(async m => {
        const controller = new AbortController(); const t = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const r = await fetch(`${base}/v3/documents/${encodeURIComponent(m.id)}`, { headers, signal: controller.signal });
            return r.ok ? await r.json() : null;
        } catch { return null; }
        finally { clearTimeout(t); }
    }));
    battleFull.forEach((doc, k) => {
        const meta = (doc && doc.metadata) || battleMetas[k].metadata || {};
        const t = getTown(String(meta.townSeed ?? ''));
        const text = String((doc && doc.content) || '').trim();
        if (text && !t.battles.some(b => b.text === text)) t.battles.push({ foe: meta.foe || null, day: meta.day || '', year: meta.year || '', text });
    });

    // shape each town: farmers (with memories), intra-town relationship edges, civic record, inventions.
    let totalFarmers = 0;
    const townsOut = [];
    for (const t of townsMap.values()) {
        const farmers = [...t.byName.values()].filter(f => f.memories.length);
        if (!farmers.length && !t.civic.length && !t.inventions.length && !t.battles.length) continue;
        totalFarmers += farmers.length;
        const firsts = new Map(farmers.map(f => [f.name.split(' ')[0], f.name]));   // "Mercurial" -> "Mercurial Ry"
        // edges: a memory of A that names another farmer B (by first name) -> an A—B edge labelled by verb
        const seen = new Set(), links = [];
        for (const f of farmers) {
            const meFirst = f.name.split(' ')[0];
            for (const text of f.memories) {
                for (const [first, full] of firsts) {
                    if (first === meFirst) continue;
                    if (!new RegExp(`\\b${first}\\b`).test(text)) continue;
                    const key2 = [f.name, full].sort().join('|'); if (seen.has(key2)) continue;
                    let label = 'knows';
                    for (const [re, lab] of RELS) if (re.test(text)) { label = lab; break; }
                    seen.add(key2); links.push({ a: f.name, b: full, label });
                }
            }
        }
        townsOut.push({ seed: t.seed, name: t.name, farmers, links,
            townHistory: t.civic.length ? t.civic.join('\n') : null, inventions: t.inventions, battles: t.battles });
    }
    // biggest towns first, deterministic tie-break by seed (display order only)
    townsOut.sort((a, b) => (b.farmers.length - a.farmers.length) || String(a.seed).localeCompare(String(b.seed)));
    return send(res, 200, { towns: townsOut, source: data.results ? 'supermemory-local' : 'empty', count: totalFarmers, townCount: townsOut.length });
};
