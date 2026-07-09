# Ry Farms — Memory-Depth Plan (post-council, 2026-07-09)

The council (5 voices: DeepSeek, Gemini, GPT-5.5, Grok, Fable) was unanimous: the engine is rigorous
and the doctrines are sound, but the memory feature ships as **scaffolding, not the identity feature** —
the inner life is "one quote deep," ~16 themes can't carry 162 real documents, and a large fraction of
mundane docs fall to the generic fallback *by construction*. Beliefs sclerose, attribution repeats, and
every tuning number is asserted, not measured. This plan makes memory **document-specific, varied, and
re-entrant**, adds the missing self-correction loops, and replaces asserted numbers with measured ones.

Doctrines still hold (determinism, compile-don't-query, personality-guard). All display-text widening
uses dedicated seeded streams → digests unmoved; the few sim-affecting changes (belief bounds) re-baseline
but self-compare.

## Workstream 1 — Widen the source-document channel + variation  (HIGHEST LEVERAGE)
*Fixes: "one quote deep", fallback-generic-by-construction, creed repetition.*
- **`docLexicon(memory)`** (dna.js): deterministically extract 4–10 SALIENT tokens from title+summary+
  content — proper nouns / capitalized / rare / domain terms, stopwords dropped, seeded tie-break. Every
  farmer, even a "steady"-fallback one, carries words from THEIR actual document.
- **Weave the lexicon into creed quotes**: each theme gets 2–4 quote TEMPLATES with a `{term}` slot filled
  from the lexicon (fallback to a neutral word if empty). So two "grit" farmers read differently and each
  references its own doc.
- **Creed mutter variation + cooldown**: creeds get multiple phrasings (beliefs already do) + a per-farmer
  "last said" guard so the same line never repeats back-to-back.
- **Belief phrasings also slot the lexicon** where natural (they already vary + name the cause).
- Deterministic + display-only → digest unchanged. Verify: a blind distinctiveness check (below).

## Workstream 2 — Belief erosion + anti-spiral bounds
*Fixes: sclerosis, monotonic drift, runaway polarization in tiny towns.*
- **Contradiction → erosion**: a belief whose theme is repeatedly CONTRADICTED by recent events weakens
  and can be shed (a 'wary' farmer helped enough softens; 'kinship' betrayed enough hardens). Add a belief
  `strength` that rises on reinforcement, falls on contradiction, and drops the belief below a floor.
- **Nudge bounds**: cap cumulative personality drift per trait (e.g. ±0.18 lifetime) so a life can't push a
  farmer to an extreme; nudges shrink as they approach the cap and reverse under contradiction.
- Re-baselines the digest (sim-affecting) but self-compares.

## Workstream 3 — Invention throttle + knowledge-recovery valve
*Fixes: content ceiling, near-miss spam, hoarding dead-ends.*
- **Throttle**: a farmer stops tinkering once their reachable table is exhausted (all affordable helpful
  recipes known) — no more pure near-miss spam / silent stock burn.
- **Recovery valve**: confirm independent rediscovery already works (it does — near-miss blocks only the
  SAME farmer, not the town); add a light **observe/reverse-engineer** path so a witnessed craft can seed
  heard-of, and a **deathless-town caveat** note. Keep it small.

## Workstream 4 — Trial legibility + the sabotage-evidence decision
*Fixes: "the sim cheats", omniscient-vs-exploitable opportunity, untested role-crime intersections.*
- **Show the case**: when the Watch accuses, the chronicle names the evidence that crossed the bar —
  motive (the grudge), opportunity (pieced together), pattern (priors). A verdict must show its basis.
- **Opportunity framing**: keep perp-only (fair, no wrongful conviction) but FRAME it as reconstructed
  ("the Watch pieced it together"), not omniscient. Decide explicitly; document it.
- **Intersections**: a role-holder shouldn't sabotage the very thing they steward — discourage the
  Healer from being the saboteur (poison-then-cure); ensure a poisoned outcast still recovers even if the
  hard-hearted healer refuses (poison illness self-resolves like any illness — verify).

## Workstream 5 — Measurement harness (replace asserted numbers with measured)
*Fixes: "every tuning number is asserted."*
- **Soak harness**: N seeds × ~30 days → belief-theme histogram, **fallback-creed fraction**, time-to-full-
  diffusion, sabotage incidents / conviction rate / **innocent-conviction rate**, invention hit-rate
  variance, per-town belief count distribution.
- **Blind distinctiveness test**: compile creeds for the whole real corpus (+ synthetic mundane docs);
  measure how often two farmers get an identical creed SET, and the fallback fraction. This is the real
  "can you tell them apart" test, run over the roster, not the sweeper.

## Quick fixes (alongside)
- **Slice-2 doctrine honesty**: creeds DO nudge within the guard (thrift creed `+0.12` to lowball drive).
  State that plainly; add a test that the memory modifier stays strictly below the personality modifier.
- **Writeback**: dedupe by (townSeed, farmerSeed) so repeated fresh boots can't spam duplicate life-docs;
  keep the read-filter but add a boot-time integrity assert.
- **RECIPES "(N have heard of it)"**: minor knowledge-leak nit — leave unless the whisper channel starts
  reading it.

## Sequence
W1 (lexicon + variation) → W5 blind test to PROVE W1 landed → W2 (belief self-correction) → W3 (invention
throttle) → W4 (trial legibility) → soak harness + quick fixes folded in. Council-re-review after W1+W2.
