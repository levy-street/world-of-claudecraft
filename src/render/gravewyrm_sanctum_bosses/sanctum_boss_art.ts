// The Gravewyrm Sanctum bosses' shaders and procedural geometry: the plate
// overlays (sound ice, the glowing fracture web with its closing frost ring,
// open quench-water with drifting floes), the meltwater (trench strips and warm
// puddles), the Unquenched bubble ring, the landing shadow, the shock rings,
// Korgath's chain links, the Held statue's ice, the Wyrm's Eye. Every material
// here is built ONCE by SanctumBossFx's constructor under its root, before its
// gated attach (src/render/CLAUDE.md, "GPU work"). Unlit shader materials
// only: no light, no lit program.

import * as THREE from 'three';

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
// Voronoi: x the nearest cell distance, y the edge distance (F2 - F1), z the cell id.
vec3 voronoi(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0; float id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(n + g);
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; id = h21(n + g); } else if (d < f2) { f2 = d; }
  }
  return vec3(f1, f2 - f1, id);
}
`;

const DISC_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ---- the plates -------------------------------------------------------------------

const PLATE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uState;     // 0 sound, 1 cracked, 2 broken
uniform float uRefreeze;  // cracked: share of the refreeze still to go (-1 never)
uniform float uFlash;     // a burn coming (breath, plunging fire, the eye's plate)
uniform float uSink;      // 0..1 the plate tipping under (render only)
uniform float uShock;     // 0..1 his landing cracking through it (render only, fades)
uniform float uSeed;
uniform float uDetail;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  float ang = atan(vP.y, vP.x);
  float edge = 0.94 + 0.06 * vnoise(vec2(ang * 3.0 + uSeed, uSeed));
  float inside = 1.0 - smoothstep(edge - 0.03, edge, r);
  if (inside <= 0.001) discard;
  vec3 col = vec3(0.0);
  float a = 0.0;
  vec2 q = vP * 3.2 + uSeed * 7.0;
  if (uState < 0.5) {
    // Sound ice: only a cold sheen at the seam, so the shore reads the floe.
    float rim = smoothstep(edge - 0.12, edge - 0.02, r);
    col = vec3(0.86, 0.95, 1.0) * (0.25 + 0.5 * rim);
    a = 0.06 + 0.22 * rim * uDetail;
  } else if (uState < 1.5) {
    // Cracked: a glowing fracture web, hottest at the heart.
    vec3 v = voronoi(q);
    vec3 v2 = voronoi(q * 2.3 + 3.1);
    float crack = 1.0 - smoothstep(0.0, 0.07, v.y);
    float fine = (1.0 - smoothstep(0.0, 0.05, v2.y)) * 0.55;
    float web = max(crack, fine);
    float pulse = 0.75 + 0.25 * sin(uTime * 3.2 + v.z * 9.0);
    vec3 hot = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.82, 0.45), crack);
    col = vec3(0.92, 0.95, 1.0) * 0.18 + hot * web * 2.4 * pulse;
    a = 0.28 + 0.65 * web;
    // The refreeze: frost creeping in from the edge, its front a bright ring.
    if (uRefreeze >= 0.0) {
      float front = uRefreeze * edge;
      float frosted = smoothstep(front - 0.015, front + 0.015, r);
      float frontLine = 1.0 - smoothstep(0.0, 0.035, abs(r - front));
      float rime = 0.6 + 0.4 * vnoise(vP * 14.0 + uSeed);
      col = mix(col, vec3(0.88, 0.96, 1.0) * rime, frosted * 0.85);
      a = mix(a, 0.55, frosted);
      col += vec3(0.55, 0.85, 1.0) * frontLine * 1.6;
      a = max(a, frontLine * 0.9);
    }
  } else {
    // Broken: open quench-water, black and steaming, floes drifting in it.
    vec2 drift = vec2(sin(uTime * 0.11 + uSeed), cos(uTime * 0.09 + uSeed)) * 0.35;
    vec3 v = voronoi(vP * 2.6 + drift + uSeed * 3.0);
    float floe = step(0.62, v.z) * smoothstep(0.02, 0.09, v.y) * (1.0 - smoothstep(0.32, 0.42, v.x));
    float ripple = 0.5 + 0.5 * sin(r * 26.0 - uTime * 2.2 + vnoise(vP * 5.0) * 4.0);
    vec3 water = vec3(0.02, 0.05, 0.08) + vec3(0.05, 0.12, 0.16) * ripple * 0.5;
    float foam = smoothstep(edge - 0.08, edge - 0.01, r) * (0.6 + 0.4 * vnoise(vec2(ang * 9.0, uTime)));
    vec3 ice = vec3(0.8, 0.9, 0.96) * (0.7 + 0.3 * vnoise(vP * 11.0));
    col = mix(water, ice, floe * (1.0 - uSink * 0.0)) + vec3(0.75, 0.85, 0.9) * foam * 0.6;
    a = 0.94 * uSink + 0.0;
    a = max(a, floe * uSink);
    // The plate tipping under: the cracks flare and go dark as the water takes it.
    vec3 vv = voronoi(q);
    float tip = (1.0 - uSink) * (1.0 - smoothstep(0.0, 0.08, vv.y));
    col += vec3(1.0, 0.45, 0.1) * tip * 2.0;
    a = max(a, tip);
  }
  if (uShock > 0.0) {
    // A white fracture web racing through the ice, gone as it settles: the
    // weight of him, never a state (the plate stays what the sim says).
    vec3 sv = voronoi(q * 1.4 + 1.7);
    float web = 1.0 - smoothstep(0.0, 0.06, sv.y);
    col += vec3(0.75, 0.92, 1.0) * web * uShock * 1.8;
    a = max(a, web * uShock * 0.85);
  }
  if (uFlash > 0.0) {
    float beat = 0.6 + 0.4 * sin(uTime * 12.0);
    col += vec3(1.0, 0.42, 0.08) * uFlash * beat * (0.5 + 0.5 * smoothstep(0.2, edge, r));
    a = max(a, uFlash * 0.55 * beat);
  }
  gl_FragColor = vec4(col, a * inside);
}
`;

