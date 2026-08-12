// postcard.js — #postcard the share loop. The sim is deterministic, so a town's seed IS the town:
// a link carrying the seed (plus the culture flag an orc town needs, since a resumed orc town's URL
// drops it) will found the very same land for whoever opens it. This module is off-sim and shared by
// BOTH ends of the postcard: main.js mints the link + clipboard line the sender copies, and
// server.mjs injects the town's name into the share-card tags a scraper reads from that link.
// Node-safe on purpose (farm.js already is — the headless tests run the whole sim) so the server can
// name a town it has never simulated and tests/postcard.mjs can pin the contract.

import { generateTownName } from './farm.js';

const PUBLIC_ORIGIN = 'https://propagate.heyhaigh.ai';   // matches index.html's static og:url

// The client boot's exact seed coercion (main.js): parseInt >>> 0, so junk parses to 0 — the meta
// must name the SAME town the boot would found, garbage in or not.
function coerceSeed(raw) { return parseInt(raw, 10) >>> 0; }

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
    const raw = params.get('seed');
    if (raw == null || raw === '') return null;
    const seed = coerceSeed(raw);
    const culture = (params.get('orc') != null || params.get('culture') === 'orc') ? 'orc' : 'human';
    const name = generateTownName(seed, culture);
    return {
        title: `${name} — Propagate`,
        description: `A postcard from ${name}. This exact town will grow for you too — a procedural, AI-driven farm sim, free in your browser.`,
        url: `${PUBLIC_ORIGIN}/?seed=${seed}${culture === 'orc' ? '&orc=1' : ''}`,
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
