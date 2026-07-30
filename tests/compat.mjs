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
         CRAFTABLES, HOUSE_TIERS, FACILITY_DEFS, PROJECT_DEFS, T, GRID } from '../farm.js';

// Pinned 2026-07-29 when this section was added. Re-pin DELIBERATELY: a terrain hash moving means existing
// towns' frontier terrain or per-tile attributes changed, and a tables hash moving means a save-referenced
// list was reordered. Both are compatibility events, not routine re-baselines.
const TERRAIN_BASELINE = { 20260706: 'edfcf64a', 42: 'c62da43d', 7: '48d1421d', 3: 'ba0fa190' };
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
    const parts = ['tiles:' + fnvBytes(w.tiles)];
    // FRONTIER: reading a tile outside the valley materialises its chunk from #genTile. A wide lattice with a
    // prime-ish stride so it lands in many different chunks rather than sampling one repeatedly.
    const frontier = [];
    for (let i = -180; i <= 280; i += 41) for (let j = -180; j <= 280; j += 41) frontier.push(w.get(i, j));
    parts.push('frontier:' + fnvBytes(frontier));
    // PER-TILE ATTRIBUTES — re-derived live on every frame and every work tick, never stored, so a change
    // here rewrites existing towns: rock size and ore yield, forest age, which wild tile holds which herb.
    const attrs = [];
    for (let i = 12; i <= GRID - 12; i += 7) for (let j = 12; j <= GRID - 12; j += 7) {
        attrs.push(`${obstacleTier(i, j)}${forageIngredient(i, j) || '-'}${treeVariant(i, j, 6)}${treeIsFruit(i, j) ? 1 : 0}${TREE_SAMPLE_DAYS.map(d => treeStageAt(i, j, d)).join('')}`);
    }
    parts.push('attrs:' + fnv(attrs.join('|')));
    return fnv(parts.join('/'));
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

for (const seed of SEEDS) {
    const a = terrainDigest(seed), b = terrainDigest(seed);
    const same = a === b;
    const base = TERRAIN_BASELINE[seed];
    const ok = base == null ? '(unpinned)' : (a === base ? 'ok' : `FAIL != ${base}`);
    console.log(`terrain seed ${String(seed).padEnd(9)} ${a}  same-twice=${same}  ${ok}`);
    if (!same) { console.error(`  seed ${seed}: generation is NOT reproducible in-process`); compatFail++; }
    if (base != null && a !== base) compatFail++;
}
if (compatFail) { console.error(`\n${compatFail} compatibility fingerprint failure(s) — generation or a save-referenced table moved.`); process.exit(1); }
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
