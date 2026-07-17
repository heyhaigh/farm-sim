# ORC_BRANDING_NOTES — Warband Re-Branding Audit

*Fantasy-writer commission, 2026-07-11. Companion to `ORC_HUMAN_LORE.md` (mirror doctrine) +
`ORC_HUMAN_RECONCILIATION_PLAN.md`. Covers the **cultural surface** of an orc town — every human-flavored noun,
label, sprite, and system a warband currently inherits — what to swap, where, how deep. Guiding rule: **each orc
thing is the human thing turned over, not random grotesquerie.** Same soul, inverted lens.*

## Already orc-aware (don't redo)
Only these branch on `culture`/`.orc` today: **dna.js** `orcify()` (war-role, guttural name, ashen palette,
raider personality, one prepended `ORC_CREEDS` line); **farm.js** town name (`ORC_TOWN_ROOTS/TAILS`), standout
founder names (`ensureFounderVariety` orc block), `culture` into `growHeir/growFarmer`, saved/loaded; **main.js**
orc foe sprite on farmers, two UI strings (`- WARBAND`, `raiders/plundered`), world-index `culture`, `?orc=1`;
**pixel.js** nothing. Everything below is inherited verbatim.

## THE ENABLER (do first) — culture-lexicon layer
One map `CULTURE_COPY = { human:{…}, orc:{…} }` keyed by stable ids (`role.manager`, `facility.coop`,
`noun.settler`, `panel.chronicle`, …) + `cultureWord(culture, id)` defaulting to the human string. Every QUICK
rename becomes "add an orc value + route the callsite through `cultureWord`." New `culture.js` (or a const near
`ORC_ROLES` in dna.js). **[MEDIUM once, unlocks ~30 QUICK swaps]**. Pure display, determinism-safe.

## A. NAMES
- **Role titles** MANAGER/WATCH/HEALER → **Warchief/Enforcer/Bonesetter** (farm.js roleTitle ~L2517 + seating/recall beats; main.js civic band). **[QUICK]**
- **Facility names** water garden/chicken coop/livestock pen/sheep pen/mill/hatch house → **leech-bog/crow-roost/beast-pen/pelt-pen/bone-mill/brood-hutch** (`FACILITY_DEFS` labels + main.js `FAC_INFO` + `specialty()`). **[QUICK]**
- **Produce display** eggs/milk/wool/lily&fish → keep ids, relabel roost-eggs/beast-milk/pelt/reeds&eels (`FACILITY_DEFS.produce` + `goodLabel()`). **[QUICK]**
- **Project names** BULLETIN BOARD/GUARDIAN HEAD/TOOLSHED/WINDMILL/FOX SENTINEL/SECOND WELL/STONE MOTHER → **WAR-POST/SKULL-TOTEM/ARMORY/GRIND-TOTEM/FANG-IDOL/BLOOD-CISTERN/THE BLEEDING MOTHER** (`PROJECT_DEFS` + `STRUCT_INFO`; perks untouched). **[QUICK]**
- **House tiers** tipi/yurt/cottage → hide-tent/war-yurt/longhall (`HOUSE_TIERS`). **[QUICK]** copy / **[MEDIUM]** sprites
- **Silo** {NAME} SILO / "Settlers give surplus" → **SPOILS-HOARD** / "Raiders throw plunder on the pile". **[QUICK]**
- **Tale name** TALES OF THE WILDS / rares star-crystal/emberbloom/traveller's relic → **BLOOD-LEGENDS** / skull-gem/ember-gore/warlord's relic (`RARE_NAME`, frozen at founding — snapshot like human). **[MEDIUM]**
- **Recipe/invention names** — orc lens over the SAME name grammar: tier plain/fine/pristine → **crude/forged/bloodforged**; growboost→"war-paint," refresh→"grog," mendhp→"gut-stitch poultice." Parallel orc name-template keyed by canonicalKey+effect+tier, display overlay like `recipeFlavor`. **[MEDIUM]**

