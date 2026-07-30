// mobile-gate.js — what a phone gets instead of the game.
//
// Propagate is a fullscreen mouse-and-keyboard sim, so a phone never boots it. But a link shared publicly is
// mostly opened on phones, and those visitors should meet PROPAGATE rather than a web page — so the notice is
// the REAL animated wordmark drawn through the REAL CRT shader onto the same #tv canvas.
//
// This is a SEPARATE ENTRY POINT, and that is the whole point (Codex #63-2). index.html imports either this
// or main.js, never both. Importing main.js on a phone would execute its module scope — measured at 96 image
// requests and ~2MB of art on production, plus the entire sim graph — for a device that renders no world.
// Here the dependency list is crt.js, pixel.js and title-anim.js; only the last fetches anything, and it is
// the one sheet actually on screen.

import { CRT } from './crt.js';
import { drawText, textWidth } from './pixel.js';
import { drawTitleArt } from './title-anim.js';
import { gateLayout, GATE_L1, GATE_L2 } from './gate-layout.js';
import { createScheduler } from './gate-loop.js';

// The CSS contract this module depends on (`pointer-events: none` on the canvas, the fallback rule) keys
// off `entry-mobile`. The entry chooser stamps it before loading us; re-stamping here is idempotent and
// keeps the module correct even if it is ever loaded directly.
document.documentElement.classList.add('entry-mobile');

const out = document.getElementById('tv');
const game = document.createElement('canvas');
const ctx = game.getContext('2d');
let crt = new CRT(out, game);   // `let`: a context loss invalidates it and it must be rebuilt (see below)

let GW = 320, GH = 300;

function gateResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    out.width = Math.max(1, Math.round(out.clientWidth * dpr));
    out.height = Math.max(1, Math.round(out.clientHeight * dpr));
    const L = gateLayout(out.clientWidth, out.clientHeight);
    GW = L.GW; GH = L.GH;
    if (game.width !== GW || game.height !== GH) {
        game.width = GW; game.height = GH;
        ctx.imageSmoothingEnabled = false;
    }
    return L;
}

window.addEventListener('resize', gateResize);
window.addEventListener('orientationchange', gateResize);
gateResize();

// Codex #63-3: `gate-live` retires the plain-text HTML fallback, so it must NOT be set until a frame has
// actually rendered. Setting it up front meant any exception in sizing, drawing or crt.render() left a
// permanently black page with the notice suppressed. Now the fallback stands until the gate proves itself,
// and a later failure puts it back.
let firstFrameDone = false;
function markLive() {
    if (firstFrameDone) return;
    firstFrameDone = true;
    document.documentElement.classList.add('gate-live');
}
// The HTML fallback is `position: fixed; inset: 0` with its own background at z-index 9999, so it COVERS
// the canvas — there is no need to hide #tv as well, and hiding it would break recovery on restore.
function markFailed(err) {
    firstFrameDone = false;
    document.documentElement.classList.remove('gate-live');
    document.documentElement.classList.add('gate-fallback');
    if (!markFailed.logged) { markFailed.logged = true; console.error('mobile gate render failed:', err); }
}

// Codex #64-3: a WebGL context loss does NOT throw — it fires `webglcontextlost` and quietly makes draw
// calls ineffective. So the try/catch below could never see it, and after one good frame `gate-live` would
// stay set over a frozen black canvas with the notice suppressed. Handle it explicitly.
// preventDefault() is required, or the browser will never fire `webglcontextrestored`.
let contextLost = false;
out.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    markFailed(new Error('webglcontextlost'));
}, false);
out.addEventListener('webglcontextrestored', () => {
    // Codex #65-1: restoring the CONTEXT does not restore the CRT's shaders, programs, buffer or texture —
    // those were created against the dead one. Restarting the old instance renders happily at 60fps onto a
    // BLACK canvas, and because WebGL calls do not throw, markLive() would retire the fallback over it.
    // Rebuild before recovering. (My earlier check missed this by asserting on class state, not on pixels.)
    // Logged UNCONDITIONALLY, unlike markFailed's once-only: a rebuild failure is rare, terminal for the
    // gate, and the only thing that explains a notice that never goes away.
    try { crt = new CRT(out, game); }
    catch (err) { console.error('mobile gate: CRT rebuild after context restore failed:', err); markFailed(err); return; }
    contextLost = false;
    schedule(false);   // the loop parked itself on loss; restart it
}, false);

// Scheduling is INSIDE the frame now, not unconditionally at the top: a permanently-failing gate used to
// retry at full frame rate, which on a phone is a hot battery for nothing.
//
// `scheduled` keeps exactly ONE loop in flight. Since every frame reschedules itself, a second entry
// forks a duplicate that never merges back.
//
// The sequence that does it (Codex #65-3 — I had guessed at loss→restore→loss→restore, which does NOT
// reproduce, because the loop parks on loss and the browser fires one restore per loss):
//
//     a frame THROWS  ->  schedule(true) leaves a 1s retry pending
//     context is LOST ->  the loop parks
//     context RESTORES BEFORE that timeout fires  ->  the restore path starts an immediate loop
//     the old timeout then fires  ->  a SECOND permanent loop
//
// Measured in-browser: 61 renders/sec guarded, 122 unguarded. tests/gate-loop.mjs encodes it.
// Note the guard makes the restore path a no-op while a retry is pending, so recovery waits out the
// remaining backoff (<=1s) instead of restarting instantly. That is the intended trade.
const loop = createScheduler({ raf: requestAnimationFrame.bind(window), delay: setTimeout.bind(window) });
const schedule = (failed) => loop.schedule(failed);

function gateFrame(t) {
    if (contextLost) return;   // parked — `webglcontextrestored` restarts the loop
    try {
        const L = gateLayout(out.clientWidth, out.clientHeight);
        GW = L.GW; GH = L.GH;
        if (game.width !== GW || game.height !== GH) { game.width = GW; game.height = GH; ctx.imageSmoothingEnabled = false; }

        // the start screen's own backdrop: near-black with a soft green lift behind the letters
        ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, GW, GH);
        const vg = ctx.createRadialGradient(GW / 2, GH / 2, 0, GW / 2, GH / 2, GH * 0.7);
        vg.addColorStop(0, 'rgba(18,32,22,0.65)'); vg.addColorStop(1, 'rgba(5,7,10,0)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);

        const cx = GW / 2;
        const centred = (str, y, color, sc) => drawText(ctx, str, Math.round(cx - textWidth(str, sc) / 2), y, color, sc);
        const titleBottom = drawTitleArt(ctx, cx, L.titleTop, L.maxW, GW);
        centred(GATE_L1, titleBottom + L.d1, '#f0d060', L.s1);
        centred(GATE_L2, titleBottom + L.d2, '#8a8f9c', L.s2);

        // Codex #63-5: the shader's clock is in SECONDS — the game's frame loop divides the rAF timestamp
        // by 1000 before calling render. Passing raw milliseconds ran the dot-crawl 1000x too fast.
        crt.render((t || performance.now()) / 1000);
        markLive();
        schedule(false);
    } catch (err) {
        markFailed(err);
        schedule(true);
    }
}
loop.onFrame(gateFrame);
schedule(false);
