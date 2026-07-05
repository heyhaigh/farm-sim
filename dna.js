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
    },
    athlete: {
        label: 'Athlete',
        keywords: ['soccer', 'sport', 'steps', 'fitness', 'heart rate', 'hrv', 'defender', 'sweeper', 'athletic', 'running'],
        statBias: { dex: 2, con: 1 },
        crop: 'carrot', hat: 'headband',
        shirt: '#e86a5e', hair: '#2e2620',
        names: ['Turbo', 'Scout', 'Sprint', 'Striker', 'Dash'],
    },
    designer: {
        label: 'Designer',
        keywords: ['design', ' ui', ' ux', 'portfolio', 'figma', 'interface', 'creative', 'carplay', 'showcase', 'display', 'wearable'],
        statBias: { int: 2, wis: 1 },
        crop: 'rose', hat: 'beret',
        shirt: '#c77dba', hair: '#503a2a',
        names: ['Pixel', 'Vector', 'Kerning', 'Bezier', 'Swatch'],
    },
    builder: {
        label: 'Builder',
        keywords: ['startup', 'leadership', 'team', 'launch', 'product', 'iheartradio', 'aloe', 'business', 'smart hub', 'consulting', 'zero'],
        statBias: { str: 2, con: 1 },
        crop: 'pumpkin', hat: 'hardhat',
        shirt: '#e0a03c', hair: '#3a2a1c',
        names: ['Rivet', 'Forge', 'Crane', 'Girder', 'Hex'],
    },
    homebody: {
        label: 'Homebody',
        keywords: ['dog', 'pottery', 'partner', 'personal', 'family', 'home', 'clay', 'wheel', 'canine', 'hobby'],
        statBias: { wis: 2, con: 1 },
        crop: 'tomato', hat: 'strawhat',
        shirt: '#8fb85e', hair: '#6a4a30',
        names: ['Biscuit', 'Clay', 'Mochi', 'Pudding', 'Bun'],
    },
    greeter: {
        label: 'Greeter',
        keywords: ['contact', 'linkedin', 'about page', 'navigation', 'website', 'guidance', 'visitors', 'site', 'changelog', 'metrics'],
        statBias: { cha: 2, dex: 1 },
        crop: 'wheat', hat: 'cap',
        shirt: '#6a9ade', hair: '#4a3624',
        names: ['Concierge', 'Beacon', 'Usher', 'Ping', 'Docent'],
    },
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
// Farmer sheet generation
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f0c8a0', '#e0b088', '#c89068', '#a87850', '#8a5c3c'];

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

    return {
        seed,
        name: `${arch.names[Math.floor(rand() * arch.names.length)]} Ry`,
        archetype: arch.label,
        archetypeKey: key,
        stats,
        level: 1,
        xp: 0,
        harvested: 0,
        crop: arch.crop,
        hat: arch.hat,
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
