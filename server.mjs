// server.mjs — the Propagate server: static files + the /api/* expressive-channel endpoints
// (LLM chat + the DM's writing desk). Node built-ins only, no dependencies.
//
// It wears two hats, and NODE_ENV=production is the switch (the Dockerfile sets it):
//   dev  — no-store on everything, so an edit always lands on reload. Unchanged behaviour.
//   prod — caching + gzip, because a hosted deploy is a network away rather than a disk away.
//          See CACHING below for why each rule is what it is.
//
//   node server.mjs [port]        (default 8000)
//
// Reads OPENAI_API_KEY (and optional RY_FARMS_LLM_MODEL) from a gitignored .env in
// this directory or from the environment. Without a key the game runs exactly as
// before — the api handlers answer { fallback: true } and the procedural text stands.
// The old `python3 -m http.server` still works too; you just get no LLM channel.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(new URL(import.meta.url).pathname);
// An explicit CLI port still wins (the documented `node server.mjs 8123` local habit); otherwise take
// PORT from the environment, which is how a host like Railway tells us where to listen.
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8000;

// minimal .env loader (never overrides a var already set in the environment)
try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* no .env — fine, handlers fall back */ }

// API routes -> module path. Handlers are (re)loaded PER REQUEST with the /api require-cache cleared first,
// so editing a handler lands on the next request with no server restart — matching the static files'
// "edits always land" contract. (The old map required each handler ONCE at boot, so an edited handler stayed
// frozen at its start-of-process version — e.g. memory-graph kept returning the old shape after a rewrite.)
// #freequota the endpoints that reach the model (everything else — knowledge-graph, writeback — is exempt)
const LLM_ROUTES = new Set(['/api/ry-farms-chat', '/api/ry-farms-dm', '/api/ry-farms-conscience',
    '/api/ry-farms-congregation', '/api/ry-farms-raid-council', '/api/ry-farms-invent']);
// Two windows per IP: a burst window (40 per 10 minutes — a whisper costs 2 requests, chat 1 per message,
// so this is ~20 whispers or 40 chat turns in ten minutes, generous for a human) and a daily cap (400).
const LLM_IP_BURST = 40, LLM_IP_BURST_MS = 10 * 60_000;
const LLM_IP_DAY = 400, LLM_IP_DAY_MS = 24 * 60 * 60_000;
const _llmIp = new Map();   // ip -> { b: count, bStart, d: count, dStart }
function takeLlmToken(ip) {
    const now = Date.now();
    let e = _llmIp.get(ip);
    if (!e) { e = { b: 0, bStart: now, d: 0, dStart: now }; _llmIp.set(ip, e); }
    if (now - e.bStart > LLM_IP_BURST_MS) { e.b = 0; e.bStart = now; }
    if (now - e.dStart > LLM_IP_DAY_MS) { e.d = 0; e.dStart = now; }
    if (e.b >= LLM_IP_BURST || e.d >= LLM_IP_DAY) return false;
    e.b++; e.d++;
    // bounded memory: prune stale entries once the table grows past a few thousand IPs
    if (_llmIp.size > 5000) for (const [k, v] of _llmIp) { if (now - v.dStart > LLM_IP_DAY_MS) _llmIp.delete(k); }
    return true;
}

const API_ROUTES = {
    '/api/knowledge-graph': './api/knowledge-graph.js',
    '/api/memory-writeback': './api/memory-writeback.js',
    '/api/memory-graph': './api/memory-graph.js',
    '/api/ry-farms-chat': './api/ry-farms-chat.js',
    '/api/ry-farms-dm': './api/ry-farms-dm.js',
    '/api/ry-farms-conscience': './api/ry-farms-conscience.js',
    '/api/ry-farms-congregation': './api/ry-farms-congregation.js',
    '/api/ry-farms-raid-council': './api/ry-farms-raid-council.js',
    '/api/ry-farms-invent': './api/ry-farms-invent.js',
};
const API_DIR = path.join(ROOT, 'api');
function loadHandler(rel) {
    // drop every cached module living under /api so a handler AND its local deps (e.g. _llm.js) re-read disk
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(API_DIR + path.sep)) delete require.cache[key];
    }
    return require(rel);
}

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'video/webm',   // #memory-intro the reveal's memory-web animation
    // NOTE: .md is deliberately absent. This map doubles as the serve allowlist, and markdown is never
    // game media — leaving it in would hand over any internal doc that reached the deploy directory.
};

