// api/ry-farms-raid-council.js — the MUSTER COUNSEL (#raid-council). When a raid is telegraphed ("a warband
// is massing to the north"), the roused townsfolk form a line at the frontier and have ~30 seconds before the
// blow lands. Given the cast + the situation (who's coming, from where, what's at stake), the model writes
// that exchange: urgent, in-character strategy and nerve — who holds where, who watches the flank, what to do
// if the line gives. DISPLAY TEXT ONLY: the sim never reads these lines (they go into transient speech bubbles
// via the muster-talk director), so the seeded world stays byte-identical whether or not the model answers.
// Any failure returns { fallback: true } and the authored MUSTER_TALK pools carry the scene instead.
//
// Same serverless shape as ry-farms-congregation.js (mounted by server.mjs).

const LINE_MAX = 110;
const LINE_SCHEMA_MAX = 150;

function cleanLine(text) {
    let s = String(text || '')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/[–—]/g, ' - ').replace(/…/g, '...')
        .replace(/\s+/g, ' ').trim()
        .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > LINE_MAX) {
        s = s.slice(0, LINE_MAX);
        const end = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?'));
        s = end > 12 ? s.slice(0, end + 1) : s.replace(/\s+\S*$/, '');
    }
    if (!/[.!?]$/.test(s)) s = s.replace(/[\s,;:\-]+$/, '') + '.';
    return s.trim();
}

function send(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); } });
        req.on('error', reject);
    });
}

const { callLLM } = require('./_llm.js');

const scriptSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['script'],
    properties: {
        script: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['speaker', 'line'],
                properties: {
                    speaker: { type: 'string' },
                    line: { type: 'string', maxLength: LINE_SCHEMA_MAX },
                },
            },
        },
    },
};

// #one-beat the DM's single staged moment for the marquee duel — a tiny, enum-locked schema a 3B model can
// hit reliably (the DeepSeek gate would cancel a full beat-sheet; ONE beat with two enums is a different risk).
const beatSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['beat'],
    properties: {
        beat: {
            type: 'object',
            additionalProperties: false,
            required: ['stunt', 'by', 'bark'],
            properties: {
                stunt: { type: 'string', enum: ['shove', 'taunt'] },
                by: { type: 'string', enum: ['foe', 'defender'] },
                bark: { type: 'string', maxLength: 90 },
            },
        },
    },
};

async function generateBeat(body) {
    const orc = body.culture === 'orc';
    const town = String(body.town || (orc ? 'the hold' : 'the town')).slice(0, 40);
    const nem = body.nemesis && body.nemesis.name ? {
        name: String(body.nemesis.name).slice(0, 40),
        raidCount: Math.max(1, body.nemesis.raidCount | 0),
        sworeAgainst: body.nemesis.sworeAgainst ? String(body.nemesis.sworeAgainst).slice(0, 30) : null,
    } : null;
    if (!nem) throw new Error('no named foe - no beat');
    const system = [
        `You direct ONE dramatic moment in a pixel-farm-sim raid duel. ${nem.name} is raiding ${town} (raid ${nem.raidCount} of his war)${nem.sworeAgainst ? `, and he has sworn against ${nem.sworeAgainst} — this duel is the two of them, the grudge made flesh` : ''}.`,
        'Choose ONE beat for the middle of their duel:',
        '- stunt: "shove" (the actor drives the other back hard) or "taunt" (words only, no motion).',
        `- by: "foe" (${nem.name} does it) or "defender"${nem.sworeAgainst ? ` (${nem.sworeAgainst} does it)` : ''}.`,
        '- bark: ONE short line the actor says as they do it. Under 12 words, first person, in character, plain ASCII, no emojis, no em dashes.',
        orc ? 'The defenders are orcs of the hold; the raiders are a rival band.' : `The foe is an orc warleader; the defender is a farmer with a hoe and a grudge.`,
        'Return JSON only: { "beat": { "stunt": "...", "by": "...", "bark": "..." } }.',
    ].join('\n');
    const out = await callLLM({
        system,
        user: JSON.stringify({ culture: orc ? 'orc' : 'human', nemesis: nem }),
        schema: beatSchema, schemaName: 'ry_farms_duel_beat', maxTokens: 120, temperature: 0.9,
    });
    const b = out && out.beat;
    if (!b || (b.stunt !== 'shove' && b.stunt !== 'taunt') || (b.by !== 'foe' && b.by !== 'defender')) throw new Error('bad beat');
    const bark = cleanLine(b.bark);
    if (!bark || bark.length < 2) throw new Error('empty bark');
    return { beat: { stunt: b.stunt, by: b.by, bark } };
}