## B. ROLES & POWER (#94 civic → warband hierarchy)
- **Civic framing** "the town chose"/APPROVAL/TRUST/winter VOTE/PAST OFFICES → **FEAR-RESPECT/FEALTY/THE RECKONING/FALLEN WARBOSSES**; Moment THE TOWN DECIDES→**THE WARBAND KNEELS**. **[QUICK]** copy
- **Power mechanic** vote vs might: (a) **[QUICK]** keep the seeded tally, re-weight orc "fitness" to STR/CON+reputation, reframe as "the strongest is backed"; (b) **[DEEP]** a real challenge event (ties to FOE_SIEGE + reconciliation envoy). Recommend (a) now, (b) with siege.
- **Recall** "lost faith in their calls" → "the warband smelled weakness". **[QUICK]**
- **Theft trial** — strong inversion: taking from a RIVAL is prowess ("the strong take"); the trial fires only for theft from KIN ("stealing from their own"). **[QUICK]** copy (in-group only) / **[DEEP]** in/out-group targeting split.

## C. FACILITIES & ECONOMY (farm loop → war-camp)
- **The cultivate loop** (crops, till/plant/water/harvest, egg/milk/wool) → **[DEEP]** raid-spoils economy / butchery / grog / trophies + own AI loop. The big deferred rework.
- **Crops** interim **[QUICK]**: don't rename each crop — rename the VERBS harvest/YIELD/harvested → **plunder/HAUL/plundered** (extend the done world-map card to sheet YIELD + roster YLD).
- **Silo/directive** "asks for surplus to grow the town" → **"demands tribute for the hoard"**. **[QUICK]**
- **Barter** "bartered/drove a hard bargain" → "traded spoils/took the better cut". **[QUICK]** / **[DEEP]** intimidation-trade
- **Help economy → warband loyalty** "POST JOBS/I COULD USE A HAND/LENDING A HAND" → **CALL THE WARBAND/I NEED FISTS/ANSWERING THE WAR-HORN**. **[QUICK]** (perfect mirror)
- **Wells** TOWN WELL → **BLOOD-CISTERN**. **[QUICK]**
- **Foraging/wood** "fell a tree/scarecrow" → "hew timber for the palisade / warding-skull". **[QUICK]**

## D. TALES & RECIPES (crafting engine, inverted lens; effects/keys stay = digest anchor)
- Recipe flavor + tale imagery → see A. **[MEDIUM]**
- **Harm axis** — for orcs war-gear/harm is the CENTER not the taboo edge; a bane-dominant brew is desirable "throwing-poison" (re-weight `weight(farmer)` in the invention table). **[DEEP]**, defer.
- **Healer→Butcher-shaman** soup/salve/tonic "tended/eased illness" → grog/gut-stitch/blood-tonic "patched up/stopped the bleeding". **[QUICK]** copy

## E. INNER LIFE
- **ORC_CREEDS** good but thin (6) — add 3–4 avenge/remember lines ("A debt unpaid is a debt unreal," "Carve it, or it never happened," "We endure; let them build"). **[QUICK]**
- **Memory-derived creed QUOTES** stay pastoral (acceptable per lore; optional **[MEDIUM]** orc phrasing set per theme).
- **Personality labels** Pillar/Team Player/Lone Wolf/Homebody/Steady Hand → **Warboss's Right Hand/Pack-Fighter/Lone Fang/Den-Keeper/Cold Blade** (culture-keyed map over same thresholds). **[MEDIUM]**
- **Dreams** `DREAM_DEFS` — beautiful mirror, all display: beloved TO BE NEEDED→**TO BE FEARED**; grandhouse A HOME THAT WILL OUTLAST→**A STRONGHOLD THAT OUTLASTS**; deed A DEED WORTH A STANDING STONE→**A KILL WORTH A SAGA**; outdo TO OUTGROW A RIVAL→**TO BREAK A RIVAL FOR GOOD**; farshore keep; quietlife PEACE A FENCE RAIN→**A DEN A FIRE AND SPOILS ENOUGH**. **[QUICK]** (ids unchanged)
- **Bonds → blood-debts** "grown close/fallen out/owes their life" → "swore a blood-bond/turned on each other/owes a blood-debt". **[QUICK]**
- **GOAL_CREEDS** THIS TOWN LOOKS AFTER ITS OWN/NO ONE OUTGROWS ME → **THE WARBAND TAKES CARE OF ITS OWN/NONE OUT-RAID ME**. **[QUICK]**
- **Story-biography tables** STORY_ORIGINS/DEPARTURES/TALISMANS/ARRIVALS + BELIEF_THEMES — parallel orc set (war-camps, raids, blood-feuds, trophies). **[MEDIUM→DEEP]**, own pass.

