# Ry Farms — THE RAID, AS BUILT: how is the experience forming? (council + fable, 2026-07-16, T-minus ~12h)

**The ask:** this is NOT a plan review — it's an experience review. Below is the raid vertical exactly as it
plays tonight, moment by moment, after three build-feedback loops with the designer. Judge the EXPERIENCE:
where is it strong, where does it sag, what one or two changes before the SuperMemory hackathon deadline
(~12h) would most lift how this demos and how it feels to play. Assume all of it works as described.

## Context in two lines
A CRT-shaded isometric pixel farm-sim where every farmer is grown deterministically from a real memory
document (D&D stats, personalities, elections, grudges). Orc warbands raid across a world map; everything
below writes back into self-hosted SuperMemory — the hackathon's judging axis is how meaningfully memory is
leveraged. LLM = local llama3.2:3b, display-only side-channels, authored fallbacks everywhere.

## THE EXPERIENCE, moment by moment (as built tonight)
1. **The telegraph (~45s).** A marquee: "A WARBAND GATHERS TO THE SOUTH-WEST" (screen-true compass). A red
   danger seam bleeds into the ground in that bearing — fading up from just past the town's outermost farms,
   holding, fading out again toward the fog. Six orc figures muster on it, restless, facing the town (full
   4-direction sprites). A pulsing red mark on the minimap. If a farmer is working near the gathering point,
   they SIGHT it: cry out, alarm goes up early.
2. **The alarm.** The sentry (or the sighter) cries "RAIDERS! TO ARMS!" — every hale farmer drops their task
   mid-swing and converges on a muster line OUTSIDE the farms, facing the threat. The sentry stands down from
   the perimeter beat and joins. Buildup music ("The Gathering Dark": low E drone, lone frame-drum) with an
   audibility floor. On the line they talk — an LLM writes the muster counsel per telegraph (urgent strategy
   + nerve, by name, speech-floor paced, one voice at a time); authored pools if offline.
3. **The named war.** Raid one founds a nemesis arc silently. From raid two the marquee reads "KRUL THE
   HOWLER RETURNS — RAID 3 OF HIS WAR"; the chronicle names him; if he swore against a farmer (the hero who
   bested him last raid), "— and he comes for Cricket", and the counsel knows it ("he'll come for Cricket. he
   swore it."). One nemesis at a time. Ends honestly both ways: whole band broken = "the war ends at
   Cricket's feet"; reconciliation = "ends at the parley table."
4. **The landing.** UNDER RAID slam (3.2s covered hold, war-horn ×3) fires on first blade-contact with the
   line. Hard cut to battle music ("Iron at the Gate", 132bpm, kick every beat). Toasts/spotlights freeze
   while the raid is hot — the fight owns the screen.
5. **The battle.** Each raider pairs with a defender (the named foe goes for his sworn enemy — the FOCUS
   duel). A GLOBAL INITIATIVE runs the whole fight: ONE exchange resolves at a time, round-robin across
   duels on a ~1.1s beat — MISS / PARRY! / DODGE! / HIT! / STAGGERED!-loses-next-turn floating text, footwork
   on every outcome (knockback, press, recoil, sidestep), lunge animations, per-outcome clash SFX. Endings
   are scripted to the seeded resolver verdict: doomed raiders take the finishing blow at the line (FELLED!,
   darkened fallen pose); survivors BREAK OFF — and are PURSUED, harried with swings at their backs to the
   silo and out, seen off at the wilds ("and STAY out!"). A defender who fells their raider flanks the
   nearest live duel — but the nemesis duel is off-limits: "NO — he's mine!"
6. **The stand-down.** No scatter: the line breaks up over seconds on a stagger, lingering while a DEBRIEF
   plays — the LLM writes the aftermath (who's hurt by name, the reckoning, then strategy: a returning foe
   means guard the sworn one / meet him further out; a new band means walls and watches). Music exits on a
   ladder: battle → 7s of the low-drone comedown → the season theme.
7. **The memory.** Every real battle writes ONE SuperMemory document the moment the show ends: the
   round-by-round exchanges with names, the reckoning, the hero, the wounded, whose war it was. The town's
   civic record carries the BOOK OF WARS (current arc + every ended war). Farmer lives, elections, and
   inventions were already persisted — the loop is: memories → farmers → a named war accumulating across
   raids → battles written back, blow by blow.
8. **The apparatus.** An admin booth stages GHOST rehearsals (full show, zero record — probe-verified) for
   filming; `RYFARMS.raid()` summons real canon raids; cursor-crossing can walk the camera into a met
   neighbour town (in-place world swap, CRT-static channel change).

## Known rough edges (designer's own list, partially unfixed)
- The counterfactual "HAD MERCURIAL NOT KEPT THE WATCH..." marquee + the RAIDERS AT THE GATE grand card both
  land right at battle-end — the aftermath reading may now be its own pile-up.
- Duels v2/initiative/v3 not yet browser-verified end-to-end (built against tests + earlier live sessions).
- The battle doc is deterministic prose, not an LLM tale (the chronicler phase was deliberately deferred).
- The memory PORTAL (force-graph of the SuperMemory corpus) does not yet surface wars/battles specially.

## The questions (answer ranked, be concrete)
1. As a played EXPERIENCE, where does this sag? What's the weakest beat in the 1→7 sequence?
2. With ~12h to the hackathon deadline (judging = meaningful SuperMemory leverage + demo impact): what ONE
   or TWO changes lift it most? (Candidates: portal surfacing of wars/battles; an LLM battle-tale
   chronicler; a "war so far" recap card when a named foe returns; demo-choreography tooling in the booth;
   fixing the aftermath pile-up; something we haven't thought of.)
3. Is the initiative pacing (one exchange per 1.1s across ~4 duels, battle ~25-40s) right? Too slow, too
   fast, or does it need dynamics (accelerate as duels resolve)?
4. The demo itself: if you had 90 seconds of judge attention, what exactly do you show, in what order?
5. What would make a JUDGE believe the memory loop is real and not staged — what should be visibly
   queryable/traceable live?
