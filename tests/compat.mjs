// tests/compat.mjs — SAVE-COMPATIBILITY fingerprint. Pure, no simulation, runs in well under a second.
//
// Split out of determinism.mjs deliberately, for two reasons learned the hard way while building it:
//   1. determinism.mjs process.exit(1)s in its sim-digest section, so any change that moves BOTH the sim and
//      the terrain killed the run before the terrain lines ever printed — the fingerprint looked like it had
//      missed the change when it had simply never executed.
//   2. That harness re-simulates 30 days x 4 seeds twice. This one only constructs worlds and calls pure
//      functions, so it is fast enough to run on every edit — which is the only way a guard like this
//      actually gets run.
//
// Run: `node tests/compat.mjs`  (exits non-zero if terrain generation or a save-referenced table moved)

const SEEDS = [20260706, 42, 7, 3];

function fnv(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
}

// ---------------------------------------------------------------------------------------------------------
// #compat — TERRAIN + CONTENT-TABLE FINGERPRINT
//
// The digest above cannot see world generation. It hashes farmers (positions, inventories, creeds) and a few
// world scalars — no tiles, no chunks, no structures — so a generation change is caught only INDIRECTLY, when
// it happens to move a farmer inside 30 days. Two whole classes slip through:
//
//   1. Render-only positional hashes. `treeVariant` and `treeIsFruit` have exactly one caller each and it is
//      the renderer, so changing them repaints every forest in every existing town with all seeds green.
//   2. Wilderness past the valley. 30 days of play never leaves the middle of a 110x110 grid, so `#genTile`
//      is essentially untested — and it is the one generator whose output is NOT frozen into a save, so a
//      change to it seams new terrain against the chunks a player already materialised.
//
// This section closes both. It is a PURE fingerprint: construct a world, hash the founding tile array, force
// a lattice of frontier chunks into existence, and sample the per-tile hash functions. No ticking, so it is
// fast and it fails for exactly one reason — generation moved.
//
// It also pins the ORDER of the content tables that saves reference by index or by string key. These are
// append-only forever: `projectIndex` is a raw index into PROJECT_DEFS, `built.level` a raw index into
// HOUSE_TIERS, and facility/craftable/tile identity is a bare string or enum number living in old snapshots.
// Reordering any of them silently reinterprets towns that already exist, which no amount of care at the call
// sites can undo. If this hash moves, either you appended (re-pin it) or you broke compatibility (don't).
import { World } from '../farm.js';
import { obstacleTier, forageIngredient, treeVariant, treeIsFruit, treeStageAt, FORAGE_INGREDIENTS,
         CRAFTABLES, HOUSE_TIERS, FACILITY_DEFS, PROJECT_DEFS, T, GRID, CENTER } from '../farm.js';
// Codex #56-5 — the RENDER side of the positional family. Until tilehash.js existed these lived in main.js,
// which needs a DOM and so could never be imported here: changing any of them repainted every existing town
// with both harnesses green. They decide which grass patch a tile is, which variant of a sprite set it gets,
// and how far that sprite is nudged — all recomputed live, none of it stored.
import { grassPatch, pickIndex, tileJitter, tileNoise, tileRand, WILD_SPREAD } from '../tilehash.js';

// Pinned 2026-07-29 when this section was added. Re-pin DELIBERATELY: a terrain hash moving means existing
// towns' frontier terrain or per-tile attributes changed, and a tables hash moving means a save-referenced
// list was reordered. Both are compatibility events, not routine re-baselines.
// Pinned per PART, not as one opaque hash (Codex #57). A drift then names itself: `tiles` is the founding
// valley, `frontier` the lazily generated wilderness — both per-seed — while `attrs` (sim-side per-tile
// hashes) and `look` (render-side) take no seed at all and are a property of the CODE, so they are pinned
// once. Re-pin DELIBERATELY: a moved part means existing towns differ, and the part tells you which way.
//
// CANONICAL RUNTIME for these values: node v24.4.1 darwin/arm64. The generation path uses Math.hypot and
// friends, which ECMAScript leaves implementation-approximated, so a different engine or version may legally
// produce different low bits. If every part moves at once AND the runtime differs, suspect the runtime first.
const TERRAIN_BASELINE = {
    20260706: { tiles: '2195aa20', frontier: 'be024324' },
    42:       { tiles: 'ac75eeed', frontier: 'ec721114' },
    7:        { tiles: '00455fdc', frontier: 'd2ca09eb' },
    3:        { tiles: '9622d43c', frontier: '0e1ced3f' },
};
const HASH_BASELINE = { attrs: 'f5bd4e3b', look: 'd3b1a6fd' };
const TABLES_BASELINE = '67414731';

