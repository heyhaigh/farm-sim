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

// A doc THIS game wrote back (tagged app:'ry-farms' / container 'ry-farms') must never be read back as a
// SOURCE memory — that would grow future farmers from past farmers as fresh docs, an echo chamber. But a
// past farmer's LIFE is exactly what a NEW town should be able to inherit *deliberately* (#1.1 generational
// founding): the fix the plan calls for is a LINEAGE bucket + a blend ratio, not a blanket exclude. So we
// split our own docs three ways: farmer-life -> lineage (heirs may be grown from it), town-history/inventions
// -> dropped (not a life to inherit), everything else -> the fresh source corpus.
function ourMeta(d) { return d.metadata || d.meta || {}; }
function isFarmerLife(d) {
    const meta = ourMeta(d);
    if (meta.kind === 'farmer-life') return true;
    // fallback when a build doesn't echo metadata back: our life-docs open with "{name} — a {arch} of {town}."
    // AND carry the ry-farms container tag.
    const tags = d.containerTags || d.container_tags || meta.containerTags || meta.tags || [];
    const tagged = Array.isArray(tags) && tags.includes('ry-farms');
    return tagged && /Creeds they live by:/.test(String(d.content || d.text || ''));
}
function isGenerated(d) {
    const meta = ourMeta(d);
    if (meta.app === 'ry-farms' || meta.kind === 'farmer-life') return true;
    const tags = d.containerTags || d.container_tags || meta.containerTags || meta.tags || [];
    return Array.isArray(tags) && tags.includes('ry-farms');
}

// Parse a persisted farmer-life doc (written by api/memory-writeback.js `lifeDoc`) back into the compact
// LINEAGE record a new town can found an heir from: their name, archetype, town, the creed they lived by, a
// dream, and the memory they were themselves grown from. Read-only + at-founding only (compile-don't-query).
function parseLineageLife(d) {
    const meta = ourMeta(d);
    const content = String(d.content || d.text || d.body || meta.content || '');
    const id = d.id || d.documentId || d.document_id || d._id || d.customId || meta.id || null;
    const head = (content.split('\n')[0] || '').match(/^(.+?)\s+—\s+an?\s+(.+?)\s+of\s+(.+?)\.?\s*$/);
    const name = (meta.name && String(meta.name)) || (head && head[1]) || null;
    const creed = (content.match(/Creeds they live by:\s*\n\s*-\s*(.+)/) || [])[1];
    if (!id || !name || !creed) return null;   // an heir needs at least a named forebear + a creed to carry
    const dream = (content.match(/Their dream:\s*(.+?)\.?\s*$/m) || [])[1] || null;
    const sourceTitle = (content.match(/Grown from the memory:\s*"(.+?)"/) || [])[1] || null;
    return {
        id: String(id),
        farmerSeed: meta.farmerSeed != null ? String(meta.farmerSeed) : null,
        townSeed: meta.townSeed != null ? String(meta.townSeed) : null,
        name: String(name),
        archetype: head ? String(head[2]) : 'farmer',
        town: head ? String(head[3]) : null,
        creed: String(creed).trim(),
        dream: dream ? String(dream).trim() : null,
        sourceTitle: sourceTitle ? String(sourceTitle).trim() : null,
    };
}

