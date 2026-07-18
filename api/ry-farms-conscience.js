// api/ry-farms-conscience.js — the CONSCIENCE channel (#93): the player as a stray inner
// voice in a farmer's head. TWO stages in one handler, each a strict-schema OpenAI call:
//
//   { stage: 'classify', ... } -> maps the player's free-text whisper onto ONE bounded urge
//        kind (+ optional target name + tone). This is what the sim "hears": the same reading
//        the narrator will answer, so there's no keyword-vs-reply desync. The DETERMINISTIC
//        verdict (heed / already / bargain / dismiss / question / defy) is decided sim-side in
//        farm.js from this kind — the model never rolls the outcome.
//
//   { stage: 'reply', ... } -> writes the farmer's in-character response GIVEN the verdict the
//        sim already decided. Display text only; it can never change what the farmer will do.
//
// Same serverless shape as ry-farms-chat.js / ry-farms-dm.js (mounted by server.mjs). Every
// failure returns { fallback: true } so the client's offline keyword+template path stands in,
// and the game — and its determinism — is unaffected whether or not the voice is ever answered.

const REPLY_MAX = 180;      // hard cap after trimming to a whole sentence
const REPLY_SCHEMA_MAX = 260;   // looser schema bound so the model finishes its thought before we trim

// the bounded urge vocabulary (must mirror URGE_KINDS in farm.js). 'visit' carries a target.
const URGE_KINDS = ['chop', 'plant', 'water', 'rest', 'explore', 'build', 'visit', 'trade', 'hunt', 'none', 'watch'];
const TONES = ['suggest', 'observe', 'press', 'praise', 'meta'];

// bitmap-font sanitize for the reply text (drawText uppercases at render): straight quotes,
// spaced hyphens, printable ASCII only, whitespace collapsed, trimmed to a clean sentence end.
function cleanReply(text) {
    let s = String(text || '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, ' - ')
        .replace(/…/g, '...')
        .replace(/\s+/g, ' ')
        .trim();
    s = s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > REPLY_MAX) {
        // a hard length cut may land mid-sentence: keep the last COMPLETE sentence within the cap;
        // if there's no sentence end at all, drop the final (possibly partial) word.
        s = s.slice(0, REPLY_MAX);
        const end = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?'));
        if (end > 20) return s.slice(0, end + 1);
        s = s.replace(/\s+\S*$/, '');
    }
    // ensure a clean ending. A trailing connector (comma / dash / colon) means a clause was cut —
    // fall back to the last full sentence, else drop the dangling connector and close it. Otherwise
    // it's just a complete line missing its full stop, so add one (never amputate a real word).
    if (!/[.!?]$/.test(s)) {
        if (/[,;:\-]\s*$/.test(s)) {
            const end = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?'));
            s = end > 20 ? s.slice(0, end + 1) : s.replace(/[\s,;:\-]+$/, '') + '.';
        } else {
            s += '.';
        }
    }
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

// ---- stage 1: CLASSIFY ------------------------------------------------------

const classifySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'target', 'tone'],
    properties: {
        kind: { type: 'string', enum: URGE_KINDS },
        target: { type: 'string' },   // a farmer's short name for 'visit', else ""
        tone: { type: 'string', enum: TONES },
    },
};

async function classify(body) {
    const names = Array.isArray(body.names) ? body.names.slice(0, 40) : [];
    const system = [
        'You read a single stray thought that a player is pushing into a farmer\'s head in a farming sim, and map it onto ONE bounded intention.',
        `kind MUST be one of: ${URGE_KINDS.join(', ')}.`,
        '- chop = cut wood / clear trees. plant = sow crops. water = water the fields. rest = sleep / take a break.',
        '- explore = wander off / see past the map. build = expand or upgrade the homestead. hunt = hunt wild game. trade = barter goods with a neighbour.',
        '- visit = go see / talk to a specific named person; put that person in target.',
        '- watch = stand guard / take the watch / post a lookout / defend against raiders. Use for "go take watch", "raise the watch", "man the wall", "raiders coming".',
        '- none = anything that is not one of the above (small talk, a question, an insult, praise with no action, gibberish).',
        `target = the short first name of the person referenced (only for visit, and only if it matches one of the town's people); otherwise "".`,
        names.length ? `Town people (match target case-insensitively to one of these first names): ${names.join(', ')}.` : '',
        `tone MUST be one of: ${TONES.join(', ')}. suggest = a nudge to act; observe = a neutral remark; press = insistent / repeated / demanding; praise = encouragement; meta = talking ABOUT the voice/thought itself.`,
        'If the person named for a visit is not in the town list, use kind "none".',
        'Return JSON only.',
    ].filter(Boolean).join('\n');
    const out = await callLLM({
        system,
        user: JSON.stringify({ message: String(body.message || '').slice(0, 400) }),
        schema: classifySchema, schemaName: 'ry_farms_conscience_classify', maxTokens: 200, temperature: 0,
    });
    return classify_normalize(out, names);
}

