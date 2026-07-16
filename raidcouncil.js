// raidcouncil.js — client side of the MUSTER COUNSEL (#raid-council). When a raid is telegraphed, the roused
// cast (names + personalities + who holds which office) and the situation (foe, bearing) are sent to
// /api/ry-farms-raid-council; the returned turn-by-turn script is handed to the sim's muster-talk director
// (world._raidScript — consumed via world.nextRaidCouncilLine, one voice at a time on the speech floor).
// DISPLAY TEXT ONLY: the sim never reads these lines, so the seeded world stays deterministic whether or not
// the model answers. Any failure at all simply leaves the authored MUSTER_TALK pools carrying the scene.

const COUNCIL_ENDPOINT = '/api/ry-farms-raid-council';
const COUNCIL_TIMEOUT_MS = 20000;   // the telegraph window is ~45s; a slow answer still lands mid-muster

let inflight = false;
let doneFor = null;                 // pendingRaid identity we've already asked about (once per telegraph)

function shortNameOf(f) { return f.sheet.name.split(' ')[0]; }

function castView(world, f) {
    const s = f.sheet, p = s.personality;
    const sentry = world.currentSentry && world.currentSentry();
    return {
        name: shortNameOf(f),
        archetype: s.archetype || null,
        personality: p ? { label: p.label, creed: p.creed } : null,
        role: f === sentry ? 'sentry' : (world.roles && world.roles.manager === s.seed) ? 'manager' : null,
    };
}

// Kick the generation for the CURRENT telegraph if we haven't asked yet. Fire-and-forget: it stores
// world._raidScript when (if) it arrives; the muster-talk director swaps it in from that line on.
export async function requestRaidCouncil(world) {
    const pr = world && world.pendingRaid;
    if (!pr) return;
    const key = world.seed + ':' + (pr.e && pr.e.id ? pr.e.id : pr.landsAt);
    if (inflight || doneFor === key) return;
    const cast = world.farmers.filter(f => !f.downed && f.health !== 'sick').slice(0, 8);
    if (cast.length < 2) return;
    inflight = true; doneFor = key;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COUNCIL_TIMEOUT_MS);
    try {
        const res = await fetch(COUNCIL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                culture: world.culture, town: world.name,
                foe: (pr.e && pr.e.by) || 'a warband', dir: pr.dirName || 'the dark',
                // #nemesis the grudge, so the counsel KNOWS its history ("he'll come for Cricket. he swore it.")
                nemesis: (pr.e && pr.e.foe) ? {
                    name: pr.e.foe.name, raidCount: pr.e.foe.raidCount,
                    sworeAgainst: (() => { const f = world.farmers.find(x => x.sheet.seed === pr.e.foe.sworeAgainst); return f ? shortNameOf(f) : null; })(),
                } : null,
                cast: cast.map(f => castView(world, f)),
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`raid council endpoint ${res.status}`);
        const data = await res.json();
        if (!data || data.fallback || !Array.isArray(data.script)) throw new Error(data?.error || 'no script');
        const byName = new Map(cast.map(f => [shortNameOf(f).toLowerCase(), f.sheet.seed]));
        const lines = [];
        for (const t of data.script) {
            const seed = byName.get(String(t.speaker || '').toLowerCase());
            if (seed != null && t.line) lines.push({ seed, line: String(t.line) });
        }
        // only hand the director a script if THIS telegraph is still live (it may have landed while we waited)
        if (lines.length >= 4 && world.pendingRaid && !world.raidEvent) {
            world._raidScript = { lines, i: 0, headSince: null };
        }
    } catch { /* offline pools carry the scene */ }
    finally { clearTimeout(timer); inflight = false; }
}