// SuperMemory's document shape isn't pinned across versions, so pull each field from the likeliest
// candidates and always end with the { id, title, summary, content } dna.js consumes.
function normalizeDoc(d) {
    if (!d || typeof d !== 'object') return null;
    if (isGenerated(d)) return null;   // never regrow a farmer from a farmer's persisted life
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

// --- #1.1 lineage via /v4/search (the reliable read on current SuperMemory) -------------------------------
// GET /v3/documents (the corpus list) is gone on newer self-hosted builds (v0.0.3 404s it), but POST /v4/search
// works, so the read half of the memory loop rides search. Search returns EXTRACTED FACTS (chunks), not the raw
// life-doc, one row per fact with the farmer's name/townSeed/farmerSeed in metadata — so we group facts by
// forebear and distil ONE creed to carry. Best-effort + off-sim: any failure yields [] and founding proceeds.
// Strip the extraction's third-person preamble so a carried creed reads as the conviction itself.
function cleanCreed(s) {
    return String(s)
        .replace(/^One of [A-Z][\w'-]* Ry'?s?\s+(?:earned\s+)?(?:creeds?|beliefs?)\s+is\s+that\s+/i, '')
        .replace(/^[A-Z][\w'-]* Ry'?s?\s+(?:earned\s+)?(?:creeds?|beliefs?)\s+(?:include|are|is)\s+that\s+/i, '')
        .replace(/^[A-Z][\w'-]* Ry\s+(?:lives by the creed|holds(?: as a creed)?(?: that)?|believes(?: that)?|has(?: a)?|recently|chose|chosen|set)\s+/i, '')
        .replace(/^(?:a recurring impulse to|the rule that|as a creed that|that|to)\s+/i, '')
        .replace(/\.$/, '')
        .trim();
}
function creedFromFact(text) {
    let m = text.match(/creed[^'"]*['"]([^'"]+)['"]/i);            // "lives by the creed 'X'"
    if (m) return cleanCreed(m[1]);
    m = text.match(/creed (?:that|is|of|:)\s+(.+?)[.\n]/i);        // "holds as a creed that X."
    if (m) return cleanCreed(m[1]);
    return null;
}
function parseLineageFromSearch(name, townSeed, farmerSeed, facts) {
    if (!name) return null;
    let creed = null, sourceTitle = null;
    for (const t of facts) {
        if (!creed) creed = creedFromFact(t);
        if (!sourceTitle) { const s = t.match(/from the memory ['"]([^'"]+)['"]/i); if (s) sourceTitle = s[1].trim(); }
    }
    if (!creed) {   // no explicit creed fact — carry the forebear's strongest remembered conviction, verbatim-ish
        const best = facts.find(t => /believe|creed|hold|live by|course/i.test(t)) || facts[0];
        if (best) creed = cleanCreed(best);
    }
    if (!creed) return null;
    return {
        id: `ry-farms:${townSeed ?? 'x'}:${farmerSeed ?? name}`,
        name: String(name),
        town: null,   // the town NAME isn't in metadata (only townSeed); heirs read "heir of {name}" when unknown
        townSeed: townSeed != null ? String(townSeed) : null,
        farmerSeed: farmerSeed != null ? String(farmerSeed) : null,
        archetype: 'farmer',
        creed: String(creed),
        dream: null,
        sourceTitle: sourceTitle || null,
    };
}
async function searchLineage(base, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const body = {
            q: 'farmer creed belief dream founders help remembers course', limit: 100, containerTag: 'ry-farms',
            filters: { AND: [{ key: 'kind', value: 'farmer-life' }] },
        };
        const r = await fetch(`${base}/v4/search`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        if (!r.ok) return [];
        const data = await r.json();
        const byKey = new Map();   // group extracted facts per forebear (town+farmer)
        for (const row of (data.results || [])) {
            const m = row.metadata || {};
            if (m.kind !== 'farmer-life' || !m.name) continue;
            const key = `${m.townSeed ?? 'x'}:${m.farmerSeed ?? m.name}`;
            const g = byKey.get(key) || { name: m.name, townSeed: m.townSeed, farmerSeed: m.farmerSeed, facts: [] };
            const txt = String(row.memory || '').trim(); if (txt) g.facts.push(txt);
            byKey.set(key, g);
        }
        const out = [];
        for (const g of byKey.values()) { const life = parseLineageFromSearch(g.name, g.townSeed, g.farmerSeed, g.facts); if (life) out.push(life); }
        return out;
    } catch { return []; }
    finally { clearTimeout(timer); }
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
        const seenLin = new Set();
        const out = [];
        const lineage = [];
        // SOURCE-CORPUS read via the legacy GET /v3/documents list. This endpoint is GONE on newer self-hosted
        // builds (v0.0.3 404s it), so a failure here must NOT abort the handler — the lineage read below rides
        // the still-working /v4/search. Soft-fail: on any error we break with whatever corpus we have (often
        // none on new builds -> dna.js grows the first town from invented lives, then writes them back for heirs).
        try {
            for (let page = 0; page < MAX_PAGES; page++) {
                const url = `${base}/v3/documents?limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}&page=${page + 1}`;
                const controller = new AbortController();
                // HARD deadline: race BOTH the fetch and the body read against a timeout, so even a server
                // that sends headers then stalls the body can never hang the handler (Codex r13 #2).
                let timer;
                const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 8000); });
                let data;
                try {
                    const r = await Promise.race([fetch(url, { headers, signal: controller.signal }), deadline]);
                    if (!r.ok) throw new Error(`SuperMemory ${r.status}`);
                    data = await Promise.race([r.json(), deadline]);
                } finally {
                    clearTimeout(timer);
                }
                const raw = extractDocs(data);
                for (const d of raw) {
                    if (isFarmerLife(d)) {                                  // a past farmer's life -> the lineage bucket
                        const life = parseLineageLife(d);
                        if (life && !seenLin.has(life.id)) { seenLin.add(life.id); lineage.push(life); }
                        continue;
                    }
                    const doc = normalizeDoc(d);                            // fresh source doc (town-docs drop out via isGenerated)
                    if (doc && !seen.has(doc.id)) { seen.add(doc.id); out.push(doc); }
                }
                if (!hasMore(data, raw.length, out.length + lineage.length)) break;
            }
        } catch (corpusErr) {
            console.warn('[knowledge-graph] corpus list unavailable (GET /v3/documents) — lineage still rides /v4/search:', corpusErr?.message || corpusErr);
        }
        // #1.1 the RELIABLE lineage read: /v4/search (GET /v3/documents above is gone on newer builds, so the
        // legacy loop's lineage is a bonus for old builds; search is the path that actually closes the loop).
        // Merge + dedup by a STABLE forebear key (Codex r20 P2): the legacy path ids by doc UUID and the search
        // path by `ry-farms:<town>:<farmer>` — deduping by `id` would let the SAME forebear enter twice on a
        // server exposing both. Key by (townSeed, farmerSeed) — the actual identity — which both paths carry.
        // dedup by identity when seeds are present; otherwise by the UNIQUE doc id — NOT the name (Codex r21 P2:
        // two distinct metadata-poor lives sharing a name would otherwise collapse to `x:<name>` and one drops).
        const lifeKey = l => (l.townSeed != null && l.farmerSeed != null) ? `${l.townSeed}:${l.farmerSeed}` : String(l.id || l.name || '');
        const seenLife = new Set(lineage.map(lifeKey));
        for (const l of await searchLineage(base, headers)) { const k = lifeKey(l); if (!seenLife.has(k)) { seenLife.add(k); lineage.push(l); } }
        // stable order -> deterministic cast + deterministic heir pairing for a given corpus
        out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        lineage.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return send(res, 200, { documents: out, lineage, source: (out.length || lineage.length) ? 'supermemory-local' : 'error', count: out.length, lineageCount: lineage.length });
    } catch (err) {
        // never fatal: an empty list makes dna.js fall back to its embedded offline crew
        return send(res, 200, { documents: [], source: 'error', error: err?.message || 'corpus fetch failed' });
    }
};
