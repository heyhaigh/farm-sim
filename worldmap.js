// worldmap.js — #2 THE WORLD OF TOWNS (the camera tier above a single town).
//
// A town's sim is the reproducible substrate; the WORLD is the living layer on top. This module is pure model
// + geometry over the world index (save.js): where each town sits in a shared coordinate space, how far its
// influence REACHES (grows with the town), which towns DESCEND from which (the lineage graph — the closed
// memory loop drawn at world scale), and which towns have grown far enough to MEET. On an encounter, a creed
// travels between them — the world itself becomes a memory-propagation medium (#2.4). Nothing here feeds a
// town's seeded sim; it's display/persistence only, the same boundary as the LLM/shader side-channels.

import { hashString } from './dna.js';
import { lineagePairKey, isCrossFaction, foldDisposition, dispositionTier, resolveEncounter, applyOutcome, seedTraveler, TRAVELER } from './reconciliation.js';

const WORLD_W = 1000, WORLD_H = 640;   // abstract world-plane units (the map view scales these to the screen)

// Deterministic scatter: a town's world position is fixed by its seed, so the map is stable across visits.
// A little hash-jitter on two axes spreads them; the map view re-centers/zooms to fit whatever exists.
export function townPos(seed) {
    const hx = hashString('wx:' + (seed >>> 0)) / 0xffffffff;
    const hy = hashString('wy:' + (seed >>> 0)) / 0xffffffff;
    return { x: 40 + hx * (WORLD_W - 80), y: 40 + hy * (WORLD_H - 80) };
}

// A town's REACH grows as it thrives — population, age, and cumulative harvest push its traders/settlers
// outward (the plan's "towns venture outward via the expansion system"). Two towns MEET when reaches overlap.
export function townReach(t) {
    const pop = t.pop || 0, day = t.day || 0, harv = t.harvestTotal || 0;
    return Math.min(260, 46 + pop * 5 + Math.sqrt(day) * 6 + Math.sqrt(harv) * 1.6);
}

// Memory-derived tint (#5.1 seed): the town's palette hue comes from the fingerprint of its founding memories,
// so a town literally wears the color of what it was grown from. Warm/cool falls out of the hash; saturation
// lifts with how much the town has lived. #3.2/#5.3: an ORC warband is rendered as atmosphere — ashen and
// blood-red, the tension made visible at a glance against the verdant human towns.
export function townTint(t) {
    if (t.culture === 'orc') {
        const hue = 2 + ((t.fingerprint >>> 0) % 14);   // narrow red band, ashen
        return { h: hue, s: 52, l: 40, css: `hsl(${hue} 52% 44%)`, cssDim: `hsl(${hue} 40% 24%)`, orc: true };
    }
    const hue = ((t.fingerprint >>> 0) % 360);
    const sat = 45 + Math.min(30, (t.harvestTotal || 0) / 200);
    return { h: hue, s: sat, l: 58, css: `hsl(${hue} ${sat}% 58%)`, cssDim: `hsl(${hue} ${sat}% 30%)`, orc: false };
}

