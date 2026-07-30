# Save compatibility

**The game is live and players have towns in their own browsers.** All state is client-side IndexedDB. There
is no server-side save, no way to reach anyone's data, and no way to know what build a given town was created
under. Every migration is code you ship that runs in their browser.

That makes a handful of ordinary-looking edits destructive in ways that produce no error. This document is the
rule set. `node tests/compat.mjs` enforces most of it in half a second.

---

## 1. The slot invariant

A town snapshot lives in a **slot** keyed by seed (`town:<seed>`). Two values identify a slot *version*:

| | what it means | lives |
|---|---|---|
| **generation** (`gen:<seed>`) | the OCCUPANT's identity. Bumped whenever the slot changes hands — the thing in it is no longer a continuation of what was there | on the slot |
| **`_rev`** | the ORDER of continuations of that one occupant | in the snapshot |

Together they are **one compare-and-set token**. A live writer owns the pair it observed atomically, and:

> A save commits only when its pair **exactly equals** the stored pair. Equality, not `>=`. Committing
> preserves the generation and advances the revision by one. Claiming an **empty** slot is its own transition:
> no bump, and only a rev-0 writer — one that actually observed the slot empty at this generation — may do it.

Being behind is a stale tab. **Being ahead is not benign**: under every legitimate path a live writer's pair
equals the stored pair, so ahead means inconsistent provenance, and authorizing it fails open on exactly the
corruption the check exists to catch.

**A snapshot is only safe to write back under the generation it was READ WITH.** Hence `loadTownState()`
returns `{ok, snap, gen, seed}` from one readonly transaction. There is deliberately no non-atomic loader and
no bare generation read — reading the two separately re-opens the hole the generation closes.

**A failed observation is not an empty slot.** `ok: false` means storage could not be read; a caller must fail
closed, because founding a savable town over a slot you never managed to look at is how a town gets buried.

### Paths that change a slot's occupancy

Every one of these bumps the generation, atomically with the occupancy change:

| path | notes |
|---|---|
| `quarantineTown` | an **automatic** discontinuity — must CAS its target, since it is triggered by a *specific* snapshot failing to hydrate |
| `restoreQuarantined` | puts a preserved town back |
| `wipeTown` / `undoWipe` | explicit destructive commands — may target whatever occupies the slot |

An unreadable save is **preserved**, never overwritten: it moves to `unreadable:<seed>` with its reason, and
`RYFARMS.peekSave()` / `restoreSave()` recover it. A session that cannot preserve it runs **non-persisting**
rather than risk burying it.

### Derived state obeys the same invariant

The world index has its own revision guard, so it inherited the whole bug class. `updateWorldIndex` therefore
takes a **mandatory** `{seed, gen, rev}` fence, checked against `gen:<seed>` *and* `town:<seed>` in the
fencing transaction. Generation alone is not enough: a delayed rev-N publication can land after the snapshot
reaches N+1 while the index has not yet seen N+1, and then encounter detection makes durable decisions from a
stale summary.

`quarantineTown` also captures and prunes the town's whole index slice, and restore puts it back — otherwise a
replacement inherits the dead town's summary, inbox, pairs, encounters and news.

---

## 2. Append-only, forever

These are referenced from saved data by string key or numeric index, with no indirection layer. **Appending is
safe. Reordering, renaming or inserting silently reinterprets every existing town.**

| thing | what breaks |
|---|---|
| `T` tile enum numbering | a saved `8` becomes whatever 8 means next — reinterprets the ground |
| `PROJECT_DEFS` order | `projectIndex` is a raw array index; inserting re-points every town's build queue |
| `HOUSE_TIERS` indices | `built.level` is a raw index; inserting rewrites what every existing house *is* |
| `CRAFTABLES` ids | rename and every farmer silently loses that tool's effect |
| facility `type` / `struct.kind` / `producer.kind` / crop ids | `undefined` lookups, invisible buildings |
| `sheet.seed` derivation | farmers load fine, but every cross-reference detaches: offices vacate, bonds and grudges evaporate |

Evidence this is real: `structSprites.tower` still exists in `main.js` while `'tower'` appears nowhere in
`farm.js` — a legacy type surviving only inside old saves. `T.SIGN: 5` is vestigial and unreclaimable.

