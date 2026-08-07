// dm.js — the LLM chronicler's visit (#92 stage 2): client side of the expressive channel.
//
// Once per town, after boot, the founding cast's sheets (plus their procedural draft
// tales) are sent to /api/ry-farms-dm, and the returned fantasy prose replaces each
// farmer's story.tale. DISPLAY TEXT ONLY: the sim never reads story.tale, so the seeded
// world stays deterministic whether or not the chronicler ever answers. Enriched tales
// are stamped story.llm = true and live on the sheet, so the existing save carries them;
// a farmer is asked about exactly once per town, ever. Offline / no key / bad response —
// any failure at all — simply leaves the stage-1 procedural tale standing.

const DM_ENDPOINT = '/api/ry-farms-dm';
const DM_TIMEOUT_MS = 60000;          // one big generation, not a chat turn
const DM_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let inflight = false;
let lastFailAt = -Infinity;

// same bitmap-font sanitation as the server (belt and braces — the tale goes straight
// into drawText): straight quotes, spaced hyphens, printable ASCII, whitespace collapsed
function cleanTale(text) {
    let s = String(text || '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, ' - ')
        .replace(/…/g, '...')
        .replace(/\s+/g, ' ')
        .trim();
    return s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function characterOf(f) {
    const s = f.sheet, p = s.personality;
    return {
        seed: s.seed,
        name: s.name,
        shortName: s.name.split(' ')[0],
        trade: s.archetype,                    // their farming persona (greeter, builder...)
        background: s.story.bg,                // the 5e background the DM already rolled
        stats: s.stats,
        personality: { label: p.label, creed: p.creed },
        ideal: s.story.ideal,
        bond: s.story.bond,
        flaw: s.story.flaw,
        dream: { yearn: s.dream.yearn, rivalName: s.dream.rivalName || null },
        keepsake: String((s.memory && s.memory.title) || 'a life before the valley').slice(0, 40),
        draft: s.story.tale,                   // the procedural tale, offered as raw material
    };
}

// #dm-batch1 — enrich ONE farmer per pass, not the whole cast at once.
//
// The old shape asked for every un-enriched founder in a single request, and that was wrong in
// three ways at the same time (Codex #104 P1-1, all three measured 2026-08-07):
//
//   1. TRUNCATION. An eight-founder payload is 9,376 characters and callLLM caps user content at
//      8,000 — so the prompt arrived as JSON cut mid-object. Every request, silently.
//   2. TOKENS. Eight tales at 120-180 words each need ~2,500 completion tokens. The free tier meters
//      6k per MINUTE and counts the REQUESTED size, so one founding reserved the whole minute and
//      starved every other call in it.
//   3. IT FED A UI THAT SHOWS ONE. main.js renders story.tale inside a single farmer's sheet — the
//      cast is never displayed together. We were generating eight biographies to satisfy a view
//      that displays one, most of which a player never opens.
//
// One farmer per pass: 1,282 characters in (6x under the cap) and 260 completion tokens out,
// measured against real Groq. It cannot truncate, cannot burst, and "one tale per requested seed"
// becomes trivially checkable because there is exactly one.
//
// The procedural draft is already complete and already on screen, so nobody ever waits — the LLM
// upgrade lands later, farmer by farmer, and the budget follows the player's attention instead of
// being spread evenly over seven strangers. `preferSeed` lets an opened sheet jump the queue.
// seed -> when this farmer last failed to produce a usable tale. Long enough that a genuinely bad
// draft stops blocking the cast, short enough that a transient upstream wobble is retried.
const seedFailAt = new Map();
const SEED_RETRY_MS = 15 * 60 * 1000;

export async function enrichStories(world, isCurrent = () => true, preferSeed = null) {
    if (typeof fetch !== 'function' || inflight) return 0;
    if (Date.now() - lastFailAt < DM_RETRY_COOLDOWN_MS) return 0;
    const waiting = world.farmers.filter(f =>
        f.sheet.story && (f.sheet.story.v || 1) >= 2 && !f.sheet.story.llm && f.sheet.dream);
    if (!waiting.length) return 0;

    // Stable order so repeated passes work down the cast deterministically, BUT skip seeds that
    // have already failed recently (Codex #105 P1-3). Lowest-seed-always was head-of-line blocking:
    // one farmer whose draft reliably produces a short or malformed tale was picked again after
    // every cooldown — Codex reproduced the sequence [1,1] — and the other seven were never
    // attempted at all. A per-seed cooldown rotates past the sticking point instead of starving
    // the cast behind it.
    const now = Date.now();
    const ready = waiting.filter(f => (seedFailAt.get(f.sheet.seed) || 0) + SEED_RETRY_MS < now);
    // Everyone is in cooldown: fall back to the whole list rather than stalling forever, so a bad
    // minute for the endpoint does not permanently freeze enrichment.
    const pool = ready.length ? ready : waiting;
    const chosen = (preferSeed != null && pool.find(f => f.sheet.seed === preferSeed))
        || pool.slice().sort((a, b) => a.sheet.seed - b.sheet.seed)[0];
    const pending = [chosen];

    inflight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DM_TIMEOUT_MS);
    try {
        const res = await fetch(DM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                town: { name: (world.name || 'PROPAGATE'), seed: world.seed, day: world.day, season: world.seasonName, culture: world.culture },
                characters: pending.map(characterOf),
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`dm endpoint ${res.status}`);
        const data = await res.json();
        if (data?.fallback) throw new Error(data.error || 'dm endpoint requested fallback');
        if (!isCurrent()) return 0;   // town was reset while the chronicler was writing

        let applied = 0;
        for (const t of data.tales || []) {
            const f = pending.find(x => x.sheet.seed === Number(t.seed));
            const tale = cleanTale(t.tale);
            if (f && tale.length >= 200) {
                f.sheet.story.tale = tale;
                f.sheet.story.llm = true;
                applied++;
            }
        }
        // Nothing applied means THIS farmer is the problem (a short tale, a missing seed, a draft
        // the model keeps choking on). Mark the seed so the next pass moves on to someone else.
        if (!applied) seedFailAt.set(chosen.sheet.seed, Date.now());
        if (applied) world.addLog(`The chronicler set down ${chosen.sheet.name.split(' ')[0]}'s history in a finer hand.`, '#c9a45a');
        return applied;
    } catch (err) {
        lastFailAt = Date.now();
        seedFailAt.set(chosen.sheet.seed, Date.now());   // rotate past this farmer next pass
        console.warn('ry-farms: DM enrichment unavailable (procedural tales stand)', err?.message || err);
        return 0;
    } finally {
        clearTimeout(timeout);
        inflight = false;
    }
}
