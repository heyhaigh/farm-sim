// tests/gate-layout.mjs — the mobile gate's geometry across real device sizes.
//
// The gate is otherwise unreachable by the suite (it needs a canvas and a matching media query) and it is
// the screen most first-time visitors will ever see, so the layout maths is split into a pure function
// (gate-layout.js) precisely so it can be checked here. Codex #63-4 found the landscape clip that the
// "composition fits the canvas" invariant below now pins down.

import { gateLayout, GATE_L1, GATE_L2 } from '../gate-layout.js';
import { textWidth } from '../pixel.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const FRAME_W = 256, FRAME_H = 113;

// Real device sizes in CSS px, both orientations. The 19.5:9 landscape entries are the ones that used to clip.
const DEVICES = [
    ['iPhone SE portrait', 375, 667], ['iPhone SE landscape', 667, 375],
    ['iPhone 14 portrait', 390, 844], ['iPhone 14 landscape', 844, 390],
    ['iPhone 14 Pro Max portrait', 430, 932], ['iPhone 14 Pro Max landscape', 932, 430],
    ['Pixel 7 portrait', 412, 915], ['Pixel 7 landscape', 915, 412],
    ['iPad mini portrait', 744, 1133], ['iPad mini landscape', 1133, 744],
    ['square-ish', 500, 500], ['absurdly wide', 2000, 300], ['absurdly tall', 300, 2000],
];

for (const [name, w, h] of DEVICES) {
    const L = gateLayout(w, h);

    // 1. the composition must fit inside the canvas, top and bottom
    const bottom = L.titleTop + L.titleH + L.below;
    check(`${name}: composition fits`, L.titleTop >= 0 && bottom <= L.GH,
        `top=${L.titleTop} bottom=${bottom} GH=${L.GH}`);

    // 2. both lines of copy must fit the width
    check(`${name}: copy fits width`,
        textWidth(GATE_L1, L.s1) <= L.GW && textWidth(GATE_L2, L.s2) <= L.GW,
        `l1=${textWidth(GATE_L1, L.s1)} l2=${textWidth(GATE_L2, L.s2)} GW=${L.GW}`);

    // 3. the logo must fit the width and be an INTEGER scale (fractional blurs the pixel art)
    check(`${name}: logo integer + fits width`,
        Number.isInteger(L.logoScale) && L.logoScale >= 1 && FRAME_W * L.logoScale <= L.GW,
        `scale=${L.logoScale} w=${FRAME_W * L.logoScale} GW=${L.GW}`);

    // 4. the source canvas aspect must track the output, or the shader stretches the logo
    const srcAr = L.GW / L.GH, outAr = w / h;
    const clamped = L.GW === 240 || L.GW === 1200 || L.GH === 240 || L.GH === 1200;
    check(`${name}: aspect tracks output`, clamped || Math.abs(srcAr - outAr) / outAr < 0.02,
        `src=${srcAr.toFixed(3)} out=${outAr.toFixed(3)}`);
}

// Portrait must hit the 92% fill the owner signed off on (256 of a 278-wide source).
const p = gateLayout(390, 844);
const fill = (FRAME_W * p.logoScale) / p.GW;
check('portrait logo fills ~92% of width', Math.abs(fill - 0.921) < 0.005, `got ${(fill * 100).toFixed(1)}%`);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nGate layout is broken.'); process.exit(1); }
console.log('Gate layout holds across portrait, landscape and the clamp extremes.');
