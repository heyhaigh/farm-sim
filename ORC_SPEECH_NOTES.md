# Orc SPEECH Audit & Rewrite (fantasy-writer, 2026-07-12)

All farmer speech lives in **farm.js** (216 inline `.say()`/`.think()`/`this.thought=` + pools) and **dna.js**
(creeds). `main.js` has ZERO speech (only renders `farmer.bubble`/`farmer.thought`). Wire everything on
`world.culture === 'orc'`. Determinism-safe: pure display, swap arrays of EQUAL length. Grep the actual strings
(line numbers below drift as the file changes). **Highest win: POOL B (#scriptedChat) + 2a (task-thoughts).**

## POOL A — IDLE_THOUGHTS (farm.js)  [DONE]
human: NICE DAY OUT HERE / THE SOIL SMELLS GOOD TODAY / I SHOULD VISIT THE WELL LATER / WONDER HOW THE NEIGHBORS
ARE DOING / A GOOD FENCE MAKES A GOOD FARM
orc: GOOD DAY TO TAKE SOMETHING / THIS GROUND STINKS OF WEAKNESS / THE CISTERN IS MINE TO GUARD / WHICH OF THEM
IS RIPE FOR TAKING / A STRONG WALL IS A FULL BELLY

## POOL B — #scriptedChat greeting/pleasantry sub-pools (farm.js ~7445-7528) — HIGHEST FREQ  [DONE]
Each `#pickLine([...])` is a pool; swap by culture. Full parallels (human → orc):
- warm/friend: GOOD TO SEE YOU FRIEND!→STILL BREATHING, BLOOD-KIN. / WE MAKE A FINE TEAM.→WE RAID WELL TOGETHER.
  / YOUR HELP STUCK WITH ME.→I OWE YOU A DEBT. IT HOLDS. / THIS PLACE FEELS LESS LONELY.→THE CAMP IS STRONGER WITH YOU.
- grudge: I HAVEN'T FORGOTTEN.→I FORGET NOTHING. / WATCH YOURSELF.→SLEEP LIGHTLY. / WE ARE NOT SQUARE.→THE DEBT IS
  UNPAID. / KEEP TO YOUR OWN ROWS.→STAY OUT OF MY REACH.
- challenge-leader: I'LL PASS YOU YET.→I'LL PULL YOU DOWN YET. / ENJOY THE LEAD... FOR NOW.→WEAR THE CHIEF-MARK...
  FOR NOW. / YOUR LEAD HAS A SHADOW.→YOUR THRONE HAS A KNIFE BEHIND IT.
- is-leader: KEEP AT IT!→TAKE MORE! / FINE DAY FOR FARMING.→FINE DAY FOR TAKING. / THE TOWN RISES WITH US.→THE
  WARBAND RISES ON OUR BACKS.
- vivid-memory: WE'RE NOT SQUARE YET.→THE BLOOD-DEBT STANDS. / GOOD WORK STICKS AROUND.→A GOOD HAUL IS REMEMBERED.
  / WE BUILT MORE THAN WOOD.→WE SPILLED MORE THAN SWEAT. / THAT DAY STILL HOLDS ME UP.→THAT DAY IS CARVED IN ME. /
  THE TOWN REMEMBERS WORK.→THE SAGA REMEMBERS BLOOD. / DAY {d} STILL STINGS→DAY {d} IS AN OPEN WOUND / DAY {d}
  STILL WARMS ME→DAY {d} STILL FEEDS MY FIRE
- project: {L} NEEDS {n} MORE.→{L} WANTS {n} MORE FISTS. / {L} IS NEAR DONE.→{L} IS ALMOST OURS.
- no-board: WE NEED A BOARD FOR JOBS.→WE NEED A WAR-POST FOR THE TAKING.
- goal lines (by this.goal): good-neighbor A FARM IS A PROMISE.→A DEBT REPAID IS A DEBT REPAID. / HELP GIVEN
  RETURNS HOME.→A FIST LENT COMES BACK ARMED.  lone-wolf QUIET ROWS SUIT ME.→I HUNT ALONE. / I TRUST WORK MORE
  THAN TALK.→I TRUST MY AXE MORE THAN YOUR MOUTH.  harvest-king EVERY ROW IS A SCORECARD.→EVERY HAUL IS A TALLY. /
  THE HARVEST WILL KNOW ME.→THE SPOILS WILL KNOW MY NAME.  sharp-trader FAIR TERMS KEEP FRIENDS.→HARD TERMS KEEP
  THE WEAK IN LINE. / A DEAL TELLS THE TRUTH.→A DEAL IS A LEASH.  master-farmer I AM LEARNING THE LAND.→I AM
  BREAKING THIS LAND. / THE SOIL ANSWERS PATIENCE.→THE LAND YIELDS TO STRENGTH.  default WE KEEP LEARNING HERE.→
  WE GROW STRONGER HERE.
- gossip: DON'T TRUST {X}...→{X} IS WEAK. USE THEM.
- weather: SKY SOUNDS ANGRY TODAY.→THE SKY WANTS A FIGHT. / COUNT YOUR ROOF BEAMS.→BRACE THE WALLS. / RAIN DOES
  HALF OUR WORK.→RAIN SPARES OUR BACKS. / THE FIELDS ARE DRINKING.→THE MUD FEEDS THE SPOILS. / THE DIRT IS ASKING
  LOUDLY.→THE GROUND IS DYING OF THIRST. / EVERY DROP COUNTS TODAY.→HOARD EVERY DROP.
- default greeting: MORNING!→GRRAH. / HOW GOES THE HARVEST?→WHAT HAVE YOU TAKEN? / WHAT DID THE SOIL TELL YOU?→WHAT
  DID THE WILDS COST YOU? / STILL HERE. STILL TRYING.→STILL HERE. STILL TAKING.
- listener warm: ALWAYS FRIEND.→ALWAYS, BLOOD-KIN. / I REMEMBER TOO.→I REMEMBER THE DEBT TOO. / WE KEEP EACH OTHER
  STANDING.→WE KEEP EACH OTHER ARMED.
- listener cold: MIND YOUR OWN ROWS.→MIND YOUR OWN THROAT. (keep '...' / NOT TODAY.)
- listener project: I CAN SPARE A HAND.→I CAN SPARE A FIST. / POST IT WHERE ALL CAN SEE.→NAIL IT TO THE WAR-POST.
  / THAT WOULD HELP US ALL.→THAT FEEDS THE WHOLE BAND.
- listener weather: WEATHER HAS A TEMPER.→THE SKY HAS A TEMPER. / THE ROOF WILL TELL.→THE WALLS WILL TELL.
- listener default: LIKEWISE.(keep) / CAN'T COMPLAIN.→NO BLOOD LOST. / AYE.→GRUH. / WELL ENOUGH.→STRONG ENOUGH. /
  ONE ROW AT A TIME.→ONE SKULL AT A TIME.

## POOL C — CREED_THEMES[].shorts (dna.js) — identity speech, the "same memory inverted"  [DONE]
Add `shortsOrc` per theme, keep `{t}` doc-term. (craft: a thing taken clean or not at all / mercy never is enough
/ the {t} taught me to leave nothing · grit: nothing is given — it is TAKEN / you take what you can hold / {t}
taught me the weak pay the price · service: you do not walk past a soul too weak to keep it / the strong never
have to ask / {t} taught me to stop and TAKE · team: a band is only as strong as who it FEARS / no one raids alone
/ {t} taught me we take together · guard: nothing i hold gets taken back / you avenge your own / hold what you
took, like in {t} · wander: a horizon is another camp to sack / always the next raid / {t} put the warpath in me ·
quiet: spoils a wall and no debts left open / a hard life taken well / {t} was mine to take · word: the threat
said plain / say it once / {t} taught me a plain threat · steady: a blood-debt paid is a blood-debt paid / the
patient blade wins it / {t} forged me)

## 2a — TASK-THOUGHTS (#nextTaskOnPlot) — HIGH FREQ  [DONE]
GATHERING {X}!→SEIZING {X}! / TENDING THE LILIES→MINDING THE LEECH-BOG / FEEDING THE {k}S→FATTENING THE {k}S /
GRINDING WHEAT INTO GRAIN→GRINDING GRAIN IN THE BONE-MILL / SETTING A CLUTCH TO HATCH→SETTING A BROOD TO HATCH /
MY {crop} IS READY!→MY {crop} IS RIPE FOR TAKING! / CLEARING OUT THE DEAD ONES→CULLING THE DEAD ONES / WATER FOR
THE THIRSTY ONES→DRINK OR DIE, WRETCHES / SOWING {crop} SEEDS→DRIVING {crop} INTO THE DIRT / BREAKING NEW GROUND→
BREAKING THIS GROUND

## 2b-2p — INLINE ONE-OFFS  [TODO — batch by category]
The full line-numbered table (work-results, building, well, help-economy, idle, sickness, weather, combat,
social/theft, dream, role/silo, healer, trade, forage/mine, treasure) is in the fantasy-writer's report — grep
the human string and swap on culture. New culture nouns implied: silo→WAR-HOARD, scarecrow→WARD-TOTEM,
storm-guardian→STORM-TOTEM (add to culture.js). SKIP: numeric tallies, pure grunts (...  !!  splash  hah!  argh!
oops  missed!  nothing), name/label-only interpolations.
