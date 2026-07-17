# Ry Farms — The Raid/Watch/Congregation Build Spec (v3, 2026-07-14)

**This is the definitive design to BUILD from** — consolidated after a re-review (council + Fable) and a long
design pass with the owner. We are past reviewing-to-decide; the reviews were mined for guardrails (baked in
below). Doctrines unchanged: **determinism** (sim = seeded rng; same seed ⇒ byte-identical; cross-town crosses
in via an exactly-once inbox) and **compile-don't-query** (LLM + SuperMemory are display/persistence side-channels).

## The spine (what makes the whole thing real)
The screensaver verdict was really "no meaningful agency." The fix isn't a defense minigame — it's that **the
player and the town's government run on different value functions:**
- **The Manager governs UTILITARIAN** — town survival, cold arithmetic. Good at it; doesn't need the player to optimize.
- **The player governs CARE + INTEL** — you know these specific little people (grown from *your* memories), and
  you alone **see the world map**. Your whisper is the *personal, sometimes-earlier* voice over the town's calculus.

## What a RAID now IS (the arc everything serves)
A raid is a little story, not a resource tax:
**a lookout sees them coming → raises the alarm → does the town answer in time? → someone's hurt (or down), stores
held (or lost) → the town remembers, and reaches for stronger defense or for peace.**

The guard is the town's **tripwire + rallying point, NOT a lone hero.** One farmer can't turn away four; the
guard's worth is *detection + rally timing* — converting a *surprise* into a raid the town **rallies** to. This
elegantly closes the council's stacking fear: detection+rally **doesn't stack into a turtle** (one good lookout is
enough), so no hardcoded cap is needed — it's just not what a lookout *is*.

---

## BUILD ORDER (dependency-correct; each built RIGHT, not fast)

### 1. Speech floor  — *foundation, small*
A **scene-scoped conversation mutex** (congregation + day-10 vote ONLY — not a general N-party framework, per both
camps): while a ceremony scene is active, one farmer holds the floor and speaks; the next waits a readable beat
(builds on the shipped `sayAfter`/`speechReadTime`). No global lock on ambient chatter.

