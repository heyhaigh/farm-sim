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
// Codex #104 P3-7: the first version only matched `!tools` and `COPY ... tools/`, so valid forms
// slipped past — `!./tools/**`, `COPY tools ./tools` (no slash), and JSON-form `COPY ["tools", ...]`.
// The current Dockerfile is safe either way; the point is that the GUARD must be, so a future edit
// cannot ship an exempt directory through a syntax this check never learned to read.
for (const dir of EXEMPT_MUST_NOT_SHIP) {
    // any re-include line naming the dir: !tools, !./tools/**, ! tools/, !/tools
    if (new RegExp(`^\\s*!\\s*\\.?/?${dir}(/|\\b)`, 'm').test(dockerignore)) {
        leaked.push(`.dockerignore re-includes ${dir}/`);
    }
    // any COPY/ADD mentioning the dir as a source, shell-form or JSON-form, with or without a slash
    for (const line of dockerfile.split('\n')) {
        if (!/^\s*(COPY|ADD)\b/i.test(line)) continue;
        if (/^\s*(COPY|ADD)\b[^#]*--from=/i.test(line)) continue;   // multi-stage copies are not repo paths
        if (new RegExp(`(^|[\\s"'\\[,=])\\.?/?${dir}(/|["'\\s,\\]]|$)`).test(line)) {
            leaked.push(`Dockerfile ${line.trim().slice(0, 60)}`);
        }
    }
}
if (leaked.length) {
    console.error(`CHOKEPOINT EXEMPTION LEAKED INTO THE IMAGE:\n  ${leaked.join('\n  ')}\n`
        + `  These directories are skipped by the chokepoint scan, so shipping them would put a\n`
        + `  budget-bypassing model caller on the live server.`);
    process.exit(1);
}

console.log(`LLM chokepoint intact: every model call goes through ${ALLOW} (fail-closed, timed, budgeted, breakered).`);
console.log(`Exempt dirs verified un-shippable: ${EXEMPT_MUST_NOT_SHIP.join(', ')}.`);
