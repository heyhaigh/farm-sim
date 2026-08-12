// postcard.js — #postcard the share loop. The sim is deterministic, so a town's seed IS the town:
// a link carrying the seed (plus the culture flag an orc town needs, since a resumed orc town's URL
// drops it) will found the very same land for whoever opens it. This module is off-sim and shared by
// BOTH ends of the postcard: main.js mints the link + clipboard line the sender copies, and
// server.mjs injects the town's name into the share-card tags a scraper reads from that link.
// Node-safe on purpose (farm.js already is — the headless tests run the whole sim) so the server can
// name a town it has never simulated and tests/postcard.mjs can pin the contract.

import { generateTownName } from './farm.js';

const PUBLIC_ORIGIN = 'https://propagate.heyhaigh.ai';   // matches index.html's static og:url

// The ONE reading of a query's town identity — seed and culture. The boot (main.js) and the OG
// preview (postcardMeta) MUST agree byte-for-byte, because a preview that names a different town
// than the click founds is exactly the contract failure this module exists to prevent — so BOTH
// consume this helper (Codex #123-3: each side keeping its own parseInt was a green-suite
// divergence waiting to happen). Junk parses to 0 — a valid town, the same one the boot founds.
export function queryTown(params) {
    const raw = params.get('seed');
    const hasSeed = raw != null && raw !== '';
    return {
        hasSeed,
        seed: hasSeed ? (parseInt(raw, 10) >>> 0) : null,
        culture: (params.get('orc') != null || params.get('culture') === 'orc') ? 'orc' : 'human',
    };
}

// The sender's half: the URL a recipient opens and the line that travels with it.
// `pc=1` marks the arrival so the founding boot can greet it (and the funnel can count it);
// a reload of the same URL resumes the town and stays quiet.
export function buildPostcard({ seed, name, day, year, culture, origin }) {
    const s = seed >>> 0;
    const url = `${origin || PUBLIC_ORIGIN}/?seed=${s}${culture === 'orc' ? '&orc=1' : ''}&pc=1`;
    const when = year > 1 ? `year ${year}, day ${day}` : `day ${day}`;
    const text = `A postcard from ${name} (${when}).\nThis exact town will grow for you too: ${url}`;
    return { url, text };
}

// The scraper's half: share-card fields for a link that carries a seed. Returns null when the
// query names no seed (the plain page's static tags stand).
export function postcardMeta(params) {
    const q = queryTown(params);
    if (!q.hasSeed) return null;
    const name = generateTownName(q.seed, q.culture);
    return {
        title: `${name} — Propagate`,
        description: `A postcard from ${name}. This exact town will grow for you too — a procedural, AI-driven farm sim, free in your browser.`,
        url: `${PUBLIC_ORIGIN}/?seed=${q.seed}${q.culture === 'orc' ? '&orc=1' : ''}`,
    };
}

// Swap the five share-card values inside the served index.html. Attribute-targeted replaces, not a
// template: index.html stays a plain valid page (python http.server, file://, the deploy repo all
// serve it untouched) and the injection can only ever touch the tags it names.
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function injectOgTags(html, meta) {
    const swap = (h, attr, key, value) =>
        h.replace(new RegExp(`(${attr}="${key}" content=")[^"]*(")`), (_, a, b) => a + escapeAttr(value) + b);
    let out = html;
    out = swap(out, 'property', 'og:title', meta.title);
    out = swap(out, 'property', 'og:description', meta.description);
    out = swap(out, 'property', 'og:url', meta.url);
    out = swap(out, 'name', 'twitter:title', meta.title);
    out = swap(out, 'name', 'twitter:description', meta.description);
    return out;
}
