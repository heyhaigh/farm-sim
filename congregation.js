// congregation.js — client side of the DAY-1 FOUNDING CONVERSATION (#132b). Once, when a fresh town opens on
// its founding congregation, the founding cast (names + personalities + what each was grown from) is sent to
// /api/ry-farms-congregation, and the returned turn-by-turn script is handed to the sim's congregation director
// (world._foundingScript). DISPLAY TEXT ONLY: the director reads it to choose what each founder SAYS; the sim
// never reads it, so the seeded world stays deterministic whether or not the model answers. Any failure at all
// (offline, no LLM, bad response, slow) simply leaves the director's authored offline pools carrying the scene.

const CONG_ENDPOINT = '/api/ry-farms-congregation';
const CONG_TIMEOUT_MS = 30000;   // one generation, kicked at boot; the offline pools cover the wait

let inflight = false;
let doneFor = null;              // town seed we've already asked for (once per town, ever)

function shortNameOf(f) { return f.sheet.name.split(' ')[0]; }

// the founder view the model writes against — only what THEY are (knowledge hygiene, like dm.js/conscience.js)
function founderView(f) {
    const s = f.sheet, p = s.personality;
    return {
        name: shortNameOf(f),
        archetype: s.archetype || null,
        personality: p ? { label: p.label, creed: p.creed } : null,
        keepsake: s.memory && String(s.memory.title || '').slice(0, 60),
        dream: s.dream ? s.dream.yearn : null,
    };
}

// Kick the generation for `world` if it's a fresh founding congregation we haven't asked about yet. Fire-and-
// forget: it stores world._foundingScript when (if) it arrives; the director swaps it in from that turn on.
export async function requestCongregation(world) {
    if (!world || typeof world.congregating !== 'function' || !world.congregating()) return;
    if (inflight || doneFor === world.seed) return;
    const founders = world.farmers.slice(0, 8);
    if (founders.length < 2) return;
    inflight = true; doneFor = world.seed;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONG_TIMEOUT_MS);
    try {
        const res = await fetch(CONG_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ culture: world.culture, founders: founders.map(founderView) }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`congregation endpoint ${res.status}`);
        const data = await res.json();
        if (!data || data.fallback || !Array.isArray(data.script)) throw new Error(data?.error || 'no script');
        // map each turn's speaker NAME back to a founder seed, so the director voices the intended founder
        const byName = new Map(founders.map(f => [shortNameOf(f).toLowerCase(), f.sheet.seed]));
        const script = [];
        for (const t of data.script) {
            const seed = byName.get(String(t.speaker || '').trim().toLowerCase());
            const text = String(t.line || '').trim();
            if (seed != null && text) script.push({ seed, text });
        }
        // only adopt it if the town is STILL congregating (a slow answer that lands after the scene is useless)
        if (script.length >= 4 && world.congregating()) world._foundingScript = script;
    } catch {
        /* any failure: the director's authored offline pools stand in — nothing to do */
    } finally {
        clearTimeout(timer);
        inflight = false;
    }
}
