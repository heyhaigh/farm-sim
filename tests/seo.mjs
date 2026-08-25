// tests/seo.mjs — the public discovery contract for a canvas-first game.
//
// Search and answer engines receive most of Propagate's meaning from the HTML head, the accessible page
// copy, the entity graph, and three named root files. Pin those surfaces together, then boot the real server
// to prove the canonical duplicate redirects without breaking query strings or the legacy host's saves.
//
// Run: `node tests/seo.mjs`

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

const ROOT = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8');
const html = read('index.html');
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');
const llms = read('llms.txt');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

assert.match(html, /<title>Propagate: Procedural AI Farm Simulation Game \| Ryan Haigh<\/title>/);
assert.match(html, /<meta name="description" content="[^"]*procedural,[^"]*farm simulation[^"]*">/);
assert.match(html, /<link rel="canonical" href="https:\/\/propagate\.world\/">/);
assert.equal((html.match(/<h1\b/g) || []).length, 1, 'the document must carry one semantic H1');
ok('title, description, canonical, and one H1 identify the game');

const scripts = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
const nodes = scripts.flatMap((script) => script['@graph'] || [script]);
const byId = new Map(nodes.filter((node) => node['@id']).map((node) => [node['@id'], node]));
const game = byId.get('https://propagate.world/#game');
assert.equal(game?.['@type'], 'VideoGame');
assert.equal(game?.url, 'https://propagate.world/');
assert.equal(game?.creator?.['@id'], 'https://heyhaigh.ai/#person');
assert.equal(game?.mainEntityOfPage?.['@id'], 'https://propagate.world/#webpage');
assert.equal(byId.get('https://propagate.world/#webpage')?.about?.['@id'], game['@id']);
assert.equal(byId.get('https://heyhaigh.ai/#person')?.name, 'Ryan Haigh');
assert.ok(nodes.some((node) => node['@type'] === 'FAQPage' && node.mainEntity?.length >= 5));
ok('JSON-LD connects the game, canonical page, creator, and FAQ facts');

assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Sitemap: https:\/\/propagate\.world\/sitemap\.xml$/m);
assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
assert.match(sitemap, /<loc>https:\/\/propagate\.world\/<\/loc>/);
assert.doesNotMatch(sitemap, /<changefreq>/);
assert.match(llms, /^# Propagate$/m);
assert.match(llms, /Ryan Haigh \(https:\/\/heyhaigh\.ai\)/);
assert.match(llms, /It does NOT call large language\s+models during play/);
ok('robots, sitemap, and llms.txt agree on canonical identity and facts');

const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close((err) => err ? reject(err) : resolve(port));
    });
});
const server = spawn(process.execPath, ['server.mjs', String(port)], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk; });

try {
    const base = `http://127.0.0.1:${port}`;
    let root;
    for (let attempt = 0; attempt < 40; attempt++) {
        try { root = await fetch(`${base}/`); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    assert.equal(root?.status, 200, `server did not start: ${stderr}`);
    assert.ok(root.headers.get('content-type')?.startsWith('text/html'));

    const duplicate = await fetch(`${base}/index.html?seed=424242&orc=1`, { redirect: 'manual' });
    assert.equal(duplicate.status, 308);
    assert.equal(duplicate.headers.get('location'), '/?seed=424242&orc=1');

    for (const [path, type] of [
        ['/robots.txt', 'text/plain'],
        ['/sitemap.xml', 'application/xml'],
        ['/llms.txt', 'text/plain'],
    ]) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200, `${path} must be served`);
        assert.ok(response.headers.get('content-type')?.startsWith(type), `${path} content type`);
    }
    ok('the real server serves discovery files and canonicalizes /index.html with its query intact');
} finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
        if (server.exitCode != null) return resolve();
        server.once('exit', resolve);
        setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 1000);
    });
}

console.log(`seo: ${passed} checks passed`);
