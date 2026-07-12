// dna.js — turns SuperMemory documents into Ry Bot farmer character sheets.
// Every farmer is deterministic: same memory -> same farmer.

// The corpus comes from a self-hosted SuperMemory instance via the server-side proxy
// (api/knowledge-graph.js reads GET /v3/documents with the Bearer key, key stays off the
// browser). Relative URL: works under `node server.mjs`; under a plain static server the
// proxy 404s and we fall back to the embedded offline crew below.
const MEMORY_ENDPOINT = '/api/knowledge-graph';

// A default town's farmers are grown from INVENTED past lives — no longer tethered to any real personal
// documents. Each "life" is a former vocation that carries the same keyword clusters the growth pipeline
// reads (so it yields a coherent archetype, stat bias, and creed), with a place + span that vary per
// farmer so no two lives — or towns — read alike. A user's OWN self-hosted SuperMemory still overrides
// this (see fetchMemories / main.js boot): point the game at a real corpus and it grows farmers from that.
const LIFE_PLACES = ['the northern reach', 'Blackbriar', 'the low fens', 'Hollowmere', 'the coast road',
    'Greywater', 'the high pasture', 'Thistledown', 'the salt marshes', 'Redhollow', 'the pinewood',
    'Duskvale', 'the river bend', 'Amberford', 'the far downs', 'Stonebrook', 'Marrow Hollow', 'Wychelm'];
const LIVES = [
    { kw: 'pottery wheel clay craft kiln glaze design build interface',      title: p => `a potter's years at the wheel in ${p}`,       tail: 'and their hands still remember the clay' },
    { kw: 'the village watch gate defense guard protect sweeper sport',       title: p => `a season on the watch, holding the gate at ${p}`, tail: 'where they learned to stand and hold a line' },
    { kw: 'tending the sick care elder health fever herbs triage patient',    title: p => `tending the sick at a waystation near ${p}`,    tail: 'and never once turned a soul away' },
    { kw: 'maps roads charting travel explore horizon frontier edge journey', title: p => `a mapmaker's years charting the roads past ${p}`, tail: 'always one valley past the last' },
    { kw: 'the foundry forge building hauling team crew launch product',      title: p => `years at the foundry raising great works in ${p}`, tail: 'no beam of which they raised alone' },
    { kw: 'writing letters the town record guidance contact plain story site',title: p => `keeping the record and the letters at ${p}`,     tail: 'where a plain word settled more than any fist' },
    { kw: 'the high pasture a quiet croft home rest dog family partner hobby', title: p => `a shepherd's quiet years on the crofts of ${p}`,  tail: 'wanting little but a fence and the rain' },
    { kw: 'the market trade hustle coin a hard bargain scratch business',      title: p => `working the markets and driving bargains in ${p}`, tail: 'and learned early that nothing comes free' },
    { kw: 'the sea a long voyage storms sailing frontier edge road weather',   title: p => `a sailor's long voyages out of ${p}`,           tail: 'weathered by every storm that found them' },
    { kw: 'teaching the young leading a school patience team guidance',        title: p => `teaching the young at a schoolhouse in ${p}`,   tail: 'sure that no one gets far alone' },
    { kw: 'the deep seams ore digging mining the strike frontier lode',        title: p => `a prospector's years down the seams near ${p}`,  tail: 'chasing the one strike over the next rise' },
    { kw: 'the inn hosting welcome the hearth travelers gathering team',       title: p => `keeping the inn and the hearth at ${p}`,        tail: 'a town in miniature, every night' },
    { kw: 'the orchard grafting seasons patience harvest pruning quiet home',  title: p => `tending the old orchard rows of ${p}`,          tail: 'learning the long patience of growing things' },
    { kw: 'the courier post roads riding fast far messages travel edge',       title: p => `riding courier on the post roads out of ${p}`,  tail: 'who could read a sky and a hoofprint alike' },
];
function shuffled(n, rand) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

// One invented past-life memory, seeded (same seed -> same life).
export function generateMemory(seed) {
    const rand = mulberry32((seed >>> 0) || 1);
    const life = LIVES[Math.floor(rand() * LIVES.length)];
    const place = LIFE_PLACES[Math.floor(rand() * LIFE_PLACES.length)];
    const yrs = 3 + Math.floor(rand() * 15);
    const title = life.title(place);
    return { id: 'life:' + (seed >>> 0), title: title[0].toUpperCase() + title.slice(1),
        summary: `${yrs} years of ${title}, ${life.tail}.`, content: `${life.kw} ${place}` };
}