function fnvBytes(arr) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
}

// Tree stages are sampled EARLY and at several days on purpose. A founding tree's birth day is
// -(hash % 32) and TREE_STAGE_DAYS is [8, 12], so maturity is age >= 20: sample at day 40 and every tree in
// the lattice is already mature, the buckets saturate, and a change to the age window moves NOTHING. That
// exact mistake made the first version of this fingerprint pass a mutation-test it should have failed. These
// three days straddle both bucket edges (age 1..32 / 6..37 / 14..45).
const TREE_SAMPLE_DAYS = [1, 6, 14];

function terrainDigest(seed) {
    const w = new World(seed);                       // construction only — generation, no simulation
    const parts = { tiles: fnvBytes(w.tiles) };
    // FRONTIER — EXHAUSTIVE, not sampled. Reading a tile outside the valley materialises its chunk from
    // #genTile, the one generator whose output is NOT frozen into a save: change it and a player's next
    // expedition crosses a seam between old-formula and new-formula ground.
    //
    // Two sparse versions of this failed a mutation test before this one, and the reason is worth keeping.
    // A wide lattice caught salt and threshold changes but stepped clean over `r > 68` -> `r > 64`, which
    // moves terrain only in a ~4-tile ring; adding a dense radial rim sample ALSO missed it. The affected
    // set is the INTERSECTION of a thin ring and a rare feature — the lake branch fires above a 0.80 noise
    // threshold — so the odds of any sampled point sitting in both are negligible. No sampling strategy
    // fixes that; only covering every tile does. So: every tile in a band around the valley, excluding the
    // valley itself (already hashed above as `tiles`).
    //
    // The band is +/-90 rather than a tighter ring because coverage here is a numbers game: a 0.001 nudge to
    // the lake-SHORE threshold moves only the tiles whose noise sits in that 0.001 slice, and a ~17k-tile
    // band expected roughly zero of them (it was missed; the same 0.001 change to the WATER threshold was
    // caught, so at that granularity a narrower band is down to luck). ~72k tiles makes the thin slices
    // land. Still 0.4s, memoised by chunk — cheap enough that there is no reason to be clever.
    const band = [];
    for (let i = -90; i < GRID + 90; i++) for (let j = -90; j < GRID + 90; j++) {
        if (i >= 0 && i < GRID && j >= 0 && j < GRID) continue;   // the valley is persisted, not generated
        band.push(w.get(i, j));
    }
    parts.frontier = fnvBytes(band);
    // EVERY tile, not a lattice. These are pure arithmetic with no chunk generation behind them, so density
    // is nearly free — and a stride-7 lattice (144 points) missed a 0.01 nudge to grassPatch's SUNLIT
    // threshold, because that band is the tail of the distribution and 144 samples contained none of it. The
    // same mistake as the frontier: thin slices need coverage, not cleverness.
    return parts;
}

