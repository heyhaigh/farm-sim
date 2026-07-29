// server.mjs — local dev server for Propagate: static files (no-cache, so edits always
// land on hard reload) + the /api/* expressive-channel endpoints (LLM chat + the DM's
// writing desk). Node built-ins only, no dependencies.
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
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    // NOTE: .md is deliberately absent. This map doubles as the serve allowlist, and markdown is never
    // game media — leaving it in would hand over any internal doc that reached the deploy directory.
};

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    const apiRel = API_ROUTES[url.pathname];
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
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) { res.writeHead(404); res.end('not found'); return; }

    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        });
        res.end(data);
    });
}).listen(PORT, () => {
    // the resolved, fail-closed status comes straight from the chokepoint (single source of truth)
    const { llmStatus } = require('./api/_llm.js');
    console.log(`ry-farms on http://localhost:${PORT}  (LLM ${llmStatus()})`);
});
