// The shared soak marker's painter (the plan: soak_marker_core.ts): one flat
// disc (the vortex, the rim, the converging rings, the inward chevrons, the
// soakers' pips and an optional countdown arc: one draw, one program) and one
// ribbon mesh of thin wisps spiralling up out of it (one draw, one program,
// additive). Built once by its OWNER under the owner's gated root (no GPU work
// after boot), no light, no texture, no per-frame allocation. The disc's rim
// is the sim's radius; nothing on the floor draws outside it. Every tier draws
// the disc whole; only the wisps' count follows the tier's detail. Reduced
// motion holds every motion still.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { FLOOR_TELL_PIPS } from './floor_tell_core';
import {
  newSoakMarkerLook,
  SOAK_CHARACTER,
  SOAK_MARKER,
  SOAK_PALETTES,
  type SoakElement,
  soakFlicker,
  soakMarkerLook,
  soakMarkerStage,
  soakTimerLeft,
  soakWispCount,
  soakWispHeight,
} from './soak_marker_core';

const DISC_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The ripples mirror soak_marker_core.ts soakRipple; the pips mirror
 *  floor_tell.ts (one per needed soaker, lit one per player inside). */
const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSpin;
uniform float uBloom;
uniform float uAlpha;
uniform float uFlare;
uniform float uNeed;
uniform float uLit;
uniform float uPipAt;
uniform float uPipSize;
uniform float uRimOn;
uniform float uTimer;
uniform float uRadius;
uniform float uRipEvery;
uniform float uRipTo;
uniform vec4 uChar;
uniform vec2 uChar2;
uniform float uDetail;
uniform float uFlick;
uniform float uInfo;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uBright;
uniform vec3 uHot;
varying vec2 vXZ;

