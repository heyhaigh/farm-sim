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

// Enrich every farmer whose story is composer-generation (v2) but not yet LLM-written.
// `isCurrent` guards against the response landing after a NEW-town reset. Returns the
// number of tales applied (0 = nothing to do / failed — either way the game is whole).
export async function enrichStories(world, isCurrent = () => true) {
    if (typeof fetch !== 'function' || inflight) return 0;
    if (Date.now() - lastFailAt < DM_RETRY_COOLDOWN_MS) return 0;
    const pending = world.farmers.filter(f =>
        f.sheet.story && (f.sheet.story.v || 1) >= 2 && !f.sheet.story.llm && f.sheet.dream);
    if (!pending.length) return 0;

    inflight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DM_TIMEOUT_MS);
    try {
        const res = await fetch(DM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                town: { name: (world.name || 'PROPAGATE'), seed: world.seed, day: world.day, season: world.seasonName },
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
        if (applied) world.addLog(`The chronicler set down ${applied} settlers' histories in a finer hand.`, '#c9a45a');
        return applied;
    } catch (err) {
        lastFailAt = Date.now();
        console.warn('ry-farms: DM enrichment unavailable (procedural tales stand)', err?.message || err);
        return 0;
    } finally {
        clearTimeout(timeout);
        inflight = false;
    }
}
