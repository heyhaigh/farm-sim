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
        if (lines.length >= 4 && world.pendingRaid === pr && !world.raidEvent) {   // #Kimi THIS telegraph only — never a later one's
            world._raidScript = { lines, i: 0, headSince: null };
        }
    } catch { /* offline pools carry the scene */ }
    finally { clearTimeout(timer); inflight = false; }
}

// #raid-feel THE DEBRIEF (player: "no summation, no review of what just occurred") — the fight just ended;
// the line lingers. Given the cast + what actually happened (who fell, who broke off, who's hurt, whose war
// it is), the model writes the aftermath exchange: check the hurt, count the stores, then STRATEGY — a
// returning named foe means "he'll come again, keep {sworn} guarded"; a new band means walls and watches.
// Same contract as the muster counsel: display bubbles only, DEBRIEF_TALK pools carry it offline.
let debriefInflight = false;
let debriefDoneFor = null;
export async function requestRaidDebrief(world, battle) {
    if (!world || !battle || debriefInflight || debriefDoneFor === battle.rid) return;
    const cast = world.farmers.filter(f => !f.downed && f.health !== 'sick').slice(0, 8);
    if (cast.length < 2) return;
    debriefInflight = true; debriefDoneFor = battle.rid;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COUNCIL_TIMEOUT_MS);
    try {
        const res = await fetch(COUNCIL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phase: 'debrief',
                culture: world.culture, town: world.name,
                foe: battle.clan || 'a warband', dir: 'the dark',
                nemesis: battle.nemesis || null,
                battle: {
                    felled: battle.outcome && battle.outcome.felled, n: battle.outcome && battle.outcome.n,
                    harvestLost: battle.outcome && battle.outcome.harvestLost,
                    hero: battle.hero || null, wounded: battle.wounded || [],
                },
                cast: cast.map(f => castView(world, f)),
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`debrief endpoint ${res.status}`);
        const data = await res.json();
        if (!data || data.fallback || !Array.isArray(data.script)) throw new Error(data?.error || 'no script');
        const byName = new Map(cast.map(f => [shortNameOf(f).toLowerCase(), f.sheet.seed]));
        const lines = [];
        for (const t of data.script) {
            const seed = byName.get(String(t.speaker || '').toLowerCase());
            if (seed != null && t.line) lines.push({ seed, line: String(t.line) });
        }
        // only hand it over while the debrief window is still open (they may have all drifted off)
        if (lines.length >= 3 && world._debrief && world.time < world._debrief.until) {
            world._raidScript = { lines, i: 0, headSince: null };
            world._debrief.until = Math.max(world._debrief.until, world.time + lines.length * 4 + 6);   // let the scene finish
        }
    } catch { /* the authored DEBRIEF_TALK pool carries the scene */ }
    finally { clearTimeout(timer); debriefInflight = false; }
}

// #one-beat (council Phase 3) — THE DM'S BEAT: one bespoke stunt + bark for the marquee duel, written
// during the telegraph. Tiny schema (stunt/by/bark), so even the 3B model is reliable; the seeded house
// beat carries the moment when this never arrives. Display-only, like every script here.
let beatInflight = false;
let beatDoneFor = null;
export async function requestDuelBeat(world) {
    const pr = world && world.pendingRaid;
    if (!pr || !pr.e || !pr.e.foe || beatInflight) return;
    const key = world.seed + ':' + (pr.e.id || pr.landsAt);
    if (beatDoneFor === key) return;
    beatInflight = true; beatDoneFor = key;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COUNCIL_TIMEOUT_MS);
    try {
        const sworn = pr.e.foe.sworeAgainst != null ? world.farmers.find(x => x.sheet.seed === pr.e.foe.sworeAgainst) : null;
        const res = await fetch(COUNCIL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phase: 'beat',
                culture: world.culture, town: world.name,
                foe: pr.e.foe.name, dir: pr.dirName || 'the dark',
                nemesis: { name: pr.e.foe.name, raidCount: pr.e.foe.raidCount,
                           sworeAgainst: sworn ? shortNameOf(sworn) : null },
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`beat endpoint ${res.status}`);
        const data = await res.json();
        if (!data || data.fallback || !data.beat) throw new Error(data?.error || 'no beat');
        const b = data.beat;
        if ((b.stunt === 'shove' || b.stunt === 'taunt') && (b.by === 'foe' || b.by === 'defender') && b.bark) {
            // #Codex38 P1-4: STAMP the beat with the raid it was written for and only hand it over if THAT
            // raid is still the current one — `|| world.raidEvent` used to accept ANY active raid, so a late
            // response for raid A could bark at raid B's focus duel. farm.js re-checks the id at consume.
            const rid = pr.e && (pr.e.id || (pr.e.pairKey + ':' + pr.e.ordinal));
            const cur = world.pendingRaid || world.raidEvent;
            const curRid = cur && cur.e && (cur.e.id || (cur.e.pairKey + ':' + cur.e.ordinal));
            if (rid && rid === curRid) world._duelBeat = { stunt: b.stunt, by: b.by, bark: String(b.bark).slice(0, 90), rid };
        }
    } catch { /* the seeded house beat carries the moment */ }
    finally { clearTimeout(timer); beatInflight = false; }
}
