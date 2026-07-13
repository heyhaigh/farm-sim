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

// #Codex24-3: this endpoint writes to a LOCAL, single-user, self-hosted store off the sim loop. It can't do
// user-account auth (there are no accounts) — but it CAN refuse the two realistic abuse vectors: a malicious
// page in the user's browser POSTing across origins (CSRF / DNS-rebind), and a caller aiming a write at a
// wildcard/guessed customId. So: same-origin (loopback) only, and every customId must be keyed to a REAL
// numeric town+farmer identity (no `?? 'x'` catch-all doc anyone can clobber).
function isLoopbackOrigin(origin) {
    try { const h = new URL(origin).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1'; }
    catch { return false; }
}
// #Codex25-7: a STRICT non-negative-integer parse. `+v` coerces null/''/[]/false all to 0 and true to 1, so
// the old `Number.isFinite(+v)` accepted them and let a caller write the shared `ry-farms:0:0` doc. Accept only
// a real non-negative safe integer, or a canonical non-negative integer string — nothing else.
const numOrNull = v => {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
    if (typeof v === 'string' && /^\d+$/.test(v)) { const n = Number(v); return Number.isSafeInteger(n) ? n : null; }
    return null;
};

// #Codex25-6 — a server-side MONOTONIC-revision guard. SuperMemory exposes no get-by-customId / conditional
// write, so a true durable CAS isn't possible here; this in-process registry is the achievable server-side
// defense for the local self-host: it rejects any write whose rev is <= the highest rev ALREADY COMMITTED for
// that customId, which blocks the two-visible-tabs stale-overwrite within a session (paired with the client's
// stale/hidden-tab guard). It's recorded only on a SUCCESSFUL write (a failed fetch doesn't poison it), and it
// is NOT durable across a server restart — a limitation inherent to the store's API.
const revRegistry = new Map();   // customId -> highest committed rev (this process)
async function upsertDoc(base, headers, doc, rev) {
    const prev = revRegistry.get(doc.customId);
    if (prev !== undefined && rev <= prev) return { stale: true };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    try {
        const r = await fetch(`${base}/v3/documents`, { method: 'POST', headers, body: JSON.stringify(doc), signal: controller.signal });
        if (r.ok) { revRegistry.set(doc.customId, rev); return { ok: true }; }
        return { ok: false, status: r.status, text: (await r.text()).slice(0, 200) };
    } catch (e) { return { err: e?.message || 'threw', cause: e?.cause?.message || '' }; }
    finally { clearTimeout(timer); }
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

// #97 P5 — the town's book of INVENTIONS: each generatively-discovered recipe, its ingredients, and who
// first worked it out — one town-level document (sibling of the civic record).
function townInventionsDoc(ti, town) {
    const lines = [`${town || 'The valley'} — the book of inventions.`];
    const recipes = Array.isArray(ti.recipes) ? ti.recipes : [];
    if (recipes.length) {
        lines.push('Recipes the town has invented:');
        for (const r of recipes.slice(-40)) {
            const ing = Array.isArray(r.ingredients) ? r.ingredients.join(' + ') : '';
            const who = r.inventor ? `, first worked out by ${String(r.inventor).split(' ')[0]}` : '';
            lines.push(` - ${r.name} (from ${ing})${who}${r.lore ? `: ${r.lore}` : ''}.`);
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
    // #Codex24-3: reject cross-site callers (a same-origin game request has no Origin or a loopback one)
    const origin = req.headers && req.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) return send(res, 403, { ok: false, error: 'cross-origin writes are not allowed' });
    if (typeof fetch !== 'function') return send(res, 200, { ok: false, written: 0, error: 'fetch unavailable' });

    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 200, { ok: false, written: 0, error: e?.message || 'bad body' }); }
    // #Codex24-3: every write must be keyed to a REAL numeric town identity — no `?? 'x'` catch-all customId
    // that any caller could target to clobber a shared document.
    const townSeed = numOrNull(body?.townSeed);
    if (townSeed == null) return send(res, 400, { ok: false, written: 0, error: 'numeric townSeed required' });
    // #Codex24-3: a monotonic revision the client stamps onto each doc (default 0). SuperMemory has no reliable
    // get-by-customId to do a server-side compare-and-set, so this records the version for provenance + lets a
    // consumer detect staleness; the client only ever posts its CURRENT state (and guards stale/hidden tabs).
    const rev = numOrNull(body?.rev) ?? 0;
    const farmers = Array.isArray(body?.farmers) ? body.farmers.slice(0, MAX_FARMERS) : [];
    const townHistory = body?.townHistory && typeof body.townHistory === 'object' ? body.townHistory : null;
    const townInventions = body?.townInventions && typeof body.townInventions === 'object' ? body.townInventions : null;
    if (!farmers.length && !townHistory && !townInventions) return send(res, 200, { ok: true, written: 0 });

    const base = (process.env.SUPERMEMORY_URL || DEFAULT_URL).replace(/\/+$/, '');
    const key = process.env.SUPERMEMORY_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    // the town's civic record — one upserting document per town (customId keeps it a single evolving doc)
    let townHistoryWritten = false;
    if (townHistory) {
        const doc = {
            content: townHistoryDoc(townHistory, body.town),
            customId: `ry-farms:townhistory:${townSeed}`,
            containerTags: ['ry-farms'],
            metadata: {
                app: 'ry-farms', kind: 'town-history', rev: String(rev), townSeed: String(townSeed),
                ...(body.town != null ? { town: String(body.town) } : {}),
            },
        };
        const out = await upsertDoc(base, headers, doc, rev);
        if (out.ok) townHistoryWritten = true;
        else if (out.stale) console.warn('[writeback] town-history skipped (stale rev)');
        else console.error('[writeback] town-history failed', out.status || '', out.text || out.err || '');
    }
    // #97 P5 — the town's book of inventions (one upserting doc per town)
    let townInventionsWritten = false;
    if (townInventions) {
        const doc = {
            content: townInventionsDoc(townInventions, body.town),
            customId: `ry-farms:towninventions:${townSeed}`,
            containerTags: ['ry-farms'],
            metadata: { app: 'ry-farms', kind: 'town-inventions', rev: String(rev), townSeed: String(townSeed),
                ...(body.town != null ? { town: String(body.town) } : {}) },
        };
        const out = await upsertDoc(base, headers, doc, rev);
        if (out.ok) townInventionsWritten = true;
        else if (out.stale) console.warn('[writeback] town-inventions skipped (stale rev)');
        else console.error('[writeback] town-inventions failed', out.status || '', out.text || out.err || '');
    }
    if (!farmers.length) return send(res, 200, { ok: true, written: (townHistoryWritten ? 1 : 0) + (townInventionsWritten ? 1 : 0), townHistoryWritten, townInventionsWritten, source: base });

    let written = 0;
    const persisted = [];
    for (const f of farmers) {
        // #Codex24-3: only ever write to a customId keyed by a REAL numeric (town, farmer) identity — skip a
        // malformed entry rather than fall back to a wildcard doc a caller could aim at.
        const fSeed = numOrNull(f?.seed);
        if (fSeed == null) continue;
        const doc = {
            content: lifeDoc(f, body.town),
            // a STABLE id per (town, farmer) so re-posting the same life UPSERTS instead of piling up
            // duplicate docs across repeated fresh boots (if the store honours customId; harmless if not)
            customId: `ry-farms:${townSeed}:${fSeed}`,
            // container + metadata tag every generated life so the READ side can exclude it (no feedback loop).
            // SuperMemory validates metadata values as STRINGS and rejects nulls — so stringify + drop empties.
            containerTags: ['ry-farms'],
            metadata: {
                app: 'ry-farms', kind: 'farmer-life', rev: String(rev),
                townSeed: String(townSeed), farmerSeed: String(fSeed),
                ...(f.sourceDocId != null ? { sourceDocId: String(f.sourceDocId) } : {}),
                ...(f.name != null ? { name: String(f.name) } : {}),
            },
        };
        const out = await upsertDoc(base, headers, doc, rev);
        if (out.ok) { written++; persisted.push(fSeed); }
        else if (out.stale) { /* a newer rev already landed for this farmer — skip silently */ }
        else console.error('[writeback] farmer-life failed', out.status || '', out.text || out.err || '');
    }
    // report which seeds landed so the client stamps exactly those (a partial write is fine + resumable)
    return send(res, 200, { ok: true, written, of: farmers.length, persisted, townHistoryWritten, townInventionsWritten, source: base });
};
