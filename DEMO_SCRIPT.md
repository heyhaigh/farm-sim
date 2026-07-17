# RY FARMS — the 90-second SuperMemory hackathon demo (synthesized from council + fable + Kimi, 2026-07-16)

**Thesis line (say it once, first):** "Every farmer here was grown from one of my real memories. Nobody
scripted Krul the Howler — this town fought him three times, and both sides remember. Watch the loop close."

## Setup (before judges — 15 min)
1. `launchctl` SuperMemory on :6767 is up; `node server.mjs 8013` running; Ollama up (`ollama serve`).
1b. **Warm the model** (Kimi): a cold 3b makes the FIRST counsel line — the very line that proves "the LLM
   reads the war" — arrive late. `curl :11434/api/generate -d '{"model":"llama3.2:3b","prompt":"hi"}'` once.
2. Two browser tabs: **A** = the game (`localhost:8013/?seed=20260706`), **B** = the memory portal
   (`localhost:8013/memory-graph.html`). Optional tab C: a terminal with a `curl :6767/v3/documents/list`
   one-liner for the raw-API skeptic.
3. Canon history already exists (Krul's war, 3 raids — done). If demoing on a FRESH seed instead: run
   `RYFARMS.raid()` twice, let both play out fully, ~5 min.
4. **Rehearse the run once with the booth** (Settings → STAGE A RAID): full show, zero writes — the demo
   itself uses a REAL raid so the write is real. **Stopwatch it on the demo machine, audio ON** (Kimi:
   battle length scales with band size — a full 4-raider fight runs ~40s (the party caps at 4); if the rehearsal overruns the
   budget, re-budget the script to 2 minutes rather than cutting the finale). **Screen-record this ghost
   run as the fallback video** — the live demo depends on network + local LLM + audio + two tabs.
5. Console ready with: `RYFARMS.demoRaid()` (real raid, compressed clock: alarm ~4s, lands ~14s).

## The 90 seconds
- **0:00–0:12 — the premise.** Tab B (portal): "This force-graph is my SuperMemory corpus, live. Gold
  diamonds are towns, discs are farmers grown from my memory documents — and this red diamond is a WAR."
  Click **KRUL THE HOWLER** → the sheet: two battles, blow-by-blow, timestamps predating today's demo.
- **0:12–0:20 — the summon.** Tab A. Type `RYFARMS.demoRaid()` — read the console reply aloud
  ("KRUL THE HOWLER RETURNS"). The marquee names him; **THE WAR SO FAR** card recaps his war — "read from
  the town's memory."
- **0:20–0:30 — the town reacts.** Alarm; every farmer drops their task; the line forms outside the farms;
  the counsel speaks the grudge ("he'll come for ___ — he swore it"). "That line is the local LLM reading
  the war's history. If Ollama were down you'd get authored lines — the sim never waits on a model."
- **0:30–0:58 — the battle.** UNDER RAID slam → Iron at the Gate → initiative duels on the music grid,
  accelerating as raiders fall; the named duel finishes LAST (fermata, finishing blow). Pursuit sees the
  runners off. **Say nothing. Let it play.**
- **0:58–1:12 — the stand-down.** The line lingers; the debrief names the hurt; the aftermath cards
  sequence; then **"SET DOWN IN THE TOWN RECORD"** fires — that card appears only when the SuperMemory
  write has actually landed (point at the doc id on it).
- **1:12–1:30 — the proof.** WAIT for the Inscription card ("SET DOWN IN THE TOWN RECORD") before touching
  tab B — it fires only when the write has actually landed (Kimi: handing over early anti-proves the thesis;
  the holding line is "the town is writing it down — watch for the card"). Then tab B, reload: Krul's war node now holds **three** battles — the newest is the
  fight the judge just watched, blow-for-blow identical. Then hand over the keyboard: "search the store
  yourself — try Krul."

## The three proof moves (if a judge pushes back)
1. **Read-after-write:** tab C, `curl -s :6767/v3/documents/list ... | grep battle` — the new doc,
   seconds-old timestamp, customId keyed to the raid the judge watched.
2. **Provenance both directions:** a farmer's sheet → the recognizably-human source memory that grew them;
   the counsel's grudge line → the earlier battle doc containing the oath.
3. **The negative control (the closer):** Settings → STAGE A RAID (ghost). Full spectacle plays; show the
   store — **no document appears**. "The system knows canon from rehearsal. What writes is real."

## Failure modes + outs
- Ollama slow/down → authored MUSTER_TALK/DEBRIEF pools carry the scene invisibly; don't mention it unless
  asked, then it's a FEATURE (offline-first).
- SuperMemory down → the Inscription card simply won't fire; fall back to the portal's existing corpus and
  the pre-demo battles. (Check :6767 before going on.)
- A raid where Krul FALLS ends his war — that's a *better* demo ("the war ends at ___'s feet" + the war
  closes in the Book of Wars). Roll with the seeded verdict; both endings are honest.
