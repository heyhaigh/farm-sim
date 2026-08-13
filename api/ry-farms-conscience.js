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
    // small models sometimes append stray symbols after the sentence ("... a worry. =") — strip any
    // trailing run of non-sentence junk (seen live on llama-3.1-8b via Groq)
    s = s.replace(/[\s=\-_*#~^`|\\/+<>]+$/g, '').trim();
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
const { asText } = require('./_text.js');   // #111 P2 type boundary: coercion is not a type check

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
        // #promptdiet (2026-08-13) — compressed; the definitions, the visit/target rule, the tone
        // enum, and the #classify-examples (the 8B needs examples, not just definitions) all stay.
        'Map a player\'s stray thought (pushed into a farmer\'s head in a farm sim) onto ONE bounded intention.',
        `kind MUST be one of: ${URGE_KINDS.join(', ')}. chop=cut wood. plant=sow. water=water fields. rest=sleep/break. explore=wander/see past the map. build=expand the homestead. hunt=wild game. trade=barter. visit=go see a named person (put them in target). watch=stand guard/lookout/defend ("take watch", "man the wall", "raiders coming"). none=anything else (small talk, questions, insults, praise, gibberish).`,
        `target = the referenced person's short first name (visit only, must match the town list); otherwise "". A visit to someone not on the list -> kind "none".`,
        names.length ? `Town people: ${names.join(', ')}.` : '',
        `tone MUST be one of: ${TONES.join(', ')}. suggest=nudge. observe=neutral remark. press=insistent/demanding. praise=encouragement. meta=about the voice itself.`,
        'Examples: "go chop some wood"->chop. "those fields look thirsty"->water. "you should get some sleep"->rest. "put something in the ground"->plant. "go see what is past the ridge"->explore. "your home could use another room"->build. "meat would be good tonight"->hunt. "swap goods with a neighbour"->trade. "someone should stand guard tonight"->watch. "nice work today"->none.',
        'A clear action verb or need ALWAYS beats none; none only when nothing fits. Return JSON only.',
    ].filter(Boolean).join('\n');
    const out = await callLLM({
        system,
        user: JSON.stringify({
            recent: Array.isArray(body.recent) ? body.recent.slice(-4) : [], message: String(body.message || '').slice(0, 400) }),
        schema: classifySchema, schemaName: 'ry_farms_conscience_classify', maxTokens: 200, temperature: 0,
    });
    return classify_normalize(out, names);
}