// The per-tile hash families take NO seed — obstacleTier, forageIngredient, treeStageAt, grassPatch,
// pickIndex and tileJitter are functions of position alone. So they are a property of the CODE, not of any
// one world, and pinning them per-seed would have been the same four numbers repeated. Hashed once.
function hashDigest() {
    const parts = {};
    // PER-TILE ATTRIBUTES — re-derived live on every frame and every work tick, never stored, so a change
    // here rewrites existing towns: rock size and ore yield, forest age, which wild tile holds which herb.
    const attrs = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
        attrs.push(`${obstacleTier(i, j)}${forageIngredient(i, j) || '-'}${treeVariant(i, j, 6)}${treeIsFruit(i, j) ? 1 : 0}${TREE_SAMPLE_DAYS.map(d => treeStageAt(i, j, d)).join('')}`);
    }
    parts.attrs = fnv(attrs.join('|'));
    // RENDER-SIDE per-tile look. Sampled over the same lattice, plus the jitter at the spreads main.js
    // actually passes (tree 32x18 is the widest, so it is the one that would visibly shift).
    const look = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
        // every jitter KIND, so a change to any spread in WILD_SPREAD moves the digest
        const jt = tileJitter(i, j, 'tree'), jr = tileJitter(i, j, 'rock');
        const js = tileJitter(i, j, 'stump'), jo = tileJitter(i, j, 'other');
        look.push(`${grassPatch(i, j)}${pickIndex(i, j, 64, 6)}${pickIndex(i, j, 68, 5)}${jt.x},${jt.y};${jr.x},${jr.y};${js.x},${js.y};${jo.x},${jo.y}`);
    }
    parts.attrs = fnv(attrs.join('|'));
    parts.look = fnv(look.join('|'));
    return parts;
}

function tablesDigest() {
    return fnv(JSON.stringify({
        T: Object.entries(T),                                   // renumbering reinterprets saved ground
        projects: PROJECT_DEFS.map(p => p.type),                // projectIndex is a raw array index
        houses: HOUSE_TIERS.map(h => h && h.name),              // built.level is a raw array index
        facilities: Object.keys(FACILITY_DEFS),                 // facility.type is a saved string key
        craftables: CRAFTABLES.map(c => c.id),                  // f.tools is a Set of these ids
        forage: FORAGE_INGREDIENTS.slice(),                      // indexed by hash % length
    }));
}

let compatFail = 0;
const tHash = tablesDigest();
if (TABLES_BASELINE == null) console.log(`content tables  ${tHash}  (unpinned — set TABLES_BASELINE)`);
else if (tHash !== TABLES_BASELINE) { console.error(`FAIL content tables ${tHash} != baseline ${TABLES_BASELINE} — a save-referenced table was REORDERED, not appended to`); compatFail++; }
else console.log(`content tables  ${tHash}  ok`);

// Codex #57 judgment — the four parts are pinned SEPARATELY. One opaque hash told you something moved but
// never what, so every legitimate terrain change meant re-pinning four numbers blind. Now a drift names its
// own part: `tiles` is the founding valley, `frontier` the generated wilderness, `attrs` the sim-side
// per-tile hashes, `look` the render-side ones. That keeps the coverage exhaustive while making a re-pin
// auditable — you can see whether you changed what you meant to.
const WORLD_PARTS = ['tiles', 'frontier'];
const CODE_PARTS = ['attrs', 'look'];

function report(label, got, base, parts) {
    const drift = [], unstable = [];
    for (const k of parts) {
        if (got[k] !== got['__2nd_' + k]) unstable.push(k);
        else if (base[k] == null) drift.push(`${k}=${got[k]}  (unpinned)`);
        else if (got[k] !== base[k]) drift.push(`${k}: ${base[k]} -> ${got[k]}`);
    }
    const line = parts.map(k => `${k}=${got[k]}`).join('  ');
    if (!unstable.length && !drift.length) { console.log(`${label.padEnd(24)} ok    ${line}`); return 0; }
    console.error(`${label.padEnd(24)} FAIL  ${line}`);
    for (const u of unstable) console.error(`   ${u}: NOT reproducible in-process — a determinism bug, not a content change`);
    for (const d of drift) console.error(`   ${d}`);
    return unstable.length + drift.length;
}

