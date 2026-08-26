// mobile-title.js — the real Propagate wordmark loop without the old full-screen WebGL workload.
//
// The static OG image remains the phone's LCP candidate. index.html loads this module only after `load`,
// and the module crossfades only after it has drawn the same lush frame the static poster already shows.
// A phone therefore gets the original vine/shine sequence without a visible handoff or a 60fps CRT loop.

const SHEET = { cols: 8, fw: 256, fh: 113, last: 32, ms: 90, pause: 2000, rest: 150 };
const canvas = document.getElementById('mobile-title');
const ctx = canvas?.getContext('2d', { alpha: true });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let image = null;
let timer = 0;
let frame = SHEET.last;

function draw(index) {
    if (!ctx || !image) return;
    const sx = (index % SHEET.cols) * SHEET.fw;
    const sy = Math.floor(index / SHEET.cols) * SHEET.fh;
    ctx.clearRect(0, 0, SHEET.fw, SHEET.fh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, sx, sy, SHEET.fw, SHEET.fh, 0, 0, SHEET.fw, SHEET.fh);
}

function schedule(delay, callback) {
    window.clearTimeout(timer);
    timer = window.setTimeout(callback, delay);
}

function advance() {
    if (document.hidden || reduceMotion) return;
    if (frame === SHEET.last) {
        schedule(SHEET.pause, () => {
            frame = 0;
            draw(frame);
            // The old animation held frame zero for its 150ms reset beat plus the first 90ms frame.
            schedule(SHEET.rest + SHEET.ms, advance);
        });
        return;
    }
    frame += 1;
    draw(frame);
    schedule(SHEET.ms, advance);
}

function reveal() {
    // Frame 32 is the lush, shine-complete title visible in og-image.png. Drawing it before the class change
    // makes the image-to-canvas crossfade visually continuous instead of jumping back to the bare title.
    frame = SHEET.last;
    draw(frame);
    requestAnimationFrame(() => {
        document.documentElement.classList.add('mobile-animation-ready');
        if (!reduceMotion && !document.hidden) advance();
    });
}

function restore() {
    window.clearTimeout(timer);
    if (document.hidden || reduceMotion || !image) return;
    frame = SHEET.last;
    draw(frame);
    advance();
}

if (canvas && ctx) {
    const title = new Image();
    title.fetchPriority = 'low';
    title.addEventListener('load', () => {
        image = title;
        reveal();
    }, { once: true });
    title.src = './propagate-title-anim2.png';
    document.addEventListener('visibilitychange', restore);
}
