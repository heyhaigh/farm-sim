// dna.js — turns SuperMemory documents into Ry Bot farmer character sheets.
// Every farmer is deterministic: same memory -> same farmer.

const MEMORY_ENDPOINT = 'https://heyhaigh.ai/api/knowledge-graph';

// Small offline crew so the page still works if the API is unreachable.
const FALLBACK_MEMORIES = [
    { id: 'fb-voice', title: "Ryan's Seven-Year Experience in Voice Technologies for Elder Care", summary: 'Ryan spent seven years building voice-first experiences for elder care at Aloe Care Health, including a patented voice-enabled emergency triage system.' },
    { id: 'fb-soccer', title: "Ryan's Soccer Career as a Sweeper Defender", summary: 'Ryan played sweeper through high school, anchoring the defense from freshman to senior year.' },
    { id: 'fb-design', title: "Ryan's Design Work for Samsung Wearable Launch at iHeartRadio", summary: 'Ryan led design for first-release products, including the iHeartRadio app for the Samsung wearable launch.' },
    { id: 'fb-startup', title: "Ryan's Zero-to-One Startup Expertise", summary: 'Twelve years of early-stage startup consulting, taking products from zero to one.' },
    { id: 'fb-pottery', title: "Ryan's Enjoyment of Wheel-Throwing Pottery Classes", summary: 'Ryan takes wheel-throwing pottery classes and enjoys working with clay.' },
    { id: 'fb-site', title: 'Guidelines for Contacting Ryan', summary: 'Visitors should be pointed to the About page or LinkedIn — there is no contact form.' },
];

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
        names: ['Echo', 'Herald', 'Whisper', 'Signal', 'Chirp'],
        facilities: ['pond', 'coop', 'pen'], penAnimal: 'goat',
    },
    athlete: {
        label: 'Athlete',
        keywords: ['soccer', 'sport', 'steps', 'fitness', 'heart rate', 'hrv', 'defender', 'sweeper', 'athletic', 'running'],
        statBias: { dex: 2, con: 1 },
        crop: 'carrot', hat: 'headband',
        shirt: '#e86a5e', hair: '#2e2620',
        names: ['Turbo', 'Scout', 'Sprint', 'Striker', 'Dash'],
        facilities: ['coop', 'pen', 'pond'], penAnimal: 'goat',
    },
    designer: {
        label: 'Designer',
        keywords: ['design', ' ui', ' ux', 'portfolio', 'figma', 'interface', 'creative', 'carplay', 'showcase', 'display', 'wearable'],
        statBias: { int: 2, wis: 1 },
        crop: 'grapes', hat: 'beret',
        shirt: '#c77dba', hair: '#503a2a',
        names: ['Pixel', 'Vector', 'Kerning', 'Bezier', 'Swatch'],
        facilities: ['pond', 'coop', 'pen'], penAnimal: 'pig',
    },
    builder: {
        label: 'Builder',
        keywords: ['startup', 'leadership', 'team', 'launch', 'product', 'iheartradio', 'aloe', 'business', 'smart hub', 'consulting', 'zero'],
        statBias: { str: 2, con: 1 },
        crop: 'pumpkin', hat: 'hardhat',
        shirt: '#e0a03c', hair: '#3a2a1c',
        names: ['Rivet', 'Forge', 'Crane', 'Girder', 'Hex'],
        facilities: ['pen', 'coop', 'pond'], penAnimal: 'cow',
    },
    homebody: {
        label: 'Homebody',
        keywords: ['dog', 'pottery', 'partner', 'personal', 'family', 'home', 'clay', 'wheel', 'canine', 'hobby'],
        statBias: { wis: 2, con: 1 },
        crop: 'pepper', hat: 'strawhat',
        shirt: '#8fb85e', hair: '#6a4a30',
        names: ['Biscuit', 'Clay', 'Mochi', 'Pudding', 'Bun'],
        facilities: ['pond', 'pen', 'coop'], penAnimal: 'pig',
    },
    greeter: {
        label: 'Greeter',
        keywords: ['contact', 'linkedin', 'about page', 'navigation', 'website', 'guidance', 'visitors', 'site', 'changelog', 'metrics'],
        statBias: { cha: 2, dex: 1 },
        crop: 'wheat', hat: 'cap',
        shirt: '#6a9ade', hair: '#4a3624',
        names: ['Concierge', 'Beacon', 'Usher', 'Ping', 'Docent'],
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
// Farmer sheet generation
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f0c8a0', '#e0b088', '#c89068', '#a87850', '#8a5c3c'];

// The six crop kinds a farm can sow (one per archetype). A farm's MIX is drawn from these.
export const ALL_CROPS = ['sunflower', 'carrot', 'grapes', 'pumpkin', 'pepper', 'wheat'];
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

export function growFarmer(memory, mutation = 0) {
    const seed = hashString((memory.id || memory.title || 'ry') + (mutation ? `:m${mutation}` : ''));
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

    return {
        seed,
        name: `${arch.names[Math.floor(rand() * arch.names.length)]} Ry`,
        archetype: arch.label,
        archetypeKey: key,
        stats,
        personality,
        level: 1,
        xp: 0,
        harvested: 0,
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
        memory,
        mutation,
    };
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
        if (docs.length === 0) throw new Error('no usable documents');
        return { memories: docs, source: 'supermemory' };
    } catch (err) {
        console.warn('[ry-bots] falling back to offline memories:', err.message);
        return { memories: FALLBACK_MEMORIES, source: 'offline' };
    }
}
