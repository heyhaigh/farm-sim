// tests/llm-chokepoint.mjs — COST-SAFETY guard. Fails if any file other than api/_llm.js reaches a
// chat-completions / OpenAI endpoint directly. This keeps the single fail-closed chokepoint enforced across
// future edits, so a stray fetch or a new endpoint can never silently reopen the paid-billing path.
//
//   node tests/llm-chokepoint.mjs      (exits non-zero on a violation — wire into CI / pre-push)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOW = 'api/_llm.js';                          // the ONLY file allowed to call a model endpoint
// `tools/` holds manually-run diagnostics that deliberately bypass the chokepoint — probe-llm.mjs
// exists precisely to measure raw provider limits, which it cannot do through a budgeted, breakered
// wrapper. That exemption is only safe because `tools/` never reaches production, and the assertion
// at the bottom of this file ENFORCES that rather than trusting it. Do not add a directory here
// without adding it there too.
const SKIP = new Set(['node_modules', '.git', '.agents', 'assets', '.supermemory', 'tests', 'tools', 'v1-3d']);
const BAN = [/chat\/completions/, /\bapi\.openai\.com\b/, /["']openai["']/, /new OpenAI\b/, /\/v1\/responses\b/];

const hits = [];
function walk(dir, rel = '') {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name), r = rel ? `${rel}/${name}` : name;
        if (statSync(p).isDirectory()) { walk(p, r); continue; }
        if (!/\.(js|mjs)$/.test(name) || r === ALLOW) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            for (const re of BAN) if (re.test(line)) hits.push(`  ${r}:${i + 1}  ${line.trim().slice(0, 90)}`);
        });
    }
}
walk(ROOT);

if (hits.length) {
    console.error(`LLM chokepoint VIOLATED — these reach a model endpoint outside ${ALLOW}:\n${hits.join('\n')}`);
    process.exit(1);
}

// The exempt directories are only safe if they CANNOT ship. `.dockerignore` is a deny-all allowlist
// and the Dockerfile copies named paths, so an exemption leaks into production only if someone adds
// it to one of those. Check both, because either alone would be enough to put a budget-bypassing
// script on the live server.
const EXEMPT_MUST_NOT_SHIP = ['tools', 'tests'];
const dockerignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const leaked = [];
for (const dir of EXEMPT_MUST_NOT_SHIP) {
    if (new RegExp(`^\\s*!${dir}\\b`, 'm').test(dockerignore)) leaked.push(`.dockerignore re-includes ${dir}/`);
    if (new RegExp(`^\\s*COPY\\b.*\\b${dir}/`, 'm').test(dockerfile)) leaked.push(`Dockerfile COPYs ${dir}/`);
}
if (leaked.length) {
    console.error(`CHOKEPOINT EXEMPTION LEAKED INTO THE IMAGE:\n  ${leaked.join('\n  ')}\n`
        + `  These directories are skipped by the chokepoint scan, so shipping them would put a\n`
        + `  budget-bypassing model caller on the live server.`);
    process.exit(1);
}

console.log(`LLM chokepoint intact: every model call goes through ${ALLOW} (fail-closed, timed, budgeted, breakered).`);
console.log(`Exempt dirs verified un-shippable: ${EXEMPT_MUST_NOT_SHIP.join(', ')}.`);
