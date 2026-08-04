// memory-invent.js — #97 P5 client half of the generative-crafting flavour + persistence layer.
//
// enrichInventions(): asks /api/ry-farms-invent to NAME + tell the lore of each generatively-discovered
// recipe, and stashes it in world.recipeFlavor — the DISPLAY shadow store (excluded from the sim digest, so
// LLM-on ≡ LLM-off; the procedural name stands if the LLM is unavailable). Content-addressed: one call per
// canonical key, ever.
// persistTownInventions(): writes the town's book of inventions to self-hosted SuperMemory (recipe nodes off
// the town hub, sibling to the town-history doc). Both off the sim loop, best-effort.

// #local-memory — inventions persist to the browser store first (memory-store.js); the server
// POST rides the shared echo channel for self-hosted SuperMemory dev setups.
import { storePayload } from './memory-store.js';
import { echoToServer } from './memory-writeback.js';

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
            body: JSON.stringify({ culture: world.culture, name: rec.name, effect: rec.effect, tier: rec.tier, quality: rec.quality, dominant: rec.dominant, ingredients: Object.keys(rec.inputs || {}) }) });
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
    // Codex #61-2 — same policy guard as memory-writeback.js's three entry points, at this function's own
    // boundary rather than its caller's. This writes to the shared SuperMemory store, which outlives the tab,
    // so a menu backdrop or a session we refused to persist must be silent. The current caller is gated, but
    // caller-dependent protection is exactly the shape the centralized guards were added to eliminate — and
    // that shape has already been missed twice in this work (persistBattle, then the world-index read).
    // Returns silently: intentional background suppression should not spam the console.
    if (!world || world._persistenceDisabled) return false;
    if (typeof fetch !== 'function' || invInflight || !world.recipes) return false;
    if (Date.now() - invFailAt < COOLDOWN_MS) return false;
    const recipes = Object.values(world.recipes);
    if (!recipes.length) return false;
    const sig = inventSignature(world);
    if (sig === invSig) return false;                                // nothing new since last write
    invInflight = true;
    const nameOf = seed => { const f = world.farmers.find(x => x.sheet.seed === seed); return f ? f.sheet.name : null; };
    try {
        const body = { town: world.name || 'PROPAGATE', townSeed: world.seed, townInventions: {
                recipes: recipes.map(r => ({ id: r.id, name: (world.recipeFlavor[r.id]?.name) || r.name, lore: world.recipeFlavor[r.id]?.lore || null,
                    effect: r.effect, tier: r.tier, ingredients: Object.keys(r.inputs || {}), inventor: nameOf(r.discovererSeed) })),
            } };
        const local = await storePayload(body);          // #local-memory the browser store is the authority
        echoToServer(body);                              // best-effort echo for a self-hosted SuperMemory
        if (!isCurrent()) return false;
        if (!local || !local.written) { invFailAt = Date.now(); return false; }
        invSig = sig; return true;
    } catch (err) { invFailAt = Date.now(); return false; }
    finally { invInflight = false; }
}
