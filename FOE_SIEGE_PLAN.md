# Foe Siege — fences as collision, breakable structures, farmer response & rebuild

**Status:** QUEUED (not started). Captured 2026-07-11 from Ry. Belongs under **WORLD_OF_TOWNS_PLAN.md Phase 3**
(orc towns & the human/orc tension) and threads into Phase 4 legibility (visible drama) + Phase 5 shader beats
(raid punch). Build only after Phase 1 (memory loop) lands; this is the *conflict* payoff the demo wants.

## The core change
Today a foe encounter (assassin / orc / anyone who doesn't belong in the town) effectively **ends when a farmer
reaches their fence line** — the fence is a safe boundary and the threat evaporates. Ry wants the opposite: the
**fence is not a magic ward**. A foe can breach it and press the attack *inside* the farm, which forces real
decisions from the farmer and adds a rebuild/repair economy afterward.

## Mechanics to build

### 1. Fences are collision paths for foes (not free passage, not an invisible wall)
- Foes / non-town individuals treat fence tiles as **collision** — they can't instantly walk through.
- But a fence is **breakable**: a foe can choose to destroy a fence segment to get through. A fence should be
  **quick/easy to break** (low HP), so it slows but doesn't stop a determined attacker.
- Town members pass their own fences normally (existing behavior); only foes must break through.

### 2. Foes choose a target once inside
After breaching, a foe **picks what to do** (not just "reach the farmer"):
- **Destroy farmland** (trample/burn crops or facilities), or
- **Attack the home**, or
- **Attack the farmer** directly.
- Target choice can be memory/personality-driven (an orc who remembers being turned away burns the home; a
  raider after resources hits the farmland) — traceable via Phase 1.2 provenance for the narrator.

### 3. Structures have HP and take TIME to destroy
- A **fence** breaks fast (seconds of effort).
- A **home** takes a **while** — you should visibly see the **house health diminish** over sustained effort.
  This creates a window: the attack on a home is not instant, so the farmer (and neighbors) can react.
- Effort/timing is the tension knob: a foe committing to a home is exposed for that whole duration.

### 4. The farmer's response — real choices, not just "flee home"
The farmer can no longer assume running to the fence = safety. New decision branch when a foe breaches:
- **Flee** — but realize *"I can't actually run safely home"* if the foe can follow/breach; the old escape
  is no longer guaranteed. This should be a felt beat ("Oh crap, this foe doesn't disappear at my fence").
- **Get help** — run to other farmers / the town, raising an alarm; nearby (esp. brave / high-STR / Watch)
  farmers converge to defend. Reuses the help-economy + Watch plumbing.
- **Fight back** — stand and defend (stat-driven: STR/CON, maybe a tool as a weapon), possibly alongside helpers.
- **Flee to town** — still an option, but now a *strategic* one (regroup, gather defenders) rather than an
  automatic safe-out.

### 5. Rebuild & repair (the aftermath layer)
Damage persists and must be undone by labor:
- **Rebuild the fence line** — the farmer (and helpers) must re-raise destroyed fence segments to close the
  perimeter again (reuses fence-building / expansion cost logic).
- **Repair the home** — restore house HP over time/effort; a badly-damaged home may impair its function
  (no safe sleep / morale hit) until repaired.
- Trampled farmland must be re-tilled/replanted (existing crop loss + regrow paths).
- This gives raids **lasting consequence** and gives farmers a **recovery arc** (good narrator/legibility beats).

## Integration points to inspect before building (don't assume; verify in code)
- Existing **encounter/foe system** (assassins, `world.encounters`/`prey`, whatever spawns & resolves foes) —
  where the "ends at fence" behavior lives.
- **Fence representation** — fence posts/segments as tiles vs. drawn overlay; whether they already have any
  collision or HP concept (likely none for foes today).
- **Structure HP** — does the house/facility already have a health/damage concept? (Storm/lightning damage?
  If a house-HP field exists, reuse it; otherwise add one, carried in save/fromSave.)
- **Pathfinding/collision** — how movement collision is computed, so foes can treat fences as blocking-but-
  breakable without breaking farmer pathing.
- **Watch / help economy** — reuse for "get help" convergence + defenders.
- **Determinism**: all of this is SIM state — every choice (breach, target, flee/fight/help, damage ticks,
  rebuild) must be seeded rng + stable iteration; new HP/damage/rebuild fields must serialize in save/fromSave;
  the determinism harness must still self-compare (re-baseline once, but same-twice must hold).
- **Legibility (Phase 4)**: alarm indicator, "under attack!" beat, narrator lines ("An orc broke Bram's fence
  and set upon his home"); **shader (Phase 5.4)**: a bloom/aberration punch when a breach or raid lands.

## Open questions
- Can foes breach INTO a farm and also be *fended off* and retreat, or is it fight-to-resolution?
- Do multiple foes (an orc warband) coordinate a siege, or is this 1v1 first?
- Does a destroyed home kill/displace the farmer, or just force repair + a morale/During-repair penalty?
- Is "fight back" lethal (a farmer can die), or does defeat = injury/flee? (Ties into the existing
  health/illness/death model — verify what exists.)