function classify_normalize(raw, names) {
    let kind = URGE_KINDS.includes(raw?.kind) ? raw.kind : 'none';
    let target = String(raw?.target || '').trim();
    const tone = TONES.includes(raw?.tone) ? raw.tone : 'suggest';
    if (kind === 'visit') {
        const match = names.find(n => n.toLowerCase() === target.toLowerCase());
        if (!match) { kind = 'none'; target = ''; } else target = match;
    } else target = '';
    return { kind, target, tone };
}

// ---- stage 2: REPLY ---------------------------------------------------------

const replySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['line'],
    properties: { line: { type: 'string', maxLength: REPLY_SCHEMA_MAX } },
};

const VERDICT_GUIDE = {
    HEED: 'They quietly take up the thought as if it were their own idea. Not obedient - they own it. Do not thank the voice.',
    ALREADY: 'The thought matches what they were already going to do. A flicker of "...I was already going to."',
    BARGAIN: 'They will do it - but later, once the work in front of them is done. A deferral, not a refusal.',
    DISMISS: 'They shrug the thought off and stay their own course. Unbothered, or mildly puzzled where it came from.',
    QUESTION: 'They do not act, but the thought unsettles them - they wonder WHY they thought it, whose voice it is.',
    DEFY: 'They bristle and lean the OTHER way out of contrariness. The push made them dig in.',
};

const STANCE_GUIDE = {
    skeptic: 'They half-believe the voice is just tired nerves and say so.',
    believer: 'They treat the voice with quiet awe, as an omen or a guiding spirit.',
    bargainer: 'They talk back to the voice, weighing what is in it for them.',
    unbothered: 'They barely register the voice as anything but their own passing thought.',
};

async function reply(body) {
    const ch = body.character || {};
    const verdict = VERDICT_GUIDE[body.verdict] ? body.verdict : 'DISMISS';
    const stance = STANCE_GUIDE[ch.stance] ? ch.stance : 'unbothered';
    const system = [
        'You voice a single farmer in PROPAGATE, a pixel farming sim, answering a stray thought (the "voice") that has surfaced in their head. The player IS that voice - an inner prompting, NOT a person the farmer can see or a god they obey.',
        'Write ONLY the farmer\'s inward reaction: 1 to 2 short COMPLETE sentences (under ~28 words total), first person, plain and lived-in. Always finish your sentences. No stage directions, no quotation of the voice, no narration.',
        'The farmer has FREE WILL. Their response is already decided by the verdict below - honor it exactly. They must NEVER simply obey on command; even when they heed, it reads as their own choice, not compliance.',
        `VERDICT (${verdict}): ${VERDICT_GUIDE[verdict]}`,
        `STANCE toward the voice: ${STANCE_GUIDE[stance]}`,
        'Stay true to their personality, mood, dream, and current situation as given. Never promise a specific mechanical result, never mention stats, rolls, or game terms.',
        'ALWAYS speak as "I". Keep it grounded and human. Plain ASCII only: no markdown, no em dashes (use " - "), straight quotes, no emojis, no modern or technological references.',
        'Return JSON only: { "line": "<the farmer\'s reaction>" }.',
    ].join('\n');
    const user = JSON.stringify({
        character: ch,
        voiceSaid: String(body.message || '').slice(0, 400),
        classifiedAs: { kind: body.kind || 'none', tone: body.tone || 'suggest' },
        verdict,
        pressure: body.pressure || 0,
        recent: Array.isArray(body.history) ? body.history.slice(-12) : [],
        snapshot: body.snapshot || {},
    });
    const raw = await callLLM({ system, user, schema: replySchema, schemaName: 'ry_farms_conscience_reply', maxTokens: 320 });
    const line = cleanReply(raw?.line);
    if (!line || line.length < 2) throw new Error('empty reply');
    return { line, verdict };
}

// ---- handler ----------------------------------------------------------------

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });

    // an OpenAI key OR a custom OpenAI-compatible base URL (e.g. a local Ollama) counts as configured
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return send(res, 503, { fallback: true, error: 'LLM not configured' });
    if (typeof fetch !== 'function') return send(res, 501, { fallback: true, error: 'fetch unavailable' });

    try {
        const body = await parseBody(req);
        if (body.stage === 'classify') return send(res, 200, await classify(body));
        if (body.stage === 'reply') return send(res, 200, await reply(body));
        return send(res, 400, { fallback: true, error: 'unknown stage' });
    } catch (err) {
        return send(res, 500, { fallback: true, error: err?.message || 'conscience generation failed' });
    }
};
