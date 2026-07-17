# Crafting + Invention + Diffusion — v2 build plan (task #97), post-council

Council round (2026-07-09, `.council-review.md`, 4 models): unanimous "not fit beyond a narrow
prototype" — the substrate is sound, but every hard part was punted. v2 folds in all consensus +
contested fixes. The five load-bearing changes:

1. **Slice 1 = Healer + consumables ONLY, with VISIBLE AGENCY** (triage, herb requests, reactions,
   recovery beats). Do NOT refactor tools/projects/facilities into the recipe system yet (council:
   regression magnet + "purely subtractive" otherwise).
2. **Invention is seeded on IDENTITY, not inventory** — `(world ^ farmer ^ day ^ inventCount)`,
   never a `goodsHash`. Kills the JS-iteration-order / float / mid-tick-barter determinism landmine.
3. **Harmful items ship LAST (Slice 4), gated behind a covert-crime detection + recovery system** —
   the Watch (built for overt theft with a live witness) is NOT a counter to slow poison/blight.
4. **The bounded space is ENUMERATED** — concrete tables, counts, effect ranges, duplicate handling.
5. **Crafted items live in their own bucket** (`sheet.items`), separate from raw `sheet.goods`, and
   diffusion is a real rate model (not symmetric gossip).

## Doctrines (non-negotiable, reinforced)
- **Determinism:** all crafting/invention outcomes seeded + in-sim; same seed ⇒ same town. Invention
  seed uses identity + day + a per-farmer counter (NO inventory hashing). Any inventory-derived value
  is canonicalized (sorted keys, integer quantities). Digests re-baseline but self-compare clean.
- **No LLM in the sim loop:** invention/effects are procedural. An LLM MAY *name/flavour* an invented
  item as a display channel, keyed by its STABLE recipe id, with a procedural fallback name always
  present — never affecting mechanics, save-stability, or the digest.
- **Knowledge hygiene:** a farmer crafts only recipes in their KNOWN set; diffusion is explicit.
- **Conservation:** inputs consumed exactly; a failed craft consumes a defined fraction; nothing
  created/destroyed off-ledger (the `transferGood`/`cropStock` invariant Codex enforced).

## The recipe layer (shared spine)
`recipe = { id, name, inputs:{good:qty}, output:{item, qty}, effect, kind, tier }`
- `id` — a STABLE string. Base: `'soup'`, `'salve'`, `'tonic'`. Invented: `'inv:<kind>:<n>'`
  (deterministic from the invention table index — never derived from a display name or LLM text).
- `inputs` — raw goods (grass/flower/crops/…) consumed from `sheet.goods`/`produce`.
- `output` — a crafted **item**, stored in a NEW `sheet.items = {itemId: qty}` bucket, kept
  separate from raw goods so soup/poison can't be bartered or stolen as generic trade goods.
- `effect` — a pure function id the sim applies (heal / cure / tool-buff / [harm, slice 4]).
- `kind` — remedy | tool | utility | harm(slice 4). `tier` — for power-creep control.

Existing tools/projects/facilities stay AS THEY ARE for now (they'll fold in only in a much later
pass, once the recipe layer is proven — council: don't rip out the build economy mid-flight).

---

## Slice 1 — the Healer + consumables (the first ship)

### Base recipes (everyone knows them; no invention yet)
| id | inputs | output | effect |
|---|---|---|---|
| `soup` | 2 crops + 1 grass | soup | mild: `sickDays -= 1`, energy `+0.15` (the current soup, now PAID for) |
| `salve` | 3 grass + 1 flower | salve | `sickDays = max(1, ceil(sickDays/2))`, `strain -= 0.5` |
| `tonic` | 6 grass + 2 flower | tonic | CURE: `health='healthy'`, `sickDays=0`, energy `+0.25` |

### Healing balance (concrete numbers, anti-death-spiral)
- Illness is already CON-save-gated and bounded (`fallIll(3 + rand*3)` → 3–5 days, decays daily).
  So **untreated sickness always self-resolves** — remedies SHORTEN, they aren't the only exit. No
  hard soft-lock is possible: the worst case degrades to today's behaviour.
- `tonic` is deliberately EXPENSIVE (6 grass) + on a Healer brew cooldown, so it can't trivialise
  illness or make `salve` obsolete — salve is the cheap workhorse, tonic the emergency cure.
- **Supply buffer:** grass is replenishable (bushes give 1–3/forage). The Healer keeps a reserve and
  forages proactively; when herbs run low they post a request (below). If the town is truly tapped
  out, healing degrades to soup/self-resolve — inconvenient, never fatal.

### The Healer's VISIBLE AGENCY (the council's core fix — not subtractive)
- **Triage:** the Healer picks the patient in most need (sickest / longest-ailing / lowest energy),
  and chooses the remedy by severity + herb stock — tonic for the gravely ill when herbs allow,
  salve otherwise, soup as a fallback. A real decision, surfaced in their thought bubble.
- **Herb request:** when the Healer's grass drops below a threshold, they post a "bring grass to the
  Healer" call the town answers (reusing the Manager-directive acceptance machinery: opinion ×
  personality, logged, capped) — pulling the town into caregiving. Farmers with spare grass carry it
  to the Healer.
