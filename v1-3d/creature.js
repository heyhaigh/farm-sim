// creature.js — the Ry Bot body tech.
//
// Each bot is a set of primitive "parts" (round cones / spheres). A single
// custom vertex shader evaluates a smooth-min SDF of ALL parts and relaxes
// every vertex onto the blended iso-surface, computing normals from the SDF
// gradient and blending part colors inside the smin fold. The result: separate
// primitives that read as one seamless toon body — no seams, no skinning,
// no marching cubes, and it animates for free because the SDF lives in
// uniforms that the CPU updates each frame.

import * as THREE from 'three';
import { mulberry32 } from './dna.js';

export const MAX_PARTS = 26;

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
#define MAX_PARTS ${MAX_PARTS}
uniform vec4 uPartA[MAX_PARTS];   // xyz = end A, w = radius at A
uniform vec4 uPartB[MAX_PARTS];   // xyz = end B, w = radius at B
uniform vec3 uPartColor[MAX_PARTS];
uniform int uPartCount;
uniform float uSmooth;            // smin blend radius
uniform float uOutline;           // shell offset for the outline pass

attribute vec4 aParam;            // xyz = canonical surface dir, w = t along spine
attribute float aPart;            // which part this vertex belongs to

varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorldPos;

// iq's round cone — a capsule with different radii at each end
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3  ba = b - a;
    float l2 = dot(ba, ba);
    float rr = r1 - r2;
    float a2 = l2 - rr * rr;
    float il2 = 1.0 / l2;
    vec3  pa = p - a;
    float y = dot(pa, ba);
    float z = y - l2;
    vec3  xd = pa * l2 - ba * y;
    float x2 = dot(xd, xd);
    float y2 = y * y * l2;
    float z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// Smooth-min union over all parts, folding color along the way.
vec4 mapScene(vec3 p) {
    float d = 1e9;
    vec3 col = uPartColor[0];
    for (int i = 0; i < MAX_PARTS; i++) {
        if (i >= uPartCount) break;
        float di = sdRoundCone(p, uPartA[i].xyz, uPartB[i].xyz, uPartA[i].w, uPartB[i].w);
        float h = clamp(0.5 + 0.5 * (d - di) / uSmooth, 0.0, 1.0);
        d = mix(d, di, h) - uSmooth * h * (1.0 - h);
        col = mix(col, uPartColor[i], h);
    }
    return vec4(col, d);
}

float mapDist(vec3 p) {
    float d = 1e9;
    for (int i = 0; i < MAX_PARTS; i++) {
        if (i >= uPartCount) break;
        float di = sdRoundCone(p, uPartA[i].xyz, uPartB[i].xyz, uPartA[i].w, uPartB[i].w);
        float h = clamp(0.5 + 0.5 * (d - di) / uSmooth, 0.0, 1.0);
        d = mix(d, di, h) - uSmooth * h * (1.0 - h);
    }
    return d;
}

vec3 calcGrad(vec3 p) {
    const vec2 e = vec2(0.008, -0.008);
    return normalize(
        e.xyy * mapDist(p + e.xyy) +
        e.yyx * mapDist(p + e.yyx) +
        e.yxy * mapDist(p + e.yxy) +
        e.xxx * mapDist(p + e.xxx));
}