function classify_normalize(raw, names) {
    let kind = URGE_KINDS.includes(raw?.kind) ? raw.kind : 'none';
    let target = asText(raw?.target).trim();
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
        // #promptdiet (2026-08-13) — same CONTRACT, half the tokens: this block is re-sent on every
        // whisper and was the single largest cost. Every rule from the #120/#sheet-is-the-soul/
        // #inspiration arcs survives in compressed form; only prose was cut.
        'You voice one farmer in PROPAGATE, a pixel farm sim, reacting inwardly to a stray thought (the "voice") in their head. The player IS that voice - an inner prompting, never a visible person or a god they obey.',
        'Reply = their inward reaction ONLY: 1-2 COMPLETE sentences, under ~28 words, first person, plain and lived-in. No stage directions, no quoting the voice, no narration.',
        'FREE WILL: the verdict below already decided their response - honor it exactly. Never simple obedience; even a heed reads as their own choice.',
        ch.culture === 'orc'
            ? 'CULTURE VOICE - OVERRIDES ALL OTHER STYLE: an ORC of a war-hoard - short, blunt, physical sentences, gruff, rough humor, scorn for softness. Their world is hold, band, hoard, iron, ash, hide, meat - never town or gentle words. Cadence example (never copy the words): "Rest? Bones rest when the work is dead." Not a villain - a people.'
            : 'CULTURE VOICE: a human settler - plain-spoken, wary, neighbourly.',
        'FRESH WORDS: verdict/stance notes are ATTITUDE only - never echo their wording, never reuse phrasing from `recent`. Same mind, new words.',
        `VERDICT (${verdict}): ${VERDICT_GUIDE[verdict]}`,
        `STANCE toward the voice: ${STANCE_GUIDE[stance]}`,
        'THE SHEET IS THE SOUL: `character` IS this farmer. They RECOGNISE their own `creeds` if the voice touches one ("...that\'s my own rule"). `traits` colour every line - low honesty angles and schemes, high temper flares, high drive keeps score. The `flaw` shows. Never a generic farmer.',
        'PRESENT MOMENT: `snapshot.state`/`doing`/`time` are what they are doing RIGHT NOW - answer from inside it. A farmer in the afternoon never speaks of night or bedtime; a roused sleeper knows they were roused. Never promise mechanical results, never mention stats, rolls, or game terms.',
        'THE THREAD: `recent` is their OWN inner life (who:"voice" = earlier thoughts, who:"ry" = their reactions). If the new thought echoes or contradicts one, they NOTICE - "that thought again" - these intrusions accumulate.',
        'THE SEED: `seed` = how THIS idea sits in their mind. "fresh": planted by this very whisper - may sense it will linger, but it does NOT "keep returning" yet. "turning" (+days): it returns unbidden - show that, even inside a refusal. "fading": going quiet. DEFY with a seed: they just tore the lingering idea out for good and may say so.',
        'REASON "set on their own errand": they already carry their OWN intention today and file this thought for later - an occupied mind, not an ordinary musing.',
        'TEMPORAL TRUTH: the snapshot (day, time, season, year, weather) is the WHOLE of history - never invent past seasons, events, or people. Day 1 of year 1 has no past at all.',
        'Speak as "I". Plain ASCII: no markdown, no em dashes (use " - "), straight quotes, no emojis, nothing modern.',
        'Return JSON only: { "line": "<the farmer\'s reaction>" }.',
    ].join('\n');
    const user = JSON.stringify({
        character: ch,
        voiceSaid: String(body.message || '').slice(0, 400),
        classifiedAs: { kind: body.kind || 'none', tone: body.tone || 'suggest' },
        verdict,
        pressure: body.pressure || 0,
        // #inspiration — bounded copy, never the raw object: only the two fields the prompt names
        seed: body.seed && typeof body.seed.stage === 'string'
            ? { stage: String(body.seed.stage).slice(0, 12), days: Math.max(0, Math.min(99, body.seed.days | 0)) }
            : null,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 48) : undefined,
        recent: Array.isArray(body.history) ? body.history.slice(-12) : [],
        snapshot: body.snapshot || {},
    });
    const raw = await callLLM({ system, user, schema: replySchema, schemaName: 'ry_farms_conscience_reply', maxTokens: 320 });
    const line = cleanReply(asText(raw?.line));
    if (!line || line.length < 2) throw new Error('empty reply');
    return { line, verdict };
}

// ---- telemetry ---------------------------------------------------------------
// #funnel — whisper LLM-hit vs fallback rate (2026-08-01 council Day-2). The client cannot report
// this honestly: from its side a 503, a rate-limited breaker and a dead network are one `catch`.
//
// The recorder lives in _whisper-telemetry.js because failures also occur BEFORE this handler runs
// — server.mjs's per-IP limiter rejects without loading it. One module means one set of counters
// AND one emitter; a caller that increments without emitting is not reporting anything, since
// Railway stdout is the only sink (Codex #100 P1-1).
const { noteWhisper, bucketReason } = require('./_whisper-telemetry.js');

