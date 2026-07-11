// worldmap.js — #2 THE WORLD OF TOWNS (the camera tier above a single town).
//
// A town's sim is the reproducible substrate; the WORLD is the living layer on top. This module is pure model
// + geometry over the world index (save.js): where each town sits in a shared coordinate space, how far its
// influence REACHES (grows with the town), which towns DESCEND from which (the lineage graph — the closed
// memory loop drawn at world scale), and which towns have grown far enough to MEET. On an encounter, a creed
// travels between them — the world itself becomes a memory-propagation medium (#2.4). Nothing here feeds a
// town's seeded sim; it's display/persistence only, the same boundary as the LLM/shader side-channels.

import { hashString } from './dna.js';

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
// lifts with how much the town has lived.
export function townTint(t) {
    const hue = ((t.fingerprint >>> 0) % 360);
    const sat = 45 + Math.min(30, (t.harvestTotal || 0) / 200);
    return { h: hue, s: sat, l: 58, css: `hsl(${hue} ${sat}% 58%)`, cssDim: `hsl(${hue} ${sat}% 30%)` };
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
export function detectEncounters(index) {
    const nodes = computeLayout(index);
    const met = new Set((index.encounters || []).map(e => pairKey(String(e.a), String(e.b))));
    const fresh = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j];
        const key = pairKey(String(A.seed), String(B.seed));
        if (met.has(key)) continue;
        const dx = A.x - B.x, dy = A.y - B.y, dist = Math.hypot(dx, dy);
        if (dist > A.reach + B.reach) continue;                 // not yet within reach of each other
        met.add(key);
        const ev = {
            a: A.seed, b: B.seed, day: Math.max(A.day, B.day), at: Date.now(),
            aName: A.name, bName: B.name,
            // the memory that travels each way (#2.4): each town's motto reaches the other
            aCarried: A.motto || null, bCarried: B.motto || null,
        };
        fresh.push(ev);
    }
    if (fresh.length) index.encounters = (index.encounters || []).concat(fresh);
    return fresh;
}

// A short human line for an encounter, for the world log / narrator (#4.1).
export function encounterLine(ev) {
    const a = String(ev.aName || `Town ${ev.a}`).split(' ')[0];
    const b = String(ev.bName || `Town ${ev.b}`).split(' ')[0];
    let s = `${a} and ${b} have grown into each other's reach.`;
    if (ev.aCarried) s += ` ${a} carries word that "${ev.aCarried}".`;
    return s;
}
