// gate-layout.js — the mobile gate's geometry, as a PURE function of the output size.
//
// Split out from mobile-gate.js so it can be tested headlessly: this module touches no DOM and imports only
// pixel.js (which is itself DOM-free at import). tests/gate-layout.mjs drives it across a table of real
// device sizes. That seam exists because the gate is otherwise unreachable by the suite — it needs a canvas
// and a matching media query — and it is the screen most first-time visitors will ever see.

import { textWidth } from './pixel.js';

// The gate magnifies everything relative to the game's own 320x300 internal resolution. The logo scales in
// INTEGER steps only (fractional scaling half-pixels the art and blurs it), so the way to make it fill more
// of a phone's width is to shrink the source canvas underneath it, not to scale the sprite. At 1.15 the
// 256px logo goes from 80% of a portrait width to 92%, and every glyph grows with it.
export const GATE_ZOOM = 1.15;
const BASE_W = 320, BASE_H = 300;
const FRAME_W = 256, FRAME_H = 113;   // one title-sheet frame (mirrors TITLE_SHEET in title-anim.js)
const MARGIN = 16;                    // breathing room the composition must leave top and bottom

export const GATE_L1 = 'DESKTOP ONLY';
export const GATE_L2 = 'TRY ON A DIFFERENT DEVICE';

const even = (v) => Math.round(v / 2) * 2;

export function gateLayout(outW, outH) {
    // Match the OUTPUT aspect in both orientations, or the shader stretches the logo. Portrait pins the
    // short side (width) and grows height; landscape pins height the way the game itself does. The clamps
    // are escape hatches for absurd aspect ratios only — inside them the source aspect tracks the output.
    const ar = outW / Math.max(outH, 1);
    let GW, GH;
    if (ar >= 1) { GH = even(BASE_H / GATE_ZOOM); GW = Math.max(240, Math.min(1200, even(GH * ar))); }
    else { GW = even(BASE_W / GATE_ZOOM); GH = Math.max(240, Math.min(1200, even(GW / ar))); }

    // Largest integer text scale that still fits the width. The 3x5 font at scale 1 is three source pixels
    // tall; the headline takes the biggest step it can, the support line is deliberately the quiet one.
    const fit = (str, want) => { let sc = want; while (sc > 1 && textWidth(str, sc) > GW - 24) sc--; return sc; };
    const s1 = fit(GATE_L1, 3), s2 = fit(GATE_L2, 1);
    const d1 = 28, d2 = d1 + s1 * 5 + 12;      // gaps measured from the art's bottom edge
    const below = d2 + s2 * 5;

    // Codex #63-4: the logo must fit the HEIGHT as well as the width. On a 19.5:9 landscape phone the
    // width-only rule picked 2x — 226px of logo plus 60px of copy in a 260px canvas, so the block started
    // at -13 and the support line was clipped off the bottom entirely.
    let logoScale = Math.max(1, Math.floor(Math.min(GW - 32, 512) / FRAME_W));
    while (logoScale > 1 && FRAME_H * logoScale + below > GH - MARGIN) logoScale--;

    const maxW = FRAME_W * logoScale, titleH = FRAME_H * logoScale;
    // Centre the WHOLE composition: the block's height varies with the logo scale, so a fixed fraction of
    // the height lands correctly in one aspect and shoves the copy against the edge in the other.
    const titleTop = Math.round((GH - (titleH + below)) / 2);
    return { GW, GH, logoScale, maxW, titleH, titleTop, below, s1, s2, d1, d2 };
}