**What the harness actually pins, and what it does not.** `tests/compat.mjs` fingerprints the `T` enum, the
`PROJECT_DEFS` order, the `HOUSE_TIERS` names, the `FACILITY_DEFS` keys, the `CRAFTABLES` ids and the
`FORAGE_INGREDIENTS` order. It does **not** pin `struct.kind`, `producer.kind`, crop ids, or the `sheet.seed`
derivation — those rows are a rule you must follow by hand, with no test to catch you. Do not read a green
run as "the contract held".

Note also that the digest hashes the FULL arrays, so it moves on a safe **append** as well as on a
destructive **reorder**. A moved hash is therefore a prompt to check which of the two you did — not proof of
either. Re-pin deliberately, and say in the commit which it was.

---

## 3. Positional hashes are a contract, not an implementation detail

`tilehash.js` holds the positional hash family, shared by the simulation and the renderer. Nothing stores
their results — they are recomputed every frame and every work tick — so **they are the contract a saved town
is read through**. Change a constant and every existing player's town is retroactively different: mature
forests become saplings, boulders resize, ore yield moves.

The salts are as load-bearing as the algorithm. Do not renumber them.

Not covered: `pixel.js`'s `hash2d` is procedural-sprite *texture* noise — it never reads a world position, so
changing it is a visible art edit rather than a silent per-tile rewrite.

---

## 4. Changing content without breaking towns

The save is a **near-total state dump** (~140 fields, the full tile grid, every farmer's whole sheet), and a
resume re-runs the world generator then throws its output away. So terrain generation changes cannot reshape a
town someone already has. You are more change-tolerant than you might fear; the danger is concentrated in
sections 1–3.

Three tiers:

- **Additive** (new facility, appended house tier, appended project) — no migration needed.
- **Visual replacement** — free. Sprites are looked up by the persisted type string, so changing the art gives
  every existing building the new look. **Re-skin, don't re-key.** Renaming the *type* makes the building
  invisible while its tiles stay solid.
- **Behavioural or geometric replacement** — needs the `yardV` pattern: an additive marker whose *absence*
  identifies old saves, plus an idempotent repair pass that **grandfathers** what exists. Its own comment
  states the doctrine: *"Old farms keep the layout they grew; only newly raised facilities get paddocks."*

### `SAVE_VERSION`

It is a **floor**, not an equality gate. Raising it means adding the upgrade step to `World.MIGRATIONS` keyed
by the version it upgrades *from*, then bumping. Steps run before `#restoreFrom`, on data written by a build
that no longer exists, so they must be idempotent and total.

**Prefer not to bump.** The `yardV` pattern is cheaper and safer for almost everything; bump only when a
field's *meaning* changes such that absence cannot express it. (It used to be a strict `!==`, which meant
bumping it silently deleted every player's town.)

### Perks are frozen

`workMult`, `growthMult`, `lightningMult` and `rainBoost` are persisted as accumulated multipliers, not
derived from `structures`. Retuning `PROJECT_DEFS` numbers therefore has **zero** retroactive effect. Fixing
that needs an explicit recompute migration — which must also repair a known bug: after a load, `this.statue`
is a copy distinct from its `structures` entry, so `indexOf` returns −1 and a superseded statue is never
removed on upgrade.

---

## 5. Known-good and queued

**Backward compatibility with pre-generation saves is sound**: a missing `gen:<seed>` reads as 0,
`loadTownState` pairs that 0 atomically with the old snapshot, `fromSave` restores its `_rev`, boot assigns
`_gen = 0`, and the exact CAS matches `(0, stored _rev)` and advances normally. Absent and stored-zero are
intentionally equivalent.

Queued, not blocking:

- **`rev === 0` as the empty-slot proxy** → an explicit empty observation. Safe today only because every path
  that empties a slot also bumps the generation. **Do this before export/import lands**, since importing is a
  new way to populate a slot.
- **Self-concurrent saves** → a trailing-dirty coalesce per world, so a duplicate save does not log a refusal.
- **Web Locks + `BroadcastChannel`** → make a second tab visibly read-only. The CAS is the correctness
  backstop; this is the UX.
