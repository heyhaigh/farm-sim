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
    const search = async (q, limit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const r = await fetch(`${base}/v4/search`, { method: 'POST', headers, signal: controller.signal,
                body: JSON.stringify({ q, limit, containerTag: 'ry-farms' }) });
            if (!r.ok) throw new Error(`search ${r.status}`);
            return await r.json();
        } finally { clearTimeout(timer); }
    };
    let data, civicData;
    try {
        data = await search('farmer creed belief memory dream town', 100);
        civicData = await search('the town civic record - manager watch voted in out elected recalled served', 24);
    } catch (e) {
        return send(res, 200, { farmers: [], links: [], source: 'offline', error: e?.message || 'supermemory unreachable' });
    }

    // group the distilled memories by farmer (newest town per name wins, so the graph is one town).
    // the TOWN-HISTORY doc (#94 P3 — the civic record: who the town voted in/out, and why) has no farmer
    // name, so it's pulled aside into its own node rather than dropped.
    const byName = new Map();
    for (const row of (data.results || [])) {
        const m = row.metadata || {};
        if (m.kind === 'town-history') continue;   // the civic record comes from the dedicated search
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
        if (m.kind !== 'town-history') continue;
        const text = String(row.memory || '').trim(); if (!text) continue;
        if (!civicLines.includes(text)) civicLines.push(text);
        if (!civicTown) civicTown = m.town || null;
    }
    if (civicLines.length) townHistory = { town: civicTown, text: civicLines.join('\n') };
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
    return send(res, 200, { farmers, links, townHistory, source: data.results ? 'supermemory-local' : 'empty', count: farmers.length });
};