// seed-independent: the per-tile hash families
{
    const a = hashDigest(), b = hashDigest();
    for (const k of CODE_PARTS) a['__2nd_' + k] = b[k];
    compatFail += report('per-tile hashes', a, HASH_BASELINE, CODE_PARTS);
}
// per-seed: the founding valley and the generated frontier
for (const seed of SEEDS) {
    const a = terrainDigest(seed), b = terrainDigest(seed);
    for (const k of WORLD_PARTS) a['__2nd_' + k] = b[k];
    compatFail += report(`terrain seed ${seed}`, a, TERRAIN_BASELINE[seed] || {}, WORLD_PARTS);
}
if (compatFail) {
    // Codex #57 judgment on floating point — the generation path uses Math.hypot/exp/sin/cos, which
    // ECMAScript leaves implementation-approximated, so the digests are not guaranteed bit-identical across
    // engines or versions. Report the runtime on failure: if the parts moved and the runtime ALSO changed,
    // suspect the runtime before suspecting the code.
    console.error(`\nruntime: ${typeof process !== 'undefined' ? process.version + ' ' + process.platform + '/' + process.arch : 'unknown'}  (canonical: v24.4.1 darwin/arm64)`);
    console.error(`${compatFail} compatibility fingerprint failure(s) — generation or a save-referenced table moved.`);
    process.exit(1);
}
console.log('Terrain generation + save-referenced content tables unchanged.');

// ---------------------------------------------------------------------------------------------------------
// THE MIGRATION CHAIN — exercised now, while it is empty, so it is known-good before anything depends on it.
//
// The gate used to be `data.v !== SAVE_VERSION`, which cannot express "older but readable": bumping the
// version rejected every existing save, and because the boot path swallows a fromSave throw and founds a
// fresh town, the bump read to a player as "your town is gone". It is now a floor plus an ordered chain of
// in-place upgrade steps. These assertions pin the four behaviours that matter.
let mFail = 0;
const m = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) mFail++; };

const v1 = { v: 1, seed: 7 };
m(World.migrate(structuredClone(v1)).v === 1, 'a current-version snapshot passes through untouched');

// A snapshot from a FUTURE build is the one case we cannot read — refuse rather than guess at it. The caller
// preserves it (save.js quarantineTown) so a later build can still open the town.
let threwFuture = false;
try { World.migrate({ v: World.SAVE_VERSION + 1, seed: 7 }); } catch { threwFuture = true; }
m(threwFuture, 'a snapshot from a NEWER build is refused, not silently mangled');

let threwNoVersion = false;
try { World.migrate({ seed: 7 }); } catch { threwNoVersion = true; }
m(threwNoVersion, 'a snapshot with no usable version is refused');

// Simulate the next bump WITHOUT shipping one: raise the target, and assert a missing step is a hard error
// (loading a half-migrated town is worse than refusing), then that a registered step runs and advances `v`.
const realVersion = World.SAVE_VERSION, realMigrations = World.MIGRATIONS;
try {
    World.SAVE_VERSION = 2;
    World.MIGRATIONS = {};
    let threwGap = false;
    try { World.migrate(structuredClone(v1)); } catch { threwGap = true; }
    m(threwGap, 'a MISSING upgrade step is a hard error, not a silent partial load');

    let ran = 0;
    World.MIGRATIONS = { 1: (d) => { ran++; d.migratedMarker = true; } };
    const out = World.migrate(structuredClone(v1));
    m(ran === 1 && out.v === 2 && out.migratedMarker === true, 'a registered step runs exactly once and advances v1 -> v2');

    // Idempotence in the sense that matters: re-running migrate on an ALREADY-migrated snapshot is a no-op.
    const again = World.migrate(out);
    m(ran === 1 && again.v === 2, 're-migrating an up-to-date snapshot does nothing');
} finally {
    World.SAVE_VERSION = realVersion;
    World.MIGRATIONS = realMigrations;
}
m(World.SAVE_VERSION === realVersion && World.MIGRATIONS === realMigrations, 'the harness restored SAVE_VERSION/MIGRATIONS');

if (mFail) { console.error(`\n${mFail} migration-chain failure(s).`); process.exit(1); }
console.log('Migration chain: version floor, refusal cases, and step dispatch all behave.');
