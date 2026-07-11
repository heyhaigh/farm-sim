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
const SKIP = new Set(['node_modules', '.git', '.agents', 'assets', '.supermemory', 'tests', 'v1-3d']);
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
console.log(`LLM chokepoint intact: every model call goes through ${ALLOW} (fail-closed, timed, budgeted, breakered).`);