// ---------------------------------------------------------------------------
// CACHING + COMPRESSION (production only — dev keeps the "edits always land" contract)
//
// A hosted boot pulls 176 asset files (measured) plus ~1.86MB of JS, and the dev server's
// no-store meant EVERY visit and every reload re-downloaded all of it. The two rules differ
// because the two kinds of file version differently:
//
//   /assets/**  long max-age. The art is addressed by stable filename and effectively never
//               changes; it is also the bulk of the bytes. 30 days, not a year+immutable,
//               because the names carry no content hash — a replaced sprite has to be able to
//               reach people without a rename.
//   everything  no-cache, which means REVALIDATE, not "don't store". index.html asks for
//   else       ./main.js with no version in the name, so a long max-age would serve stale code
//               against new markup after a deploy. Paired with an ETag, a repeat visit costs a
//               conditional request and a 304 instead of the full payload.
//
// The ETag is size+mtime rather than a content hash: no large file gets read to answer a
// request that is about to 304 anyway.
// ---------------------------------------------------------------------------
const PROD = process.env.NODE_ENV === 'production';
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const gzipCache = new Map();   // file -> { key, buf }. Text only, so this stays under ~1MB.

function cacheControl(rel) {
    if (!PROD) return 'no-store, no-cache, must-revalidate, max-age=0';
    return rel.startsWith('/assets/') ? 'public, max-age=2592000' : 'no-cache';
}
// gzip once per (file, version) and keep the buffer: the files are static, so recompressing
// 920KB of farm.js on every request would be pure waste.
function gzipFor(file, key, data) {
    const hit = gzipCache.get(file);
    if (hit && hit.key === key) return hit.buf;
    const buf = zlib.gzipSync(data, { level: 6 });
    gzipCache.set(file, { key, buf });
    return buf;
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // #buildrev WHICH BUILD IS THIS? Codex #64-2: the release check used to be `curl main.js | wc -c`, which
    // prints a number and exits 0 whatever it finds — it cannot fail, two different revisions of equal size
    // are indistinguishable, and it says nothing about index.html or the mobile entry. A deploy that
    // succeeds while serving an older image is a failure mode we have actually hit, so the image now states
    // its own revision and the release step asserts on it.
    // Railway injects RAILWAY_GIT_COMMIT_SHA; BUILD_REV is the manual override for anywhere that doesn't.
    if (url.pathname === '/api/build') {
        // Codex #65-2: RAILWAY_GIT_COMMIT_SHA FIRST. It is the platform's own record of which commit triggered
        // this container; BUILD_REV is a value a human typed. Letting the manual one win would allow the
        // endpoint to echo the expected revision without proving anything about what is actually running —
        // the exact failure the assertion exists to catch. BUILD_REV is the fallback for non-Railway hosts.
        const rev = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_REV || 'unknown';
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ rev }));
        return;
    }

    // /llms.txt — context for AI crawlers (the llms.txt convention). Served by EXACT NAME, deliberately
    // not by adding .txt to the MIME allowlist: that map doubles as the serve allowlist, and opening the
    // whole extension would hand over any stray .txt that reached the deploy directory.
    if (url.pathname === '/llms.txt') {
        fs.readFile(path.join(ROOT, 'llms.txt'), (err, buf) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(buf);
        });
        return;
    }

    const apiRel = API_ROUTES[url.pathname];
    // #freequota PER-IP FAIR SHARE for the LLM-backed endpoints. The model provider is a shared FREE tier
    // (~14.4k requests/day): _llm.js's global budget stops runaway totals, but without this one enthusiastic
    // player could drink the whole town's daily quota. A rejected request returns the exact fallback shape
    // every client already handles — the player gets the offline keyword/template behaviour, not an error.
    // In-process Maps are fine: Railway runs one instance, and a restart forgiving the counters is acceptable.
    if (apiRel && LLM_ROUTES.has(url.pathname)) {
        const ip = req.headers['cf-connecting-ip']
            || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket.remoteAddress || 'unknown';
        if (!takeLlmToken(ip)) {
            // #funnel (Codex #98 P1-2, corrected in #99 P1-1) — this rejection never reaches the
            // conscience handler, so without recording it a locally throttled whisper is missing
            // from the hit/fallback denominator and the LLM-hit rate reads higher than it is.
            //
            // ONLY the conscience route. The limiter guards six LLM routes; counting chat, DM,
            // congregation, raid-council and invention throttles as whisper failures was the
            // opposite error — a telemetry channel contaminated by five unrelated endpoints.
            //
            // The stage (classify vs reply) is unknowable without parsing a body we deliberately do
            // not parse on a rejection path, so it lands in 'unattributed' — a legitimate attempt
            // the player did not get, counted toward the headline rate.
            //
            // Through the SHARED recorder, not by touching the counters directly (Codex #100 P1-1).
            // Railway stdout is the only telemetry sink there is: incrementing a global without
            // running the throttled emitter meant a burst of throttled whispers followed by quiet —
            // or a restart — disappeared entirely. Recording and emitting are one operation.
            if (url.pathname === '/api/ry-farms-conscience') {
                require('./api/_whisper-telemetry.js').noteWhisper('unattributed', false, 'rate-limited-local');
            }
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '600' });
            res.end(JSON.stringify({ fallback: true, error: 'rate limited - offline fallback' }));
            return;
        }
    }
    if (apiRel) {
        try { const api = loadHandler(apiRel); await api(req, res); }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ fallback: true, error: err?.message || 'handler crashed' }));
        }
        return;
    }

    // STATIC. This started as a localhost dev server and is now what faces the internet on a hosted
    // deploy, so it serves an ALLOWLIST rather than "whatever is on disk". The project root holds .env
    // (api keys) and .supermemory/ (auth-secret + personal documents); an over-broad CLI deploy once put
    // that pair on a public URL, and `GET /.supermemory/api-key` answered 200. What gets uploaded must
    // not be the only thing standing between those files and a request.
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // 1. no dotfile segments — kills /.env, /.supermemory/..., /.vercel/..., /.git/... outright
    if (rel.split('/').some(seg => seg.startsWith('.'))) { res.writeHead(404); res.end('not found'); return; }

    // 2. stay inside ROOT. startsWith(ROOT) alone is a bare string prefix, so a sibling directory
    //    (ry-farms-backup) would pass it — compare against ROOT + separator.
    const file = path.normalize(path.join(ROOT, rel));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }

    // 3. known game media only. The old default of application/octet-stream meant an unrecognised
    //    extension — an internal .md, a stray backup, a key file — was still handed over.
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext];
    if (!type) { res.writeHead(404); res.end('not found'); return; }

    fs.stat(file, (serr, st) => {
        if (serr || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
        const headers = { 'Content-Type': type, 'Cache-Control': cacheControl(rel) };
        const canZip = PROD && COMPRESSIBLE.has(ext);
        // Vary goes on every compressible response, hit or 304 — otherwise a shared cache could
        // hand a gzipped body to a client that never asked for one.
        if (canZip) headers['Vary'] = 'Accept-Encoding';

        const etag = `W/"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
        if (PROD) {
            headers['ETag'] = etag;
            if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
        }

        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            let body = data;
            if (canZip && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
                body = gzipFor(file, etag, data);
                headers['Content-Encoding'] = 'gzip';
            }
            res.writeHead(200, headers);
            res.end(body);
        });
    });
}).listen(PORT, () => {
    // the resolved, fail-closed status comes straight from the chokepoint (single source of truth)
    const { llmStatus } = require('./api/_llm.js');
    console.log(`ry-farms on http://localhost:${PORT}  (LLM ${llmStatus()})`);
});