export function plateMaterial(uTime: { value: number }, seed: number, detail: boolean) {
  return new THREE.ShaderMaterial({
    name: 'sanctumPlate',
    uniforms: {
      uTime,
      uState: { value: 0 },
      uRefreeze: { value: -1 },
      uFlash: { value: 0 },
      uSink: { value: 1 },
      uShock: { value: 0 },
      uSeed: { value: seed },
      uDetail: { value: detail ? 1 : 0.5 },
    },
    vertexShader: DISC_VERT,
    fragmentShader: PLATE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---- meltwater (the trench strips, the warm puddles, the pools' rim) ------------

const MELT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uCircle;    // 1: a round puddle (radius 1); 0: a strip (x -0.5..0.5, z 0..1)
uniform float uLength;    // a strip's length in yards (for the ripple scale)
uniform vec3 uRim;
uniform float uSeed;
varying vec2 vP;
${NOISE}
void main() {
  float edgeD;
  vec2 w;
  if (uCircle > 0.5) {
    float r = length(vP);
    float wob = 0.92 + 0.08 * vnoise(vec2(atan(vP.y, vP.x) * 3.0, uSeed));
    edgeD = wob - r;
    w = vP * 3.0;
  } else {
    float across = 0.5 - abs(vP.x);
    float ends = min(vP.y, 1.0 - vP.y) * uLength * 0.25;
    edgeD = min(across * (0.9 + 0.2 * vnoise(vec2(vP.y * uLength * 0.6, uSeed))), ends);
    w = vec2(vP.x * 4.0, vP.y * uLength);
  }
  if (edgeD <= 0.0) discard;
  float n = vnoise(w * 1.3 + vec2(0.0, -uTime * 0.6)) * 0.6 + vnoise(w * 3.1 - uTime * 0.4) * 0.4;
  vec3 water = vec3(0.015, 0.03, 0.05) + vec3(0.06, 0.1, 0.14) * n * 0.6;
  float rim = 1.0 - smoothstep(0.0, 0.09, edgeD);
  float glint = smoothstep(0.75, 0.95, n) * 0.4;
  vec3 col = water + uRim * rim * (1.4 + 0.6 * sin(uTime * 2.5 + w.y)) + vec3(0.6, 0.8, 0.9) * glint;
  float a = (0.9 * smoothstep(0.0, 0.03, edgeD) + rim * 0.6) * uAlpha;
  gl_FragColor = vec4(col, min(1.0, a));
}
`;

export function meltMaterial(uTime: { value: number }, circle: boolean, rim: number, seed: number) {
  return new THREE.ShaderMaterial({
    name: 'sanctumMeltwater',
    uniforms: {
      uTime,
      uAlpha: { value: 0 },
      uCircle: { value: circle ? 1 : 0 },
      uLength: { value: 10 },
      uRim: { value: new THREE.Color(rim) },
      uSeed: { value: seed },
    },
    vertexShader: DISC_VERT,
    fragmentShader: MELT_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---- rings: shock rings, the Unquenched bubbles, the pools' flare ---------------

const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uWidth;     // the ring's band width (share of the radius)
uniform float uBubbles;   // 1: a ring of rising bubbles over dark water
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float band = 1.0 - smoothstep(0.0, uWidth, abs(r - (1.0 - uWidth)));
  float inner = (1.0 - smoothstep(0.0, 1.0 - uWidth, r)) * 0.25;
  vec3 col = uColor * (band * 1.8 + inner);
  float a = band + inner;
  if (uBubbles > 0.5) {
    float ang = atan(vP.y, vP.x);
    float pops = step(0.72, vnoise(vec2(ang * 12.0, uTime * 3.0))) * band;
    vec3 hole = vec3(0.01, 0.02, 0.03);
    col = mix(hole, uColor * 1.6, band) + vec3(0.9) * pops;
    a = (1.0 - smoothstep(0.85, 1.0, r)) * 0.9 + pops * 0.5;
  }
  gl_FragColor = vec4(col, a * uAlpha);
}
`;

export function ringMaterial(additive: boolean) {
  return new THREE.ShaderMaterial({
    name: 'sanctumRing',
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
      uWidth: { value: 0.12 },
      uBubbles: { value: 0 },
    },
    vertexShader: DISC_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---- the landing shadow -----------------------------------------------------------

const SHADOW_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec2 vP;
void main() {
  // A wyrm's shape, not a dot: the body long along z, the wings wide across.
  vec2 p = vP;
  float body = length(p * vec2(2.6, 1.0));
  float wings = length(p * vec2(1.0, 3.2));
  float d = min(body, wings);
  float a = (1.0 - smoothstep(0.55, 1.0, d)) * uAlpha * (0.88 + 0.12 * sin(uTime * 4.0));
  gl_FragColor = vec4(vec3(0.0, 0.0, 0.02), a);
}
`;

export function shadowMaterial(uTime: { value: number }) {
  return new THREE.ShaderMaterial({
    name: 'sanctumLandingShadow',
    uniforms: { uAlpha: { value: 0 }, uTime },
    vertexShader: DISC_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---- Korgath's chains ---------------------------------------------------------------

const CHAIN_VERT = /* glsl */ `
attribute float aAlong;
attribute float aAround;
varying float vAlong;
varying float vAround;
void main() {
  vAlong = aAlong;
  vAround = aAround;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CHAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;      // straining: the Smith's runes burn along the links
uniform float uLength;    // yards
uniform float uFlash;     // a re-rivet or a break flash
varying float vAlong;
varying float vAround;
void main() {
  // Links: alternate faces every half yard, each a dark iron oval with a rime cap.
  float s = vAlong * uLength / 0.55;
  float link = fract(s);
  float face = mod(floor(s), 2.0);
  float oval = 1.0 - smoothstep(0.32, 0.48, abs(link - 0.5));
  float hole = 1.0 - smoothstep(0.1, 0.2, abs(link - 0.5));
  float lit = 0.55 + 0.45 * cos(vAround * 6.2831 + face * 1.57);
  vec3 iron = vec3(0.16, 0.17, 0.19) * (0.5 + 0.9 * lit) * (0.6 + 0.4 * oval);
  float rime = smoothstep(0.55, 0.95, lit) * 0.55;
  vec3 col = mix(iron, vec3(0.86, 0.94, 1.0), rime);
  col *= mix(1.0, 0.45, hole * (1.0 - face));
  float rune = (0.5 + 0.5 * sin(uTime * 9.0 - s * 0.9)) * uGlow;
  col += vec3(0.35, 0.75, 1.0) * (rune * 1.8 + uGlow * 0.4) + vec3(0.9, 0.97, 1.0) * uFlash * 2.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const CHAIN_SEGMENTS = 28;
export const CHAIN_SIDES = 6;

/** A chain's tube: (segments + 1) rings of `sides` vertices, written per frame. */
export function chainGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (CHAIN_SEGMENTS + 1) * CHAIN_SIDES;
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const along = new Float32Array(n);
  const around = new Float32Array(n);
  for (let i = 0; i <= CHAIN_SEGMENTS; i++)
    for (let k = 0; k < CHAIN_SIDES; k++) {
      along[i * CHAIN_SIDES + k] = i / CHAIN_SEGMENTS;
      around[i * CHAIN_SIDES + k] = k / CHAIN_SIDES;
    }
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setAttribute('aAround', new THREE.BufferAttribute(around, 1));
  const index: number[] = [];
  for (let i = 0; i < CHAIN_SEGMENTS; i++)
    for (let k = 0; k < CHAIN_SIDES; k++) {
      const a = i * CHAIN_SIDES + k;
      const b = i * CHAIN_SIDES + ((k + 1) % CHAIN_SIDES);
      index.push(a, a + CHAIN_SIDES, b, b, a + CHAIN_SIDES, b + CHAIN_SIDES);
    }
  g.setIndex(index);
  return g;
}

export function chainMaterial(uTime: { value: number }) {
  return new THREE.ShaderMaterial({
    name: 'sanctumSealChain',
    uniforms: {
      uTime,
      uGlow: { value: 0 },
      uLength: { value: 10 },
      uFlash: { value: 0 },
    },
    vertexShader: CHAIN_VERT,
    fragmentShader: CHAIN_FRAG,
  });
}

// ---- the Held statue's ice ----------------------------------------------------------

const ICE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const ICE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.0);
  float top = 0.5 + 0.5 * normalize(vN).y;
  vec3 col = uTint * (0.35 + 0.4 * top) + vec3(0.85, 0.95, 1.0) * f * 1.3;
  gl_FragColor = vec4(col, (0.62 + 0.38 * f) * uAlpha);
}
`;

export function iceMaterial(tint: number) {
  return new THREE.ShaderMaterial({
    name: 'sanctumHeldIce',
    uniforms: { uAlpha: { value: 1 }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: ICE_VERT,
    fragmentShader: ICE_FRAG,
    transparent: true,
    depthWrite: true,
  });
}

/** A rimed figure frozen where it fell: a cluster of ice spars round a
 *  hunched core, about a man high (unit: yards). */
export function heldStatueGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const core = new THREE.IcosahedronGeometry(0.75, 0).scale(0.9, 1.5, 0.8).translate(0, 1.0, 0);
  parts.push(core);
  const spars = [
    [0.55, 0.0, 0.2, 1.7, 0.3],
    [-0.5, 0.1, -0.1, 1.5, -0.35],
    [0.1, -0.5, 0.25, 1.3, 0.15],
    [-0.15, 0.5, 0.2, 1.9, -0.1],
    [0.35, 0.35, 0.16, 2.2, 0.25],
  ];
  for (const [x, z, w, h, lean] of spars) {
    const g = new THREE.OctahedronGeometry(1, 0).scale(w, h * 0.5, w);
    g.rotateZ(lean);
    g.translate(x, h * 0.45, z);
    parts.push(g);
  }
  // Merge by hand (no BufferGeometryUtils import for one mesh).
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const np = p.toNonIndexed();
    np.computeVertexNormals();
    pos.set(np.getAttribute('position').array as Float32Array, o * 3);
    nor.set(np.getAttribute('normal').array as Float32Array, o * 3);
    o += np.getAttribute('position').count;
    np.dispose();
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, o * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, o * 3), 3));
  return g;
}

// ---- the Wyrm's Eye ------------------------------------------------------------------

/** The burning eye over a marked player's head (a canvas painted once). */
export function wyrmEyeTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const glow = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,240,190,1)');
  glow.addColorStop(0.35, 'rgba(255,150,40,0.9)');
  glow.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  // The lids: a sharp almond.
  g.beginPath();
  g.moveTo(10, 64);
  g.quadraticCurveTo(64, 14, 118, 64);
  g.quadraticCurveTo(64, 114, 10, 64);
  g.closePath();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,220,140,1)';
  g.stroke();
  const iris = g.createRadialGradient(64, 64, 2, 64, 64, 30);
  iris.addColorStop(0, 'rgba(255,255,230,1)');
  iris.addColorStop(0.5, 'rgba(255,170,40,1)');
  iris.addColorStop(1, 'rgba(160,30,0,1)');
  g.fillStyle = iris;
  g.beginPath();
  g.arc(64, 64, 28, 0, Math.PI * 2);
  g.fill();
  // The slit pupil.
  g.fillStyle = 'rgba(20,0,0,1)';
  g.beginPath();
  g.ellipse(64, 64, 5, 24, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Korzul's fire: the flame atlas through a rose-gold to ember ramp (the crypt
 *  particle kit's fire shader with the wyrm's own ramp). */
export function wyrmFireFrag(ghostFireFrag: string, ghostRampGlsl: string): string {
  const ramp = /* glsl */ `
vec3 wyrmRamp(float h) {
  vec3 c = mix(vec3(0.0), vec3(0.35, 0.05, 0.01), smoothstep(0.0, 0.2, h));
  c = mix(c, vec3(1.0, 0.32, 0.05), smoothstep(0.2, 0.5, h));
  c = mix(c, vec3(1.0, 0.7, 0.32), smoothstep(0.5, 0.8, h));
  c = mix(c, vec3(1.0, 0.95, 0.82), smoothstep(0.8, 0.98, h));
  return c;
}
`;
  return ghostFireFrag
    .replace(ghostRampGlsl, `${ghostRampGlsl}\n${ramp}`)
    .replace('ghostRamp(clamp(body * heat', 'wyrmRamp(clamp(body * heat');
}

// ---- the Seal Shackles (the sim's stationary parts are drawn bodyless) ---------------

const IRON_FRAG = /* glsl */ `
uniform vec3 uRune;
uniform float uRuneOn;
uniform float uBroken;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
void main() {
  vec3 n = normalize(vN);
  float key = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.8, 0.3))), 0.0);
  float rim = pow(max(1.0 - abs(dot(n, normalize(vV))), 0.0), 3.0);
  vec3 iron = vec3(0.13, 0.135, 0.15) * key + vec3(0.75, 0.88, 1.0) * rim * 0.35;
  // Rime on the top faces.
  iron = mix(iron, vec3(0.82, 0.92, 1.0), smoothstep(0.55, 0.95, n.y) * 0.45);
  // The Smith's runes cut round the cuff: bands that burn the shackle's colour.
  float band = step(0.82, fract(vL.y * 2.2 + vL.x * 1.1)) * (1.0 - uBroken);
  vec3 col = iron + uRune * band * uRuneOn * 2.2;
  gl_FragColor = vec4(col, 1.0);
}
`;
const IRON_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vL = position;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

export function ironMaterial() {
  return new THREE.ShaderMaterial({
    name: 'sanctumSealShackle',
    uniforms: {
      uRune: { value: new THREE.Color(0x6cc8ff) },
      uRuneOn: { value: 1 },
      uBroken: { value: 0 },
    },
    vertexShader: IRON_VERT,
    fragmentShader: IRON_FRAG,
  });
}

/** A Seal Shackle: an iron cuff standing on its anchor block, its ring facing
 *  +z (toward Korgath), about a man high (yards). `open`: the cuff sundered. */
export function shackleGeometry(open: boolean): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(0.85, 0.24, 8, 22, open ? Math.PI * 1.45 : Math.PI * 2);
  if (open) ring.rotateZ(Math.PI * 0.8);
  ring.translate(0, 1.55, 0);
  const block = new THREE.BoxGeometry(1.7, 0.75, 1.3).translate(0, 0.375, 0);
  const bolt = new THREE.CylinderGeometry(0.22, 0.28, 0.6, 8).translate(0, 0.95, 0);
  const parts = [ring, block, bolt];
  let count = 0;
  const flat = parts.map((p) => {
    const np = p.toNonIndexed();
    np.computeVertexNormals();
    count += np.getAttribute('position').count;
    p.dispose();
    return np;
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const np of flat) {
    pos.set(np.getAttribute('position').array as Float32Array, o * 3);
    nor.set(np.getAttribute('normal').array as Float32Array, o * 3);
    o += np.getAttribute('position').count;
    np.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