// The full render model for the map: every town with its position, reach, tint, and lineage edges (an edge
// points from a town to an ANCESTOR town it was founded from — drawn only when the ancestor is also known).
export function computeLayout(index) {
    const towns = Object.values(index?.towns || {});
    const known = new Set(towns.map(t => String(t.seed)));
    const nodes = towns
        .sort((a, b) => a.seed - b.seed)   // stable order
        .map(t => ({
            seed: t.seed, name: t.name || `Town ${t.seed}`, pop: t.pop || 0, day: t.day || 0, year: t.year || 1,
            harvestTotal: t.harvestTotal || 0, motto: t.motto || null, lastSeen: t.lastSeen || 0,
            culture: t.culture === 'orc' ? 'orc' : 'human', envoy: t.envoy || null, lineageRoot: t.lineageRoot != null ? String(t.lineageRoot) : String(t.seed),
            ...townPos(t.seed), reach: townReach(t), tint: townTint(t),
            // edges to ancestor towns that we actually have on the map (skip lineage from unknown/foreign towns)
            ancestors: (t.lineage || []).map(String).filter(s => s !== String(t.seed) && known.has(s)),
        }));
    return nodes;
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// Detect NEW encounters: any two towns whose reaches now overlap and that haven't met before. Appends an
// encounter event (with a creed CARRIED from each town to the other — #2.4) to the index. Returns the list of
// newly-created encounters so the caller can surface them. Idempotent: a met pair is never re-created.
export const WORLD_INDEX_VERSION = 3;   // v3 adds pairs[] (traveler awareness state machine); v1/v2 still load

// Queue a structured event into a town's inbox (the world->sim crossing; the town consumes it deterministically
// at load/dawn). Keyed by town seed so a dormant town gets its due when it's next played.
function queueInbox(index, townSeed, ev) {
    index.inbox = index.inbox || {};
    // stable id so the town can apply each event EXACTLY ONCE even if a crash leaves it uncleared (Codex r20 P1)
    ev.id = ev.id || `${ev.pairKey}:${ev.ordinal}:${ev.kind}`;
    (index.inbox[String(townSeed)] = index.inbox[String(townSeed)] || []).push(ev);
}

export function detectEncounters(index) {
    const nodes = computeLayout(index);
    const met = new Set((index.encounters || []).map(e => pairKey(String(e.a), String(e.b))));
    index.ledgers = index.ledgers || {};       // #reconciliation: per faction-lineage-pair grievance/reconciliation record
    index.pairs = index.pairs || {};           // Slice B: per town-pair awareness state (unknown->rumored->aware->met)
    const fresh = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j];
        const key = pairKey(String(A.seed), String(B.seed));
        if (met.has(key)) continue;
        // F2: exact squared-distance geometry now that overlap is outcome-bearing (no Math.hypot rounding).
        const dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy, rr = A.reach + B.reach;

        // ── Slice B: RUMOR phase — when a pair first drifts within the (wider) rumor radius, a traveler sets
        // out. Its whole fate + arrival sim-day is decided NOW as a pure fn; the map marker just walks toward
        // it. The traveler inbox event goes to the DESTINATION (asymmetric: only they learn). NO raid gating
        // yet (Slice C) — the existing encounter logic below still runs unchanged.
        const rumorR = rr * TRAVELER.rumorMult;
        if (!index.pairs[key] && d2 <= rumorR * rumorR) {
            const discoveryDay = Math.max(A.day, B.day), dist = Math.sqrt(d2);
            const t = seedTraveler({
                pairKey: key, ordinal: 0, aSeed: A.seed, bSeed: B.seed, aCulture: A.culture, bCulture: B.culture,
                aName: A.name, bName: B.name, ax: A.x, ay: A.y, bx: B.x, by: B.y, discoveryDay, dist,
            });
            index.pairs[key] = { state: 'enRoute', origin: t.origin, destination: t.destination, fate: t.fate,
                discoveryDay, arrivalDay: t.arrivalDay, warning: t.warning, bearing: t.bearing, fromCulture: t.fromCulture };
            // Slice C: a LOST traveler delivers nothing — no inbox event, so the destination never learns and
            // the pair meets by surprise (base curiosity, no parley boost). Only a survivor's warning arrives.
            if (t.fate === 'arrives') queueInbox(index, t.destination, { kind: 'traveler', pairKey: key, ordinal: 0, day: t.arrivalDay,
                payload: { type: 'warning', origin: String(t.origin), fromCulture: t.fromCulture, warning: t.warning, bearing: t.bearing } });
        }

        if (d2 > rr * rr) continue;              // not yet within reach of each other
        met.add(key);
        const day = Math.max(A.day, B.day);

        if (!isCrossFaction(A, B)) {
            // same-culture neighbours meet in peace and swap a motto (#2.4 cross-town memory)
            fresh.push({ a: A.seed, b: B.seed, day, at: Date.now(), aName: A.name, bName: B.name, kind: 'meeting', aCarried: A.motto || null, bCarried: B.motto || null });
            continue;
        }

        // #reconciliation cross-faction: RESOLVE through the seeded model over the LINEAGE-pair ledger, so a
        // gen-1 raid and a gen-3 parley compound. raid | parley-honored | parley-betrayed.
        const human = A.culture === 'orc' ? B : A, orc = A.culture === 'orc' ? A : B;
        const lpk = lineagePairKey(A, B);
        const led = index.ledgers[lpk] || { grievances: [], reconciliations: [], tier: 'hostile', firstTrustDone: false };
        const disposition = foldDisposition(led);
        const tier = dispositionTier(disposition, led.tier || 'hostile');
        const ordinal = led.grievances.length + led.reconciliations.length;
        const res = resolveEncounter({
            pairKey: lpk, ordinal, disposition, tier,
            humanEnvoy: human.envoy || { seed: human.seed }, orcEnvoy: orc.envoy || { seed: orc.seed },
        });
        const shortH = String(human.name).split(' ')[0], shortO = String(orc.name).split(' ')[0];
        const nextLed = applyOutcome(led, res.outcome, { ordinal, day });   // idempotent record
        nextLed.tier = dispositionTier(foldDisposition(nextLed), tier);     // hysteretic tier for next time
        nextLed.firstTrustDone = led.firstTrustDone;
        index.ledgers[lpk] = nextLed;

        const ev = { a: orc.seed, b: human.seed, day, at: Date.now(), aName: orc.name, bName: human.name, pairKey: lpk, ordinal, outcome: res.outcome };
        if (res.outcome === 'raid') {
            ev.kind = 'raid';
            ev.aCarried = `${shortO} took what ${shortH} had gathered`;    // both readings — the contested record
            ev.bCarried = `${shortH} remembers the ${shortO} raid`;
            queueInbox(index, human.seed, { kind: 'raided', pairKey: lpk, ordinal, day, by: orc.name });
        } else if (res.outcome === 'honored') {
            ev.kind = 'reconciled';
            ev.aCarried = `${shortO} was written into ${shortH}'s record - and kept faith`;
            ev.bCarried = `${shortH} and ${shortO} kept faith at the frontier`;
            queueInbox(index, human.seed, { kind: 'reconciled', pairKey: lpk, ordinal, day, envoy: human.envoy && human.envoy.seed, withName: orc.name });
            queueInbox(index, orc.seed, { kind: 'reconciled', pairKey: lpk, ordinal, day, envoy: orc.envoy && orc.envoy.seed, withName: human.name });
        } else {   // betrayed
            ev.kind = 'betrayed';
            const victimTown = res.betrayer === 'orc' ? human : orc;       // the honest party's envoy is wronged
            ev.aCarried = `${res.betrayer === 'orc' ? shortO : shortH} used the open hand as cover`;
            ev.bCarried = `${String(victimTown.name).split(' ')[0]} will remember the broken parley`;
            queueInbox(index, victimTown.seed, { kind: 'betrayed', pairKey: lpk, ordinal, day, envoy: victimTown.envoy && victimTown.envoy.seed, by: (res.betrayer === 'orc' ? orc.name : human.name) });
        }
        fresh.push(ev);
    }
    if (fresh.length) index.encounters = (index.encounters || []).concat(fresh);
    index.v = WORLD_INDEX_VERSION;
    return fresh;
}

// A short human line for an encounter, for the world log / narrator (#4.1).
export function encounterLine(ev) {
    const a = String(ev.aName || `Town ${ev.a}`).split(' ')[0];   // orc side for cross-faction events
    const b = String(ev.bName || `Town ${ev.b}`).split(' ')[0];   // human side
    if (ev.kind === 'raid') return `The ${a} warband fell upon ${b}. ${b} will remember.`;
    if (ev.kind === 'reconciled') return `${b} and the ${a} warband met at the frontier - and kept faith.`;
    if (ev.kind === 'betrayed') return `A parley between ${b} and the ${a} warband was broken. Blood, and a longer memory.`;
    // same-culture meeting
    let s = `${a} and ${b} have grown into each other's reach.`;
    if (ev.aCarried) s += ` ${a} carries word that "${ev.aCarried}".`;
    return s;
}