- **Doesn't overwork:** the Healer holds a higher energy floor (rests earlier) so they're available;
  they prioritise tending over their own grind.
- **Reactions + beats:** a cured/tended farmer thanks + bonds; the Healer's approval rises; the
  chronicle logs "tended {X} back to health" and "the Healer ran short of herbs" — readable
  cause/effect. Recovery is a public micro-ritual (reuses the #83 perk-up).
- Fitness/appointment/approval/recall reuse the P1/P2 role kernel (already built): Healer fitness =
  WIS + INT + collaboration; excluded from also being Manager/Watch; shown on card + civic band.

Slice 1 is a full, visible loop: a caring specialist triaging patients, rallying the town for herbs,
and turning the tide of an outbreak — not a resource check.

---

## Slice 2 — procedural invention (bounded + enumerated)

### The safe seed (no goods-hash)
`roll = mulberry32(world.seed ^ farmer.seed ^ (day * 0x9e3779b1) ^ (farmer.inventCount >>> 0))`.
`inventCount` is a per-farmer counter incremented on each experiment (rides the sheet). Reproducible,
zero inventory-iteration/float/mid-tick fragility.

### Trigger (occasional, a genuine beat)
An IDLE farmer (no urgent/personal work pending), off a cooldown (~every few days), with SPARE goods
(≥ a defined reserve of the class's inputs, e.g. ≥8 grass), and enough curiosity/diligence, may
experiment. Urgent survival always preempts it.

### The bounded taxonomy (ENUMERATED — ~12 to start; grows deliberately)
A hand-authored `INVENTION_TABLE`, indexed by `kind` then a small list. Each: `{inputs, output,
effect, tier, weight(farmer)}`. Slice-2 ships the **helpful** kinds only:
- **remedy** (×3): e.g. fever-tonic (faster cure), poultice (heals HP), sleeping-draught (deep rest
  → energy).
- **tool/efficiency** (×3): compost (crop growth +), whetstone (work speed +), lantern-oil (night
  work without the energy penalty).
- **utility** (×3): preserves (soup that doesn't spoil), fertiliser-from-flowers, a rain-charm dud
  (flavour, no effect — a "harmless curiosity", per council's near-miss ask).
- **harm** (×3): DEFERRED to Slice 4 (table entries exist but are UNREACHABLE until then).

Outcome class is weighted by **personality AND state** (not a flat trait map): a farmer surrounded by
the sick + caring → remedy; hungry/behind → efficiency; curious → utility. A `weight(farmer)`
function per entry, so "good→tonic / bad→poison" caricature is avoided; the roll then picks an entry
the farmer can afford.

### Duplicate handling + power-creep
- If the rolled recipe is already town-known: it becomes a **near-miss** (a harmless curiosity or a
  weak variant), not a flat dupe — the farmer "learned something, not much." (Council #4.)
- `tier` caps strictly-superior spam: a stronger variant obsoletes its base only within a bounded
  ladder, and the invention table has a fixed ceiling per kind.

### Legibility
- A chronicle **"discovered"** beat ("{Fen} hit on a way to brew a fever-tonic").
- The farmer's card gains a **KNOWN RECIPES** readout (what they can craft); a town view (folded
  into the chronicle civic band or a recipe line) shows what's been discovered + who knows it.

---

## Slice 3 — diffusion (a real rate model)

A recipe has two knowledge states, decoupled (council: knowing-OF ≠ knowing-HOW):
- **heard-of** — from gossip ("heard {Fen} brews a fever-tonic"); can't craft it yet.
- **known** — can craft it; gained only by being TAUGHT (direct) or from the Lorekeeper.

Spread model (per day, seeded):
- **gossip**: reuses `hearGossip` but only conveys heard-of (low chance, decays). Not symmetric
  auto-teach.
- **direct teach**: the inventor may teach an ALLY (high opinion) — full known — possibly for a
  favour/good; low-honesty inventors hoard or charge. A learning cost (a short "shown how" beat).
- **Lorekeeper** (when that role exists, P4): records known recipes into a town "book" and teaches
  idle farmers at a multiplier — this is the Lorekeeper's real job. NOT a balance prerequisite for
  Slices 1–3 (council: don't hang balance on an unbuilt role) — diffusion works without it, the
  Lorekeeper just accelerates it.
- **Exclusivity half-life**: tuned so a useful recipe takes ~1–2 seasons to become common — the
  inventor keeps an edge for a while, and dead-secret recipes eventually surface.

---

## Slice 4 — harmful items + covert-crime detection (LAST, gated)

Harmful items (bitter draught → sicken; blight dust → wither a crop) ship ONLY after their
counterweight exists (council's hardest consensus):
- **Deferred-effect covert crime:** a harmful item applied to a target's food/crop takes effect
  later. Detection is a **suspicion trail**, not a live witness: opportunity (who was near the
  victim's plot/stores), motive (a standing grudge/rivalry), and pattern (repeat incidents) each add
  suspicion. When suspicion crosses a threshold, the **Watch investigates** and convenes a trial
  (reusing the P2 justice vote) — so covert harm has real, escalating consequences.
- **Recovery + counters:** antidotes (a Healer recipe), crop replant/quarantine, restitution on
  conviction, and community vigilance (neighbours warier of a suspected poisoner). These are the
  self-correction the council demanded before sabotage can exist.
- **Negative feedback:** a caught saboteur is fined/shunned (P2 outcomes) and loses standing; the
  Healer's antidotes blunt poisons; grass/crop buffers absorb blight. No unpunishable stunlock.

---

## Determinism spec (explicit)
- Invention seed: identity + day + per-farmer `inventCount`. NO inventory hashing.
- Any inventory-derived value: canonical serialization (sorted keys, integer quantities, no floats).
- Stable recipe ids (strings), independent of display names / LLM flavour.
- Crafting conserves inputs exactly; a FAILED craft consumes a defined fraction (a "wasted a bit")
  and is itself seeded, not `Math.random`.
- New state on the sheet (rides the save): `sheet.items`, `sheet.recipes` (known set + heard-of),
  `sheet.inventCount`; world gets a small recipe registry if needed. Round-trip tested.
- Headless tests: craft consumes+conserves; invention reproducible per (farmer, day, count);
  duplicate→near-miss; diffusion rate bounds; save/load mid-craft; self-compare digests.

## Legibility (committed)
- KNOWN RECIPES on the card; a "discovered"/"learned"/"tended"/"ran short of herbs" chronicle beat
  set; the town recipe state surfaced in the civic band. No hidden systemic events.

## Rejected / deferred from council (with reasons)
- **goods-hash invention seed** — dropped for identity+counter seeding (determinism).
- **tools/projects/facilities refactor in Slice 1** — deferred; leave the build economy untouched.
- **harmful items early** — deferred to Slice 4 behind detection+recovery.
- **LLM deciding mechanics or naming stored without a fallback** — rejected; flavour only, keyed by
  stable id, procedural fallback always present.
- **Balance hung on the Lorekeeper** — rejected; diffusion works without it; the Lorekeeper only
  accelerates (its own P4 build).

## Verification (per slice)
- Headless: conservation, invention determinism, duplicate→near-miss, diffusion half-life bounds,
  save/load mid-craft; self-compare digests deterministic (new baseline recorded each slice).
- Browser: a Healer visibly triaging an outbreak, requesting herbs, curing/salving with beats;
  (S2) a discovery beat + known-recipe card; (S3) a recipe spreading believably; (S4) a poisoning
  investigated → tried → recovered.
- Balance: a Monte-Carlo-ish sweep over seeds — illness duration, herb scarcity, (S4) sabotage
  frequency + town-collapse rate — to catch grind-lock or spiral before shipping each slice.