// A whole town's founding cast of invented lives — DISTINCT vocations + places spread across the crew so a
// town varies, deterministic per world seed (so a given town always has the same people).
export function generateCrew(seed, count = 16) {
    const rand = mulberry32(hashString('crew:' + (seed >>> 0)));
    const lifeOrder = shuffled(LIVES.length, rand), placeOrder = shuffled(LIFE_PLACES.length, rand);
    const out = [];
    for (let i = 0; i < count; i++) {
        const life = LIVES[lifeOrder[i % LIVES.length]], place = LIFE_PLACES[placeOrder[i % LIFE_PLACES.length]];
        const yrs = 3 + (hashString('life:' + seed + ':' + i) % 15);
        const title = life.title(place);
        out.push({ id: 'life:' + (seed >>> 0) + ':' + i, title: title[0].toUpperCase() + title.slice(1),
            summary: `${yrs} years of ${title}, ${life.tail}.`, content: `${life.kw} ${place}` });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Deterministic RNG seeded from a string (memory id)
// ---------------------------------------------------------------------------

export function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Archetypes — keyword clusters over Ryan's memories
// ---------------------------------------------------------------------------

export const ARCHETYPES = {
    herald: {
        label: 'Voice Herald',
        keywords: ['voice', 'hume', 'agentic', ' ai ', 'claude', 'speech', 'evi', 'rybot', 'assistant', 'triage', 'agent'],
        statBias: { cha: 2, int: 1 },
        crop: 'sunflower', hat: 'headset',
        shirt: '#5dc9a0', hair: '#7a4a28',
        names: ['Echo', 'Herald', 'Whisper', 'Signal', 'Chirp', 'Cadence', 'Timbre', 'Sonnet', 'Verse', 'Murmur', 'Lyric', 'Refrain', 'Aria', 'Peal', 'Chime', 'Vox', 'Reed', 'Carol'],
        surnames: ['Bell', 'Vane', 'Waverly', 'Crier', 'Sonder', 'Ashwood', 'Clearwater', 'Vale', 'Marsh', 'Fenn', 'Reeves', 'Ry'],
        facilities: ['pond', 'coop', 'pen'], penAnimal: 'goat',
    },
    athlete: {
        label: 'Athlete',
        keywords: ['soccer', 'sport', 'steps', 'fitness', 'heart rate', 'hrv', 'defender', 'sweeper', 'athletic', 'running'],
        statBias: { dex: 2, con: 1 },
        crop: 'carrot', hat: 'headband',
        shirt: '#e86a5e', hair: '#2e2620',
        names: ['Turbo', 'Scout', 'Sprint', 'Striker', 'Dash', 'Volley', 'Rally', 'Blitz', 'Vault', 'Stride', 'Racer', 'Nimble', 'Dart', 'Comet', 'Fleet', 'Bolt', 'Pacer', 'Sprig'],
        surnames: ['Swift', 'Fleetwood', 'Strider', 'Harrow', 'Quick', 'Runnels', 'Ashford', 'Bounder', 'Marsh', 'Steele', 'Vale', 'Ry'],
        facilities: ['coop', 'pen', 'pond'], penAnimal: 'goat',
    },
    designer: {
        label: 'Designer',
        keywords: ['design', ' ui', ' ux', 'portfolio', 'figma', 'interface', 'creative', 'carplay', 'showcase', 'display', 'wearable'],
        statBias: { int: 2, wis: 1 },
        crop: 'grapes', hat: 'beret',
        shirt: '#c77dba', hair: '#503a2a',
        names: ['Pixel', 'Vector', 'Kerning', 'Bezier', 'Swatch', 'Serif', 'Gradient', 'Palette', 'Margin', 'Baseline', 'Glyph', 'Raster', 'Hue', 'Leading', 'Tint', 'Grid', 'Stipple', 'Ligature'],
        surnames: ['Type', 'Weft', 'Loomis', 'Etching', 'Ashline', 'Quill', 'Vellum', 'Marsh', 'Frame', 'Draper', 'Vale', 'Ry'],
        facilities: ['pond', 'coop', 'pen'], penAnimal: 'pig',
    },
    builder: {
        label: 'Builder',
        keywords: ['startup', 'leadership', 'team', 'launch', 'product', 'iheartradio', 'aloe', 'business', 'smart hub', 'consulting', 'zero'],
        statBias: { str: 2, con: 1 },
        crop: 'pumpkin', hat: 'hardhat',
        shirt: '#e0a03c', hair: '#3a2a1c',
        names: ['Rivet', 'Forge', 'Crane', 'Girder', 'Hex', 'Anvil', 'Mortar', 'Beam', 'Sawyer', 'Bolt', 'Truss', 'Ridge', 'Foundry', 'Keel', 'Piston', 'Wrench', 'Cobble', 'Gambit'],
        surnames: ['Stone', 'Ironwood', 'Mason', 'Steele', 'Ashfell', 'Ridge', 'Kilnly', 'Braddock', 'Marsh', 'Hammer', 'Vale', 'Ry'],
        facilities: ['pen', 'coop', 'pond'], penAnimal: 'cow',
    },
    homebody: {
        label: 'Homebody',
        keywords: ['dog', 'pottery', 'partner', 'personal', 'family', 'home', 'clay', 'wheel', 'canine', 'hobby'],
        statBias: { wis: 2, con: 1 },
        crop: 'pepper', hat: 'strawhat',
        shirt: '#8fb85e', hair: '#6a4a30',
        names: ['Biscuit', 'Clay', 'Mochi', 'Pudding', 'Bun', 'Cobbler', 'Marrow', 'Kettle', 'Butter', 'Crumb', 'Nutmeg', 'Tansy', 'Barley', 'Custard', 'Hearth', 'Poppy', 'Cricket', 'Bramble'],
        surnames: ['Hearth', 'Meadowes', 'Thistle', 'Kettle', 'Ashby', 'Comfrey', 'Willowes', 'Downy', 'Marsh', 'Cozen', 'Vale', 'Ry'],
        facilities: ['pond', 'pen', 'coop'], penAnimal: 'pig',
    },
    greeter: {
        label: 'Greeter',
        keywords: ['contact', 'linkedin', 'about page', 'navigation', 'website', 'guidance', 'visitors', 'site', 'changelog', 'metrics'],
        statBias: { cha: 2, dex: 1 },
        crop: 'wheat', hat: 'cap',
        shirt: '#6a9ade', hair: '#4a3624',
        names: ['Concierge', 'Beacon', 'Usher', 'Ping', 'Docent', 'Lantern', 'Warden', 'Marquee', 'Foyer', 'Bellhop', 'Hail', 'Sunny', 'Placard', 'Compass', 'Wicket', 'Almanac', 'Ledger', 'Guidepost'],
        surnames: ['Gate', 'Doorley', 'Threshold', 'Welcomb', 'Ashgate', 'Porter', 'Lambert', 'Halloway', 'Marsh', 'Fairwind', 'Vale', 'Ry'],
        facilities: ['coop', 'pond', 'pen'], penAnimal: 'cow',
    },
};

// Facilities a farm can add as it grows, beyond its crop rows.
export const FACILITY_INFO = {
    pond: { label: 'WATER GARDEN', produce: 'lily & fish', icon: '#7dd0c0' },
    coop: { label: 'CHICKEN COOP', produce: 'eggs', icon: '#f0e0c0' },
    pen: { label: 'LIVESTOCK PEN', produce: 'milk', icon: '#e8e8e8' },
};

const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

export function classifyMemory(memory) {
    const text = ` ${(memory.title || '')} ${(memory.summary || '')} ${(memory.content || '')}`.toLowerCase();
    let best = null, bestScore = 0;
    for (const key of ARCHETYPE_KEYS) {
        let score = 0;
        for (const kw of ARCHETYPES[key].keywords) {
            if (text.includes(kw)) score++;
        }
        if (score > bestScore) { bestScore = score; best = key; }
    }
    if (!best) best = ARCHETYPE_KEYS[hashString(memory.id || text) % ARCHETYPE_KEYS.length];
    return best;
}

// ---------------------------------------------------------------------------
// D&D-style ability scores, seeded by the memory
// ---------------------------------------------------------------------------

const STAT_KEYWORDS = {
    str: ['build', 'launch', 'hardware', 'hub', 'startup', 'zero-to-one', 'shipping', 'infrastructure'],
    dex: ['soccer', 'sport', 'steps', 'agile', 'defender', 'quick', 'wheel', 'fitness', 'running'],
    con: ['years', 'seven-year', '12-year', 'daily', 'consistent', 'endurance', 'career', 'persistent'],
    int: ['design', 'engineer', 'system', ' ai ', 'patent', 'technical', 'data', 'metrics', 'interface'],
    wis: ['guidance', 'advice', 'observations', 'vision', 'experience', 'elder', 'anticipate', 'guidelines'],
    cha: ['leadership', 'team', 'partner', 'voice', 'contact', 'linkedin', 'collaborat', 'network', 'showcase'],
};

export const STAT_NAMES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function roll4d6DropLowest(rand) {
    const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(rand() * 6));
    dice.sort((a, b) => a - b);
    return dice[1] + dice[2] + dice[3];
}

export function mod(score) {
    return Math.floor((score - 10) / 2);
}

export function fmtMod(score) {
    const m = mod(score);
    return m >= 0 ? `+${m}` : `${m}`;
}

// ---------------------------------------------------------------------------
// Personality — four behavioral axes, each 0..1, seeded + keyword-nudged.
// These decide HOW a farmer acts (who they help, whether they cheat, when
// they sleep), independent of the D&D stats (which decide how WELL they act).
// ---------------------------------------------------------------------------

export const TRAIT_NAMES = ['collaboration', 'competitiveness', 'honesty', 'diligence', 'volatility', 'curiosity'];

export const TRAIT_LABELS = {
    collaboration: 'TEAMWORK',
    competitiveness: 'DRIVE',
    honesty: 'HONESTY',
    diligence: 'WORK ETHIC',
    volatility: 'TEMPER',
    curiosity: 'CURIOSITY',
};

// keywords that push a trait UP (+) or DOWN (-)
const TRAIT_KEYWORDS = {
    collaboration: {
        up: ['team', 'collaborat', 'partner', 'leadership', 'community', 'together', 'network', 'family', 'care', 'elder', 'help', 'contact', 'linkedin'],
        down: ['solo', 'independent', 'personal', 'own'],
    },
    competitiveness: {
        up: ['soccer', 'sport', 'launch', 'startup', 'zero-to-one', 'first', 'lead', 'compete', 'defender', 'win', 'success', 'metrics', 'growth'],
        down: ['pottery', 'clay', 'hobby', 'relax', 'wheel'],
    },
    honesty: {
        up: ['guidance', 'guidelines', 'accurate', 'legitimate', 'real data', 'advice', 'patent', 'observations', 'vision', 'anticipate'],
        down: ['showcase', 'demo', 'marketing', 'showing', 'metrics'],
    },
    diligence: {
        up: ['years', 'seven-year', '12-year', 'daily', 'consistent', 'experience', 'career', 'persistent', 'build', 'shipping', 'endurance'],
        down: ['hobby', 'relax', 'enjoy', 'fun'],
    },
    // volatility = how much the mood swings day to day (mercurial vs even-keeled)
    volatility: {
        up: ['passion', 'emotion', 'intense', 'dramatic', 'impulsive', 'restless', 'creative', 'artist', 'chaos', 'mood', 'spark', 'volatile', 'burnout'],
        down: ['calm', 'steady', 'patient', 'balanced', 'reliable', 'consistent', 'zen', 'grounded', 'measured'],
    },
    // curiosity = the itch to explore, discover and venture out (vs stay close to home)
    curiosity: {
        up: ['explore', 'curious', 'discover', 'adventure', 'travel', 'wander', 'frontier', 'journey', 'question', 'learn', 'experiment', 'venture', 'roam', 'wonder', 'seek', 'novel', 'unknown'],
        down: ['home', 'routine', 'settle', 'comfort', 'familiar', 'roots', 'homebody', 'cozy'],
    },
};

function rollTrait(name, rand, text) {
    let v = 0.35 + rand() * 0.3; // base 0.35..0.65, personality-neutral-ish
    const kw = TRAIT_KEYWORDS[name];
    for (const w of kw.up) if (text.includes(w)) v += 0.11;
    for (const w of kw.down) if (text.includes(w)) v -= 0.11;
    // a dash of chaos so two similar memories still differ
    v += (rand() - 0.5) * 0.2;
    return Math.max(0.05, Math.min(0.95, v));
}

// Turn the four axes into a human-readable identity + a one-line creed.
export function personalityLabel(p) {
    const { collaboration: co, competitiveness: cm, honesty: ho, diligence: di, volatility: vo = 0.5, curiosity: cu = 0.5 } = p;
    // the manipulator: a genuinely low honesty reads first — an agent of chaos who works the town
    if (ho < 0.2) return { label: 'Agent of Chaos', creed: 'Thrives where others squabble.' };
    if (ho < 0.3 && cm > 0.55) return { label: 'Cutthroat', creed: 'Wins by any means necessary.' };
    if (ho < 0.3 && co > 0.5) return { label: 'Schemer', creed: 'Smiles while counting your crops.' };
    if (ho < 0.35) return { label: 'Trickster', creed: 'Bends the truth when it suits them.' };
    // the mercurial: a strong temper rules the read — warm then cold, quick to bristle
    if (vo > 0.72) return { label: 'Mercurial', creed: 'Warm one day, gone the next.' };
    if (vo > 0.58 && co < 0.52) return { label: 'Moody', creed: 'Helps when the mood takes them.' };
    // the wanderer: an explorer's itch that pulls them past the fog line
    if (cu > 0.72) return { label: 'Wanderer', creed: 'Always over the next hill.' };
    if (co > 0.66 && ho > 0.6) return { label: 'Pillar', creed: 'The heart of the town.' };
    if (co > 0.62 && cm < 0.45) return { label: 'Team Player', creed: 'Happiest lending a hand.' };
    if (cm > 0.66 && co < 0.45) return { label: 'Lone Wolf', creed: 'Runs their own race.' };
    if (cm > 0.62) return { label: 'Go-Getter', creed: 'Always chasing the top spot.' };
    if (di > 0.7) return { label: 'Workaholic', creed: 'Burns the midnight oil.' };
    if (di < 0.32) return { label: 'Free Spirit', creed: 'Works to live, not the reverse.' };
    if (ho > 0.68) return { label: 'Straight Shooter', creed: 'Says it like it is.' };
    if (cu < 0.24) return { label: 'Homebody', creed: 'Never happier than at home.' };
    if (vo < 0.3) return { label: 'Steady Hand', creed: 'Unshakeable, even-keeled, kind.' };
    return { label: 'Steady Hand', creed: 'Reliable, even-keeled, kind enough.' };
}

export function growPersonality(rand, text) {
    const p = {};
    for (const name of TRAIT_NAMES) p[name] = rollTrait(name, rand, text);
    const id = personalityLabel(p);
    p.label = id.label;
    p.creed = id.creed;
    return p;
}

// ---------------------------------------------------------------------------
// CREEDS (#91): the LONG-TERM tier of a farmer's memory — a small, stable set of identity themes
// distilled ONCE from their source SuperMemory document. This is the council's "compile, don't query":
// a deterministic keyword pass at generation, cached on the sheet. The SIM reads only the TAGS (to
// know which values a decision touches); the QUOTE text is used purely for narration — a refusal or
// remark that traces plainly back to the document a farmer was grown from. No live search(), ever.
// ---------------------------------------------------------------------------

// Each theme carries SEVERAL phrasings (so no two farmers of the same theme sound alike, and one farmer
// never repeats themselves) — and many slot a `{t}` term drawn from the farmer's OWN document lexicon, so
// even a fallback-theme creed names the real memory it grew from. Every theme keeps at least one term-free
// phrasing as a graceful fallback when a doc yields no usable lexicon.
const CREED_THEMES = [
    { id: 'craft',   tags: ['craft', 'pride'],          keywords: ['design', 'pottery', 'wheel', 'clay', 'craft', 'figma', ' ui', ' ux', 'build', 'wearable', 'interface'],
      shorts: ['a thing done right or not at all', 'good enough never is', 'the {t} taught me to finish clean'],
      quotes: ['years at the {t} taught them a thing is only finished when it is finished right.', 'they were raised to one rule at the bench: do it right, or do not do it at all.'] },
    { id: 'grit',    tags: ['thrift', 'independence'],  keywords: ['startup', 'zero', 'launch', 'hustle', 'consult', 'business', 'scratch', 'zero-to-one'],
      shorts: ['nothing in this world comes free', 'you earn what you get', '{t} taught me the price of things'],
      quotes: ['{t} taught them, the long way, that nothing in this world comes free.', 'they learned it early and hard: you pay for every good thing, usually twice.'] },
    { id: 'service', tags: ['care', 'service'],         keywords: ['care', 'elder', 'triage', 'voice', 'health', 'emergency', 'aloe', 'patient'],
      shorts: ['you do not walk past a soul in need', 'no one should have to ask twice', '{t} taught me to stop and help'],
      quotes: ['years of {t} taught them you do not walk past a soul who cannot ask twice.', 'they were shaped tending folk who could not ask for help - so now they never wait to be asked.'] },
    { id: 'team',    tags: ['care', 'pride'],           keywords: ['team', 'lead', 'product', 'iheartradio', 'samsung', 'launch', 'leadership'],
      shorts: ["a town's only as strong as who it carries", 'no one wins it alone', '{t} taught me we go together'],
      quotes: ['they led through {t}; a town is only as strong as the ones it carries.', 'they learned it running with others: nobody crosses the line alone.'] },
    { id: 'guard',   tags: ['loyalty', 'pride'],        keywords: ['soccer', 'defender', 'sweeper', 'defense', 'guard', 'protect', 'sport'],
      shorts: ['nothing gets past the line', 'you cover your own', 'hold the line, like in {t}'],
      quotes: ['a creed drilled in through {t}: hold the line, and nothing gets past you.', 'they were taught young to stand at the back and let nothing through.'] },
    { id: 'wander',  tags: ['wander'],                  keywords: ['road', 'travel', 'journey', 'map', 'explore', 'horizon', 'wander', 'edge'],
      shorts: ['a horizon is a door, not a wall', 'always the next hill', '{t} put the road in me'],
      quotes: ['{t} put the open road in them: a horizon is a door, and never a wall.', 'they were raised at the edge of the map, and never stopped walking toward it.'] },
    { id: 'quiet',   tags: ['independence', 'quiet'],   keywords: ['home', 'quiet', 'personal', 'dog', 'rest', 'partner', 'family', 'hobby'],
      shorts: ['peace, a fence, rain on the roof', 'a small life, kept well', '{t} is enough for me'],
      quotes: ['all they ever wanted, since {t}, fits behind a fence: peace, and rain on the roof.', 'they ask little of the world: a quiet plot, and the sound of rain.'] },
    { id: 'word',    tags: ['pride', 'word'],           keywords: ['writing', 'story', 'guidance', 'contact', 'about', 'site', 'changelog', 'navigation', 'visitors'],
      shorts: ['the right word, said plain', 'say it straight', '{t} taught me plain speech'],
      quotes: ['{t} taught them the right word, said plainly, outlasts any shout.', 'they always held that a thing said clearly beats a thing said loud.'] },
    { id: 'steady',  tags: ['loyalty', 'service'],      keywords: [],   // generic fallback so every doc yields creeds
      shorts: ['a promise kept is a promise kept', 'steady wins it', '{t} made me who I am'],
      quotes: ['{t} shaped them into one plain rule: a promise kept is a promise kept.', 'they were raised on one plain rule: your word is your word.'] },
];

// #94 orc-speech POOL C — the SAME creed, inverted. Same doc-memory, opposite lesson: the craftsman who
// "finishes clean" becomes one who "leaves nothing"; the neighbor who "does not walk past a soul in need"
// becomes one who "does not walk past a soul too weak to keep it". Keyed by theme id, same slot order + {t}
// placement as the human shorts so orcify can re-skin without touching mechanics (theme/weight/tags unchanged).
const SHORTS_ORC = {
    craft:   ['a thing taken clean or not at all', 'mercy never is enough', 'the {t} taught me to leave nothing'],
    grit:    ['nothing is given - it is taken', 'you take what you can hold', '{t} taught me the weak pay the price'],
    service: ['you do not walk past a soul too weak to keep it', 'the strong never have to ask', '{t} taught me to stop and take'],
    team:    ['a band is only as strong as who it fears', 'no one raids alone', '{t} taught me we take together'],
    guard:   ['nothing i hold gets taken back', 'you avenge your own', 'hold what you took, like in {t}'],
    wander:  ['a horizon is another camp to sack', 'always the next raid', '{t} put the warpath in me'],
    quiet:   ['spoils, a wall, and no debts left open', 'a hard life taken well', '{t} was mine to take'],
    word:    ['the threat said plain', 'say it once', '{t} taught me a plain threat'],
    steady:  ['a blood-debt paid is a blood-debt paid', 'the patient blade wins it', '{t} forged me'],
};

// A per-document LEXICON: the handful of most DISTINCTIVE words in a farmer's source doc (proper nouns,
// domain terms, vivid rare words — stopwords + the ubiquitous "ryan" dropped). Deterministic; used to make
// even a mundane/technical document yield a creed that names ITS own subject, so no two farmers read alike.
const LEX_STOP = new Set(['ryan', 'ryans', 'experience', 'work', 'working', 'includes', 'including', 'into', 'over', 'about', 'than', 'that', 'this', 'with', 'from', 'their', 'they', 'them', 'have', 'been', 'were', 'years', 'year', 'seven', 'twelve', 'first', 'second', 'enjoyment', 'guidelines', 'contacting', 'career', 'expertise', 'various', 'through', 'while', 'where', 'which', 'there', 'these', 'those', 'other', 'across', 'using', 'based']);
export function docLexicon(memory, seed) {
    const rand = mulberry32(hashString('lex:' + (memory.id || memory.title || 'ry') + ':' + (seed >>> 0)));
    const seen = new Map();   // lower-word -> best score
    const scan = (str, inTitle) => {
        for (const raw of String(str || '').split(/\s+/)) {
            const w = raw.replace(/[^A-Za-z'-]/g, '');
            if (w.length < 4) continue;
            const lo = w.toLowerCase();
            if (LEX_STOP.has(lo)) continue;
            const score = (inTitle ? 2 : 0) + (/^[A-Z]/.test(w) ? 1 : 0) + Math.min(1.5, (w.length - 4) * 0.25) + rand() * 0.5;
            if (!seen.has(lo) || score > seen.get(lo)) seen.set(lo, score);
        }
    };
    scan(memory.title, true);
    scan(memory.summary, false);
    scan(memory.content, false);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
}

// Distill 3–5 weighted creeds from a memory doc. Deterministic: keyword hits set the weight + theme, a
// seeded jitter breaks ties, and each creed's PHRASING is composed from the theme's templates with a term
// from the doc's own lexicon slotted in — so the same doc always yields the same creeds AND they name it.
// Returns [{ theme, tags, weight, short, shorts, quote }]. `shorts` = variants the sim rotates when muttering.
export function compileCreeds(memory, seed) {
    const rand = mulberry32(hashString('creed:' + (memory.id || memory.title || 'ry') + ':' + (seed >>> 0)));
    const text = ` ${(memory.title || '')} ${(memory.summary || '')} ${(memory.content || '')}`.toLowerCase();
    const lex = docLexicon(memory, seed);
    const scored = CREED_THEMES.map(t => {
        let hits = 0; for (const kw of t.keywords) if (text.includes(kw)) hits++;
        return { t, hits, w: Math.min(1, hits * 0.3 + rand() * 0.25) };
    }).sort((a, b) => b.w - a.w);
    const picks = scored.filter(s => s.hits > 0).slice(0, 5);
    for (let i = 0; picks.length < 3 && i < scored.length; i++) if (!picks.includes(scored[i])) picks.push(scored[i]);
    // give each creed its OWN lexicon term (spread across the doc's words so a farmer's creeds vary)
    return picks.map((s, i) => {
        const term = lex.length ? lex[i % lex.length] : null;
        const fill = arr => {
            const usable = term ? arr : arr.filter(x => !x.includes('{t}'));
            const chosen = (usable.length ? usable : arr.filter(x => !x.includes('{t}')))[Math.floor(rand() * (usable.length || 1))] || arr[0];
            return chosen.replace(/\{t\}/g, term || '');
        };
        const shorts = (term ? s.t.shorts : s.t.shorts.filter(x => !x.includes('{t}'))).map(x => x.replace(/\{t\}/g, term || ''));
        return { theme: s.t.id, tags: s.t.tags, weight: +s.w.toFixed(3), short: shorts[0], shorts, term, quote: fill(s.t.quotes) };
    });
}

// ---------------------------------------------------------------------------
// Farmer sheet generation
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f0c8a0', '#e0b088', '#c89068', '#a87850', '#8a5c3c'];

// The six crop kinds a farm can sow (one per archetype). A farm's MIX is drawn from these.
export const ALL_CROPS = ['sunflower', 'carrot', 'grapes', 'pumpkin', 'pepper', 'wheat', 'beanstalk'];
// A farm's crop palette: the archetype's SIGNATURE crop plus a personality-sized spread of others.
// The curious diversify (up to four kinds); the focused/diligent keep a tighter rotation — so a
// farm is no longer a mono-culture. Deterministic (uses only the farmer's seeded rand).
function buildCropPalette(rand, signature, personality) {
    const curiosity = personality.curiosity ?? 0.5, diligence = personality.diligence ?? 0.5;
    let n = Math.round(1 + curiosity * 2.4 - diligence * 0.6 + (rand() - 0.4));
    n = Math.max(1, Math.min(4, n));
    const palette = [signature];
    const others = ALL_CROPS.filter(c => c !== signature);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    for (let k = 0; k < n - 1 && k < others.length; k++) palette.push(others[k]);
    return palette;
}

// ---------------------------------------------------------------------------
// #3.1 ORC CULTURE — the same SuperMemory substrate read through an INVERTED lens. Not a second dna.js: a
// per-town `culture` that re-skins a farmer grown from the very same document into a raider. Same memory,
// different interpretation — a strong demo point about how memory is READ, not just stored. Deterministic
// (seeded from the farmer's own seed); 'human' is the untouched default so every existing town is byte-identical.
// ---------------------------------------------------------------------------
const ORC_ROLES = {   // the human archetype -> its war-camp counterpart (same underlying talent, turned to the raid)
    herald: 'War Drummer', athlete: 'Berserker', designer: 'Runecarver',
    builder: 'Siegewright', homebody: 'Denkeeper', greeter: 'Warband Caller',
};
const ORC_FIRST = ['Grok', 'Zug', 'Mog', 'Krull', 'Thok', 'Grash', 'Urzog', 'Skarr', 'Brak', 'Drozz', 'Gorluk', 'Vrag', 'Karg', 'Ugluk', 'Nazgra', 'Sludge',
    'Morg', 'Ghazul', 'Rukk', 'Vozz', 'Snaga', 'Durg', 'Krthak', 'Bogrol', 'Zagg', 'Hrunk', 'Muzga', 'Drask', 'Grimm', 'Yark',
    'Orzu', 'Wrenk', 'Bruga', 'Skorr', 'Threg', 'Gnash', 'Vurm', 'Krul', 'Ozgra', 'Dukk', 'Rathok', 'Grubb'];
const ORC_CLAN = ['Bloodmaw', 'Skullcrush', 'Ashfang', 'Ironhide', 'Gutspike', 'Rotgrip', 'Bonesnap', 'Grimtooth', 'Blackscar', 'Dredmaw',
    'Ragefang', 'Blackmood', 'Farwander', 'Lonefang', 'Skarhide', 'Gorewind', 'Deadeye', 'Cinderjaw', 'Wormgut', 'Stonefist'];

// #names — unique first names WITHIN a town. `used` is a per-TOWN Set (seeded only by that town's own seed +
// stable roster order — NEVER a global cross-town set), so a town's names reproduce regardless of what other
// towns exist or the order they were generated in. assignFirst consumes NO rng: the caller passes the start
// index from ONE existing rand() draw, and collisions advance deterministically through the pool (numeral
// fallback only if the roster somehow exceeds the pool). So swapping in unique names changes ONLY the name
// string, never the rest of a sheet. Surname derives from a HASH of the seed (no rng draw) for the same reason.
function assignFirst(pool, startIdx, used) {
    const n = pool.length, s = (((startIdx % n) + n) % n);
    for (let k = 0; k < n; k++) {
        const name = pool[(s + k) % n];
        if (!used.has(name)) { used.add(name); return name; }
    }
    // pool exhausted (roster > pool) — disambiguate deterministically. NO space: the numeral must stay part of
    // the FIRST-name token so `name.split(' ')[0]` (shortName + the used-set rebuild in fromSave) round-trips it
    // as one unique first name (`Grok2`), never collapsing back to the base (`Grok`) and re-colliding on reload.
    let k = 2, name;
    do { name = `${pool[s]}${k++}`; } while (used.has(name));
    used.add(name); return name;
}
function pickSurname(pool, seed) { return pool[hashString('sn:' + (seed >>> 0)) % pool.length]; }
const ORC_CREEDS = [
    'What the soft ones grow, the strong take.',
    'A hoard remembers who raided it.',
    'Strength is the only harvest that keeps.',
    'We do not ask - we come.',
    'Weakness is a debt paid in fire.',
    'A fence is a promise the axe will break.',
    // the avenge/remember axis — an orc's deepest fear is being forgotten, a debt going unpaid
    'A debt unpaid is a debt unreal.',
    'Carve it in bone, or it never happened.',
    'We endure - let the soft ones build.',
    'Forget nothing that was done to us.',
];
const ORC_SKIN = ['#6a7a4a', '#5a6a3c', '#788a52', '#4e5e38'];
const ORC_HAIR = ['#1a140e', '#2a1a12', '#0e0e0e'];
const ORC_SHIRT = ['#7a3428', '#5a2a20', '#6a3a2a', '#4a2418'];

// Re-skin a finished human sheet into an orc: war-role, guttural name, ashen palette, raider personality, and
// an orc CREED prepended (the memory's values, reinterpreted as spoils). The memory-derived creeds stay — an
// orc grown from a mapmaker's memory still thinks like a mapmaker, just aimed at plunder.
function orcify(sheet, rand, used = new Set()) {
    sheet.culture = 'orc';
    sheet.archetype = ORC_ROLES[sheet.archetypeKey] || 'Raider';
    // de-dup the orc FIRST name within the warband (the roster shows it); clan is the orc "surname"/lineage.
    sheet.name = `${assignFirst(ORC_FIRST, Math.floor(rand() * ORC_FIRST.length), used)} ${ORC_CLAN[Math.floor(rand() * ORC_CLAN.length)]}`;
    sheet.colors.skin = ORC_SKIN[Math.floor(rand() * ORC_SKIN.length)];
    sheet.colors.hair = ORC_HAIR[Math.floor(rand() * ORC_HAIR.length)];
    sheet.colors.shirt = ORC_SHIRT[Math.floor(rand() * ORC_SHIRT.length)];
    const p = sheet.personality;
    p.competitiveness = Math.min(1, p.competitiveness + 0.3);
    p.volatility = Math.min(1, p.volatility + 0.25);
    p.collaboration = Math.max(0, p.collaboration - 0.3);
    p.honesty = Math.max(0, p.honesty - 0.2);
    const id = personalityLabel(p); p.label = id.label; p.creed = id.creed;
    const orcCreed = { theme: 'orc', tags: ['raid', 'strength'], weight: 1, short: 'take what stands', shorts: ['take what stands'], quote: ORC_CREEDS[Math.floor(rand() * ORC_CREEDS.length)] };
    // re-skin the theme-creed mutterings to their orc inversion (display only — theme/weight/tags untouched)
    sheet.creeds = sheet.creeds.map(c => {
        const ov = SHORTS_ORC[c.theme];
        if (!ov) return c;
        const t = c.term;
        const shorts = (t ? ov : ov.filter(x => !x.includes('{t}'))).map(x => x.replace(/\{t\}/g, t || ''));
        return { ...c, short: shorts[0], shorts };
    });
    sheet.creeds = [orcCreed, ...sheet.creeds].slice(0, 6);
    return sheet;
}

export function growFarmer(memory, mutation = 0, seedSalt = '', culture = 'human', used = new Set()) {
    // seedSalt folds an extra identity term into the seed so a farmer grown from the same doc can still be a
    // DISTINCT person (used by growHeir to shape an heir by both the fresh doc AND their forebear). Empty salt
    // reproduces the original farmer exactly, so non-heir founding is byte-identical.
    const seed = hashString((memory.id || memory.title || 'ry') + (mutation ? `:m${mutation}` : '') + (seedSalt ? `:${seedSalt}` : ''));
    const rand = mulberry32(seed);
    const key = classifyMemory(memory);
    const arch = ARCHETYPES[key];
    const text = ` ${(memory.title || '')} ${(memory.summary || '')}`.toLowerCase();

    // roll stats, biased by memory keywords + archetype
    const stats = {};
    for (const s of STAT_NAMES) {
        let v = roll4d6DropLowest(rand);
        let hits = 0;
        for (const kw of STAT_KEYWORDS[s]) if (text.includes(kw)) hits++;
        v += Math.min(hits, 2) + (arch.statBias[s] || 0);
        stats[s] = Math.max(3, Math.min(18, v));
    }

    const personality = growPersonality(rand, text);

    const sheet = {
        seed,
        // one rand() draw (as before) picks the start; human names de-dup within the town + get a themed
        // surname. Orc towns overwrite this in orcify() — keep a single rand() draw here for parity, no de-dup
        // (the discarded human name must not pollute the town's used-name set).
        name: culture === 'orc'
            ? `${arch.names[Math.floor(rand() * arch.names.length)]} orc`
            : `${assignFirst(arch.names, Math.floor(rand() * arch.names.length), used)} ${pickSurname(arch.surnames, seed)}`,
        archetype: arch.label,
        archetypeKey: key,
        stats,
        personality,
        level: 1,
        xp: 0,
        harvested: 0,        // lifetime OUTPUT (crops + facility produce + forage) — drives progression/milestones
        cropsHarvested: 0,   // CROPS grown + harvested only — the "yield" the roster/card report (see #doHarvest)
        cropStock: {},     // per-type provenance tally {type:{grown,stolen,found}} — the inventory breakout
        crop: arch.crop,   // signature crop (kept for code that still reads a single crop)
        crops: buildCropPalette(rand, arch.crop, personality),
        hat: arch.hat,
        // every farmer can raise a sheep flock once they're a seasoned hand (LV15) with a yurt —
        // slot it right after the coop (chickens) so it's an early livestock reward, ahead of the
        // cottage-gated pond/pen. (Copy first — arch.facilities is a shared constant.)
        facilityPrefs: (() => { const p = [...arch.facilities]; const c = p.indexOf('coop'); p.splice(c >= 0 ? c + 1 : p.length, 0, 'sheeppen'); return p; })(),
        penAnimal: arch.penAnimal,
        colors: {
            skin: SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)],
            hair: arch.hair,
            shirt: arch.shirt,
            pants: rand() < 0.5 ? '#4a5570' : '#6a5540',
            hatColor: ['#d8c088', '#e8e0d0', '#c05840', '#f0d040', '#7dd069', '#e0e8f0'][Math.floor(rand() * 6)],
        },
        creeds: compileCreeds(memory, seed),   // #91: long-term identity distilled from the source doc
        // NB: the W2 birth-personality snapshot (`p0`) is taken AFTER founding trait-locks, in
        // World.ensureFounderVariety / lazily at first drift — not here, or the chaos/mercurial locks
        // would read as "lived drift" past the cap.
        memory,
        mutation,
        culture: 'human',
    };
    // #3.1 an orc town reads the SAME memory through the raider's lens (deterministic; human sheets untouched).
    if (culture === 'orc') orcify(sheet, mulberry32(hashString('orc:' + seed)), used);
    return sheet;
}

// #1.1 Generational founding — the closed memory loop made flesh. An HEIR is grown from a FRESH document
// like any farmer (its archetype, stats, personality, name), but folds a forebear into its seed (so it's a
// distinct person) and carries ONE creed inherited from a farmer a PAST town wrote back to SuperMemory. The
// forebear is provenance (`f.lineage`), surfaced on the sheet + chronicle so the loop is visible. Determinism
// is untouched: the whole heir derives from one seed, and the fresh-doc<->forebear pairing is chosen
// deterministically at founding and baked into the save (the sim never re-reads SuperMemory).
export function growHeir(freshDoc, lineage, mutation = 0, culture = 'human', used = new Set()) {
    const f = growFarmer(freshDoc, mutation, `heir:${lineage.id}`, culture, used);
    // #names — the heir keeps its own (de-duped) FIRST name but inherits the forebear's SURNAME, so the
    // surname becomes the visible generational thread on the memory graph. (Human lineages only — an orc
    // heir keeps its warband clan.) The first name was already de-duped in growFarmer above.
    if (culture !== 'orc' && lineage.name) {
        const foreSurname = String(lineage.name).split(' ').slice(1).join(' ');
        if (foreSurname) f.name = `${f.name.split(' ')[0]} ${foreSurname}`;
    }
    const inheritedCreed = {
        theme: 'inherited', tags: ['lineage', 'inheritance'], weight: 1,
        quote: lineage.creed,
        short: lineage.name ? `I carry what ${String(lineage.name).split(' ')[0]} believed` : 'I carry what they believed',
        shorts: ['I carry what they believed'],
        inherited: {
            name: lineage.name, town: lineage.town, townSeed: lineage.townSeed,
            farmerSeed: lineage.farmerSeed, sourceTitle: lineage.sourceTitle, archetype: lineage.archetype,
        },
    };
    f.creeds = [inheritedCreed, ...f.creeds].slice(0, 6);
    f.lineage = {   // provenance (#1.2): who this farmer descends from, beyond their own source doc
        ofName: lineage.name, ofTown: lineage.town, ofTownSeed: lineage.townSeed, ofFarmerSeed: lineage.farmerSeed,
        creed: lineage.creed, dream: lineage.dream, sourceTitle: lineage.sourceTitle, archetype: lineage.archetype,
    };
    return f;
}

// ---------------------------------------------------------------------------
// Memory fetching
// ---------------------------------------------------------------------------

export async function fetchMemories() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(MEMORY_ENDPOINT, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const docs = (data.documents || [])
            .filter(d => d.title && (d.summary || d.content))
            .map(d => ({
                id: d.id,
                title: d.title,
                summary: d.summary || d.content || '',
                content: d.content || '',
            }));
        // #1.1 lineage: past farmers this store remembers, available to found heirs from (blend, not echo).
        const lineage = Array.isArray(data.lineage) ? data.lineage : [];
        // Codex r20 P1: extract lineage BEFORE bailing on an empty source corpus. On self-hosted v0.0.3,
        // GET /v3/documents is gone (docs empty) yet /v4/search returns past lives — throwing here discarded
        // the lineage and the loop could never close. Only give up when BOTH are empty; otherwise keep the
        // lineage and grow the fresh cast from invented lives (memories:null -> generateCrew in the caller).
        if (docs.length === 0 && lineage.length === 0) throw new Error(data.error || 'no usable documents');
        return { memories: docs.length ? docs : null, lineage, source: data.source || 'supermemory' };
    } catch (err) {
        // no self-hosted corpus reachable -> the caller grows the town from INVENTED lives (generateCrew),
        // seeded by the world so the default town is unique + untethered from any real documents.
        console.warn('[ry-bots] no memory corpus; growing farmers from invented lives:', err.message);
        return { memories: null, lineage: [], source: 'invented' };
    }
}
