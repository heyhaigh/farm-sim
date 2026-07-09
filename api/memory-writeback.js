// api/memory-writeback.js — persist each farmer's COMPILED inner life back into self-hosted SuperMemory.
//
// The other half of the memory loop. api/knowledge-graph.js READS the source corpus once at founding
// to grow the cast; this endpoint WRITES each farmer's distilled life — the creeds inherited from their
// source document, the beliefs they've earned, and a few recent episodic memories — back as a document,
// so a farmer's remembered life persists and travels beyond a single save.
//
// Doctrine: this is a pure SIDE-CHANNEL, off the sim loop. The sim never reads these back (compile-don't-
// query), so writeback can never touch determinism or gameplay. Best-effort: if SuperMemory is
// unreachable (as it is whenever `npx supermemory local` isn't running), the handler no-ops and the game
// is unaffected. Generated life-docs are TAGGED (`ry-farms` container + metadata.app) so knowledge-graph.js
// filters them OUT on read — a farmer's persisted life must never become a source memory for a future
// farmer (that feedback loop would slowly fill the town with echoes of itself).

const DEFAULT_URL = 'http://localhost:6767';
const DEADLINE_MS = 8000;
const MAX_FARMERS = 64;   // a town is small; cap defensively against a malformed body

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', c => { raw += c; if (raw.length > 512 * 1024) { reject(new Error('body too large')); req.destroy(); } });
        req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('bad json')); } });
        req.on('error', reject);
    });
}

// Compose a readable "remembered life" from the compiled objects the client sends.
function lifeDoc(f, town) {
    const lines = [`${f.name || 'A settler'} — a ${f.archetype || 'farmer'} of ${town || 'the valley'}.`];
    if (f.sourceTitle) lines.push(`Grown from the memory: "${String(f.sourceTitle).slice(0, 120)}".`);
    if (f.dream) lines.push(`Their dream: ${f.dream}.`);
    if (Array.isArray(f.creeds) && f.creeds.length) { lines.push('Creeds they live by:'); for (const c of f.creeds.slice(0, 6)) lines.push(` - ${c}`); }
    if (Array.isArray(f.beliefs) && f.beliefs.length) { lines.push('Beliefs they have earned:'); for (const b of f.beliefs.slice(0, 8)) lines.push(` - ${b}`); }
    if (Array.isArray(f.episodic) && f.episodic.length) { lines.push('Recent memories:'); for (const e of f.episodic.slice(0, 12)) lines.push(` - ${e}`); }
    return lines.join('\n');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' });
    if (typeof fetch !== 'function') return send(res, 200, { ok: false, written: 0, error: 'fetch unavailable' });

    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 200, { ok: false, written: 0, error: e?.message || 'bad body' }); }
    const farmers = Array.isArray(body?.farmers) ? body.farmers.slice(0, MAX_FARMERS) : [];
    if (!farmers.length) return send(res, 200, { ok: true, written: 0 });

    const base = (process.env.SUPERMEMORY_URL || DEFAULT_URL).replace(/\/+$/, '');
    const key = process.env.SUPERMEMORY_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    let written = 0;
    const persisted = [];
    for (const f of farmers) {
        const doc = {
            content: lifeDoc(f, body.town),
            // container + metadata tag every generated life so the READ side can exclude it (no feedback loop)
            containerTags: ['ry-farms'],
            metadata: {
                app: 'ry-farms', kind: 'farmer-life',
                townSeed: body.townSeed ?? null, farmerSeed: f.seed ?? null,
                sourceDocId: f.sourceDocId ?? null, name: f.name ?? null,
            },
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const r = await fetch(`${base}/v3/documents`, { method: 'POST', headers, body: JSON.stringify(doc), signal: controller.signal });
            if (r.ok) { written++; if (f.seed != null) persisted.push(f.seed); }
        } catch { /* best-effort — a life that didn't persist is no worse than before */ }
        finally { clearTimeout(timer); }
    }
    // report which seeds landed so the client stamps exactly those (a partial write is fine + resumable)
    return send(res, 200, { ok: true, written, of: farmers.length, persisted, source: base });
};