### 2. The founding congregation  — *the cold open; births the watch*
Fresh town, day 1: instead of scattering, the 8 gather at the well/war-post (reuse the existing `foundingPhase`
gather machinery) and hold a **short, paced, AUTHORED (procedural — no LLM in the day-1 path) exchange**:
- **≤4 floor speakers**, personality-cast (proposer / dissenter / comic / seconder); everyone else interjects one
  word or an emote. **≤~40s, skippable on any input** (skip advances the founding state cleanly, doesn't strand it).
- The town agrees a founding plan in *words*; the **only seeded decision is the rotation order** (one array).
  Everything else (forage, stake plots) is dialogue flavor, not sim state — or it becomes the founding subsystem.
- Out of it: the **self-organized rotating watch** (below), as *fiction the town agreed to*.
- Determinism: conversation = display; rotation order = seeded sim state. State machine covers skip / reload /
  interruption / a farmer who can't gather (sleep/injury/blocked) → degrade cleanly.
- Returning-town cold open (recap card + charge-drift) is DEFERRED out of this — separate, later, simpler.

### 3. The watch as a persisted institution  — *the tripwire, rally, wounds*
- **Pre-election (day 1–10):** the founding agreement IS the policy — a **fair rotating watch**, **max 1 on the
  beat**, a new whisper *relieves* via the rotation (never adds/stacks). The cap belongs to the **institution, not
  the (nonexistent) Manager** (Fable's key catch). You're the only *outside* instinct here.
- **Post-election:** the **Manager runs** the rotating, **threat-gated** watch (up when danger's sensed, down in
  peace — scales with threat, no permanent tax); the elected **Watch** is the standing sentinel; the Manager may
  surge to ~2 under threat. Authority/replacement/wound-priority cleanly separated between Watch vs. rotating guard.
- **Behavior — a patrol beat:** the guard cycles a few outward posts, pause-and-scan, loops (reads as "on watch").
  Human vs orc body language differs. **Layer 2 (strategic vantage/blind-spots) + the town fence DEFERRED.**
- **The tripwire:** the guard's job is to **raise the alarm early** and **rally the town** (reuse
  `#maybeRallyToThreat`/`threatAlert`). Their contribution to the raid is *alarm lead time + defenders rallied*,
  NOT flat `defPower`.

### 4. The threat tell  — *the player's intel edge*
Surface **"a warband gathers"** on the watched town from the inbox/`commit` the world layer already computes.
**Lead time ≥ worst-case whisper→confer→post traverse** (or ship an honest "posted too late" beat) so the marquee
loop (see tell → whisper → guard posted in time) can't die to pathfinding. This is what your *intel* buys you.

### 5. The whisper-lobby with visible feedback  — *the CARE agency*
You whisper to an **individual** (as now): *"go take watch,"* *"pull her off the line,"* *"raise the watch —
raiders to the north."* That farmer, per personality:
- **heeds via the Manager** — walks over, confers (*"relieve Hail? / stand longer?"*), the Manager decides; **or**
- **ignores it** (personality).
**Every outcome gets an on-screen tell** (the council's loudest note): willing / walking-to-confer / Manager
posted them / Manager kept the current watch and sent them back. Pre-election: no Manager, they go straight to
watch. **Manager personality gates how readily your whispers land → elections finally have felt consequence.**

### 6. The raid outcome + the wound  — *the stakes*
- Guard sees them → alarm → **rally**: more defenders answer → better outcome; too few/too late → raiders carry
  off stores. Resolver weighs who actually showed (already does).
- **The wound is real, not a rebound:** a guard on the exposed line takes elevated wound risk (scaling with raid
  severity), heals over **days** via the existing health economy (rest + the **healer** tends them faster), and
  can be **downed** if overwhelmed alone before help comes. The cost is *you gambled a specific person you value.*
- **Counterfactual on FROZEN rolls** (fork rolls; don't consume the rng stream): report the guard's marginal
  effect honestly, keep the zero-delta case ("they'd have gotten in anyway / the fence would've held").

### 7. The learning arc  — *raids drive the story (mostly reuse)*
A raid that gets away deepens the **grievance** (reconciliation ledger) → the town grows warier and reaches for
one of two learned responses: **stronger defense** (more watch, a defense-minded government it elects; eventually
walls — the deferred fence) or a **negotiated truce** (the reconciliation/parley "mechanism of hope"). Little
people who remember — *and learn.*

### 8. Surface reconciliation's middle act  — *deferred to last; pure display*
Event-gated voiced creed-vs-belief conflict via the memory-echo bubble; NO persistent badge (gate a tell to
near-crossover only). Deferred behind the watch vertical.

---

## Reuse / New / Deferred (honesty about scope)
- **REUSE:** `foundingPhase` gather machinery, `#maybeRallyToThreat`/`threatAlert`, health economy + healer +
  downed/revive, grievance/reconciliation ledger + parley, the whisper→urge→heed/ignore chain + its tell, `#resolveRaid`.
- **NEW (the connective tissue):** speech-floor mutex; the founding exchange + seeded rotation order; guard-as-
  tripwire (alarm/rally timing, patrol beat); the threat tell with lead-time guarantee; the whisper-lobby feedback
  states; the frozen-roll counterfactual.
- **DEFERRED:** Layer-2 strategic vantage/blind-spots; the town fence/walls; the returning-town recap/camera; LLM
  in the day-1 path; reconciliation surfacing (Move 8, last).

## Guardrails baked in (from the reviews)
Trim the congregation (≤4 speakers, one seeded decision, ≤40s, network-free, skippable); watch cap bound to the
institution not the office; guard = detection+rally (not stackable defPower); wound = a *risk* on the exposed
line, not a queue to weaponize; every lobby outcome has a visible tell; threat-tell lead time ≥ traverse; speech
floor scene-scoped only; counterfactual on frozen rolls with the zero-delta case kept. **Determinism holds
throughout** (conversation/patrol/tells are display; rotation order + standing orders are persisted seeded state).

## The one honest gate
Before claiming "legibility resolved," a tiny **fresh-eyes check** (a few people watch 90s cold → "what changed
this farmer / what did your whisper do?") — code guarantees the arc *fires*, not that a stranger *gets* it.
