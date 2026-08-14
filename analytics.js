// #funnel — GA4 custom events for the six-step player funnel the 2026-08-01 council asked for
// (COUNCIL_SYNTHESIS_2026-08-01.md, "Day 2: funnel events"). Six seats independently made the same
// point: without a funnel, every future council is opinion. This is the instrument that makes them
// honest.
//
// DISPLAY-SIDE ONLY, and deliberately so. Nothing here reads or writes the sim, nothing is awaited
// on a sim path, and every call is wrapped so a blocked/absent gtag cannot bubble an exception into
// the click handler that called it. Analytics sits in the same class as the LLM and the memory
// store: a side-channel the simulation loop never reads (AGENTS.md §3). Off-sim = determinism-safe.

// GA is configured for the live site only. localhost, a LAN address, a preview host and a
// file:// open all stay DARK — the funnel is worthless if it is half QA traffic, and this is the
// same posture the update nudge takes (main.js: no /api/build locally, so the badge never lights).
const LIVE_HOSTS = ['propagate.heyhaigh.ai', 'propagate.world'];   // #domain both real origins count — the old host stays live as the no-redirect fallback

// One localStorage key per once-only event. Prefixed so a player clearing "ryfarms-" keys clears
// the funnel ledger along with everything else, rather than being permanently marked.
const ONCE_PREFIX = 'ryfarms-funnel-';

function live() {
    try {
        return LIVE_HOSTS.includes(location.hostname) && typeof window.gtag === 'function';
    } catch {
        return false;   // no window/location at all (a test importing this module headless)
    }
}

// Fire-and-forget. Used for the events that are NOT once-only (town_created, session_return),
// where a lost hit costs one data point and nothing is permanently spent — so enqueueing is enough
// and there is no reason to wait for confirmation.
//
// The return value means ENQUEUED, not delivered. That distinction is the whole of Codex #97 P1-4:
// index.html defines `gtag` inline as `dataLayer.push`, so it exists and succeeds whether or not
// Google's script ever loads. Anything that must not be spent without proof uses trackOnce below.
export function track(event, params) {
    if (!live()) return false;
    try {
        window.gtag('event', event, params || {});
        return true;
    } catch {
        return false;   // a shim that throws (some blockers stub gtag with a thrower)
    }
}

// In-memory shortcut for the once-only events. Several funnel steps are detected by POLLING
// observable UI state from the render loop (see funnelTick in main.js), so trackOnce runs at frame
// rate — and localStorage.getItem is synchronous main-thread work. Once a step is known to be
// spent, this set answers without touching storage again for the rest of the session.
const spent = new Set();

// Sent this session, still awaiting gtag's processing acknowledgement — NOT a delivery receipt;
// see the scope note on trackOnce. Without this the frame-rate poll would re-send the same event
// every frame for as long as the acknowledgement is outstanding.
const pending = new Set();

// Bumped by resetFunnel. A send captures the current value; a confirmation arriving under an older
// generation is dropped, so an in-flight callback can never resurrect a flag the QA reset cleared.
let generation = 0;

// Once per browser, with the durable flag spent only after GA has PROCESSED the event — which is
// strictly stronger than "we enqueued it", and strictly weaker than "the collector received it".
// Both halves of that sentence matter; see the scope note below.
//
// The trap this closes (Codex #97 P1-4): index.html defines `gtag` inline as `dataLayer.push`, so
// when an ad-blocker blocks the googletagmanager request the stub still exists and still
// "succeeds". Treating that as sent burns the flag permanently and mutes that player's funnel step
// forever, with nothing in the data to show it. `event_callback` cannot fire if the library never
// loaded, so the flag survives and the next session retries. That is the correct failure direction
// and it is the common blocker case.
//
// SCOPE, corrected (Codex #98 P1-3): `event_callback` is documented as running after gtag finishes
// PROCESSING the command — it is NOT a collector acknowledgement. A tag that loaded fine but whose
// collection request is then blocked at the network layer will still invoke the callback, and the
// flag will still be spent. So this is not proof of delivery and must not be described as such.
// Closing that last gap needs an acknowledgement-capable transport, which GA does not offer here;
// the practical gate is post-deploy verification in Tag Assistant / Realtime.
//
// No `event_timeout` is set on purpose: the timeout makes GA invoke the callback even when
// processing did not complete, which would widen the false-positive rather than narrow it.
export function trackOnce(event, params) {
    if (spent.has(event) || pending.has(event)) return false;
    // Dark host (localhost/preview): bail BEFORE the storage read. Without this the frame-rate
    // poll would hit localStorage every frame for the whole dev session, since a send that never
    // happens can never mark the step spent.
    if (!live()) return false;
    const key = ONCE_PREFIX + event;
    try {
        if (localStorage.getItem(key)) { spent.add(event); return false; }
    } catch { /* private mode — proceed unledgered */ }

    pending.add(event);   // claim it immediately so the poll cannot re-send while we wait
    // Codex #98 P2-6: a callback already in flight cannot be cancelled by clearing `pending`, so a
    // reset followed by a late confirmation would silently re-spend the flag and undo the reset.
    // Each send carries the generation it was issued under, and a confirmation from a superseded
    // generation is ignored.
    const gen = generation;
    try {
        window.gtag('event', event, {
            ...(params || {}),
            event_callback: () => {
                if (gen !== generation) return;   // resetFunnel ran after this send — stale, drop it
                pending.delete(event);
                spent.add(event);
                try { localStorage.setItem(key, '1'); } catch { /* private mode */ }
            },
        });
        return true;   // enqueued; the flag is not spent until gtag reports the command processed
    } catch {
        pending.delete(event);   // a throwing shim — retry is legitimate
        return false;
    }
}

// QA: re-arm every once-only step so the funnel can be walked again on a live browser.
// Exposed through RYFARMS in main.js rather than called from anywhere in the game.
export function resetFunnel() {
    generation++;      // invalidate every callback still in flight (Codex #98 P2-6)
    spent.clear();     // the in-memory shortcut outranks storage — clearing one without the other re-arms nothing
    pending.clear();   // ditto: a still-pending event would refuse to re-send after a reset
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(ONCE_PREFIX)) doomed.push(k);
        }
        doomed.forEach(k => localStorage.removeItem(k));
        return doomed.length;
    } catch {
        return 0;
    }
}