float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  float r = length(vXZ);
  // The disc is the unit circle: no discard (it would cost early depth).
  r = min(r, 1.0);
  float aa = fwidth(r) * 1.5 + 0.003;
  float spd = uChar2.y;
  float spin = uSpin * spd;
  float time = uTime * spd;
  float th = atan(vXZ.x, vXZ.y);
  float t = fract(th / 6.2831853 + 0.5);
  // The bloom: a newborn vortex spreads out from the middle, a dying one is
  // drawn back into it.
  float rb = r / max(uBloom, 0.05);
  float spread = 1.0 - smoothstep(0.9, 1.05, rb);
  // Two counter-rotating layers: the inner turns faster than the rim (a
  // vortex), the streaks spiral in as their radial coordinate drifts.
  float twist = 2.8 * (1.0 - r);
  float angA = th + spin * (1.0 + 1.6 * (1.0 - r)) + twist;
  float angB = th - spin * 0.55 - twist * 0.6 + 1.3;
  vec2 ringA = vec2(cos(angA), sin(angA));
  vec2 ringB = vec2(cos(angB), sin(angB));
  float drift = time * 0.5;
  float stA = fbm(ringA * 2.0 + vec2(rb * 7.0 + drift, 0.0));
  // The low tier sheds two layers' octaves (cosmetic depth only).
  vec2 qA2 = ringA * 4.4 + vec2(rb * 19.0 + drift * 1.7, 4.1);
  float stA2 = uDetail > 0.5 ? fbm(qA2) : vnoise(qA2) * 0.94;
  float stB = fbm(ringB * 1.6 + vec2(rb * 5.0 + drift * 0.6, 7.3));
  vec2 qT = ringB * 1.1 + vec2(rb * 2.6 - drift * 0.3, 9.7);
  float turb = uDetail > 0.5 ? fbm(qT) : vnoise(qT) * 0.94;
  float smoke = uChar.w;
  float sA = smoothstep(0.46 + 0.08 * smoke, 0.8, stA);
  // Thin bright filaments: spiral strands wound into the middle (two
  // counter-turning sets), broken up and bent by the noise.
  float lr = log(max(rb, 0.03));
  float sp1 = t * 6.0 - lr * 1.6 + (spin * (1.0 + 0.8 * (1.0 - r))) / 1.0472 + (stB - 0.5) * 1.8;
  float sp2 = t * 4.0 + lr * 0.9 - spin * 0.35 / 1.5708 + (turb - 0.5) * 2.2;
  float fil = pow(1.0 - abs(2.0 * fract(sp1) - 1.0), 10.0)
    * smoothstep(0.35, 0.7, stA2 + 0.15) * smoothstep(0.18, 0.5, rb);
  float filB = pow(1.0 - abs(2.0 * fract(sp2) - 1.0), 14.0)
    * smoothstep(0.45, 0.75, stA) * smoothstep(0.15, 0.45, rb);
  // The radial shape: a darker turbulent core, a body, a hot inner ring
  // near the rim, a soft-to-crisp falloff onto the rim.
  float band = smoothstep(0.28, 0.72, rb) * (1.0 - smoothstep(0.92, 1.0, rb));
  float core = 1.0 - smoothstep(0.0, 0.5, rb);
  float hotR = 0.78 + 0.04 * (turb - 0.5);
  float hotRing = exp(-pow((rb - hotR) / 0.06, 2.0)) * (0.45 + 0.7 * sA);
  // The body: the element's own colour, deepening into the core.
  vec3 col = mix(uBody * 0.55, uBody, turb);
  col = mix(col, uDeep, core * (0.75 - 0.4 * turb));
  float lit = clamp(sA * (0.12 + 0.6 * band) + 0.75 * fil * (0.25 + band) + 0.5 * filB * band, 0.0, 1.0);
  col = mix(col, uBright, lit * (1.0 - 0.5 * smoke));
  float white = clamp(fil * sA * band * 1.4 + hotRing * fil * 1.2 + hotRing * 0.25, 0.0, 1.0);
  col = mix(col, uHot, white * (1.0 - 0.5 * smoke));
  col = mix(col, uBright, hotRing * 0.45 * (1.0 - white));
  float a = (0.42 + 0.3 * turb + 0.55 * lit + 0.5 * hotRing) * spread;
  a = max(a, core * (0.55 + 0.2 * smoke) * spread);
  // The birth's (and the decay's) bright front at the vortex's edge: the
  // bloom lands with a flash.
  float front = exp(-pow((rb - 0.96) / 0.07, 2.0)) * smoothstep(0.98, 0.6, uBloom) * step(rb, 1.1);
  col = mix(col, uHot, clamp(front * 1.2, 0.0, 1.0));
  a = max(a, front);
  // Light it ADDS (a) and floor it covers (occ) part: the floor's own
  // detail shows through the vortex; the rim and the pips cover it.
  float occ = (0.22 + 0.25 * lit + 0.45 * core + 0.4 * smoke) * spread;
  // Smoke (shadow): soft dark plumes curling in over the body.
  if (smoke > 0.0) {
    float plume = fbm(rot(vXZ, spin * 0.8 + twist * 1.4) * 3.0 + vec2(0.0, -drift * 0.8));
    float sm = smoothstep(0.42, 0.72, plume) * smoothstep(0.15, 0.6, rb) * smoke;
    col = mix(col, uDeep * 0.6, sm * 0.7);
    float lip = smoothstep(0.62, 0.7, plume) * (1.0 - smoothstep(0.7, 0.8, plume));
    col += uBright * lip * smoke * 0.5;
    a = max(a, sm * 0.75 * spread);
  }
  // Streams (air): long thin wind ribbons drawn round the swirl.
  if (uChar2.x > 0.0) {
    float arm = fract(t * 5.0 + log(max(r, 0.02)) * 1.35 + spin * 0.45);
    float wob = 0.03 * sin(r * 21.0 + time * 3.0);
    float line = 1.0 - smoothstep(0.0, 0.035 + aa * 2.0, abs(arm - 0.5 + wob));
    float seg = smoothstep(0.35, 0.6, vnoise(vec2(t * 9.0 + spin, r * 3.0 - time * 1.4)));
    float st = line * seg * smoothstep(0.2, 0.5, rb) * spread * uChar2.x;
    col = mix(col, uHot, st * 0.8);
    a = max(a, st * 0.85);
  }
  // A gentle flicker over the whole body (soakFlicker, once a frame).
  col *= uFlick;
  // Grains (earth's sand, fire's embers, air's motes): specks carried round
  // the vortex, twinkling.
  if (uChar.x > 0.0) {
    vec2 gq = rot(vXZ, spin * 1.25 + twist * 0.8) * 22.0;
    vec2 cell = floor(gq);
    float h = hash2(cell);
    vec2 off = vec2(hash2(cell + 7.1), hash2(cell + 3.7)) - 0.5;
    float d = length(fract(gq) - 0.5 - off * 0.6);
    float tw = 0.5 + 0.5 * sin(time * (3.0 + 5.0 * h) + h * 40.0);
    float g = step(0.8, h) * (1.0 - smoothstep(0.06, 0.16, d)) * tw * smoothstep(0.15, 0.4, rb);
    g *= uChar.x * spread;
    col = mix(col, uHot, g);
    a = max(a, g);
  }
  // Tongues (fire): the hot edge licks inward from the rim in flame tongues.
  if (uChar.z > 0.0) {
    vec2 rf = vec2(cos(th + spin * 0.3), sin(th + spin * 0.3));
    float n = fbm(rf * 3.2 + vec2(-time * 1.3, time * 0.4));
    float edge = 0.97 - 0.48 * n * n;
    float tongue = smoothstep(edge - 0.02, edge + 0.06, r) * (1.0 - smoothstep(0.97, 1.0, r));
    float tip = smoothstep(edge - 0.02, edge + 0.02, r) * (1.0 - smoothstep(edge + 0.02, edge + 0.1, r));
    tongue *= uChar.z * spread;
    vec3 flame = mix(mix(uBody, uBright, 0.55 + 0.45 * n), uHot, tip * 0.8);
    col = mix(col, flame, tongue * 0.9);
    a = max(a, tongue);
    occ = max(occ, tongue * 0.45);
  }
  // The converging rings (gather in): one leaves the rim every uRipEvery
  // seconds and closes on the middle as it fades.
  float rip = 0.0;
  for (int k = 0; k < 3; k++) {
    float ph = fract(uTime / (uRipEvery * 3.0) + float(k) / 3.0);
    float rr = 1.0 - ph * (1.0 - uRipTo);
    float w = 0.005 + 0.007 * ph;
    float ra = smoothstep(0.0, 0.12, ph) * (1.0 - ph) * (1.0 - ph);
    rip += ra * (1.0 - smoothstep(w, w + aa, abs(r - rr)));
  }
  rip = clamp(rip, 0.0, 1.0);
  col = mix(col, uBright, rip * 0.8);
  a += rip * 0.45;
  // The inward chevrons: eight arrowheads pointing at the middle, so a still
  // frame says GATHER too.
  float u = fract(t * 8.0 + 0.0625) - 0.5;
  float v = r - abs(u) * 0.9;
  float info = 0.0;
  float chev = (1.0 - smoothstep(0.012, 0.012 + aa, abs(v - 0.58))) *
    (1.0 - smoothstep(0.07, 0.1, abs(u)));
  col = mix(col, uHot, chev * 0.9);
  a = max(a, chev * 0.9);
  occ = max(occ, chev * 0.5);
  info = max(info, chev);
  // The rim: a crisp bright line at the sim's own radius, a thin dark
  // keyline inside it so it holds on any floor.
  float rw = max(0.09 / uRadius, aa * 1.2);
  float rimLine = smoothstep(1.0 - rw - aa, 1.0 - rw, r) * uRimOn;
  float keyIn = smoothstep(1.0 - rw * 1.8 - aa, 1.0 - rw * 1.8, r);
  float key = (keyIn - smoothstep(1.0 - rw - aa, 1.0 - rw, r)) * uRimOn;
  col = mix(col, uDeep * 0.5, key * 0.6);
  a = max(a, key * 0.55);
  occ = max(occ, key * 0.6 + rimLine * 0.9);
  info = max(info, rimLine);
  col = mix(col, mix(uBright, uHot, clamp(0.45 + 0.55 * uFlare, 0.0, 1.0)), rimLine);
  a = mix(a, 1.0, rimLine * 0.95);
  // Crackle (lightning; the air's storm accent): thin arcs flickering
  // along the rim.
  if (uChar.y > 0.0) {
    float fr = floor(uTime * 14.0);
    float jag = (vnoise(vec2(t * 40.0, fr)) - 0.5) * 0.05
      + (vnoise(vec2(t * 110.0, fr + 3.0)) - 0.5) * 0.02;
    float arcLine = 1.0 - smoothstep(0.004, 0.004 + aa, abs(r - 0.94 - jag));
    float on = step(0.66, vnoise(vec2(t * 21.0, fr * 1.7)));
    // A second, inner set of short arcs leaping across the bright band.
    float jag2 = (vnoise(vec2(t * 60.0, fr + 9.0)) - 0.5) * 0.06;
    float arc2 = 1.0 - smoothstep(0.003, 0.003 + aa, abs(r - 0.76 - jag2));
    float on2 = step(0.74, vnoise(vec2(t * 17.0 + 5.0, fr * 2.3)));
    float cr = max(arcLine * on, arc2 * on2 * 0.8) * uChar.y;
    col = mix(col, uHot * 1.3, cr);
    a = max(a, cr);
  }
  // The countdown arc (when the owner has one): what is left of the bar.
  if (uTimer >= 0.0) {
    float arc = (1.0 - smoothstep(0.014, 0.014 + aa, abs(r - 0.9))) * step(t, uTimer);
    col = mix(col, uHot, arc);
    a = max(a, arc);
    info = max(info, arc);
  }
  // The pips: uNeed round the rim, the first uLit bright; a dark socket
  // under each so they read over the bright band.
  if (uNeed > 0.5) {
    float k = floor(t * uNeed);
    float local = (fract(t * uNeed) - 0.5) * 6.2831853 * uPipAt / uNeed;
    float d = length(vec2(local, r - uPipAt));
    float pw = fwidth(d) * 1.5 + 0.006;
    float socket = 1.0 - smoothstep(uPipSize * 1.3 - pw, uPipSize * 1.3, d);
    float gem = 1.0 - smoothstep(uPipSize - pw, uPipSize, d);
    float hollow = smoothstep(uPipSize * 0.6 - pw, uPipSize * 0.6, d) * gem;
    float on = step(k + 0.5, uLit);
    col = mix(col, uDeep * 0.35, socket * 0.85);
    a = mix(a, 0.92, socket);
    occ = max(occ, socket * 0.85);
    info = max(info, socket);
    float gemCore = 1.0 - smoothstep(0.0, uPipSize, d);
    vec3 gemCol = mix(uBright, uHot, gemCore);
    col = mix(col, mix(uBody, gemCol, on), mix(hollow, gem, on));
    a = max(a, mix(hollow, gem, on));
  }
  // Ready (every soaker inside): a bright ring round the middle and a
  // hotter rim, so a full share reads at a glance.
  if (uFlare > 0.5) {
    float ready = 1.0 - smoothstep(0.02, 0.02 + aa, abs(r - 0.22));
    col = mix(col, uHot, ready);
    a = max(a, ready);
    occ = max(occ, ready * 0.6);
    info = max(info, ready);
  }
  col *= 1.0 + 0.25 * uFlare;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // The information (rim, pips, chevrons, arc, ready ring) draws whole from
  // the first frame and goes at once with the mark (uInfo); only the body
  // blooms in and decays.
  float k = mix(uAlpha, uInfo, clamp(info, 0.0, 1.0));
  gl_FragColor = vec4(gl_FragColor.rgb * clamp(a, 0.0, 1.0) * 1.35, clamp(occ, 0.0, 1.0)) * k;
}
`;

/** The wisps: each ribbon a strip up a spiral, its width turned to the
 *  camera, its life a rise out of the disc and a fade off the top. */
const WISP_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute float aRibbon;
attribute float aV;
attribute float aSide;
uniform float uTime;
uniform float uSpin;
uniform float uRise;
uniform float uWidth;
uniform float uSpeed;
uniform float uCurl;
uniform float uJag;
varying float vSide;
varying float vFade;
varying float vV;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 wispPoint(float seed, float v, float life) {
  float t = uTime * uSpeed;
  float ang = seed * 6.2831853 + uSpin * uSpeed * 0.5
    + v * (1.6 + 1.8 * h1(seed + 2.0)) * uCurl + life * 1.1;
  float r0 = 0.25 + 0.42 * h1(seed + 1.0);
  // Rising flames and sand ribbons lean out and fan at the top (uCurl 1);
  // smoke curls in over the middle (uCurl -1).
  float lean = uCurl > 0.0 ? 0.16 * v * v : -0.5 * v;
  float rad = max(0.04, r0 * (1.0 - 0.35 * v) + lean
    + 0.08 * sin(v * 6.5 + seed * 7.0 + t * 1.9));
  // Lightning's wisps jag and jump a few times a second.
  float jf = floor(uTime * 11.0);
  rad += uJag * 0.07 * (h1(floor(v * 9.0) + seed * 13.0 + jf) - 0.5);
  ang += uJag * 0.25 * (h1(floor(v * 9.0) + seed * 7.0 + jf + 3.0) - 0.5);
  float y = v * (0.55 + 0.45 * h1(seed + 4.0)) * uRise;
  return vec3(sin(ang) * rad, y, cos(ang) * rad);
}
void main() {
  float seed = aRibbon * 1.618 + 0.37;
  float life = fract(uTime * uSpeed * (0.32 + 0.22 * h1(seed + 6.0)) + h1(seed + 7.0));
  float head = smoothstep(0.0, 0.45, life);
  float tail = smoothstep(0.5, 1.0, life);
  float vv = mix(tail, head, aV);
  vec3 p = wispPoint(seed, vv, life);
  vec3 q = wispPoint(seed, vv + 0.03, life);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec4 w2 = modelMatrix * vec4(q, 1.0);
  vec3 tng = w2.xyz - w.xyz;
  tng = length(tng) > 1e-5 ? normalize(tng) : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(tng, normalize(cameraPosition - w.xyz));
  side = length(side) > 1e-5 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  float taper = sin(3.14159265 * aV);
  w.xyz += side * aSide * uWidth * (0.35 + 0.65 * taper) * (1.0 - 0.5 * vv);
  vSide = aSide;
  vV = vv;
  vFade = taper * (1.0 - smoothstep(0.55, 1.0, vv)) * smoothstep(0.0, 0.08, vv)
    * (1.0 - smoothstep(0.85, 1.0, life));
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

const WISP_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uBright;
uniform vec3 uHot;
varying float vSide;
varying float vFade;
varying float vV;
void main() {
  float core = 1.0 - abs(vSide);
  float a = vFade * pow(core, 1.6) * uAlpha;
  vec3 col = mix(uBright, uHot, core * core * (1.0 - 0.6 * vV));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}
`;

