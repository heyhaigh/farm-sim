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

function offlineClassify(message, names) {
    const m = String(message || '');
    const tone = /(!!|now|again|do it|must|listen|i said|come on)/i.test(m) ? 'press'
        : /(good|nice|well done|proud|great)/i.test(m) ? 'praise'
        : /\?/.test(m) ? 'observe' : 'suggest';
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
    // a bare name with no verb still reads as "go see them"
    const bare = names.find(n => new RegExp(`\\b${n.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(m));
    if (bare) return { kind: 'visit', target: bare, tone };
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

// Rotate through the pool by TURN (how many lines are already logged) so repeated whispers -
// which land the same verdict - don't echo the same canned line back over and over. The seed
// offset just varies which farmer starts where. (Display text only; no sim determinism here.)
let offlineReplyTick = 0;
function offlineReply(verdict, farmer) {
    const pool = TEMPLATES[verdict] || TEMPLATES.DISMISS;
    const turn = (farmer.sheet.conscience?.log?.length || 0) + (farmer.sheet.seed >>> 5) + (offlineReplyTick++);
    return pool[turn % pool.length];
}

// ---- curated knowledge view (knowledge hygiene: only what THEY could know) --------------------

function shortNameOf(f) { return f.sheet.name.split(' ')[0]; }

function moodWord(m) { return m > 0.4 ? 'buoyant' : m > 0.1 ? 'content' : m < -0.4 ? 'out of sorts' : m < -0.1 ? 'low' : 'even'; }
function energyWord(e) { return e < 0.2 ? 'exhausted' : e < 0.4 ? 'tired' : e < 0.75 ? 'steady' : 'fresh'; }

function characterView(f) {
    const s = f.sheet, p = s.personality;
    const bonds = f.allRegard(1, 0.2, 3).map(r => shortNameOf(r.who));
    const grudges = f.allRegard(-1, 0.2, 3).map(r => shortNameOf(r.who));
    const journal = f.journal.filter(m => m.strength > 0.6).slice(-4).map(m => m.text);
    return {
        name: shortNameOf(f),
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
function snapshotOf(f) {
    const w = f.world;
    return { day: w.day, season: w.seasonName, weather: w.weather, doing: (f.thought || '').slice(0, 48) };
}

async function postJson(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`conscience endpoint ${res.status}`);
        const data = await res.json();
        if (data?.fallback) throw new Error(data.error || 'fallback requested');
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

// ---- the orchestrator -------------------------------------------------------------------------

// Push one whisper into `farmer`. Records both the player's line and the farmer's reply on
// farmer.sheet.conscience.log (capped), and returns { verdict, kind, reply } for the UI. `save`
// is invoked once at the end so the transcript survives a reload. Never throws.
export async function whisper(world, farmer, message, save) {
    const text = String(message || '').trim();
    if (!text || !farmer) return null;
    const c = farmer.conscience;
    const names = world.farmers.filter(o => o !== farmer).map(shortNameOf);

    logLine(c, 'voice', text, world.day);

    // stage 1: classify (LLM, else keyword)
    let cls;
    try { cls = await postJson({ stage: 'classify', message: text, names }); }
    catch { cls = offlineClassify(text, names); }
    const kind = cls.kind || 'none';
    const target = cls.target || null;
    const tone = cls.tone || 'suggest';

    // stage 2: the sim decides (deterministic — this is the real event)
    const outcome = farmer.conscienceCheck(kind, target, tone);
    const verdict = outcome.verdict;

    // stage 3: reply (LLM, else template)
    let line;
    try {
        const r = await postJson({
            stage: 'reply', verdict, kind, tone,
            message: text,
            character: characterView(farmer),
            // roll-affecting pressure (day-stable) PLUS today's repeat count, so a nagged reply can
            // sound more irritated even though the verdict itself is locked for the day.
            pressure: Math.round(((c.pressure[kind] || 0) + Math.max(0, (c.asks?.[kind] || 1) - 1)) * 10) / 10,
            history: c.log.slice(-12).map(e => ({ who: e.who, text: e.text })),
            snapshot: snapshotOf(farmer),
        });
        line = r.line;
    } catch {
        line = offlineReply(verdict, farmer);
    }

    logLine(c, 'ry', line, world.day, verdict);
    if (typeof save === 'function') { try { save(); } catch { /* best effort */ } }
    return { verdict, kind, target, reply: line };
}

function logLine(c, who, text, day, verdict) {
    c.log.push(verdict ? { who, text, day, verdict } : { who, text, day });
    while (c.log.length > 40) c.log.shift();
}
