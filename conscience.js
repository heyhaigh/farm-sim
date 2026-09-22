// conscience.js — client side of the CONSCIENCE channel (#93). The player types a stray
// thought at a chosen farmer; this module runs the two-stage pipeline and records the exchange:
//
//   1. CLASSIFY  the free text -> one bounded urge kind (LLM stage 1, offline: keyword matcher).
//   2. CHECK     farmer.conscienceCheck(kind, target, tone) -> the DETERMINISTIC verdict, decided
//                in the sim (farm.js). This is the honest core: the sim decides, not the model.
//   3. REPLY     the farmer's in-character reaction to that verdict (LLM stage 2, offline: template).
//
// Every LLM call falls back cleanly, so the feature works with no key at all (keyword classify +
// templated reply). Transcripts are stored on the farmer's sheet (conscience.log) and ride the save.

import { seedStage, DAY_LENGTH } from './farm.js';   // #inspiration — one reading of a seed's life, shared with the sheet; DAY_LENGTH for the snapshot clock

// #inspiration C2 (owner) — the ABBREVIATED whisper: what the farmer will one day speak back as
// they set off to do the thing. A long whisper is trimmed to its first clause, cut at a word
// boundary (~42 chars), so "have you ever thought about exploring past the northern fog to see
// whether..." germinates as them muttering "exploring past the northern fog". Deterministic,
// display-only; stamped onto the seed CLIENT-SIDE after the verdict, because conscienceCheck is
// deliberately text-blind (the sim never reads the raw message) and must stay that way.
export function abbreviateWhisper(text) {
    let t = String(text || '').trim().replace(/\s+/g, ' ');
    // drop a leading conversational runway — the quote should start at the MEAT
    t = t.replace(/^(have you (ever )?thought about|what if you|maybe you (should|could)|you (should|could|might)|why (don't|not) you|perhaps|maybe|please)\s+/i, '');
    // first clause only: cut at sentence punctuation
    const m = t.match(/^[^.!?;]+/);
    if (m) t = m[0].trim();
    if (t.length > 42) {
        t = t.slice(0, 42);
        const sp = t.lastIndexOf(' ');
        if (sp > 12) t = t.slice(0, sp);   // word boundary, unless it leaves a stub
    }
    return t.trim();
}

const ENDPOINT = '/api/ry-farms-conscience';
const TIMEOUT_MS = 20000;

// ---- offline fallbacks (used verbatim when the LLM channel is unavailable) --------------------

const KW = [
    // #132 the watch: "go take watch", "raise the watch — raiders to the north", "stand guard", "man the wall".
    // First so a defence call wins over the incidental "see/find" that would otherwise read as a visit.
    ['watch',  /\b(watch|guard|sentry|lookout|patrol|defend|sentinel|to arms|raise the alarm|stand guard|keep watch|man the (wall|fence|gate)|raiders?)\b/i],
    ['chop',   /\b(chop|wood|timber|tree|log|axe|firewood)\b/i],
    ['water',  /\b(water|irrigat|thirst|drought)\b/i],
    ['plant',  /\b(plant|sow|seed|crop|grow.*(bean|carrot|wheat))\b/i],
    ['rest',   /\b(rest|sleep|nap|bed|relax|take a break|slow down|breathe)\b/i],
    ['explore',/\b(explore|wander|adventure|roam|beyond|horizon|fog|map|out there|see the world)\b/i],
    ['hunt',   /\b(hunt|deer|rabbit|turkey|game|meat|prey|stalk)\b/i],
    ['trade',  /\b(trade|barter|swap|sell|deal|market)\b/i],
    ['build',  /\b(build|expand|upgrade|house|home|cottage|fence|bigger|grow.*(farm|homestead))\b/i],
    ['visit',  /\b(visit|see|talk to|call on|check on|go to|find)\b/i],
];

// Codex #69-2 + #70-2 — the KW rows key on topical NOUNS (tree, wood, meat, home...) so the offline
// classifier stays generous when it's the ONLY classifier. As a backstop OVER a model that already judged
// the thought non-actionable, the bar is higher: a global cue gate wasn't enough, because an unrelated cue
// + noun re-combined ("you should be proud of that tree" -> chop; "the guard told a funny story" -> watch).
// Strict mode therefore uses its OWN table where the VERB and its OBJECT must belong to the SAME intention,
// and raid alerts get their own anchored row. No visit row on purpose: a name-drop is never promoted.
const STRICT_KW = [
    ['watch',  /\b(stand|take|keep|hold)\s+(the\s+)?(watch|guard)\b|\bstand guard\b|\bman the (wall|fence|gate)\b|\b(post|set)\s+a?\s*(lookout|sentry)\b|\braiders?\b[^.!?]*\b(coming|near|close|north|south|east|west|attack|closing|sighted|tonight)\b|\b(sound|raise)\s+the\s+alarm\b/i],
    ['chop',   /\b(chop|cut|fell)\b[^.!?]*\b(tree|wood|timber|log)s?\b|\b(get|gather|fetch|stock)\b[^.!?]*\b(wood|timber|firewood)\b/i],
    ['water',  /\bwater\b[^.!?]*\b(field|crop|plant|garden)s?\b|\b(field|crop|plant)s?\b[^.!?]*\b(thirsty|dry|need\w*\s+water)\b/i],
    ['plant',  /\b(plant|sow)\b[^.!?]*\b(seed|crop|field|something|bean|carrot|wheat)s?\b|\bput\b[^.!?]*\bin the ground\b/i],
    ['rest',   /\b(get|take|need)\b[^.!?]*\b(rest|sleep|nap|break)\b|\bgo\s+(to\s+)?(bed|sleep|rest)\b|\bslow down\b|\btake a break\b/i],
    // Codex #71 — explore lost its bare-verb alternation ("my thoughts wander at night" promoted) and
    // trade its bare to/with tails ("I sell paintings to travelers" promoted): both now need an object
    // from their own world (ground to roam, goods to move).
    ['explore',/\b(go|head|scout|set out)\b[^.!?]*\b(explore|wander|roam|beyond|past the|out there|horizon|ridge|the fog)\b|\b(explore|roam)\b[^.!?]*\b(land|ground|ridge|woods|wilds|map|world|horizon|fog|frontier)\b/i],
    ['hunt',   /\b(hunt|stalk|track)\b[^.!?]*\b(deer|rabbit|turkey|game|meat|prey|something)\b|\b(get|catch|bring)\b[^.!?]*\b(meat|game|deer|rabbit|turkey)\b|\bgo\s+hunt\w*\b/i],
    ['trade',  /\b(trade|barter|swap|sell)\b[^.!?]*\b(goods?|surplus|crops?|wood|ore|eggs?|milk|wares)\b|\bgo\b[^.!?]*\bmarket\b/i],
    ['build',  /\b(build|expand|upgrade|raise|add)\b[^.!?]*\b(house|home|room|fence|homestead|it bigger)\b|\b(house|home)\b[^.!?]*\b(could use|needs)\b/i],
];

// The bounded protocol (mirrors URGE_KINDS/TONES in api/ry-farms-conscience.js and farm.js). The
// classify validation checks against THESE, not just "is a string" — Codex #120 reproduced
// {kind:'bogus-kind'} being recorded as an LLM success, passed into conscienceCheck, and returned
// from whisper(). The instrument was still affirming semantically malformed output.
const KINDS = ['chop', 'plant', 'water', 'rest', 'explore', 'build', 'visit', 'trade', 'hunt', 'none', 'watch'];
const TONES = ['suggest', 'observe', 'press', 'praise', 'meta'];

function offlineClassify(message, names, strict = false) {
    // Codex #72 — phones type typographic apostrophes: "Don’t" sailed past every don'?t pattern (and
    // would past the KW rows too). Normalize BEFORE any matching so the whole table sees ASCII.
    const m = String(message || '').replace(/[’‘]/g, "'");
    const tone = /(!!|now|again|do it|must|listen|i said|come on)/i.test(m) ? 'press'
        : /(good|nice|well done|proud|great)/i.test(m) ? 'praise'
        : /\?/.test(m) ? 'observe' : 'suggest';
    if (strict) {
        // Codex #71 (the NO-SHIP finding) — POLARITY: a negated thought must NEVER promote. "Don't chop
        // that tree" is a chop PROHIBITION, but conscienceCheck receives only the kind — promoting it
        // could HEED the very act the player forbade. Any negation keeps the model's `none` standing;
        // conservative by design ("don't forget to water" is missed, and that's the acceptable cost at
        // the model-already-said-none bar).
        if (/\b(don'?t|do not|never|no|not|stop|quit|won'?t|wouldn'?t|shouldn'?t|can'?t|cannot)\b/i.test(m))
            return { kind: 'none', target: '', tone };
        for (const [kind, re] of STRICT_KW) if (re.test(m)) return { kind, target: '', tone };
        return { kind: 'none', target: '', tone };
    }
    for (const [kind, re] of KW) {
        if (re.test(m)) {
            if (kind === 'visit') {
                const hit = names.find(n => new RegExp(`\\b${n.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(m));
                if (hit) return { kind: 'visit', target: hit, tone };
                continue;   // "visit" with no known name -> keep scanning / none
            }
            return { kind, target: '', tone };
        }
    }
    // a bare name with no verb still reads as "go see them" — but NOT in strict mode (the #classify-backstop
    // uses strict: a smalltalk mention of a name must not be promoted to a visit over the model's "none")
    if (!strict) {
        const bare = names.find(n => new RegExp(`\\b${n.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(m));
        if (bare) return { kind: 'visit', target: bare, tone };
    }
    return { kind: 'none', target: '', tone };
}

const TEMPLATES = {
    HEED:     ['...yes. I think I will.', 'Now that I think on it - that is what I will do.', 'A good notion. I will see to it.'],
    ALREADY:  ['I was already of that mind.', 'Aye - it was on my list before you said it.', 'Funny, I was just about to.'],
    BARGAIN:  ['Soon. Once the work in front of me is done.', 'Later - there is a chore I must finish first.', 'When the day settles, maybe.'],
    DISMISS:  ['Hm. No, I have my own plans.', 'A passing thought, nothing more.', 'Not today, I think.'],
    QUESTION: ['Where did that thought even come from?', 'Odd - that did not feel like my own idea.', 'Whose voice was that, I wonder.'],
    DEFY:     ['No. If anything, I will do the opposite.', 'Push me and I dig in. Not a chance.', 'The more I hear it, the less I want to.'],
};

// #inspiration slice 1 — seed-aware tiers OVER the base pools. The stage rule (seedStage) keeps
// the claims honest: 'fresh' says a seed was planted TODAY (never "it keeps returning" on first
// contact — that would be a lie); 'turning' is the it-keeps-coming-back register, earned only by a
// seed that survived a dawn; 'fading' is the thought going. The high-pressure turning lines
// foreshadow slice 2's one interaction rule (a hardened mind won't let it grow) so the player
// learns the let-it-rest rhythm before germination even exists.
const SEED_TEMPLATES = {
    QUESTION: {
        fresh:   ['Hm. That thought has a hook in it. I will turn it over.', 'Strange - it is not mine, but it is... planted now.', 'I will not act on that. But I doubt I have heard the last of it.'],
        turning: ['That thought again. It has been circling me since you first left it.', 'I keep coming back to it, you know. Unbidden.', 'It returns on its own now. I did not invite it.'],
        fading:  ['That old thought... it was louder a few days ago.', 'I remember that notion. It is quieter now.'],
    },
    DISMISS: {
        turning: ['I said no. And yet it keeps coming back to me.', 'No - though I confess the idea has not left me alone.', 'Still no. Stop asking; the thought nags me enough by itself.'],
        fading:  ['No. And the old pull of it is nearly gone, besides.'],
    },
    DEFY: {
        turning: ['NO. And there - I have shaken the whole notion out of my head for good.', 'Push me again and lose the thought entirely. In fact - it is already gone.'],
        fading:  ['NO. Whatever was growing there, I have torn it out.'],
    },
};

// Rotate through the pool by TURN (how many lines are already logged) so repeated whispers -
// which land the same verdict - don't echo the same canned line back over and over. The seed
// offset just varies which farmer starts where. (Display text only; no sim determinism here.)
// Codex #124 P2 — the slot-policy QUESTION ('set on their own errand', plan item 15) must SOUND
// like an occupied mind, not an ordinary musing: the farmer has a live self-sown intention and is
// filing the new thought for later.
const ERRAND_TEMPLATES = [
    'Not now. My mind is set on something of my own - but I hear you.',
    'Later. I have my own errand first. The thought is noted.',
    'My own thought has the reins today. Yours can wait its turn.',
];

let offlineReplyTick = 0;
function offlineReply(verdict, farmer, stage, reason) {
    const pool = reason === 'set on their own errand' ? ERRAND_TEMPLATES
        : (SEED_TEMPLATES[verdict] && SEED_TEMPLATES[verdict][stage]) || TEMPLATES[verdict] || TEMPLATES.DISMISS;
    const turn = (farmer.sheet.conscience?.log?.length || 0) + (farmer.sheet.seed >>> 5) + (offlineReplyTick++);
    return pool[turn % pool.length];
}

// ---- curated knowledge view (knowledge hygiene: only what THEY could know) --------------------

function shortNameOf(f) { return f.sheet.name.split(' ')[0]; }

function moodWord(m) { return m > 0.4 ? 'buoyant' : m > 0.1 ? 'content' : m < -0.4 ? 'out of sorts' : m < -0.1 ? 'low' : 'even'; }
function energyWord(e) { return e < 0.2 ? 'exhausted' : e < 0.4 ? 'tired' : e < 0.75 ? 'steady' : 'fresh'; }

// a 0-1 trait rolled into a word an 8B can actually act on (numbers get ignored; words get voiced)
function traitWord(v) { return v < 0.25 ? 'very low' : v < 0.45 ? 'low' : v < 0.6 ? 'middling' : v < 0.8 ? 'high' : 'very high'; }

const STATE_WORDS = { sleep: 'asleep', rest: 'resting up for the night', sick: 'laid up sick', shelter: 'sheltering from the weather', fight: 'in a fight', flee: 'fleeing danger' };

function characterView(f) {
    const s = f.sheet, p = s.personality;
    const bonds = f.allRegard(1, 0.2, 3).map(r => shortNameOf(r.who));
    const grudges = f.allRegard(-1, 0.2, 3).map(r => shortNameOf(r.who));
    const journal = f.journal.filter(m => m.strength > 0.6).slice(-4).map(m => m.text);
    // #sheet-is-the-soul — the two things live play showed were MISSING from replies: the six trait words
    // (a low-honesty schemer answered like a mild neighbour) and the CREEDS the sim itself quotes when a
    // farmer holds their ground (a whisper spoke a farmer's literal creed back to them and they didn't
    // recognise it). Both are what the Story tab already shows the player — the reply must know at least
    // as much as the panel beside it.
    const traits = {};
    for (const [k, label] of [['collaboration', 'teamwork'], ['competitiveness', 'drive'], ['honesty', 'honesty'], ['diligence', 'work ethic'], ['volatility', 'temper'], ['curiosity', 'curiosity']])
        if (f.p && f.p[k] != null) traits[label] = traitWord(f.p[k]);
    const creeds = (f.creeds || []).filter(k => !k.overwritten && k.quote).slice(0, 3).map(k => k.quote);
    return {
        name: shortNameOf(f),
        culture: f.world.culture,   // the orc voice filter keys off this server-side
        trade: s.archetype,
        specialty: f.plot ? f.specialty() : null,
        background: s.story && s.story.bg,
        ideal: s.story && s.story.ideal,
        bond: s.story && s.story.bond,
        flaw: s.story && s.story.flaw,
        dream: s.dream ? s.dream.yearn : null,
        rival: s.dream && s.dream.rivalName || null,
        keepsake: s.memory && String(s.memory.title).slice(0, 48),
        personality: p ? { label: p.label, creed: p.creed } : null,
        traits,
        creeds,
        stance: f.conscience.stance,
        mood: moodWord(f.mood),
        energy: energyWord(f.energy),
        health: f.health,
        goal: f.goal || null,
        doingNow: (f.thought || '').slice(0, 48),
        bonds, grudges, journal,
    };
}

// a snapshot of the world AS IT WAS when the whisper landed — the reply is written against this,
// so a world that ticks on during generation can never contradict the answer.
// Time of day, mirroring the top bar's exact boundaries (main.js) — the one clock the player can
// see must be the one clock the farmer speaks from. Owner-found bug: without this field the model
// filled the temporal hole itself ("just a quiet night" at 56 AFTERNOON; "no more working after
// dark" ditto) — a resting state plus no clock reads as bedtime to an LLM.
function timeWord(w) {
    if (w.isNight()) return 'night';
    const fr = Math.min(0.999, Math.max(0, w.clock / DAY_LENGTH));
    return fr < 0.34 ? 'morning' : fr < 0.67 ? 'afternoon' : 'evening';
}

function snapshotOf(f) {
    const w = f.world;
    return {
        day: w.day, season: w.seasonName, year: w.year, weather: w.weather,
        time: timeWord(w),   // morning/afternoon/evening/night — the visible top-bar clock
        doing: (f.thought || '').slice(0, 48),   // their actual inner thought — replies ground on this
        state: STATE_WORDS[f.state] || 'up and about their day',   // so a roused sleeper KNOWS they were roused
    };   // year: the temporal-truth anchor (day-1 towns kept inventing 'last autumn')
}

// ---- whisper diagnostics (#whisperdiag) --------------------------------------------------------
//
// Server telemetry showed classify and reply each recording attempts the other did not, and the
// cause was invisible: postJson throws on a timeout, an abort, a non-200 AND a fallback:true body,
// and whisper()'s catch swallows all four identically into offline text. Which one actually fired,
// and at which stage, could not be answered from the server side — a client-side failure never
// reaches it. This buffer records what the server cannot see. Diagnosis then reads accumulated
// evidence from normal play instead of asking anyone to babysit DevTools.
//
// Display/diagnostic side-channel only: localStorage, never the save, never the sim. The sim's
// digest cannot see it.
const DIAG_KEY = 'ryfarms-whisper-diag';
const DIAG_MAX = 120;
function diagLoad() {
    try { const v = JSON.parse(localStorage.getItem(DIAG_KEY)); return Array.isArray(v) ? v : []; }
    catch { return []; }
}
// The reason survives; the raw string does not (Codex #120 P2). `detail` used to keep any exception
// message verbatim, and .copy() is explicitly an EXPORT — the documented workflow ends with the
// player pasting the buffer. Codex reproduced a fallback:true error carrying player-like text being
// retained whole, and server parse errors can quote fragments of model output, which is
// prompt-derived. Truncation is not redaction, so: match categories and code identifiers, quote
// nothing. The only free text that survives is a bare error CLASS name and code symbols (property /
// function names from TypeError messages), which are identifiers from our own source, not content.
function diagReason(err) {
    if (err?.name === 'AbortError') return `timeout ${TIMEOUT_MS}ms`;
    if (err?.transport && err.status === 0) return err.reason === 'timeout' ? `timeout ${TIMEOUT_MS}ms` : 'transport: network';
    const m = String(err?.message || '');
    let x;
    if ((x = m.match(/^conscience endpoint (\d{3})$/))) return `http ${x[1]}`;
    if (/^malformed (classify|reply) response$/.test(m)) return m;   // our own validation strings
    // server fallback categories — matched, not quoted
    if (/budget|token/i.test(m)) return 'fallback: budget';
    // 'rate' as a bare substring matched 'geneRATEd', so 'model generated empty reply' was filed
    // as throttled instead of bad-output (Codex #120) — the same substring class as the server-side
    // 'schema' gate, on the same day. Specific phrases only.
    if (/breaker|cooldown|rate.?limit|too many requests|429/i.test(m)) return 'fallback: throttled';
    if (/disabled|unconfigured|no OPENAI|not configured/i.test(m)) return 'fallback: disabled';
    if (/did not return JSON|model returned|empty/i.test(m)) return 'fallback: bad-output';
    if (/model unavailable|request failed/i.test(m)) return 'fallback: upstream';
    // client-side throws — the ALLOW-LISTED ERROR CLASS and nothing else. This branch has now had
    // three doors: the raw message (#120 r1), a mutable Error.name (#120 r2), and identifiers
    // extracted from err.message — where new TypeError('PLAYER_PRIVATE_WHISPER is not a function')
    // carried the marker verbatim, because an "identifier" pattern applied to free text IS free
    // text (#120 r3). Per the loop rule in LEARNINGS.md, a third finding in the same mechanism
    // means simplify rather than patch: no extraction at all. The class alone still separates a
    // code bug from a transport failure, which is the diagnostic question; naming the exact symbol
    // is what local DevTools is for once the buffer says a client-throw exists.
    if (['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AbortError', 'DOMException', 'EvalError', 'URIError']
        .includes(err?.name)) return `client-throw: ${err.name}`;
    return 'fallback: other';
}
function diagRecord(stage, ok, detail, ms) {
    try {
        const log = diagLoad();
        log.push({ at: new Date().toISOString().slice(0, 19), stage, ok, detail: String(detail || '').slice(0, 120), ms });
        while (log.length > DIAG_MAX) log.shift();
        localStorage.setItem(DIAG_KEY, JSON.stringify(log));
    } catch { /* quota or private mode — diagnostics must never break the feature */ }
}
// Console API: RYFARMS.whisperLog() to read, RYFARMS.whisperLog.copy() for a pasteable dump,
// RYFARMS.whisperLog.clear() to reset between experiments.
export function whisperLog() {
    const log = diagLoad();
    const rows = log.map(e => `${e.at}  ${e.stage.padEnd(8)} ${e.ok ? 'llm     ' : 'OFFLINE '} ${e.ms != null ? String(e.ms).padStart(5) + 'ms  ' : '       '}${e.detail}`);
    const summary = ['classify', 'reply'].map(st => {
        const n = log.filter(e => e.stage === st), ok = n.filter(e => e.ok).length;
        return `${st} ${ok}/${n.length} llm`;
    }).join(' · ');
    console.log(`[whisper-diag] ${summary}\n` + (rows.join('\n') || '(empty)'));
    return log;
}
whisperLog.copy = () => { const t = JSON.stringify(diagLoad(), null, 1); try { navigator.clipboard.writeText(t); } catch { } return t; };
whisperLog.clear = () => { try { localStorage.removeItem(DIAG_KEY); } catch { } };

let retryState = null; // { until, status, reason } — wall-clock, never simulation time

function endpointError(status, reason, retryAt, message = '') {
    const err = new Error(status ? `conscience endpoint ${status}` : (message || 'conscience network error'));
    err.transport = true;
    err.status = status || 0;
    err.reason = typeof reason === 'string' ? reason : 'unavailable';
    err.retryAt = retryAt || 0;
    return err;
}

function retryDelay(res, data, fallback = 60) {
    const header = Number(res.headers?.get('Retry-After'));
    const body = Number(data?.retryAfter);
    const seconds = Number.isFinite(header) && header > 0 ? header
        : Number.isFinite(body) && body > 0 ? body : fallback;
    return Math.min(seconds, 86400) * 1000;
}

async function postJson(payload) {
    const now = Date.now();
    if (retryState && now < retryState.until) {
        throw endpointError(retryState.status, retryState.reason, retryState.until);
    }
    if (retryState) retryState = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        let res;
        try {
            res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (err) {
            throw endpointError(0, err?.name === 'AbortError' ? 'timeout' : 'unavailable', Date.now() + 15_000,
                err?.name === 'AbortError' ? 'conscience timeout' : 'conscience network error');
        }
        const data = await res.json().catch(() => null);
        if (res.status === 429 || res.status === 503) {
            retryState = {
                until: Date.now() + retryDelay(res, data),
                status: res.status,
                reason: typeof data?.reason === 'string' ? data.reason : 'service_capacity',
            };
        }
        if (!res.ok) {
            const retryAt = retryState?.until || (res.status >= 500 ? Date.now() + 15_000 : 0);
            throw endpointError(res.status, data?.reason, retryAt);
        }
        if (data?.fallback) {
            const err = new Error(data.error || 'fallback requested');
            err.reason = typeof data.reason === 'string' ? data.reason : 'fallback';
            err.fallback = true;
            throw err;
        }
        retryState = null; // a genuine response is stronger evidence than any stale local cooldown
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function shouldDefer(err) {
    return !!err?.transport && (err.status === 0 || err.status === 429 || err.status === 503 || err.status >= 500);
}

function noticeForError(err) {
    const retryAt = Number(err?.retryAt) > Date.now() ? Number(err.retryAt) : Date.now() + 15_000;
    const reason = typeof err?.reason === 'string' ? err.reason : 'unavailable';
    return {
        kind: reason === 'player_quota' ? 'limit' : 'service',
        reason, retryAt,
    };
}

function pendingResult(stage, context, err) {
    const notice = noticeForError(err);
    return { pending: { stage, ...context, ...notice }, notice };
}

function offlineNotice() { return { kind: 'offline', reason: 'fallback', retryAt: 0 }; }

export function formatWhisperWait(ms) {
    let seconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    let minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60); minutes %= 60;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}${minutes ? ` ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}`;
    const days = Math.floor(hours / 24), remHours = hours % 24;
    return `${days} day${days === 1 ? '' : 's'}${remHours ? ` ${remHours} hour${remHours === 1 ? '' : 's'}` : ''}`;
}

export function whisperNoticeText(notice, now = Date.now()) {
    if (!notice) return '';
    if (notice.kind === 'offline') return 'CONVERSATION SERVICE OFFLINE - LOCAL REPLY USED - YOU CAN KEEP PLAYING';
    const wait = Number(notice.retryAt) - now;
    if (wait <= 0) return 'CONVERSATION READY - PRESS ENTER TO RETRY - YOUR THOUGHT IS KEPT';
    if (notice.kind === 'limit') return `CONVERSATION LIMIT REACHED - TRY AGAIN IN ${formatWhisperWait(wait)} - YOU CAN KEEP PLAYING`;
    return `CONVERSATION SERVICE RESTING - TRY AGAIN IN ${formatWhisperWait(wait)} - YOUR THOUGHT IS KEPT`;
}

// ---- the orchestrator -------------------------------------------------------------------------

function saveWhisper(save) { if (typeof save === 'function') { try { save(); } catch { /* best effort */ } } }

function checkedClassify(cls, text, names) {
    // Shape, enums, and target semantics are the protocol. A malformed 200 may use the local
    // interpreter, but a transport pause must never silently turn into a character decision.
    if (!cls || !KINDS.includes(cls.kind) || !TONES.includes(cls.tone) || typeof cls.target !== 'string')
        throw new Error('malformed classify response');
    if (cls.kind === 'visit' ? !names.includes(cls.target) : cls.target !== '')
        throw new Error('malformed classify response');
    if (cls.kind === 'none') {
        const kw = offlineClassify(text, names, true);
        if (kw.kind !== 'none') return kw;
    }
    return cls;
}

async function finishReply(world, farmer, state, save) {
    const c = farmer.conscience;
    let line, usedOffline = false;
    const t1 = Date.now();
    try {
        const r = await postJson(state.payload);
        if (typeof r.line !== 'string' || !r.line.trim()) throw new Error('malformed reply response');
        line = r.line;
        diagRecord('reply', true, `verdict=${state.verdict}`, Date.now() - t1);
    } catch (err) {
        diagRecord('reply', false, diagReason(err), Date.now() - t1);
        if (shouldDefer(err)) {
            saveWhisper(save); // voice + deterministic outcome already happened; keep both, add no fake reply
            return pendingResult('reply', state, err);
        }
        line = offlineReply(state.verdict, farmer, state.seedInfo?.stage, state.outcomeReason);
        usedOffline = true;
    }

    const entry = logLine(c, 'ry', line, world.day, state.verdict, state.kind);
    if (usedOffline && entry) entry.offline = true;
    saveWhisper(save);
    return {
        verdict: state.verdict, kind: state.kind, target: state.target,
        reply: line, reason: state.outcomeReason,
        notice: usedOffline ? offlineNotice() : (state.baseNotice || null),
    };
}

async function applyWhisperOutcome(world, farmer, text, cls, save, baseNotice = null) {
    const c = farmer.conscience;
    const kind = cls.kind || 'none';
    const target = cls.target || null;
    const tone = cls.tone || 'suggest';

    // The deterministic verdict happens exactly once. If prose generation pauses after this point,
    // finishReply returns a reply-only continuation containing this already-decided context.
    const preSeed = farmer.sheet.conscience?.seeds?.[kind];
    const preSnap = preSeed ? { stage: seedStage(preSeed, world.day), firstDay: preSeed.firstDay } : null;
    const outcome = farmer.conscienceCheck(kind, target, tone);
    const verdict = outcome.verdict;
    const postSeed = farmer.sheet.conscience?.seeds?.[kind];
    if (verdict === 'QUESTION' && postSeed) {
        const ph = abbreviateWhisper(text);
        if (ph) postSeed.phrase = ph;
    }
    const seedView = verdict === 'DEFY'
        ? preSnap
        : (postSeed ? { stage: seedStage(postSeed, world.day), firstDay: postSeed.firstDay } : null);
    const seedInfo = seedView ? { stage: seedView.stage, days: Math.max(0, world.day - seedView.firstDay) } : null;

    let payload;
    try {
        payload = {
            stage: 'reply', verdict, kind, tone, message: text,
            character: characterView(farmer),
            pressure: Math.round(((c.pressure[kind] || 0) + Math.max(0, (c.asks?.[kind] || 1) - 1)) * 10) / 10,
            seed: seedInfo,
            reason: outcome.reason || undefined,
            history: c.log.slice(-6).map(e => ({ who: e.who, text: String(e.text).slice(0, 120) })),
            snapshot: snapshotOf(farmer),
        };
    } catch (err) {
        // Producer drift is not a recoverable service pause: there is no request to retry. Keep the
        // deterministic result, mark the local line explicitly, and retain the diagnostic category.
        diagRecord('reply', false, diagReason(err), 0);
        const line = offlineReply(verdict, farmer, seedInfo?.stage, outcome.reason);
        const entry = logLine(c, 'ry', line, world.day, verdict, kind);
        if (entry) entry.offline = true;
        saveWhisper(save);
        return { verdict, kind, target, reply: line, reason: outcome.reason, notice: offlineNotice() };
    }
    return finishReply(world, farmer, {
        text, verdict, kind, target, tone, outcomeReason: outcome.reason, seedInfo, payload, baseNotice,
    }, save);
}

// Push one whisper into `farmer`. A recoverable service pause returns a continuation instead of
// manufacturing an in-character refusal. `resumeWhisper` finishes only the missing stage.
export async function whisper(world, farmer, message, save) {
    const text = String(message || '').trim();
    if (!text || !farmer) return null;
    const c = farmer.conscience;
    const names = world.farmers.filter(o => o !== farmer).map(shortNameOf);
    logLine(c, 'voice', text, world.day);

    const payload = { stage: 'classify', message: text, names, recent: c.log.slice(-4).map(e => ({ who: e.who, text: String(e.text).slice(0, 90) })) };
    let cls, baseNotice = null;
    const t0 = Date.now();
    try {
        cls = checkedClassify(await postJson(payload), text, names);
        diagRecord('classify', true, `kind=${cls.kind || 'none'}`, Date.now() - t0);
    } catch (err) {
        diagRecord('classify', false, diagReason(err), Date.now() - t0);
        if (shouldDefer(err)) {
            saveWhisper(save); // preserve the visible thought, but apply no verdict yet
            return pendingResult('classify', { text, payload }, err);
        }
        cls = offlineClassify(text, names);
        baseNotice = offlineNotice();
    }
    return applyWhisperOutcome(world, farmer, text, cls, save, baseNotice);
}

export async function resumeWhisper(world, farmer, pending, save) {
    if (!world || !farmer || !pending || !pending.stage) return null;
    if (pending.stage === 'reply') return finishReply(world, farmer, pending, save);
    if (pending.stage !== 'classify' || pending.used) return null;

    const names = Array.isArray(pending.payload?.names) ? pending.payload.names : [];
    let cls, baseNotice = null;
    const t0 = Date.now();
    try {
        cls = checkedClassify(await postJson(pending.payload), pending.text, names);
        diagRecord('classify', true, `kind=${cls.kind || 'none'}`, Date.now() - t0);
    } catch (err) {
        diagRecord('classify', false, diagReason(err), Date.now() - t0);
        if (shouldDefer(err)) return pendingResult('classify', { text: pending.text, payload: pending.payload }, err);
        cls = offlineClassify(pending.text, names);
        baseNotice = offlineNotice();
    }
    pending.used = true; // classification continuation may apply the verdict once, never twice
    return applyWhisperOutcome(world, farmer, pending.text, cls, save, baseNotice);
}

// Exported for the test harness (the seedDeposit precedent): the pair-eviction contract is only
// observable on a SINGLE push — in a full exchange the reply's push coincidentally heals the head,
// so no post-hoc assertion can distinguish it (a mutation proved exactly that escape).
export function logLine(c, who, text, day, verdict, kind) {
    // kind rides reply rows (#inspiration slice 2) so the panel can mark the QUESTION exchange
    // whose seed later took root. Additive; old entries without it simply never match.
    const entry = verdict ? { who, text, day, verdict, ...(kind ? { kind } : {}) } : { who, text, day };
    c.log.push(entry);
    // Codex #124 r3 — evict COMPLETE exchanges, never half of one: shifting single rows split an
    // anchored voice/QUESTION pair (the voice evicted while the new whisper awaited its reply,
    // then the reply's push evicted the anchor while its seed lived). When the head is a
    // voice+reply pair, both go together.
    while (c.log.length > 40) {
        const pair = c.log[0].who === 'voice' && c.log[1] && c.log[1].who !== 'voice';
        c.log.splice(0, pair ? 2 : 1);
    }
    return entry;
}