## F. COPY & UI (main.js — route through the lexicon; all [QUICK] once it exists)
Top bar RY FARMS/{n} RYS→**{n} ORCS**, MERCHANT IN TOWN→**TRADER AT THE GATE**, ROSTER/CHRONICLE/BOARD→**WARBAND/THE SAGA/WAR-POST**; roster TOWN ROSTER→**WARBAND**, YLD→**HAUL**; sheet FARM→**CAMP**, YIELD→**HAUL**, raised/stolen/foraged→**took/plundered/scavenged**, TOWN TIES/GOSSIP→**WARBAND TIES/CAMP TALK**; chronicle TOWN CHRONICLE/ROLES/RECIPES→**WAR-SAGA/WAR-BAND/WAR-CRAFT**, EVERYONE KNOWS→**EVERY ORC KNOWS**; board TOWN BOARD/PROJECT/PLANS/HELP WANTED→**WAR-POST/WAR-WORK/CAMP PLANS/FISTS WANTED**; boot START A NEW TOWN→**RAISE A NEW WARBAND**, THE TOWN WAITS ITS STORY UNWRITTEN→**THE WARBAND WAITS ITS SAGA UNSUNG**; `currentStatus` TENDING THE FARM→**MINDING THE CAMP** etc.
- **`ENCOUNTER_DEFS.orc = 'an orc raider'`** — an orc TOWN would be attacked by "orc raiders" (their own kind); branch the foe pick on `world.culture` → rival warband / human levy. **[MEDIUM]** (logic, not just copy)

## G. APPEARANCE (pixel.js — new make* siblings; sprite is the only existing branch)
- **Farmer sprite** — foe pack is swapped in but lacks `look(seed)` variety; **[MEDIUM]** add a tusk trait bit + green skin path in `drawHead` + a helm case in `drawHat2` (seeded variety, determinism-safe).
- **Hats** strawhat/hardhat/… → horned helm/bone-crown/topknot/warpaint-band. **[MEDIUM]**
- **Buildings** makeHouse→war-tent/longhall, makeWell→skull-totem, makeFencePost→spiked palisade, makeBoard→trophy-rack, windmill/tower/statues→war-totems, coop/barn→crow-roost/beast-barn; makeGoat is the best war-beast base. Gate on `world.culture` at the draw callsite. **[MEDIUM]**
- **Crop sprites** — **[DEEP]**, tied to the crop-economy rework.

## H. CHRONICLE BEATS & MOMENTS
Compose beat text through the lexicon so "staked a homestead / came to the valley - heir of {of} / grew to town level {N}" render orcish ("claimed a camp / marched into the marches - blood of {of} / the warband swelled to strength {N}"). Sweep kinds: found, lineage, town, build, season, legend. **[QUICK]** once lexicon exists / **[MEDIUM]** to audit all ~15 kinds.

## I. GOTCHAS
- `settler(s)/neighbour/townsfolk/homestead` at 30+ sites → funnel through `cultureWord`, don't hand-edit.
- No festival system yet — design orc-forward (war-feast/trophy-rite) if added.
- **Determinism:** A, D-names/tales, E-dreams/labels/creeds, F, H, and sprite/hat/building G = display/copy → SAFE (culture-keyed tables, ids/keys/thresholds identical, flavor excluded from digest). The **[DEEP]** items touching mechanics (power-by-challenge, theft in/out split, crop→spoils economy, orc harm-axis, foe-target branch) = seeded sim state → harness re-baseline + stable iteration.

## SHIP FIRST (batch, behind the lexicon)
1. Build `CULTURE_COPY` lexicon + `cultureWord`. 2. Role titles. 3. Facility+produce+silo+specialty labels.
4. Project+house-tier+well labels. 5. Dreams mirror. 6. Core UI nouns (RYS→ORCS, ROSTER/CHRONICLE/BOARD,
YLD/YIELD→HAUL, TIES/GOSSIP). 7. Help-economy/bonds/barter/foraging/currentStatus/chronicle-noun copy.
8. Expand ORC_CREEDS + GOAL_CREEDS.
Follow-ups: recipe/tale name overlays (D), personality-label + creed-quote sets (E), sprite/hat/building siblings
(G), orc biography tables (E), DEEP reworks (crop→spoils economy, power-by-challenge, theft inversion, harm-axis,
foe-target) alongside FOE_SIEGE + the crop-economy rework.
