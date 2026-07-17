# Moments — the celebration/legibility layer

The presentation spine the sim lacked: profound events (good AND bad) elevated into felt beats — a sound cue,
an on-screen callout, and for the biggest ones a modal that SHOWCASES the farmer + what happened + WHY (the
memory that drove it). Directly answers the council's #1 critique ("the depth is invisible in a demo"), and is
the vehicle that makes memory-causality legible (Phase 1). Display-only: reads the sim's event stream, never
writes back — determinism untouched.

## Decisions (locked with Ry)
- **Grand tier** (sound + spotlight modal): rare find · tale proven real · dream fulfilled · communal project
  raised · election result · a farmer gravely struck down (there is no permanent death — `downed`/revive — so
  the somber beat is a grave downing, honestly).
- **Callout tier** (banner + soft chime, non-blocking): discovery · first bond · poaching caught · level milestone.
- **Everything else** stays in the log/chronicle as-is. Scarcity is the point.
- **Memory "why" from day one** — the modal cites the compiled memory behind the beat (tale/dream/creed →
  source doc). Built alongside the celebration layer, not after.
- **Tone adapts** — triumph (warm) vs somber (cold) vs neutral.
- **Unified with the recap** — the end-of-day recap already slices `chronicle` by day; grand beats are
  highlighted there too. One events model, two surfaces (live spotlight / recap reel).

## Architecture (doctrine-clean, display-only)
- `addChronicle(kind, text, who, other, color, meta?)` gains an optional `meta = { tier, tone, why, icon }`.
  `why`/`tier`/`tone`/`icon` are computed deterministically (no rng) from already-compiled state; chronicle is
  NOT in the determinism digest, so this can never move the sim. Existing calls unaffected (meta defaults off).
- Emit sites pass meta at the grand/callout events (harvestRareNode, election tally, project raised, dream
  fulfilled, downing, discovery, bond, theft-caught).
- `whyOf(...)` helpers derive the provenance string from the farmer's tale/dream/creed + its source doc.
- `audio.moment(tone)` — a short triumphant arpeggio / somber tone (same oscillator style as `workSfx`).
- main.js: watch the chronicle for new grand/callout entries (like `recapSeq`); grand → center spotlight modal
  (dim backdrop, farmer sprite + icon + title + why, sound, auto-dismiss/click); callout → floating banner +
  chime. Recap card highlights grand beats.

## Build order
1. Vertical slice: **rare-find** end to end (richest provenance — the tale→belief→seek→find chain). Emit meta +
   `whyRareFind` → spotlight modal → triumph cue → recap highlight. Get it beautiful.
2. Generalize: the rest of the grand list, then the callout tier, then the recap highlight polish.