// ---- handler ----------------------------------------------------------------

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { fallback: true, error: 'POST required' });

    // Codex #97 P2-6: the environment checks below used to run BEFORE the body was read and
    // attributed every failure to 'classify'. A reply request during an unconfigured deploy then
    // inflated the classify denominator and left reply permanently at n/a — the telemetry lied
    // about which half of the whisper was broken. Read the stage first, then judge.
    //
    // A body that cannot be parsed has no knowable stage. It is recorded with reason 'bad-body',
    // which _whisper-telemetry.js routes to the 'invalid' bucket — the shipped client cannot
    // produce it, so it is protocol noise and must not dilute the product-health headline
    // (Codex #100 P2-3). Same for 'unknown-stage' below.
    let body = null;
    try {
        body = await parseBody(req);
    } catch (err) {
        noteWhisper('unattributed', false, 'bad-body');
        return send(res, 400, { fallback: true, error: 'unreadable body' });
    }

    // PARSING IS NOT VALIDATION (Codex #102 P2-1). `JSON.parse('null')` succeeds, as does `'[]'` and
    // `'"a string"'` — so a body can parse cleanly and still not be an object. Reading `body.stage`
    // off `null` then threw OUTSIDE the try above: the request 500'd through server.mjs's own
    // catch, and telemetry recorded nothing at all. A crash that is invisible to the channel built
    // to watch for crashes.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        noteWhisper('unattributed', false, 'bad-body');
        return send(res, 400, { fallback: true, error: 'unreadable body' });
    }

    // VALIDATE THE PROTOCOL BEFORE JUDGING OUR OWN HEALTH (Codex #101 P2-1). This check used to sit
    // below the environment guards, so on an unconfigured deploy a `{stage:"bogus"}` request was
    // rejected as 'unconfigured' under the 'unattributed' bucket — counted as a genuine whisper
    // attempt in the OVERALL headline, which is exactly what the invalid-traffic contract exists to
    // prevent. Malformed input is not evidence about the LLM's health, so it must be answered
    // before the LLM is consulted at all.
    if (body.stage !== 'classify' && body.stage !== 'reply') {
        noteWhisper('unattributed', false, 'unknown-stage');   // routed to `invalid` by INVALID_REASONS
        return send(res, 400, { fallback: true, error: 'unknown stage' });
    }
    const stage = body.stage;

    // A WHISPER WITH NO WORDS IS NOT A WHISPER (Codex #102 P2-2). `String(body.message || '')`
    // coerced anything into a prompt, so `{stage:'reply'}` with no message reached callLLM: it spent
    // one of the 26-per-minute shared budget on an empty prompt, returned 200, and was booked as a
    // SUCCESSFUL genuine reply. That is worse than a wasted call — it manufactures product-health
    // successes out of traffic the shipped client cannot even produce.
    //
    // Validated before the environment checks, for the same reason the stage is: bad input must not
    // be answered with a verdict about the LLM's health. (conscience.js already refuses to send an
    // empty whisper, so this can only be reached by something that is not the game.)
    if (typeof body.message !== 'string' || !body.message.trim()) {
        noteWhisper(stage, false, 'empty-message');   // routed to `invalid` by INVALID_REASONS
        return send(res, 400, { fallback: true, error: 'empty message' });
    }

    // an OpenAI key OR a custom OpenAI-compatible base URL (e.g. a local Ollama) counts as configured
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) {
        noteWhisper(stage, false, 'unconfigured');
        return send(res, 503, { fallback: true, error: 'LLM not configured' });
    }
    if (typeof fetch !== 'function') {
        noteWhisper(stage, false, 'no-fetch');
        return send(res, 501, { fallback: true, error: 'fetch unavailable' });
    }

    try {
        if (stage === 'classify') { const r = await classify(body); noteWhisper('classify', true); return send(res, 200, r); }
        const r = await reply(body); noteWhisper('reply', true); return send(res, 200, r);
    } catch (err) {
        const msg = String(err?.message || '');
        // Bucketing lives in _whisper-telemetry.js so the server and the handler classify failures
        // identically, and so a test can exercise the REAL ladder instead of a copy of it.
        const reason = bucketReason(msg);
        noteWhisper(stage, false, reason);
        return send(res, 500, { fallback: true, error: msg || 'conscience generation failed' });
    }
};
