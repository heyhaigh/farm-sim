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

// Compose the town's CIVIC RECORD (#94 P3) — who has led, for how long, and how each term ended — as a
// single town-level document so the town's political memory persists in SuperMemory alongside the lives.
function townHistoryDoc(th, town) {
    const lines = [`${town || 'The valley'} — the civic record.`];
    if (th.manager) lines.push(`Manager: ${th.manager}${th.managerTerms ? ` (serving, ${th.managerTerms} year${th.managerTerms > 1 ? 's' : ''})` : ''}.`);
    if (th.watch) lines.push(`Town Watch: ${th.watch}.`);
    const past = Array.isArray(th.history) ? th.history : [];
    if (past.length) {
        lines.push('Past office-holders the town remembers:');
        for (const h of past.slice(-24)) {
            const office = h.office === 'manager' ? 'Manager' : 'Watch';
            const span = h.fromYear === h.toYear ? `Year ${h.fromYear}` : `Years ${h.fromYear}-${h.toYear}`;
            lines.push(` - ${office} ${String(h.name || '?').split(' ')[0]}: ${span}, ${h.endReason}${h.why ? ` (${h.why})` : ''}.`);
        }
    }
    return lines.join('\n');
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
    const townHistory = body?.townHistory && typeof body.townHistory === 'object' ? body.townHistory : null;
    if (!farmers.length && !townHistory) return send(res, 200, { ok: true, written: 0 });

    const base = (process.env.SUPERMEMORY_URL || DEFAULT_URL).replace(/\/+$/, '');
    const key = process.env.SUPERMEMORY_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    // the town's civic record — one upserting document per town (customId keeps it a single evolving doc)
    let townHistoryWritten = false;
    if (townHistory) {
        const doc = {
            content: townHistoryDoc(townHistory, body.town),
            customId: `ry-farms:townhistory:${body.townSeed ?? 'x'}`,
            containerTags: ['ry-farms'],
            metadata: {
                app: 'ry-farms', kind: 'town-history',
                ...(body.townSeed != null ? { townSeed: String(body.townSeed) } : {}),
                ...(body.town != null ? { town: String(body.town) } : {}),
            },
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const r = await fetch(`${base}/v3/documents`, { method: 'POST', headers, body: JSON.stringify(doc), signal: controller.signal });
            if (r.ok) townHistoryWritten = true;
            else console.error('[writeback] town-history non-ok', r.status, (await r.text()).slice(0, 200));
        } catch (e) { console.error('[writeback] town-history threw:', e?.message, e?.cause?.message || ''); }
        finally { clearTimeout(timer); }
    }
    if (!farmers.length) return send(res, 200, { ok: true, written: townHistoryWritten ? 1 : 0, townHistoryWritten, source: base });

    let written = 0;
    const persisted = [];
    for (const f of farmers) {
        const doc = {
            content: lifeDoc(f, body.town),
            // a STABLE id per (town, farmer) so re-posting the same life UPSERTS instead of piling up
            // duplicate docs across repeated fresh boots (if the store honours customId; harmless if not)
            customId: `ry-farms:${body.townSeed ?? 'x'}:${f.seed ?? 'x'}`,
            // container + metadata tag every generated life so the READ side can exclude it (no feedback loop).
            // SuperMemory validates metadata values as STRINGS and rejects nulls — so stringify + drop empties.
            containerTags: ['ry-farms'],
            metadata: {
                app: 'ry-farms', kind: 'farmer-life',
                ...(body.townSeed != null ? { townSeed: String(body.townSeed) } : {}),
                ...(f.seed != null ? { farmerSeed: String(f.seed) } : {}),
                ...(f.sourceDocId != null ? { sourceDocId: String(f.sourceDocId) } : {}),
                ...(f.name != null ? { name: String(f.name) } : {}),
            },
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
        try {
            const r = await fetch(`${base}/v3/documents`, { method: 'POST', headers, body: JSON.stringify(doc), signal: controller.signal });
            if (r.ok) { written++; if (f.seed != null) persisted.push(f.seed); }
            else console.error('[writeback] non-ok', r.status, (await r.text()).slice(0, 200));
        } catch (e) { console.error('[writeback] threw:', e?.message, e?.cause?.message || ''); }
        finally { clearTimeout(timer); }
    }
    // report which seeds landed so the client stamps exactly those (a partial write is fine + resumable)
    return send(res, 200, { ok: true, written, of: farmers.length, persisted, townHistoryWritten, source: base });
};
