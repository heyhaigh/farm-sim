// memory-invent.js — #97 P5 client half of the generative-crafting flavour + persistence layer.
//
// enrichInventions(): asks /api/ry-farms-invent to NAME + tell the lore of each generatively-discovered
// recipe, and stashes it in world.recipeFlavor — the DISPLAY shadow store (excluded from the sim digest, so
// LLM-on ≡ LLM-off; the procedural name stands if the LLM is unavailable). Content-addressed: one call per
// canonical key, ever.
// persistTownInventions(): writes the town's book of inventions to self-hosted SuperMemory (recipe nodes off
// the town hub, sibling to the town-history doc). Both off the sim loop, best-effort.

const INVENT_ENDPOINT = '/api/ry-farms-invent';
const WRITEBACK_ENDPOINT = '/api/memory-writeback';
const COOLDOWN_MS = 60 * 1000;
const TIMEOUT_MS = 20000;

let enrichInflight = false, enrichFailAt = -Infinity;
export async function enrichInventions(world, isCurrent = () => true) {
    if (typeof fetch !== 'function' || enrichInflight || !world.recipes) return 0;
    if (Date.now() - enrichFailAt < COOLDOWN_MS) return 0;
    world.recipeFlavor = world.recipeFlavor || {};
    const rec = Object.values(world.recipes).find(r => !world.recipeFlavor[r.id]);   // one un-flavoured recipe
    if (!rec) return 0;
    enrichInflight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(INVENT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ name: rec.name, effect: rec.effect, tier: rec.tier, quality: rec.quality, dominant: rec.dominant, ingredients: Object.keys(rec.inputs || {}) }) });
        const data = await res.json().catch(() => null);
        if (!isCurrent()) return 0;
        if (!res.ok || !data || data.fallback || !data.name) { enrichFailAt = Date.now(); return 0; }
        world.recipeFlavor[rec.id] = { name: data.name, lore: data.lore || null };   // shadow store — never in the digest
        return 1;
    } catch (err) { enrichFailAt = Date.now(); return 0; }
    finally { clearTimeout(timer); enrichInflight = false; }
}

let invInflight = false, invSig = null, invFailAt = -Infinity;
function inventSignature(world) { return `${Object.keys(world.recipes || {}).length}:${Object.keys(world.recipeFlavor || {}).length}`; }
export async function persistTownInventions(world, isCurrent = () => true) {
    if (typeof fetch !== 'function' || invInflight || !world.recipes) return false;
    if (Date.now() - invFailAt < COOLDOWN_MS) return false;
    const recipes = Object.values(world.recipes);
    if (!recipes.length) return false;
    const sig = inventSignature(world);
    if (sig === invSig) return false;                                // nothing new since last write
    invInflight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const nameOf = seed => { const f = world.farmers.find(x => x.sheet.seed === seed); return f ? f.sheet.name : null; };
    try {
        const res = await fetch(WRITEBACK_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ town: world.name || 'PROPAGATE', townSeed: world.seed, townInventions: {
                recipes: recipes.map(r => ({ id: r.id, name: (world.recipeFlavor[r.id]?.name) || r.name, lore: world.recipeFlavor[r.id]?.lore || null,
                    effect: r.effect, tier: r.tier, ingredients: Object.keys(r.inputs || {}), inventor: nameOf(r.discovererSeed) })),
            } }) });
        const data = await res.json().catch(() => null);
        if (!isCurrent()) return false;
        if (!res.ok || !data || !data.townInventionsWritten) { invFailAt = Date.now(); return false; }
        invSig = sig; return true;
    } catch (err) { invFailAt = Date.now(); return false; }
    finally { clearTimeout(timer); invInflight = false; }
}
