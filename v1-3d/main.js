// main.js — Ry Bots scene: a little toon plaza where worker Ryans grown from
// SuperMemory memories wander around.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RyBot } from './creature.js';
import { fetchMemories, growDNA, dnaToJSON } from './dna.js';

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor('#171923');
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#171923', 18, 42);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(7.5, 5.5, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 26;

const LIGHT_DIR = new THREE.Vector3(0.5, 0.85, 0.35).normalize();

// Ground: big toon disc with a soft radial gradient + faint rings
function makeGround() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
    g.addColorStop(0, '#2b3040');
    g.addColorStop(0.65, '#232736');
    g.addColorStop(1, '#1b1e2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    for (let r = 60; r < 260; r += 50) {
        ctx.beginPath();
        ctx.arc(256, 256, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(24, 64),
        new THREE.MeshBasicMaterial({ map: tex })
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}
scene.add(makeGround());

// Selection ring
const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 40),
    new THREE.MeshBasicMaterial({ color: '#7dd069', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.visible = false;
selectRing.renderOrder = 2;
scene.add(selectRing);

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

const bots = [];
let memories = [];
let memorySource = 'offline';
let usedMemoryIds = new Set();
let selectedBot = null;

const statusEl = document.getElementById('status');
const tagLayer = document.body;

function updateStatus() {
    statusEl.textContent = `memories: ${memories.length} (${memorySource}) · bots: ${bots.length} · drag to orbit`;
}

function pickMemory() {
    const unused = memories.filter(m => !usedMemoryIds.has(m.id));
    const pool = unused.length ? unused : memories;
    const m = pool[Math.floor(Math.random() * pool.length)];
    usedMemoryIds.add(m.id);
    return m;
}

function spawnBot(memory, position, mutation = 0) {
    const dna = growDNA(memory, mutation);
    const bot = new RyBot(dna, memory, LIGHT_DIR);
    bot.mutation = mutation;
    bot.addTo(scene, position);

    // name tag
    const tag = document.createElement('div');
    tag.className = 'bot-tag';
    tag.textContent = dna.name;
    tagLayer.appendChild(tag);
    bot.tag = tag;

    bots.push(bot);
    updateStatus();
    return bot;
}

function removeBot(bot) {
    bot.removeFrom(scene);
    bot.tag.remove();
    const i = bots.indexOf(bot);
    if (i >= 0) bots.splice(i, 1);
    if (selectedBot === bot) deselect();
    updateStatus();
}

function spawnPosition(index, total) {
    const a = (index / Math.max(total, 1)) * Math.PI * 2 + 0.6;
    const r = 2 + (index % 3) * 1.6;
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}

function spawnCrew(count = 6) {
    while (bots.length) removeBot(bots[bots.length - 1]);
    usedMemoryIds = new Set();
    for (let i = 0; i < count; i++) {
        spawnBot(pickMemory(), spawnPosition(i, count));
    }
}

// ---------------------------------------------------------------------------
// Inspector UI
// ---------------------------------------------------------------------------

const inspector = document.getElementById('inspector');

function select(bot) {
    selectedBot = bot;
    document.getElementById('insp-name').textContent = bot.dna.name;
    document.getElementById('insp-archetype').textContent =
        `${bot.dna.archetype} · ${bot.dna.locomotion}${bot.mutation ? ` · mutation ${bot.mutation}` : ''}`;
    document.getElementById('insp-memory-title').textContent = bot.memory.title;
    const summary = bot.memory.summary || '';
    document.getElementById('insp-memory-summary').textContent =
        summary.length > 380 ? summary.slice(0, 380) + '…' : summary;
    document.getElementById('insp-dna').textContent = dnaToJSON(bot.dna);
    inspector.classList.add('open');
    const ringSize = Math.max(bot.skel.bodyLen, bot.skel.rChest * 2) * 1.1;
    selectRing.scale.setScalar(ringSize);
    selectRing.visible = true;
}

function deselect() {
    selectedBot = null;
    inspector.classList.remove('open');
    selectRing.visible = false;
}

document.getElementById('btn-close').addEventListener('click', deselect);

document.getElementById('btn-spawn').addEventListener('click', () => {
    if (!memories.length) return;
    const angle = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(Math.cos(angle) * 3.5, 0, Math.sin(angle) * 3.5);
    const bot = spawnBot(pickMemory(), pos);
    select(bot);
});

document.getElementById('btn-respawn').addEventListener('click', () => {
    deselect();
    spawnCrew(6);
});

document.getElementById('btn-mutate').addEventListener('click', () => {
    if (!selectedBot) return;
    const { memory, mutation } = selectedBot;
    const pos = selectedBot.group.position.clone();
    removeBot(selectedBot);
    const bot = spawnBot(memory, pos, (mutation || 0) + 1);
    select(bot);
});

// Picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const dx = e.clientX - downAt[0], dy = e.clientY - downAt[1];
    downAt = null;
    if (dx * dx + dy * dy > 25) return; // was a drag, not a click
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(bots.map(b => b.hitMesh), false);
    if (hits.length) select(hits[0].object.userData.bot);
    else deselect();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();

// debug handle
window.RYBOTS = { bots, scene, renderer, THREE };

function updateTags() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const bot of bots) {
        tmpV.set(0, bot.skel.headPos.y + bot.skel.rHead + bot.dna.ears.length * bot.skel.s + 0.25, 0);
        bot.group.localToWorld(tmpV);
        tmpV.project(camera);
        const behind = tmpV.z > 1;
        const x = (tmpV.x * 0.5 + 0.5) * w;
        const y = (-tmpV.y * 0.5 + 0.5) * h;
        const dist = camera.position.distanceTo(bot.group.position);
        const visible = !behind && dist < 22;
        bot.tag.style.opacity = visible ? String(THREE.MathUtils.clamp(1.6 - dist / 14, 0.25, 1)) : '0';
        if (visible) {
            bot.tag.style.left = `${x}px`;
            bot.tag.style.top = `${y}px`;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    for (const bot of bots) bot.update(t, dt);

    if (selectedBot) {
        selectRing.position.set(selectedBot.group.position.x, 0.02, selectedBot.group.position.z);
        selectRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.25;
    }

    updateTags();
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
    const result = await fetchMemories();
    memories = result.memories;
    memorySource = result.source;
    spawnCrew(6);
    updateStatus();
    document.getElementById('loading').classList.add('done');
    animate();
})();
