// tilehash.js — the POSITIONAL HASH FAMILY: one copy, shared by the simulation and the renderer.
//
// Why this module exists (Codex #56-5). These functions decide, from a tile's coordinates alone, what is
// there and what it looks like: how big a rock is, which tree species stands where, which patch of grass a
// tile belongs to, how far a sprite is nudged off centre. Nothing stores their results — they are recomputed
// every frame and every work tick — so they are not implementation detail. **They are the contract a saved
// town is read through.** Change a constant here and every existing player's town is retroactively different:
// their mature forest becomes saplings, their boulders resize, their ore yield moves.
//
// Two problems this fixes.
//
// 1. It was DUPLICATED. farm.js had `tileHash`/`tileRand`/`tileNoise` and main.js had `hash2`/`rand2`/
//    `noise2` — verified numerically identical over 40k samples, the same function written twice. That is
//    precisely the divergence hazard the compatibility guard exists to catch: someone "fixes" one copy, the
//    other keeps the old behaviour, and the sim's idea of a tile silently stops matching what is drawn. A
//    farmer charged for clearing a big boulder while a pebble is painted is not a bug anyone would look for.
//
// 2. The renderer's half was UNGUARDED. tests/compat.mjs can only import DOM-free modules, so while it
//    fingerprinted farm.js's copy, the identical family in main.js could be changed freely — repainting every
//    existing town with no test failing. `treeVariant` and `treeIsFruit` (still in farm.js, since the sim
//    consults them too) have exactly one caller each and it is the renderer.
//
// So: zero imports, no DOM, no canvas. That is a REQUIREMENT, not an accident — it is what lets the
// compatibility harness fingerprint these at all. Keep it that way.
//
// The seeds passed in are independent namespaces, and they are as load-bearing as the algorithm: sim salts
// (0x517e for obstacle bulk, 0x7ea1 for tree age…) and render salts (12/13/14 for grass patches, 71/72 for
// jitter) must not be renumbered, because the salt IS the identity of the thing being decided.
//
// NOT here, deliberately: pixel.js's `hash2d`, which is procedural-sprite TEXTURE noise. It never reads a
// world position, so it decides how a sprite is shaded rather than which sprite a tile gets, and changing it
// is a visible art edit rather than a silent per-tile rewrite. It is also still unguarded — a smaller but
// real gap, noted rather than fixed here.

// The primitive. Integer in, uint32 out, pure. Two TWO bugs once lived in a near-identical function in
// pixel.js (overflow past 2^53 without imul, and a signed int32 leaking through `%`), so keep the `| 0`
// coercions and the `>>> 0`.
export function tileHash(i, j, seed = 0) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

// 0..1 from a position.
export function tileRand(i, j, seed = 0) {
    return tileHash(i, j, seed) / 4294967296;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function smooth(t) { return t * t * (3 - 2 * t); }

// Smoothed value noise over the integer lattice — the basis for lakes, rocky highlands and grass patches.
export function tileNoise(i, j, scale, seed = 0) {
    const x = i / scale, y = j / scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    const a = tileRand(x0, y0, seed);
    const b = tileRand(x0 + 1, y0, seed);
    const c = tileRand(x0, y0 + 1, seed);
    const d = tileRand(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// Which member of an n-long variant list a tile gets. The coordinate mixing (i*31 + j*17, j*29 - i*13) is
// there so neighbouring tiles do not land on neighbouring indices and stripe the ground.
export function pickIndex(i, j, seed, len) {
    return tileHash(i * 31 + j * 17, j * 29 - i * 13, seed) % len;
}

// Low-frequency noise -> which grass "patch" a tile belongs to (0 plain / 1 shaded meadow / 2 sunlit /
// 3 wildflower). The thresholds set how much of the ground reads as each, so nudging one re-tints an
// existing town's whole valley.
export function grassPatch(i, j) {
    const n = tileNoise(i, j, 8, 12) * 0.55 + tileNoise(i + 31, j - 17, 19, 13) * 0.35 + tileRand(i, j, 14) * 0.1;
    if (n < 0.24) return 1;
    if (n > 0.78) return 2;
    if (n > 0.55) return 3;
    return 0;
}

// A stable per-tile offset so wild sprites do not sit dead-centre in a grid.
//
// Codex #57 judgment — the SPREADS live here too, not at the call site. They looked like a rendering detail,
// but they decide PERSISTENT VISUAL PLACEMENT: widen the tree spread and every tree in every existing town
// shifts. That is the same class as the salts, so it belongs behind the same fingerprint. Keyed by a semantic
// name rather than by farm.js's `T` enum on purpose — this module imports NOTHING, which is what lets the
// compatibility harness load it, and importing `T` would make farm.js -> tilehash.js -> farm.js a cycle.
export const WILD_SPREAD = {
    tree:  [32, 18],
    rock:  [5, 3],
    stump: [4, 4],
    other: [7, 4],
};

export function tileJitter(i, j, kind) {
    const [xSpread, ySpread] = WILD_SPREAD[kind] || WILD_SPREAD.other;
    return {
        x: Math.round((tileRand(i, j, 71) - 0.5) * xSpread),
        y: Math.round((tileRand(i, j, 72) - 0.5) * ySpread),
    };
}
