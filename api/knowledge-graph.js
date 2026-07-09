// api/knowledge-graph.js — the town's SEED CORPUS, read from a self-hosted SuperMemory.
//
// Ry Farms grows every farmer from a real memory. This endpoint is the server-side bridge to a
// local SuperMemory instance (`npx supermemory local`, default http://localhost:6767): it lists
// the document corpus via GET /v3/documents (Bearer-authed with a key the browser must never see)
// and normalizes each doc to the shape dna.js expects — { id, title, summary, content }. The list
// is sorted by id so the same corpus always grows the same deterministic town.
//
// Compile-don't-query doctrine: this pulls the corpus ONCE at town founding. The sim never calls
// SuperMemory's /v4/search — memory-derived content (keepsakes/beliefs, #91) is frozen at founding,
// never queried in the loop. Any failure returns an empty list so dna.js falls back to its embedded
// offline crew and the game always runs.

const DEFAULT_URL = 'http://localhost:6767';
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;      // hard backstop against a runaway paginator (~5k docs)

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

// SuperMemory's document shape isn't pinned across versions, so pull each field from the likeliest
// candidates and always end with the { id, title, summary, content } dna.js consumes.
function normalizeDoc(d) {
    if (!d || typeof d !== 'object') return null;
    const meta = d.metadata || d.meta || {};
    const id = d.id || d.documentId || d.document_id || d._id || d.uuid || meta.id || null;
    const title = d.title || d.name || d.heading || meta.title || meta.name || '';
    const content = d.content || d.text || d.raw || d.markdown || d.body || d.summary || meta.content || '';
    const summary = d.summary || d.description || meta.summary || meta.description || content;
    if (!title || !(summary || content)) return null;   // unusable — dna.js filters these anyway
    return {
        id: String(id || title),
        title: String(title),
        summary: String(summary),
        content: String(content),
    };
}

// Different builds nest the array under different keys — accept the common ones (or a bare array).
function extractDocs(data) {
    if (Array.isArray(data)) return data;
    for (const k of ['documents', 'data', 'results', 'items', 'memories', 'docs']) {
        if (Array.isArray(data?.[k])) return data[k];
    }
    return [];
}

// Try to keep paging until the corpus is exhausted, tolerating whichever pagination style is used.
function hasMore(data, pageLen, fetched) {
    if (pageLen < PAGE_LIMIT) return false;
    const p = data?.pagination || data || {};
    const total = Number(p.total ?? p.totalItems ?? p.count);
    if (Number.isFinite(total)) return fetched < total;
    return !!(p.hasMore ?? p.has_more ?? p.nextCursor ?? p.next ?? p.nextOffset);
}

module.exports = async function handler(req, res) {
    if (typeof fetch !== 'function') return send(res, 200, { documents: [], source: 'error', error: 'fetch unavailable' });

    const base = (process.env.SUPERMEMORY_URL || DEFAULT_URL).replace(/\/+$/, '');
    const key = process.env.SUPERMEMORY_API_KEY || '';
    const headers = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    try {
        const seen = new Set();
        const out = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const url = `${base}/v3/documents?limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}&page=${page + 1}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            let data;
            try {
                const r = await fetch(url, { headers, signal: controller.signal });
                if (!r.ok) throw new Error(`SuperMemory ${r.status}`);
                data = await r.json();
            } finally {
                clearTimeout(timer);
            }
            const raw = extractDocs(data);
            for (const d of raw) {
                const doc = normalizeDoc(d);
                if (doc && !seen.has(doc.id)) { seen.add(doc.id); out.push(doc); }
            }
            if (!hasMore(data, raw.length, out.length)) break;
        }
        // stable order -> deterministic cast for a given corpus
        out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return send(res, 200, { documents: out, source: 'supermemory-local', count: out.length });
    } catch (err) {
        // never fatal: an empty list makes dna.js fall back to its embedded offline crew
        return send(res, 200, { documents: [], source: 'error', error: err?.message || 'corpus fetch failed' });
    }
};