/** Segments up a wisp. */
const WISP_SEGMENTS = 14;

/** The geometry a pool of markers shares (built once by the owner). */
export interface SoakMarkerGeometry {
  disc: THREE.BufferGeometry;
  wisps: THREE.BufferGeometry;
}

export function buildSoakMarkerGeometry(geometries?: THREE.BufferGeometry[]): SoakMarkerGeometry {
  const disc = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
  const n = SOAK_MARKER.wisps;
  const verts = n * (WISP_SEGMENTS + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const rib = new Float32Array(verts);
  const vs = new Float32Array(verts);
  const sides = new Float32Array(verts);
  const index: number[] = [];
  let k = 0;
  for (let w = 0; w < n; w++) {
    const base = k;
    for (let s = 0; s <= WISP_SEGMENTS; s++) {
      for (const side of [-1, 1]) {
        pos[k * 3 + 1] = s / WISP_SEGMENTS;
        rib[k] = w;
        vs[k] = s / WISP_SEGMENTS;
        sides[k] = side;
        k++;
      }
    }
    for (let s = 0; s < WISP_SEGMENTS; s++) {
      const a = base + s * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const wisps = new THREE.BufferGeometry();
  wisps.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  wisps.setAttribute('aRibbon', new THREE.BufferAttribute(rib, 1));
  wisps.setAttribute('aV', new THREE.BufferAttribute(vs, 1));
  wisps.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  wisps.setIndex(index);
  geometries?.push(disc, wisps);
  return { disc, wisps };
}

/** One frame of a marker. */
export interface SoakMarkerPaint {
  x: number;
  /** The FLOOR height under it. */
  y: number;
  z: number;
  /** The sim's radius (yards): the rim. */
  radius: number;
  element: SoakElement;
  /** The mark's fill (0 laid, 1 landing). */
  fill: number;
  clock: number;
  reduced: boolean;
  /** The players it needs and how many stand inside. */
  need?: number;
  have?: number;
  /** Draw the marker's own rim (off where the owner draws one). Default on. */
  rim?: boolean;
  /** A countdown arc: the bar's progress (0..1), or none. */
  timer?: number | null;
  /** The tier's detail (0 low .. 1 full): the wisps' count only. */
  detail?: number;
  /** Where the pips sit (a share of the radius), for an owner whose own
   *  ring already holds the rim band (the Anvil's runes). */
  pipAt?: number;
}

const _look = newSoakMarkerLook();

/** One soak marker: a disc and its wisps under one group. */
export class SoakMarker {
  readonly group = new THREE.Group();
  readonly disc: THREE.Mesh;
  readonly wisps: THREE.Mesh;
  readonly discMat: THREE.ShaderMaterial;
  readonly wispMat: THREE.ShaderMaterial;
  private bornAt = 0;
  private releasedAt: number | null = null;
  private lastClock = 0;
  private lastReduced = false;
  private showing = false;
  private element: SoakElement | null = null;

  /** `rung`: the owner's floor ladder rung (the wisps take the next). */
  constructor(
    geo: SoakMarkerGeometry,
    materials: THREE.Material[],
    rung: number,
    name = 'soakMarker',
  ) {
    this.group.name = name;
    this.discMat = new THREE.ShaderMaterial({
      name: 'soakMarkerDisc',
      uniforms: {
        uTime: { value: 0 },
        uSpin: { value: 0 },
        uBloom: { value: 1 },
        uAlpha: { value: 0 },
        uFlare: { value: 0 },
        uNeed: { value: 0 },
        uLit: { value: 0 },
        uPipAt: { value: FLOOR_TELL_PIPS.at },
        uPipSize: { value: FLOOR_TELL_PIPS.size },
        uRimOn: { value: 1 },
        uTimer: { value: -1 },
        uRadius: { value: 1 },
        uRipEvery: { value: SOAK_MARKER.rippleEvery },
        uRipTo: { value: SOAK_MARKER.rippleTo },
        uChar: { value: new THREE.Vector4() },
        uChar2: { value: new THREE.Vector2(0, 1) },
        uDetail: { value: 1 },
        uFlick: { value: 1 },
        uInfo: { value: 1 },
        uDeep: { value: new THREE.Color() },
        uBody: { value: new THREE.Color() },
        uBright: { value: new THREE.Color() },
        uHot: { value: new THREE.Color() },
      },
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      transparent: true,
      depthWrite: false,
      // Premultiplied: the vortex adds its light and covers only part of
      // the floor under it (its detail shows through); the rim covers it.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.wispMat = new THREE.ShaderMaterial({
      name: 'soakMarkerWisps',
      uniforms: {
        uTime: { value: 0 },
        uSpin: { value: 0 },
        uRise: { value: 1 },
        uWidth: { value: 0.16 },
        uSpeed: { value: 1 },
        uCurl: { value: 1 },
        uJag: { value: 0 },
        uAlpha: { value: 0 },
        uBright: { value: new THREE.Color() },
        uHot: { value: new THREE.Color() },
      },
      vertexShader: WISP_VERT,
      fragmentShader: WISP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    materials.push(this.discMat, this.wispMat);
    this.disc = new THREE.Mesh(geo.disc, this.discMat);
    this.disc.name = `${name}Disc`;
    this.disc.renderOrder = floorVfxRenderOrder('encounter', rung);
    this.disc.frustumCulled = false;
    this.wisps = new THREE.Mesh(geo.wisps, this.wispMat);
    this.wisps.name = `${name}Wisps`;
    this.wisps.renderOrder = floorVfxRenderOrder('encounter', rung + 1);
    this.wisps.frustumCulled = false;
    this.group.add(this.disc, this.wisps);
    this.group.visible = false;
  }

  /** Lay the marker (call every frame it shows). */
  paint(p: SoakMarkerPaint): void {
    if (!this.showing || this.releasedAt !== null) {
      // A fresh mark is born; a released one taken back is born again.
      if (!this.showing || this.releasedAt !== null) this.bornAt = p.clock;
      this.releasedAt = null;
      this.showing = true;
    }
    this.lastClock = p.clock;
    this.lastReduced = p.reduced;
    const need = Math.max(0, Math.min(FLOOR_TELL_PIPS.most, Math.round(p.need ?? 0)));
    const lit = Math.max(0, Math.min(need, Math.round(p.have ?? 0)));
    const ready = need > 0 && lit >= need;
    soakMarkerLook(p.clock, p.clock - this.bornAt, null, p.fill, ready, p.reduced, _look);
    this.apply(p, need, lit);
  }

  /** The mark is gone: play the decay (or hide at once under reduced motion
   *  or when it never showed). */
  release(): void {
    if (!this.showing || this.releasedAt !== null) return;
    if (this.lastReduced) {
      this.hide();
      return;
    }
    this.releasedAt = this.lastClock;
  }

  /** Advance a decay at `clock` (owners call it every frame). */
  settle(clock: number): void {
    if (this.releasedAt === null) return;
    const d = clock - this.releasedAt;
    if (soakMarkerStage(clock - this.bornAt, d) === 'done') {
      this.hide();
      return;
    }
    const u = this.discMat.uniforms;
    soakMarkerLook(clock, clock - this.bornAt, d, 1, u.uFlare.value > 0.5, false, _look);
    u.uBloom.value = _look.bloom;
    u.uAlpha.value = _look.alpha;
    u.uSpin.value = _look.spin;
    u.uTime.value = _look.time;
    // The mark is gone: its information goes with it at once.
    u.uInfo.value = 0;
    this.wispMat.uniforms.uAlpha.value = _look.alpha * _look.wisp;
    this.wispMat.uniforms.uSpin.value = _look.spin;
    this.wispMat.uniforms.uTime.value = _look.time;
  }

  hide(): void {
    this.showing = false;
    this.releasedAt = null;
    if (this.group.visible) this.group.visible = false;
  }

  get shown(): boolean {
    return this.group.visible;
  }

  get decaying(): boolean {
    return this.releasedAt !== null;
  }

  private apply(p: SoakMarkerPaint, need: number, lit: number): void {
    const u = this.discMat.uniforms;
    const w = this.wispMat.uniforms;
    if (p.element !== this.element) {
      this.element = p.element;
      const pal = SOAK_PALETTES[p.element];
      (u.uDeep.value as THREE.Color).setHex(pal.deep);
      (u.uBody.value as THREE.Color).setHex(pal.body);
      (u.uBright.value as THREE.Color).setHex(pal.bright);
      (u.uHot.value as THREE.Color).setHex(pal.hot);
      (w.uBright.value as THREE.Color).setHex(pal.bright);
      (w.uHot.value as THREE.Color).setHex(pal.hot);
      const c = SOAK_CHARACTER[p.element];
      (u.uChar.value as THREE.Vector4).set(c.grain, c.crackle, c.tongues, c.smoke);
      (u.uChar2.value as THREE.Vector2).set(c.streams, c.speed);
      w.uWidth.value = c.wisp;
      w.uSpeed.value = c.speed;
      w.uCurl.value = c.smoke > 0.5 ? -1 : 1;
      w.uJag.value = c.crackle;
    }
    u.uTime.value = _look.time;
    u.uSpin.value = _look.spin;
    u.uBloom.value = _look.bloom;
    u.uAlpha.value = _look.alpha;
    u.uFlare.value = _look.flare;
    u.uInfo.value = 1;
    u.uNeed.value = need;
    u.uLit.value = lit;
    u.uRimOn.value = p.rim === false ? 0 : 1;
    u.uTimer.value = soakTimerLeft(p.timer);
    u.uRadius.value = p.radius;
    u.uDetail.value = p.detail ?? 1;
    u.uFlick.value = soakFlicker(_look.time);
    u.uPipAt.value = p.pipAt ?? FLOOR_TELL_PIPS.at;
    w.uTime.value = _look.time;
    w.uSpin.value = _look.spin;
    w.uAlpha.value = _look.alpha * _look.wisp;
    const n = soakWispCount(p.detail ?? 1);
    const want = n * WISP_SEGMENTS * 6;
    if (this.wisps.geometry.drawRange.count !== want) this.wisps.geometry.setDrawRange(0, want);
    this.group.position.set(p.x, p.y, p.z);
    this.disc.position.y = 0.14;
    this.disc.scale.setScalar(p.radius);
    this.wisps.position.y = 0.1;
    this.wisps.scale.set(p.radius, soakWispHeight(p.radius), p.radius);
    w.uRise.value = _look.wisp;
    this.group.visible = true;
  }
}
