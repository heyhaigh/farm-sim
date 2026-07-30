// title-anim.js — the animated PROPAGATE wordmark, shared by the desktop start screen (main.js) and the
// mobile gate (mobile-gate.js).
//
// It lives in its own module for ONE reason: the mobile gate must be able to draw the real logo without
// importing main.js. Pulling main.js in would execute its whole module scope — ~96 image requests and the
// entire sim graph — on a device that never renders a world. So this file, crt.js and pixel.js are the only
// things the gate loads, and none of them fetch art beyond the single sheet below.
//
// Keeping ONE copy of the frame maths also means the two screens cannot drift: the same loop, the same
// pause, the same fallback wordmark.

import { drawText, textWidth } from './pixel.js';

export const TITLE_SHEET = { cols: 8, rows: 5, frames: 40, fw: 256, fh: 113, ms: 90 };   // frame 39 = bare finale, unused by the loop

// #firstframe START THE TITLE EARLY. This used to be fetched on the first DRAW of the start screen, which is
// the worst possible moment: the boot screen hands over, the start screen appears, and only THEN does a 393KB
// sheet begin downloading — so the very first thing a new visitor saw was the 3x5 font wordmark, which then
// swapped to the animated title. Kicked off on import so it downloads alongside everything else, and the boot
// gate waits for it on a plain visit (see firstFrameArtChecks), where the start screen IS the first frame.
let titleImg = null, titleSettled = false;
(function preloadTitle() {
    const im = new Image();
    im.fetchPriority = 'high';
    im.addEventListener('load', () => { titleImg = im; titleSettled = true; }, { once: true });
    im.addEventListener('error', () => { titleSettled = true; }, { once: true });   // never hold the boot
    im.src = './propagate-title-anim2.png';
})();

// settled = loaded OR failed. The boot gate waits on this, so it must go true either way or a dead asset
// would hold a visitor on the static screen until the ceiling fires.
export function isTitleSettled() { return titleSettled; }

// The animated title, centred at (cx, topY); returns the y just below it. Falls back to the font wordmark.
// `gw` is the canvas width, used only to pick the fallback's scale.
export function drawTitleArt(ctx, cx, topY, maxW, gw) {
    if (titleImg && titleImg.width) {
        // Straight FORWARD loop (no boomerang): play 0→LAST once — vines bloom in (0→~20), then the SHINE
        // sweeps L→R across the letters (~20→LAST) — PAUSE 2s on the lush, shine-complete frame, then REPLAY
        // from the start. The bare tail (37-39) is never shown; the shine only ever travels left→right.
        const T = TITLE_SHEET, LAST = 32, PLAY = LAST * T.ms, PAUSE = 2000, REST = 150;
        const cycle = PLAY + PAUSE + REST, e = performance.now() % cycle;
        let i;
        if (e < PLAY) i = Math.floor(e / T.ms);        // play forward 0→LAST
        else if (e < PLAY + PAUSE) i = LAST;           // PAUSE on the lush, shine-complete frame
        else i = 0;                                    // brief beat, then the loop replays from the start
        const sx = (i % T.cols) * T.fw, sy = Math.floor(i / T.cols) * T.fh;
        const sc = Math.min(maxW / T.fw, 2.4), w = Math.round(T.fw * sc), h = Math.round(T.fh * sc);
        const dx = Math.round(cx - w / 2), dy = Math.round(topY);
        const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(titleImg, sx, sy, T.fw, T.fh, dx, dy, w, h); ctx.imageSmoothingEnabled = sm;
        return dy + h;
    }
    const s = gw < 400 ? 3 : 4, tw = textWidth('PROPAGATE', s), tx = Math.round(cx - tw / 2), ty = Math.round(topY + 20);
    drawText(ctx, 'PROPAGATE', tx + 1, ty + 1, 'rgba(0,0,0,0.6)', s);
    drawText(ctx, 'PROPAGATE', tx, ty, '#7dd069', s);
    return ty + 5 * s;
}