async function generate(body) {
    if (body.phase === 'beat') return generateBeat(body);
    const orc = body.culture === 'orc';
    const cast = (Array.isArray(body.cast) ? body.cast : []).slice(0, 8);
    const names = cast.map(f => f.name).filter(Boolean);
    if (!names.length) throw new Error('no cast');
    const town = String(body.town || (orc ? 'the hold' : 'the town')).slice(0, 40);
    const foe = String(body.foe || 'a warband').slice(0, 60);
    const dir = String(body.dir || 'the dark').slice(0, 20);
    // #nemesis the named war, if one exists — the counsel should KNOW its history, not discover it
    const nem = body.nemesis && body.nemesis.name ? {
        name: String(body.nemesis.name).slice(0, 40),
        raidCount: Math.max(1, body.nemesis.raidCount | 0),
        sworeAgainst: body.nemesis.sworeAgainst ? String(body.nemesis.sworeAgainst).slice(0, 30) : null,
    } : null;
    // #raid-feel two phases share this endpoint: 'muster' (the pre-battle counsel, default) and 'debrief'
    // (the aftermath — the fight just ended; take stock, then strategy).
    const debrief = body.phase === 'debrief';
    const b = debrief && body.battle && typeof body.battle === 'object' ? {
        felled: body.battle.felled | 0, n: body.battle.n | 0, harvestLost: body.battle.harvestLost | 0,
        hero: body.battle.hero ? String(body.battle.hero).slice(0, 30) : null,
        wounded: Array.isArray(body.battle.wounded) ? body.battle.wounded.slice(0, 6).map(x => String(x).slice(0, 30)) : [],
    } : null;
    const system = (debrief ? [
        `You write the AFTERMATH DEBRIEF in PROPAGATE, a pixel farming sim. The raid is OVER: ${foe} struck ${town} minutes ago and the fight has just ended. The ${orc ? 'orcs of the hold' : 'farmer-neighbours'} are still standing on the field where they held the line, catching their breath.`,
        b ? `What actually happened: ${b.felled} of ${b.n} raiders were felled at the line; ${Math.max(0, b.n - b.felled)} broke off and fled${b.harvestLost > 0 ? `; the raiders carried off ${b.harvestLost} measures of the harvest` : '; the stores were held'}.${b.hero ? ` ${b.hero} was the one who held the line - the fight turned on them.` : ''}${b.wounded.length ? ` WOUNDED: ${b.wounded.join(', ')} - they are hurt and standing right there.` : ' No one was badly hurt.'}` : null,
        nem ? `THIS IS A NAMED WAR: the warleader is ${nem.name}, raid number ${nem.raidCount} of his war on ${town}.${nem.sworeAgainst ? ` He has sworn against ${nem.sworeAgainst}.` : ''} He got away - they all know he will come again. The talk should turn to what THAT means: guard the one he swore against, meet him further out next time, or find a way to end this war.` : 'This was a NEW band, not a known foe. The talk should turn to defenses: the wall, the watch, meeting them further from the fields next time.',
        'Write their exchange as they stand down: first the HUMAN part (who is hurt - name them, get them inside; the reckoning - what was taken or held; a beat of relief or grief), then the STRATEGY part. Turn-taking, BY NAME, distinct voices - the shaken one, the practical one, the angry one.',
        'Rules:',
        '- 8 to 12 short turns total. Most of the cast should speak.',
        '- Each line is ONE short sentence, under ~14 words, first person, tired and real. A complete sentence.',
        '- speaker MUST be exactly one of the names given (match spelling).',
        '- No greetings, no small talk, no weather. They just fought.',
        orc ? '- These are orcs who defended their own hold: blunt, martial, proud of the stand.' : '- These are farmers, not soldiers: shaken, practical, protective of each other.',
        '- Plain ASCII only. No markdown, no em dashes (use " - "), straight quotes, no emojis, no stage directions, no narration.',
        'Return JSON only: { "script": [ { "speaker": "<name>", "line": "<what they say>" }, ... ] }.',
    ] : [
        `You write the MUSTER COUNSEL in PROPAGATE, a pixel farming sim. ${foe} has been sighted massing to the ${dir} of ${town}; the alarm is up and these ${orc ? 'orcs of the hold' : 'farmer-neighbours'} have formed a defensive line at the frontier with only moments before the raiders reach them.`,
        nem ? `THIS IS A NAMED WAR: the warleader is ${nem.name}, and this is raid number ${nem.raidCount} of his war on ${town}. They know him by name now.${nem.sworeAgainst ? ` Last time he broke off he SWORE against ${nem.sworeAgainst} - everyone on the line knows he is coming for ${nem.sworeAgainst}, and ${nem.sworeAgainst} knows it too. Let that hang over the exchange: some want to shield ${nem.sworeAgainst}, and ${nem.sworeAgainst} refuses to be shielded.` : ''}` : null,
        'Write their urgent exchange while they wait: real, flowing, turn-taking — they set STRATEGY (who holds the middle, who takes the flank, fall back to the well if the line gives, protect the stores/the sick), steady each other\'s NERVE, and speak to each other BY NAME. Distinct voices — each sounds like their own personality; a bold one is eager, a timid one is scared and says so, a wise one thinks two steps ahead.',
        'Rules:',
        '- 8 to 12 short turns total. Most of the cast should speak.',
        '- Each line is ONE short sentence, under ~14 words, first person, urgent and lived-in. A complete sentence.',
        '- speaker MUST be exactly one of the names given (match spelling).',
        `- Ground lines in the MOMENT: raiders minutes away from the ${dir}, night fields, the harvest at stake. No greetings, no small talk, no weather.`,
        orc ? '- These are orcs defending their own hold: blunt, martial, eager. Not villains - a people defending home.' : '- These are farmers, not soldiers: brave but scared, practical, protective of each other.',
        '- Plain ASCII only. No markdown, no em dashes (use " - "), straight quotes, no emojis, no stage directions, no narration.',
        'Return JSON only: { "script": [ { "speaker": "<name>", "line": "<what they say>" }, ... ] }.',
    ]).filter(Boolean).join('\n');
    const view = cast.map(f => ({
        name: f.name,
        trade: f.archetype || null,
        personality: f.personality || null,   // { label, creed }
        role: f.role || null,                 // 'sentry' | 'manager' | null — the watch talks like the watch
    }));
    const out = await callLLM({
        system,
        user: JSON.stringify({ culture: orc ? 'orc' : 'human', town, foe, dir, cast: view }),
        schema: scriptSchema, schemaName: 'ry_farms_raid_council', maxTokens: 700, temperature: 0.8,
    });
    return normalize(out, names);
}

function normalize(raw, names) {
    const lower = new Map(names.map(n => [n.toLowerCase(), n]));
    const script = [];
    for (const t of (raw && Array.isArray(raw.script) ? raw.script : [])) {
        const speaker = lower.get(String(t?.speaker || '').trim().toLowerCase());
        const line = cleanLine(t?.line);
        if (speaker && line && line.length > 1) script.push({ speaker, line });
        if (script.length >= 12) break;
    }
    if (script.length < 4) throw new Error('script too short');
    const distinct = new Set(script.map(t => t.speaker)).size;
    if (distinct < Math.min(names.length, 3)) throw new Error(`script covers only ${distinct} voices`);
    return { script };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });
    try {
        const body = await parseBody(req);
        return send(res, 200, await generate(body));
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'raid council generation failed' });
    }
};