void main() {
    int pi = int(aPart + 0.5);
    vec3 A = uPartA[pi].xyz;
    vec3 B = uPartB[pi].xyz;
    float t = aParam.w;

    // Rebuild the vertex on its (animated) parent primitive
    vec3 axis = B - A;
    float axLen = max(length(axis), 1e-5);
    vec3 ay = axis / axLen;
    vec3 helper = abs(ay.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 ax = normalize(cross(helper, ay));
    vec3 az = cross(ay, ax);
    float r = mix(uPartA[pi].w, uPartB[pi].w, t);
    vec3 n = aParam.xyz;
    vec3 p = mix(A, B, t) + (ax * n.x + ay * n.y + az * n.z) * r;

    // Relax onto the smooth-min iso-surface (removes all seams)
    for (int k = 0; k < 3; k++) {
        float d = mapDist(p);
        vec3 g = calcGrad(p);
        p -= g * d;
    }

    vec4 sc = mapScene(p);
    vec3 grad = calcGrad(p);
    vColor = sc.xyz;

    vNormalW = normalize(mat3(modelMatrix) * grad);
    p += grad * uOutline;

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
uniform vec3 uLightDir;
uniform float uOutline;
uniform vec3 uOutlineColor;

varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
    if (uOutline > 0.0001) {
        gl_FragColor = vec4(uOutlineColor, 1.0);
        return;
    }
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uLightDir);
    float nl = dot(N, L) * 0.5 + 0.5;

    // 3-band toon ramp
    float band = 0.48 + 0.32 * smoothstep(0.42, 0.46, nl) + 0.22 * smoothstep(0.72, 0.76, nl);
    vec3 col = vColor * band;

    // rim light, only on the lit side
    vec3 V = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * smoothstep(0.25, 0.7, nl);
    col += rim * 0.3;

    // cool sky fill from above
    col += vec3(0.04, 0.06, 0.10) * max(N.y, 0.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Canonical capsule geometry (positions are parametric, resolved in-shader)
// ---------------------------------------------------------------------------

function appendCapsule(buffers, partIndex, radial, height, capRings) {
    const { params, parts, indices } = buffers;
    const startVert = params.length / 4;
    const rings = [];

    // bottom cap: pole -> equator, t = 0
    for (let j = 0; j <= capRings; j++) {
        const a = (j / capRings) * Math.PI * 0.5;
        rings.push({ sy: -Math.cos(a), sr: Math.sin(a), t: 0 });
    }
    // cylinder body
    for (let j = 0; j <= height; j++) {
        rings.push({ sy: 0, sr: 1, t: j / height });
    }
    // top cap: equator -> pole, t = 1
    for (let j = 0; j <= capRings; j++) {
        const a = (j / capRings) * Math.PI * 0.5;
        rings.push({ sy: Math.sin(a), sr: Math.cos(a), t: 1 });
    }

    for (const ring of rings) {
        for (let i = 0; i <= radial; i++) {
            const th = (i / radial) * Math.PI * 2;
            params.push(Math.cos(th) * ring.sr, ring.sy, Math.sin(th) * ring.sr, ring.t);
            parts.push(partIndex);
        }
    }

    const stride = radial + 1;
    for (let j = 0; j < rings.length - 1; j++) {
        for (let i = 0; i < radial; i++) {
            const a = startVert + j * stride + i;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
}

function buildGeometry(partDefs) {
    const buffers = { params: [], parts: [], indices: [] };
    partDefs.forEach((def, i) => {
        const q = def.quality || 'small';
        if (q === 'big') appendCapsule(buffers, i, 22, 10, 6);
        else if (q === 'mid') appendCapsule(buffers, i, 16, 7, 5);
        else appendCapsule(buffers, i, 11, 5, 4);
    });
    const geo = new THREE.BufferGeometry();
    // `position` is required by three but unused — the shader rebuilds positions.
    const count = buffers.params.length / 4;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aParam', new THREE.BufferAttribute(new Float32Array(buffers.params), 4));
    geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(buffers.parts), 1));
    geo.setIndex(buffers.indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 3.5);
    return geo;
}

// ---------------------------------------------------------------------------
// Verlet chain — springy tails and ears, simulated in world space so they
// lag naturally behind the body.
// ---------------------------------------------------------------------------

class VerletChain {
    constructor(n, segLen, stiffness = 6, gravity = -3) {
        this.segLen = segLen;
        this.stiffness = stiffness;
        this.gravity = gravity;
        this.points = [];
        for (let i = 0; i <= n; i++) {
            this.points.push({ p: new THREE.Vector3(), prev: new THREE.Vector3(), init: false });
        }
    }
    step(dt, anchor, restDir) {
        const pts = this.points;
        if (!pts[0].init) {
            for (let i = 0; i < pts.length; i++) {
                const p = anchor.clone().addScaledVector(restDir, this.segLen * i);
                pts[i].p.copy(p); pts[i].prev.copy(p); pts[i].init = true;
            }
        }
        pts[0].p.copy(anchor);
        pts[0].prev.copy(anchor);
        const clampedDt = Math.min(dt, 0.033);
        const dt2 = clampedDt * clampedDt;
        const tmp = new THREE.Vector3();
        for (let i = 1; i < pts.length; i++) {
            const pt = pts[i];
            const vel = tmp.copy(pt.p).sub(pt.prev).multiplyScalar(0.92);
            const rest = anchor.clone().addScaledVector(restDir, this.segLen * i);
            const spring = rest.sub(pt.p).multiplyScalar(this.stiffness);
            spring.y += this.gravity;
            const next = pt.p.clone().add(vel).addScaledVector(spring, dt2 * 60);
            pt.prev.copy(pt.p);
            pt.p.copy(next);
        }
        // distance constraints
        for (let iter = 0; iter < 2; iter++) {
            for (let i = 1; i < pts.length; i++) {
                const d = tmp.copy(pts[i].p).sub(pts[i - 1].p);
                const len = Math.max(d.length(), 1e-6);
                d.multiplyScalar(this.segLen / len);
                pts[i].p.copy(pts[i - 1].p).add(d);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// RyBot
// ---------------------------------------------------------------------------

const LEG_PHASES = {
    2: [0, 0.5],
    4: [0, 0.5, 0.5, 0],
    6: [0, 0.5, 0.5, 0, 0, 0.5],
};

let shadowTexture = null;
function getShadowTexture() {
    if (shadowTexture) return shadowTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(10,12,18,0.5)');
    g.addColorStop(0.7, 'rgba(10,12,18,0.28)');
    g.addColorStop(1, 'rgba(10,12,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    shadowTexture = new THREE.CanvasTexture(c);
    return shadowTexture;
}

export class RyBot {
    constructor(dna, memory, lightDir) {
        this.dna = dna;
        this.memory = memory;
        this.rand = mulberry32(dna.seed ^ 0x9e3779b9);

        this.group = new THREE.Group();
        this.time = this.rand() * 100;
        this.walkPhase = this.rand();

        // behavior state
        this.home = new THREE.Vector3();
        this.target = new THREE.Vector3();
        this.yaw = this.rand() * Math.PI * 2;
        this.speed = 0;
        this.moveBlend = 0;
        this.stateTimer = 1 + this.rand() * 2;
        this.state = 'idle';
        this.hopT = -1;          // hop progress, -1 = grounded
        this.squash = 1;
        this.squashVel = 0;
        this.spawnT = 0;         // spawn pop animation
        this.blinkT = 2 + this.rand() * 4;
        this.blinkPhase = 0;
        this.selected = false;

        this.#computeSkeleton();
        this.#buildParts();
        this.#buildMeshes(lightDir);
        this.#buildEyes();
        this.#buildShadow();
    }

    // ---- skeleton dimensions -------------------------------------------------
    #computeSkeleton() {
        const d = this.dna, s = d.size;
        const k = this.skel = {};
        k.s = s;
        k.bodyLen = d.body.length * s;
        k.rChest = d.body.chest * s;
        k.rHip = d.body.hip * s;
        k.rHead = d.head.size * s;
        k.legLen = d.legs.length * s;
        k.legThick = d.legs.thick * s;

        if (d.locomotion === 'hop') {
            k.spineY = k.rHip * 1.05;
            k.hover = 0;
        } else if (d.locomotion === 'fly') {
            k.spineY = 0;
            k.hover = (0.9 + k.rChest) * 1.15;
        } else {
            k.spineY = k.legLen * 0.92 + k.rHip * 0.35;
            k.hover = 0;
        }
        k.chestY = k.spineY + k.rChest * 0.18;
        k.headPos = new THREE.Vector3(0, k.chestY + k.rChest * 0.55 + k.rHead * 0.5, k.bodyLen * 0.5 + k.rHead * 0.35);

        // leg hips
        k.hips = [];
        const count = d.legs.count;
        const pairs = count / 2;
        for (let pi = 0; pi < pairs; pi++) {
            const fz = pairs === 1 ? 0.5 : pi / (pairs - 1);
            const z = THREE.MathUtils.lerp(k.bodyLen * 0.38, -k.bodyLen * 0.38, fz);
            const rAt = THREE.MathUtils.lerp(k.rChest, k.rHip, fz);
            for (const side of [-1, 1]) {
                k.hips.push({
                    pos: new THREE.Vector3(side * rAt * 0.62, k.spineY - rAt * 0.28, z),
                    rest: new THREE.Vector3(side * rAt * 0.85, 0, z + k.legLen * 0.05),
                    side, front: fz < 0.5,
                });
            }
        }
    }

    // ---- part list -------------------------------------------------------------
    #buildParts() {
        const d = this.dna, k = this.skel;
        const [cMain, cLight, cDark] = d.palette.map(h => new THREE.Color(h));
        const parts = this.parts = [];
        const add = (role, color, quality, data = {}) =>
            parts.push({ role, color, quality, ...data, a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0.1, rb: 0.1 });

        add('body', cMain, 'big');
        add('belly', cLight, 'mid');
        add('head', cMain, 'big');
        if (d.head.snout > 0) add('snout', cLight, 'small');

        // ears / antennae
        if (d.ears.type === 'bunny') {
            for (const side of [-1, 1]) {
                add('earA', cMain, 'small', { side });
                add('earB', cLight, 'small', { side });
            }
            this.earChains = [-1, 1].map(() => new VerletChain(2, d.ears.length * k.s * 0.5, 14, -1.2));
        } else if (d.ears.type === 'antenna') {
            for (const side of [-1, 1]) add('antenna', cDark, 'small', { side });
            this.earChains = null;
        } else {
            for (const side of [-1, 1]) add('earCat', cDark, 'small', { side });
            this.earChains = null;
        }

        // legs (two segments each)
        this.legIndices = [];
        for (let i = 0; i < d.legs.count; i++) {
            this.legIndices.push(parts.length);
            add('legUpper', cMain, 'small', { leg: i });
            add('legLower', cDark, 'small', { leg: i });
        }
        // dangly flyer feet
        if (d.locomotion === 'fly') {
            for (const side of [-1, 1]) add('flyFoot', cDark, 'small', { side });
        }
        if (d.locomotion === 'hop') {
            for (const side of [-1, 1]) add('hopFoot', cDark, 'small', { side });
        }

        if (d.arms) for (const side of [-1, 1]) add('arm', cMain, 'small', { side });
        if (d.wings) for (const side of [-1, 1]) add('wing', cLight, 'mid', { side });

        if (d.tail.segments > 0) {
            for (let i = 0; i < d.tail.segments; i++) add('tail', i % 2 ? cLight : cMain, 'small', { seg: i });
            this.tailChain = new VerletChain(d.tail.segments, (d.tail.length * k.s) / d.tail.segments, 7, -2.5);
        } else {
            this.tailChain = null;
        }

        if (parts.length > MAX_PARTS) parts.length = MAX_PARTS;
    }

    // ---- meshes ---------------------------------------------------------------
    #buildMeshes(lightDir) {
        const geo = buildGeometry(this.parts);
        const uniforms = {
            uPartA: { value: this.parts.map(() => new THREE.Vector4(0, 0, 0, 0.05)) },
            uPartB: { value: this.parts.map(() => new THREE.Vector4(0, 0.01, 0, 0.05)) },
            uPartColor: { value: this.parts.map(p => p.color) },
            uPartCount: { value: this.parts.length },
            uSmooth: { value: 0.085 * this.skel.s + 0.025 },
            uOutline: { value: 0 },
            uLightDir: { value: lightDir },
            uOutlineColor: { value: new THREE.Color('#12131a') },
        };
        // pad uniform arrays to MAX_PARTS
        while (uniforms.uPartA.value.length < MAX_PARTS) {
            uniforms.uPartA.value.push(new THREE.Vector4(0, -99, 0, 0.01));
            uniforms.uPartB.value.push(new THREE.Vector4(0, -99.01, 0, 0.01));
            uniforms.uPartColor.value.push(new THREE.Color(0, 0, 0));
        }
        this.uniforms = uniforms;

        const bodyMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
        const outlineUniforms = { ...uniforms, uOutline: { value: 0.028 * this.skel.s + 0.012 } };
        const outlineMat = new THREE.ShaderMaterial({
            vertexShader: VERT, fragmentShader: FRAG, uniforms: outlineUniforms, side: THREE.BackSide,
        });

        this.bodyMesh = new THREE.Mesh(geo, bodyMat);
        this.bodyMesh.frustumCulled = false;
        this.outlineMesh = new THREE.Mesh(geo, outlineMat);
        this.outlineMesh.frustumCulled = false;
        this.group.add(this.outlineMesh, this.bodyMesh);

        // invisible picking proxy
        const hitGeo = new THREE.SphereGeometry(Math.max(this.skel.bodyLen, this.skel.rChest * 2.4) * 0.95, 8, 6);
        this.hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
        this.hitMesh.position.y = this.skel.spineY + this.skel.rChest * 0.3;
        this.hitMesh.userData.bot = this;
        this.group.add(this.hitMesh);
    }

    #buildEyes() {
        const k = this.skel, d = this.dna;
        const eyeR = d.eyes.size * k.s;
        const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const black = new THREE.MeshBasicMaterial({ color: 0x14151c });
        this.eyes = [];
        for (const side of [-1, 1]) {
            const eye = new THREE.Group();
            const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 12, 10), white);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.52, 10, 8), black);
            pupil.position.z = eyeR * 0.62;
            eye.add(ball, pupil);
            eye.userData.side = side;
            this.eyes.push(eye);
            this.group.add(eye);
        }
    }

    #buildShadow() {
        const size = Math.max(this.skel.bodyLen, this.skel.rChest * 2) * 1.5;
        const mat = new THREE.MeshBasicMaterial({
            map: getShadowTexture(), transparent: true, depthWrite: false,
        });
        this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.015;
        this.shadow.renderOrder = 1;
    }

    addTo(scene, position) {
        this.home.copy(position);
        this.group.position.copy(position);
        this.group.position.y = 0;
        this.group.scale.setScalar(0.001);
        this.spawnT = 0.0001;
        scene.add(this.group);
        scene.add(this.shadow);
        this.#pickNewTarget();
    }

    removeFrom(scene) {
        scene.remove(this.group);
        scene.remove(this.shadow);
        this.bodyMesh.geometry.dispose();
        this.bodyMesh.material.dispose();
        this.outlineMesh.material.dispose();
        this.hitMesh.geometry.dispose();
    }

    #pickNewTarget() {
        const r = 2.5 + this.rand() * 3.5;
        const a = this.rand() * Math.PI * 2;
        this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
    }

    // ---- per-frame update -------------------------------------------------------
    update(t, dt) {
        const d = this.dna, k = this.skel, p = d.personality;
        this.time += dt;

        // spawn pop
        if (this.spawnT > 0 && this.spawnT < 1) {
            this.spawnT = Math.min(1, this.spawnT + dt * 2.2);
            const e = this.spawnT;
            const scale = e < 1 ? 1 + Math.sin(e * Math.PI * 3) * 0.25 * (1 - e) : 1;
            this.group.scale.setScalar(Math.min(1, e * 1.6) * scale + 0.001);
        }

        this.#updateBehavior(dt);
        this.#updateSquash(dt);
        this.#updateBody();
        this.#updateHeadAndFace(dt);
        this.#updateLimbs();
        this.#updateChains(dt);
        this.#writeUniforms();
        this.#updateShadow();
    }

    #updateBehavior(dt) {
        const d = this.dna, p = this.dna.personality;
        const maxSpeed = (0.55 + p.energy * 0.9) * this.skel.s * (d.locomotion === 'fly' ? 1.3 : 1);

        this.stateTimer -= dt;
        if (this.state === 'idle' && this.stateTimer <= 0) {
            this.state = 'roam';
            this.#pickNewTarget();
            this.stateTimer = 4 + this.rand() * 5;
        } else if (this.state === 'roam') {
            const toTarget = new THREE.Vector3().subVectors(this.target, this.group.position);
            toTarget.y = 0;
            const dist = toTarget.length();
            if (dist < 0.3 || this.stateTimer <= 0) {
                this.state = 'idle';
                this.stateTimer = 0.8 + this.rand() * 2.5 * (1.2 - p.energy);
            } else {
                const targetYaw = Math.atan2(toTarget.x, toTarget.z);
                let dy = targetYaw - this.yaw;
                while (dy > Math.PI) dy -= Math.PI * 2;
                while (dy < -Math.PI) dy += Math.PI * 2;
                this.yaw += THREE.MathUtils.clamp(dy, -2.2 * dt, 2.2 * dt);
            }
        }

        const wantSpeed = this.state === 'roam' ? maxSpeed : 0;

        if (d.locomotion === 'hop') {
            // hoppers only move while airborne
            if (this.hopT < 0 && wantSpeed > 0) {
                this.hopT = 0;
                this.squashVel -= 3.5; // anticipation dip handled by spring
            }
            if (this.hopT >= 0) {
                const hopDur = 0.55 - this.dna.personality.energy * 0.15;
                this.hopT += dt / hopDur;
                if (this.hopT >= 1) {
                    this.hopT = wantSpeed > 0 ? 0 : -1;
                    this.squashVel -= 4.5; // landing squash
                }
                const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
                this.group.position.addScaledVector(fwd, wantSpeed * 1.5 * dt);
            }
            this.speed = this.hopT >= 0 ? wantSpeed : 0;
            this.moveBlend = THREE.MathUtils.damp(this.moveBlend, this.speed > 0.01 ? 1 : 0, 6, dt);
        } else {
            this.speed = THREE.MathUtils.damp(this.speed, wantSpeed, 4, dt);
            this.moveBlend = THREE.MathUtils.damp(this.moveBlend, this.speed > 0.05 ? 1 : 0, 6, dt);
            const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            this.group.position.addScaledVector(fwd, this.speed * dt);
            const stride = this.skel.legLen * 1.35 + 0.2;
            this.walkPhase += (this.speed / stride) * dt + this.moveBlend * dt * 0.1;
        }

        this.group.rotation.y = this.yaw;

        // vertical placement
        if (d.locomotion === 'fly') {
            const bob = Math.sin(this.time * 2.2) * 0.08 + Math.sin(this.time * 3.7) * 0.04;
            this.group.position.y = this.skel.hover + bob;
        } else if (d.locomotion === 'hop') {
            const h = this.hopT >= 0 ? Math.max(0, 4 * this.hopT * (1 - this.hopT)) * this.skel.s * 0.55 : 0;
            this.group.position.y = h;
        } else {
            this.group.position.y = 0;
        }
    }

    #updateSquash(dt) {
        // springy squash & stretch (hop landings, spawn, idle breathing)
        const target = this.hopT >= 0 && this.dna.locomotion === 'hop'
            ? 1 + Math.sin(Math.min(this.hopT, 1) * Math.PI) * 0.18
            : 1;
        const springK = 90, dampK = 11;
        const accel = (target - this.squash) * springK - this.squashVel * dampK;
        this.squashVel += accel * Math.min(dt, 0.033);
        this.squash += this.squashVel * Math.min(dt, 0.033);
        this.squash = THREE.MathUtils.clamp(this.squash, 0.6, 1.5);
    }

    #updateBody() {
        const k = this.skel, d = this.dna;
        const breathe = 1 + Math.sin(this.time * 2.1) * 0.018;
        const bob = d.locomotion === 'walk'
            ? Math.abs(Math.sin(this.walkPhase * Math.PI * 2)) * k.legLen * 0.06 * this.moveBlend
            : 0;

        const body = this.parts[0];
        body.a.set(0, k.spineY + bob, -k.bodyLen * 0.5);
        body.b.set(0, k.chestY + bob, k.bodyLen * 0.5);
        body.ra = k.rHip * breathe;
        body.rb = k.rChest * breathe;

        const belly = this.parts[1];
        belly.a.set(0, k.spineY - k.rHip * 0.32 + bob, -k.bodyLen * 0.18);
        belly.b.set(0, k.spineY - k.rChest * 0.28 + bob, k.bodyLen * 0.22);
        belly.ra = k.rHip * 0.72 * breathe;
        belly.rb = k.rChest * 0.7 * breathe;

        this.bodyBob = bob;
    }

    #updateHeadAndFace(dt) {
        const k = this.skel, d = this.dna;
        const head = this.parts.find(p => p.role === 'head');
        const tilt = Math.sin(this.time * 1.3) * 0.04;
        const headY = k.headPos.y + this.bodyBob * 1.1 + Math.sin(this.time * 2.1 + 1) * 0.012 * k.s;
        head.a.set(0, headY, k.headPos.z);
        head.b.set(0, headY + 0.01, k.headPos.z + tilt * 0.1);
        head.ra = head.rb = k.rHead;
        this.headCenter = new THREE.Vector3(0, headY, k.headPos.z);

        const snout = this.parts.find(p => p.role === 'snout');
        if (snout) {
            const sr = d.head.snout * k.s;
            snout.a.set(0, headY - k.rHead * 0.18, k.headPos.z + k.rHead * 0.72);
            snout.b.set(0, headY - k.rHead * 0.16, k.headPos.z + k.rHead * 0.72 + sr * 0.6);
            snout.ra = sr * 1.15;
            snout.rb = sr;
        }

        // cat ears / antennae (bunny ears handled by chains)
        for (const part of this.parts) {
            if (part.role === 'earCat') {
                const s = part.side;
                const base = new THREE.Vector3(s * k.rHead * 0.55, headY + k.rHead * 0.72, k.headPos.z - k.rHead * 0.1);
                const wiggle = Math.sin(this.time * 3 + s) * 0.03;
                part.a.copy(base);
                part.b.set(base.x + s * (0.12 * k.s + wiggle), base.y + d.ears.length * k.s, base.z - 0.05 * k.s);
                part.ra = k.rHead * 0.3;
                part.rb = k.rHead * 0.1;
            } else if (part.role === 'antenna') {
                const s = part.side;
                const sway = Math.sin(this.time * 2.4 + s * 1.7) * 0.08 * k.s;
                const base = new THREE.Vector3(s * k.rHead * 0.4, headY + k.rHead * 0.8, k.headPos.z);
                part.a.copy(base);
                part.b.set(base.x + s * 0.06 * k.s + sway, base.y + d.ears.length * k.s * 1.1, base.z + sway * 0.5);
                part.ra = 0.028 * k.s;
                part.rb = 0.06 * k.s; // bulb tip
            }
        }

        // eyes
        this.blinkT -= dt;
        if (this.blinkT <= 0) { this.blinkPhase = 0.16; this.blinkT = 1.8 + this.rand() * 4; }
        this.blinkPhase = Math.max(0, this.blinkPhase - dt);
        const blink = this.blinkPhase > 0 ? 0.08 : 1;
        const eyeR = d.eyes.size * k.s;
        for (const eye of this.eyes) {
            const s = eye.userData.side;
            const local = new THREE.Vector3(s * d.eyes.spacing * k.rHead, this.headCenter.y + k.rHead * 0.16, this.headCenter.z + k.rHead * 0.55);
            const dir = local.clone().sub(this.headCenter).normalize();
            eye.position.copy(this.headCenter).addScaledVector(dir, k.rHead * 0.98);
            eye.lookAt(this.group.localToWorld(eye.position.clone().add(dir)));
            eye.scale.set(1, blink, 1);
        }
    }

    #updateLimbs() {
        const k = this.skel, d = this.dna;

        // legs with two-bone IK
        if (d.legs.count > 0) {
            const phases = LEG_PHASES[d.legs.count] || LEG_PHASES[4];
            const stepLift = k.legLen * 0.32;
            const strideAmp = k.legLen * 0.38;
            const l1 = k.legLen * 0.56, l2 = k.legLen * 0.58;

            for (let i = 0; i < d.legs.count; i++) {
                const hip = k.hips[i];
                const ph = (this.walkPhase + phases[i]) * Math.PI * 2;
                const swing = Math.max(0, Math.sin(ph));

                const foot = new THREE.Vector3(
                    hip.rest.x,
                    k.legThick * 0.9 + swing * stepLift * this.moveBlend,
                    hip.rest.z + Math.cos(ph) * strideAmp * this.moveBlend
                );
                const hipPos = hip.pos.clone();
                hipPos.y += this.bodyBob;

                // 2-bone IK
                const toFoot = foot.clone().sub(hipPos);
                const dist = THREE.MathUtils.clamp(toFoot.length(), 0.15 * k.legLen, (l1 + l2) * 0.985);
                toFoot.normalize();
                const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
                const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
                // knees bend backward for front legs, forward for rear (quadruped feel);
                // 2-legged bots bend knees forward
                const bendSign = d.legs.count === 2 ? 1 : (hip.front ? -1 : 1);
                let bend = new THREE.Vector3(0, 0, bendSign);
                bend.addScaledVector(toFoot, -bend.dot(toFoot));
                if (bend.lengthSq() < 1e-6) bend.set(0, 0, bendSign);
                bend.normalize();
                const knee = hipPos.clone().addScaledVector(toFoot, a).addScaledVector(bend, h);

                const upper = this.parts[this.legIndices[i]];
                const lower = this.parts[this.legIndices[i] + 1];
                upper.a.copy(hipPos); upper.b.copy(knee);
                upper.ra = k.legThick * 1.25; upper.rb = k.legThick * 0.85;
                lower.a.copy(knee); lower.b.copy(foot);
                lower.ra = k.legThick * 0.85; lower.rb = k.legThick * 1.15; // chunky paw
            }
        }

        // dangly flyer feet / hopper feet nubs
        for (const part of this.parts) {
            if (part.role === 'flyFoot') {
                const s = part.side;
                const dangle = Math.sin(this.time * 3.1 + s) * 0.05 * k.s;
                part.a.set(s * k.rHip * 0.42, k.spineY - k.rHip * 0.7, -k.bodyLen * 0.15 + dangle);
                part.b.set(s * k.rHip * 0.45, k.spineY - k.rHip * 0.7 - k.legLen * 0.5, -k.bodyLen * 0.18 + dangle * 1.5);
                part.ra = k.legThick * 0.9;
                part.rb = k.legThick * 1.1;
            } else if (part.role === 'hopFoot') {
                const s = part.side;
                part.a.set(s * k.rHip * 0.55, k.rHip * 0.28, k.bodyLen * 0.22);
                part.b.set(s * k.rHip * 0.6, k.rHip * 0.22, k.bodyLen * 0.22 + k.rHip * 0.55);
                part.ra = k.rHip * 0.26;
                part.rb = k.rHip * 0.3;
            } else if (part.role === 'arm') {
                const s = part.side;
                const armLen = k.legLen * 0.55 + k.rChest * 0.4;
                const shoulder = new THREE.Vector3(s * k.rChest * 0.82, k.chestY + k.rChest * 0.25 + this.bodyBob, k.bodyLen * 0.3);
                const ph = (this.walkPhase + (s < 0 ? 0.5 : 0)) * Math.PI * 2;
                const swing = Math.sin(ph) * 0.45 * this.moveBlend + Math.sin(this.time * 1.7 + s) * 0.06;
                const flap = this.dna.locomotion === 'fly' ? Math.sin(this.time * 8) * 0.15 : 0;
                part.a.copy(shoulder);
                part.b.set(
                    shoulder.x + s * (k.rChest * 0.3 + flap * k.s),
                    shoulder.y - armLen * (0.85 - Math.abs(swing) * 0.15),
                    shoulder.z + swing * armLen * 0.8
                );
                part.ra = k.legThick * 1.05;
                part.rb = k.legThick * 1.2; // mitten hand
            } else if (part.role === 'wing') {
                const s = part.side;
                const flap = Math.sin(this.time * 9) * 0.85 - 0.15;
                const wingLen = k.bodyLen * 0.75 + k.rChest;
                const shoulder = new THREE.Vector3(s * k.rChest * 0.7, k.chestY + k.rChest * 0.45, k.bodyLen * 0.1);
                part.a.copy(shoulder);
                part.b.set(
                    shoulder.x + s * wingLen * Math.cos(flap * 0.6),
                    shoulder.y + wingLen * Math.sin(flap) * 0.75,
                    shoulder.z - wingLen * 0.15
                );
                part.ra = k.rChest * 0.34;
                part.rb = k.rChest * 0.1;
            }
        }
    }

    // world transforms that ignore group scale, so chain physics stays stable
    // during the spawn-pop scale animation
    #toWorldNoScale(v) {
        return v.applyQuaternion(this.group.quaternion).add(this.group.position);
    }
    #toLocalNoScale(v) {
        return v.sub(this.group.position).applyQuaternion(this._invQuat);
    }

    #updateChains(dt) {
        const k = this.skel, d = this.dna;
        this._invQuat = this.group.quaternion.clone().invert();

        // tail
        if (this.tailChain) {
            const baseLocal = new THREE.Vector3(0, k.spineY + this.bodyBob + k.rHip * 0.2, -k.bodyLen * 0.52);
            const anchor = this.#toWorldNoScale(baseLocal.clone());
            const restDir = new THREE.Vector3(0, 0.45, -1).normalize().applyQuaternion(this.group.quaternion);
            this.tailChain.step(dt, anchor, restDir);
            const pts = this.tailChain.points.map(pt => this.#toLocalNoScale(pt.p.clone()));
            let ti = 0;
            for (const part of this.parts) {
                if (part.role !== 'tail') continue;
                part.a.copy(pts[ti]);
                part.b.copy(pts[ti + 1]);
                const f0 = ti / d.tail.segments, f1 = (ti + 1) / d.tail.segments;
                part.ra = d.tail.thick * k.s * (1.4 - f0 * 0.9);
                part.rb = d.tail.thick * k.s * (1.4 - f1 * 0.9);
                ti++;
            }
        }

        // bunny ears
        if (this.earChains) {
            let ci = 0;
            for (const side of [-1, 1]) {
                const baseLocal = new THREE.Vector3(side * k.rHead * 0.42, this.headCenter.y + k.rHead * 0.8, this.headCenter.z - k.rHead * 0.05);
                const anchor = this.#toWorldNoScale(baseLocal.clone());
                const restDir = new THREE.Vector3(side * 0.22, 1, -0.12).normalize().applyQuaternion(this.group.quaternion);
                const chain = this.earChains[ci];
                chain.step(dt, anchor, restDir);
                const pts = chain.points.map(pt => this.#toLocalNoScale(pt.p.clone()));
                const earParts = this.parts.filter(p => (p.role === 'earA' || p.role === 'earB') && p.side === side);
                for (let i = 0; i < earParts.length && i + 1 < pts.length; i++) {
                    earParts[i].a.copy(pts[i]);
                    earParts[i].b.copy(pts[i + 1]);
                    earParts[i].ra = k.rHead * (0.34 - i * 0.1);
                    earParts[i].rb = k.rHead * (0.24 - i * 0.1);
                }
                ci++;
            }
        }
    }

    #writeUniforms() {
        const A = this.uniforms.uPartA.value;
        const B = this.uniforms.uPartB.value;
        const sq = this.squash;
        const sxz = 1 / Math.sqrt(Math.max(sq, 0.01));
        for (let i = 0; i < this.parts.length; i++) {
            const p = this.parts[i];
            A[i].set(p.a.x * sxz, p.a.y * sq, p.a.z * sxz, p.ra * sxz);
            B[i].set(p.b.x * sxz, p.b.y * sq + 0.0001, p.b.z * sxz, p.rb * sxz);
        }
        // eyes/head follow squash too
        for (const eye of this.eyes) {
            eye.position.x *= sxz; eye.position.y *= sq; eye.position.z *= sxz;
        }
    }

    #updateShadow() {
        this.shadow.position.x = this.group.position.x;
        this.shadow.position.z = this.group.position.z;
        const h = this.group.position.y;
        const fade = THREE.MathUtils.clamp(1 - h / (2.2 * this.skel.s + 0.5), 0.15, 0.85);
        this.shadow.material.opacity = fade;
        const spread = 1 + h * 0.25;
        this.shadow.scale.setScalar(this.group.scale.x * spread);
    }
}
