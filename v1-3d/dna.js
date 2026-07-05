// dna.js — turns SuperMemory documents into Ry Bot DNA.
// Every bot is deterministic: same memory -> same bot (until you mutate it).

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

const ARCHETYPES = {
    herald: {
        label: 'Voice Herald',
        keywords: ['voice', 'hume', 'agentic', ' ai ', 'claude', 'speech', 'evi', 'rybot', 'assistant', 'triage'],
        locomotion: 'fly', legs: 0, arms: true, wings: true,
        ears: 'antenna', tailSegments: 3,
        palettes: [
            ['#7dd069', '#eaf7d9', '#2e4a28'],
            ['#69c6d0', '#dff5f7', '#274a4e'],
            ['#9a8cff', '#e9e5ff', '#3a3260'],
        ],
        names: ['Echo', 'Herald', 'Whisper', 'Signal', 'Chirp'],
    },
    athlete: {
        label: 'Athlete',
        keywords: ['soccer', 'sport', 'steps', 'fitness', 'heart rate', 'hrv', 'defender', 'sweeper', 'athletic', 'running'],
        locomotion: 'walk', legs: 2, arms: true, wings: false,
        ears: 'cat', tailSegments: 3,
        palettes: [
            ['#f5a03c', '#ffe3bd', '#6b4a2f'],
            ['#ef6a6a', '#ffd9d9', '#5e2a2a'],
            ['#f2c14e', '#fff2cc', '#635126'],
        ],
        names: ['Turbo', 'Scout', 'Sprint', 'Striker', 'Dash'],
    },
    designer: {
        label: 'Designer',
        keywords: ['design', ' ui', ' ux', 'portfolio', 'figma', 'interface', 'creative', 'carplay', 'showcase', 'display'],
        locomotion: 'walk', legs: 4, arms: false, wings: false,
        ears: 'cat', tailSegments: 4,
        palettes: [
            ['#ff8fab', '#ffe0ea', '#5c2e3f'],
            ['#8fb8ff', '#e0ecff', '#2e3f5c'],
            ['#c9a0ff', '#efe3ff', '#44305e'],
        ],
        names: ['Pixel', 'Vector', 'Kerning', 'Bezier', 'Swatch'],
    },
    builder: {
        label: 'Builder',
        keywords: ['startup', 'leadership', 'team', 'launch', 'product', 'iheartradio', 'aloe', 'business', 'smart hub', 'consulting', 'zero'],
        locomotion: 'walk', legs: 6, arms: false, wings: false,
        ears: 'antenna', tailSegments: 0,
        palettes: [
            ['#d0b269', '#f4e8c8', '#4e4227'],
            ['#8fd0a0', '#dff5e5', '#2e4e37'],
            ['#c86f4a', '#f5dccf', '#4e2b1c'],
        ],
        names: ['Rivet', 'Forge', 'Crane', 'Girder', 'Hex'],
    },
    homebody: {
        label: 'Homebody',
        keywords: ['dog', 'pottery', 'partner', 'personal', 'family', 'home', 'clay', 'wheel', 'canine', 'hobby'],
        locomotion: 'hop', legs: 0, arms: false, wings: false,
        ears: 'bunny', tailSegments: 2,
        palettes: [
            ['#e8c8a0', '#faf0e0', '#5e4632'],
            ['#b8d8b0', '#eef7ea', '#3c5236'],
            ['#d8b8d8', '#f5eaf5', '#523c52'],
        ],
        names: ['Biscuit', 'Clay', 'Mochi', 'Pudding', 'Bun'],
    },
    greeter: {
        label: 'Greeter',
        keywords: ['contact', 'linkedin', 'about page', 'navigation', 'website', 'guidance', 'visitors', 'site', 'changelog', 'metrics'],
        locomotion: 'walk', legs: 2, arms: true, wings: false,
        ears: 'antenna', tailSegments: 0,
        palettes: [
            ['#9aa0b4', '#e8eaf2', '#33374a'],
            ['#7dd0c0', '#ddf5f0', '#28453f'],
            ['#f0d060', '#faf2cc', '#524726'],
        ],
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
// DNA generation — the ~15 lines of JSON that fully define a bot
// ---------------------------------------------------------------------------

export function growDNA(memory, mutation = 0) {
    const seed = hashString((memory.id || memory.title || 'ry') + (mutation ? `:m${mutation}` : ''));
    const rand = mulberry32(seed);
    const key = classifyMemory(memory);
    const arch = ARCHETYPES[key];

    const palette = arch.palettes[Math.floor(rand() * arch.palettes.length)];
    const name = `${arch.names[Math.floor(rand() * arch.names.length)]} Ry`;

    // Builders occasionally show up as 4-legged; athletes occasionally 4-legged too.
    let legs = arch.legs;
    if (arch.locomotion === 'walk' && rand() < 0.2) legs = legs === 6 ? 4 : legs === 4 ? 2 : 4;

    const dna = {
        name,
        archetype: arch.label,
        seed,
        size: 0.85 + rand() * 0.45,
        body: {
            length: 0.65 + rand() * 0.55,
            chest: 0.3 + rand() * 0.18,
            hip: 0.26 + rand() * 0.18,
        },
        head: { size: 0.26 + rand() * 0.16, snout: rand() < 0.6 ? 0.08 + rand() * 0.1 : 0 },
        ears: { type: arch.ears, length: 0.22 + rand() * (arch.ears === 'bunny' ? 0.4 : 0.2) },
        legs: { count: legs, length: 0.42 + rand() * 0.3, thick: 0.07 + rand() * 0.05 },
        arms: arch.arms,
        wings: arch.wings,
        tail: { segments: arch.tailSegments, length: 0.4 + rand() * 0.4, thick: 0.06 + rand() * 0.05 },
        locomotion: arch.locomotion,
        palette,
        eyes: { size: 0.09 + rand() * 0.05, spacing: 0.35 + rand() * 0.2 },
        personality: {
            energy: Math.round((0.35 + rand() * 0.6) * 100) / 100,
            curiosity: Math.round((0.3 + rand() * 0.7) * 100) / 100,
        },
    };

    if (dna.locomotion === 'hop') {
        dna.body.length *= 0.6; // hoppers are round
        dna.body.hip = dna.body.chest * (0.9 + rand() * 0.3);
    }
    if (dna.locomotion === 'fly') {
        dna.legs.count = 0;
        dna.legs.length = 0.2; // little dangly feet
    }
    return dna;
}

// Compact, human-readable DNA for the inspector panel.
export function dnaToJSON(dna) {
    const d = dna;
    const lines = [
        '{',
        `  "name": ${JSON.stringify(d.name)},`,
        `  "archetype": ${JSON.stringify(d.archetype)},`,
        `  "seed": ${d.seed},`,
        `  "size": ${d.size.toFixed(2)},`,
        `  "body": { "length": ${d.body.length.toFixed(2)}, "chest": ${d.body.chest.toFixed(2)}, "hip": ${d.body.hip.toFixed(2)} },`,
        `  "head": { "size": ${d.head.size.toFixed(2)}, "snout": ${d.head.snout.toFixed(2)} },`,
        `  "ears": { "type": "${d.ears.type}", "length": ${d.ears.length.toFixed(2)} },`,
        `  "legs": { "count": ${d.legs.count}, "length": ${d.legs.length.toFixed(2)}, "thick": ${d.legs.thick.toFixed(2)} },`,
        `  "arms": ${d.arms}, "wings": ${d.wings},`,
        `  "tail": { "segments": ${d.tail.segments}, "length": ${d.tail.length.toFixed(2)} },`,
        `  "locomotion": "${d.locomotion}",`,
        `  "palette": ${JSON.stringify(d.palette)},`,
        `  "personality": { "energy": ${d.personality.energy}, "curiosity": ${d.personality.curiosity} }`,
        '}',
    ];
    return lines.join('\n');
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
