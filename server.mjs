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
const { clientIP, localRequest, readJSON, RequestLimits } = require('./api/_request-guards.js');
const requestLimits = new RequestLimits();
const LOCAL_ROUTES = new Set(['/api/knowledge-graph', '/api/memory-graph', '/api/memory-writeback']);
function rejectRequest(req, res, status, retry) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Connection': 'close', ...(retry ? { 'Retry-After': String(retry) } : {}) });
    res.end(JSON.stringify({ fallback: true, error: status === 429 ? 'rate limited - offline fallback' : 'request refused' }));
    // Flush the response, then stop receiving an oversized or deliberately stalled upload.
    res.on('finish', () => req.destroy());
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
// #postcard — lazy so farm.js (the town-name tables ride in it) parses on the first shared-link
// hit, not at boot. Dev note: like any non-/api module, editing postcard.js needs a server restart.
let _postcard;
const postcardModule = () => (_postcard ??= import('./postcard.js'));
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
    let url;
    try { url = new URL(req.url, `http://localhost:${PORT}`); }
    catch { rejectRequest(req, res, 400); return; }

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

    // Crawler-facing root files, served by EXACT NAME — deliberately not by adding .txt/.xml to the
    // MIME allowlist: that map doubles as the serve allowlist, and opening a whole extension would
    // hand over any stray file that reached the deploy directory. llms.txt is context for AI answer
    // engines (the llms.txt convention); robots.txt welcomes their crawlers; sitemap.xml is the
    // durable index signal for the propagate.world Search Console property (#geo, 2026-08-14).
    const NAMED_ROOT = {
        '/llms.txt': ['llms.txt', 'text/plain; charset=utf-8'],
        '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
        '/sitemap.xml': ['sitemap.xml', 'application/xml; charset=utf-8'],
    };
    if (NAMED_ROOT[url.pathname]) {
        const [file, type] = NAMED_ROOT[url.pathname];
        fs.readFile(path.join(ROOT, file), (err, buf) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
            res.end(buf);
        });
        return;
    }

    // One document, one indexable URL. Preserve the query string (including postcard seeds) and the
    // current host: the legacy host remains a first-class origin because its IndexedDB saves cannot move.
    if (url.pathname === '/index.html') {
        res.writeHead(308, { 'Location': `/${url.search}`, 'Cache-Control': 'no-cache' });
        res.end();
        return;
    }

    const apiRel = API_ROUTES[url.pathname];
    if (apiRel && LOCAL_ROUTES.has(url.pathname) && !localRequest(req)) {
        if (url.pathname === '/api/memory-writeback') { rejectRequest(req, res, 403); return; }
        // Public play uses embedded/local-browser memories, never the developer's private store.
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(url.pathname === '/api/knowledge-graph'
            ? { documents: [], lineage: [], source: 'offline' }
            : { towns: [], farmers: [], links: [], source: 'offline' }));
        return;
    }
    if (apiRel) {
        let permit;
        try {
            if (LLM_ROUTES.has(url.pathname)) {
                if (req.method !== 'POST') { rejectRequest(req, res, 405); return; }
                permit = requestLimits.acquire(clientIP(req), url.pathname === '/api/ry-farms-conscience' ? 'interactive' : 'background');
                if (!permit.release) {
                    if (url.pathname === '/api/ry-farms-conscience') {
                        require('./api/_whisper-telemetry.js').noteWhisper('unattributed', false, 'rate-limited-local');
                    }
                    rejectRequest(req, res, permit.status, permit.retry); return;
                }
                try { req.body = await readJSON(req); }
                catch (error) {
                    if (url.pathname === '/api/ry-farms-conscience') {
                        require('./api/_whisper-telemetry.js').noteWhisper('invalid', false, 'bad-body');
                    }
                    rejectRequest(req, res, error.status || 400); return;
                }
            }
            const api = loadHandler(apiRel); await api(req, res);
        } catch (err) {
            console.error('[api] handler failed', url.pathname, err?.name || 'Error');
            if (!res.headersSent) rejectRequest(req, res, 500);
            else res.end();
        } finally { permit?.release?.(); }
        return;
    }

    // #postcard — a shared town link (/?seed=N[&orc=1]) gets its town's NAME injected into the
    // share-card tags, so the iMessage/Slack/X preview reads "Stonestead — Propagate" instead of the
    // generic card. Deterministic: the name comes from the seed alone (postcard.js → farm.js), no sim
    // run. Served without a validator on purpose — the variant differs per query and the plain page's
    // size+mtime ETag would collide across seeds; these are scraper/click-through hits, a full 200 is
    // fine. Any failure falls through to the untouched static page.
    if (url.searchParams.has('seed') && url.pathname === '/') {
        try {
            const { postcardMeta, injectOgTags } = await postcardModule();
            const meta = postcardMeta(url.searchParams);
            if (meta) {
                const html = injectOgTags(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), meta);
                const headers = { 'Content-Type': MIME['.html'], 'Cache-Control': cacheControl('/index.html'), 'Vary': 'Accept-Encoding' };
                let body = Buffer.from(html);
                if (PROD && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
                    body = zlib.gzipSync(body, { level: 6 });   // inline, NOT gzipFor — its per-file cache would serve one seed's page for every seed
                    headers['Content-Encoding'] = 'gzip';
                }
                res.writeHead(200, headers); res.end(body);
                return;
            }
        } catch (err) { console.warn('ry-farms: postcard tag injection failed - serving the plain page', err?.message || err); }
    }

    // STATIC. This started as a localhost dev server and is now what faces the internet on a hosted
    // deploy, so it serves an ALLOWLIST rather than "whatever is on disk". The project root holds .env
    // (api keys) and .supermemory/ (auth-secret + personal documents); an over-broad CLI deploy once put
    // that pair on a public URL, and `GET /.supermemory/api-key` answered 200. What gets uploaded must
    // not be the only thing standing between those files and a request.
    let rel;
    try { rel = path.posix.normalize(decodeURIComponent(url.pathname)); }
    catch { rejectRequest(req, res, 400); return; }
    if (rel.startsWith('/api/') || rel === '/server.mjs') { res.writeHead(404); res.end('not found'); return; }
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
