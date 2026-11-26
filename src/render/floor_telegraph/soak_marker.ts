// The shared soak marker's painter (the plan: soak_marker_core.ts): one flat
// disc (the vortex, the rim, the converging rings, the inward chevrons, the
// soakers' pips and an optional countdown arc: one draw, one program) and one
// ribbon mesh of thin wisps spiralling up out of it (one draw, one program,
// additive). Built once by its OWNER under the owner's gated root (no GPU work
// after boot), no light, no texture, no per-frame allocation. The disc's rim
// is the sim's radius; past it only the rim's own soft halo (light, never a
// fill, never moving out: a share only moves IN). Every tier draws
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
uniform float uBorn;
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
uniform float uOuter;
uniform float uArms;
uniform float uPitch;
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
  // The mesh reaches a hair past the rim (uOuter of the radius) for the
  // rim's soft halo only; the rim (r = 1) is the sim's radius.
  float r = min(length(vXZ), uOuter);
  float aa = fwidth(r) * 1.5 + 0.003;
  float spd = uChar2.y;
  float spin = uSpin * spd;
  float time = uTime * spd;
  float th = atan(vXZ.x, vXZ.y);
  float t = fract(th / 6.2831853 + 0.5);
  float smoke = uChar.w;
  vec3 col = vec3(0.0);
  // Light added (e, premultiplied) and floor covered (occ).
  float e = 0.0;
  float occ = 0.0;
  float info = 0.0;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0, r);

  // ---- the vortex (inside the rim) ----
  if (r < 1.0) {
    float rb = r / max(uBloom, 0.05);
    float spread = 1.0 - smoothstep(0.9, 1.04, rb);
    float twist = 2.8 * (1.0 - r);
    float drift = time * 0.5;
    float lr = log(max(rb, 0.02));
    // One slow, large field bends the arms so they breathe (the low tier
    // keeps one octave of it).
    vec2 bendQ = vec2(cos(th - spin * 0.3), sin(th - spin * 0.3)) * 1.3
      + vec2(rb * 2.2 - drift * 0.25, 9.7);
    float turb = uDetail > 0.5 ? fbm(bendQ) : vnoise(bendQ);
    // The arms: coherent logarithmic spirals wound in toward the eye, the
    // inner turning faster. The arm coordinate a runs across it: 0 its bright leading
    // edge, toward 1 its dark trailing side.
    float spinR = spin * (1.0 + 0.9 * (1.0 - rb));
    float ph = (spinR - th) / 6.2831853 * uArms - lr * uPitch + (turb - 0.5) * 0.18 * smoothstep(0.3, 0.75, rb);
    float idx = mod(floor(ph), uArms);
    float a = fract(ph);
    float h = hash2(vec2(idx, 3.1));
    // Each arm its own reach: it tapers to a tip short of the eye.
    float tip = 0.4 + 0.1 * h;
    float reach = smoothstep(tip, tip + 0.3, rb) * (1.0 - smoothstep(0.9, 1.0, rb));
    // Narrower toward its tip: the trailing fade quickens inward.
    float fall = mix(3.2, 9.0, 1.0 - smoothstep(0.2, 0.9, rb));
    float lead = smoothstep(0.0, 0.03, a) * exp(-a * fall);
    float edge = smoothstep(0.0, 0.015, a) * exp(-a * 40.0);
    // The soft motion-blur trail behind each arm.
    float trail = exp(-a * 1.6) * (1.0 - 0.4 * a);
    // Fine streaks ALONG the arm (fast across it, slow along it); the low
    // tier keeps the coarse set and drops the fine one.
    float st1 = vnoise(vec2(ph * 9.0, lr * 1.6 - drift * 1.2));
    float st2 = uDetail > 0.5 ? vnoise(vec2(ph * 27.0 + 3.0, lr * 3.5 - drift * 2.0)) : 0.5;
    float streak = smoothstep(0.2, 0.9, 0.75 * st1 + 0.25 * st2);
    float arm = lead * reach * (0.75 + 0.25 * h) * (0.6 + 0.5 * streak);
    float armEdge = edge * reach * reach * (0.6 + 0.6 * streak);
    float armTrail = trail * reach * (0.55 + 0.45 * st1);
    // The eye: clean, deep, slowly turning (one faint inner ring).
    float eye = 1.0 - smoothstep(0.1, 0.42, rb);
    float band = smoothstep(0.3, 0.7, rb) * (1.0 - smoothstep(0.93, 1.0, rb));
    float hotRing = exp(-pow((rb - 0.7) / 0.08, 2.0)) * (0.35 + 0.9 * arm);
    vec3 c = mix(uDeep, uBody, clamp(0.2 + 0.45 * turb + 0.45 * armTrail, 0.0, 1.0));
    c = mix(c, uDeep * 0.6, eye * 0.85);
    c = mix(c, uBright, clamp(arm * 1.25, 0.0, 1.0) * (1.0 - 0.4 * smoke));
    c = mix(c, uHot, clamp(armEdge * 1.1 + hotRing * arm * 0.6, 0.0, 1.0) * (1.0 - 0.4 * smoke));
    // Emission: the arms and their hot edges carry the light; the trail a
    // soft wash; the eye almost none.
    float glow = (0.1 + 0.18 * turb * (1.0 - eye) + 0.38 * armTrail + 1.05 * arm + 0.7 * armEdge
      + 0.4 * hotRing + 0.15 * band) * spread;
    // The eye darkens the floor a little; the body barely covers it.
    float cov = (0.08 + 0.5 * eye + 0.12 * armTrail + 0.08 * band + 0.5 * smoke * band) * spread;
    // Smoke (shadow): soft dark plumes curling in.
    if (smoke > 0.0) {
      // In the arms' own coordinates: the smoke streams along them, curling in.
      float plume = fbm(vec2(ph * 2.2, lr * 1.4 - drift * 0.9) + vec2(twist * 0.3, 0.0));
      float sm = smoothstep(0.42, 0.72, plume) * smoothstep(0.4, 0.7, rb) * smoke;
      c = mix(c, uDeep, sm * 0.7);
      glow *= 1.0 - 0.6 * sm;
      cov = max(cov, sm * 0.65 * spread);
      float lip = smoothstep(0.62, 0.7, plume) * (1.0 - smoothstep(0.7, 0.8, plume));
      c += uBright * lip * smoke * 0.35;
      glow += lip * smoke * 0.35 * spread;
    }
    // Streams (air): long thin wind ribbons round the swirl.
    if (uChar2.x > 0.0) {
      float arm = fract(t * 5.0 + log(max(r, 0.02)) * 1.35 + spin * 0.45);
      float wob = 0.03 * sin(r * 21.0 + time * 3.0);
      float line = 1.0 - smoothstep(0.0, 0.035 + aa * 2.0, abs(arm - 0.5 + wob));
      float seg = smoothstep(0.35, 0.6, vnoise(vec2(t * 9.0 + spin, r * 3.0 - time * 1.4)));
      float st = line * seg * smoothstep(0.2, 0.5, rb) * spread * uChar2.x;
      c = mix(c, uHot, st * 0.8);
      glow += st;
    }
    // Grains (sand, embers, motes) carried round the vortex, twinkling.
    if (uChar.x > 0.0) {
      vec2 gq = rot(vXZ, spin * 1.25 + twist * 0.8) * 22.0;
      vec2 cell = floor(gq);
      float h = hash2(cell);
      vec2 off = vec2(hash2(cell + 7.1), hash2(cell + 3.7)) - 0.5;
      float d = length(fract(gq) - 0.5 - off * 0.6);
      float tw = 0.5 + 0.5 * sin(time * (3.0 + 5.0 * h) + h * 40.0);
      float g = step(0.84, h) * (1.0 - smoothstep(0.06, 0.15, d)) * tw * smoothstep(0.45, 0.65, rb) * 0.6;
      g *= uChar.x * spread;
      c = mix(c, uHot, g);
      glow += g;
    }
    // The birth's bright front at the vortex's edge: the bloom lands.
    float front = exp(-pow((rb - 0.96) / 0.07, 2.0)) * smoothstep(0.98, 0.6, uBloom) * step(rb, 1.1);
    c = mix(c, uHot, clamp(front * 1.2, 0.0, 1.0));
    glow += front;
    // The converging rings inside (gather in): one leaves the rim every
    // uRipEvery seconds and closes on the middle as it fades.
    float rip = 0.0;
    for (int k = 0; k < 3; k++) {
      float ph = fract(uTime / (uRipEvery * 3.0) + float(k) / 3.0);
      float rr = 1.0 - ph * (1.0 - uRipTo);
      float w = 0.006 + 0.008 * ph;
      float ra = smoothstep(0.0, 0.12, ph) * (1.0 - ph) * (1.0 - ph);
      rip += ra * (1.0 - smoothstep(w, w + aa, abs(r - rr)));
    }
    rip = clamp(rip, 0.0, 1.0);
    c = mix(c, uBright, rip * 0.8);
    glow += rip * 0.5;
    col = c * uFlick;
    e = glow;
    occ = cov;
  }

  // ---- the inward chevrons: bold arrowheads at the middle's edge ----
  float u = fract(t * 8.0 + 0.0625) - 0.5;
  float v = r - abs(u) * 0.75;
  float chev = (1.0 - smoothstep(0.022, 0.022 + aa, abs(v - 0.5))) *
    (1.0 - smoothstep(0.1, 0.13, abs(u))) * inside;
  col = mix(col, uHot, chev);
  e = max(e, chev * 1.1);
  occ = max(occ, chev * 0.55);
  info = max(info, chev);

  // ---- the rim: a hot luminous ring, brighter on its inner edge, a soft
  // halo past it, flickering in the element's way ----
  float rw = max(0.13 / uRadius, aa * 1.5);
  float fr = floor(uTime * 14.0);
  // Per element: fire's licks, lightning's crackle, earth's sand streaks,
  // shadow's smoke (each a gentle wobble of the rim's light, never its place).
  float lick = fbm(vec2(t * 22.0, time * 1.6)) * uChar.z;
  float crack = step(0.55, vnoise(vec2(t * 30.0, fr))) * uChar.y;
  float sand = vnoise(vec2(t * 60.0 - time * 3.0, 2.0)) * uChar.x * 0.6;
  float fume = fbm(vec2(t * 9.0 + time * 0.4, 5.0)) * uChar.w;
  float rimFlick = clamp(0.8 + 0.5 * lick + 0.6 * crack + 0.3 * sand - 0.35 * fume, 0.45, 1.6);
  float rimBand = smoothstep(1.0 - rw - aa, 1.0 - rw, r) * (1.0 - smoothstep(1.0, 1.0 + aa, r));
  float rimInner = exp(-pow((r - (1.0 - rw)) / (rw * 0.45), 2.0));
  vec3 rimCol = mix(uBright, uHot, clamp(0.15 + 0.55 * rimInner + 0.5 * uFlare, 0.0, 1.0));
  float rimL = rimBand * uRimOn;
  col = mix(col, rimCol, rimL);
  e = mix(e, 1.15 * rimFlick, rimL);
  occ = max(occ, rimL * 0.75);
  info = max(info, rimL);
  // The halo: a soft glow just outside the rim (light only, never a fill).
  float halo = r > 1.0
    ? exp(-(r - 1.0) / 0.05) * 0.55 * uRimOn * rimFlick * (1.0 - smoothstep(1.1, 1.15, r))
    : 0.0;
  halo += (r < 1.0 ? exp(-(1.0 - r) / 0.06) * 0.35 * uRimOn : 0.0);
  col = mix(col, uBright, clamp(halo, 0.0, 1.0) * (1.0 - rimL));
  e += halo * (1.0 - rimL);

  // ---- the birth: the rim flares in place as the vortex blooms out to it
  // (a share only ever moves IN: nothing travels past the rim) ----
  float birthFlare = (1.0 - uBorn) * uRimOn;
  e += (rimL + halo * (1.0 - rimL)) * birthFlare * 0.9;

  // ---- crackle (lightning; the air's storm accent): short arcs leaping
  // along the rim and across the bright band ----
  if (uChar.y > 0.0) {
    float jag = (vnoise(vec2(t * 40.0, fr)) - 0.5) * 0.05
      + (vnoise(vec2(t * 110.0, fr + 3.0)) - 0.5) * 0.02;
    float arcLine = 1.0 - smoothstep(0.004, 0.004 + aa, abs(r - 0.94 - jag));
    float on = step(0.66, vnoise(vec2(t * 21.0, fr * 1.7)));
    float jag2 = (vnoise(vec2(t * 60.0, fr + 9.0)) - 0.5) * 0.06;
    float arc2 = 1.0 - smoothstep(0.003, 0.003 + aa, abs(r - 0.72 - jag2));
    float on2 = step(0.74, vnoise(vec2(t * 17.0 + 5.0, fr * 2.3)));
    float cr = max(arcLine * on, arc2 * on2 * 0.5) * uChar.y * inside;
    col = mix(col, uHot, cr);
    e = max(e, cr * 1.3);
  }
  // ---- tongues (fire): the hot edge licks inward from the rim ----
  if (uChar.z > 0.0 && r < 1.0) {
    vec2 rf = vec2(cos(th + spin * 0.3), sin(th + spin * 0.3));
    float n = fbm(rf * 3.2 + vec2(-time * 1.3, time * 0.4));
    float edge = 0.97 - 0.2 * n * n;
    float tongue = smoothstep(edge - 0.02, edge + 0.06, r) * (1.0 - smoothstep(0.96, 0.99, r));
    float tip = smoothstep(edge - 0.02, edge + 0.02, r) * (1.0 - smoothstep(edge + 0.02, edge + 0.1, r));
    tongue *= uChar.z * (1.0 - smoothstep(0.9, 1.04, r / max(uBloom, 0.05)));
    vec3 flame = mix(mix(uBody, uBright, 0.6 + 0.4 * n), uHot, tip * 0.8);
    col = mix(col, flame, tongue * 0.85);
    e = max(e, tongue * 1.05);
  }
  // ---- the countdown arc (when the owner has one) ----
  if (uTimer >= 0.0) {
    float arc = (1.0 - smoothstep(0.016, 0.016 + aa, abs(r - 0.885))) * step(t, uTimer);
    col = mix(col, uHot, arc);
    e = max(e, arc * 1.1);
    occ = max(occ, arc * 0.5);
    info = max(info, arc);
  }
  // ---- the pips: uNeed round the rim, the first uLit bright, a dark socket
  // under each so they read over the bright band ----
  if (uNeed > 0.5) {
    float k = floor(t * uNeed);
    float local = (fract(t * uNeed) - 0.5) * 6.2831853 * uPipAt / uNeed;
    float d = length(vec2(local, r - uPipAt));
    float pw = fwidth(d) * 1.5 + 0.006;
    float socket = 1.0 - smoothstep(uPipSize * 1.3 - pw, uPipSize * 1.3, d);
    float gem = 1.0 - smoothstep(uPipSize - pw, uPipSize, d);
    float hollow = smoothstep(uPipSize * 0.6 - pw, uPipSize * 0.6, d) * gem;
    float on = step(k + 0.5, uLit);
    float gemCore = 1.0 - smoothstep(0.0, uPipSize, d);
    vec3 gemCol = mix(uBright, uHot, gemCore);
    col = mix(col, uDeep * 0.3, socket * 0.7);
    e = mix(e, 0.35, socket * 0.7);
    occ = max(occ, socket * 0.7);
    float pip = mix(hollow, gem, on);
    col = mix(col, mix(uBody * 1.3, gemCol, on), pip);
    e = max(e, pip * mix(0.9, 1.2, on));
    info = max(info, socket);
  }
  // ---- ready (every soaker inside): a bright ring round the middle ----
  if (uFlare > 0.5) {
    float ready = 1.0 - smoothstep(0.02, 0.02 + aa, abs(r - 0.22));
    col = mix(col, uHot, ready);
    e = max(e, ready * 1.2);
    occ = max(occ, ready * 0.5);
    info = max(info, ready);
  }
  col *= 1.0 + 0.2 * uFlare;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // The information (rim, pips, chevrons, arc, ready ring) draws whole from
  // the first frame and goes at once with the mark (uInfo); only the body,
  // its halo and its rings bloom in and decay.
  float kk = mix(uAlpha, uInfo, clamp(info, 0.0, 1.0));
  gl_FragColor = vec4(gl_FragColor.rgb * clamp(e, 0.0, 1.6), clamp(occ, 0.0, 1.0)) * kk;
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
uniform float uCount;
// The rising vortex funnel: each strand starts ON the rim, evenly spaced
// round it, and wraps about one full turn round the axis as it rises (the
// same way the floor's arms wind in, so the spiral carries on into the air),
// on the surface of a cone narrowing upward; their heights a little staggered.
// Ribbon 0 is the faint glow column on the axis that binds them.
vec3 wispPoint(float k, float v) {
  float ang = k / uCount * 6.2831853 + uSpin * uSpeed * 0.45 + v * 5.2;
  float rad = mix(0.97, uCurl > 0.0 ? 0.3 : 0.18, pow(v, 0.8));
  // It lifts off the rim briskly, then winds on up toward the top.
  float y = (1.0 - pow(1.0 - v, 1.5)) * uRise * (0.82 + 0.18 * h1(k + 4.0));
  return vec3(sin(ang) * rad, y, cos(ang) * rad);
}
void main() {
  bool column = aRibbon < 0.5;
  float k = aRibbon - 1.0;
  float vv = aV;
  vec3 p = column ? vec3(0.0, vv * uRise * 0.9, 0.0) : wispPoint(k, vv);
  vec3 q = column ? vec3(0.0, (vv + 0.03) * uRise * 0.9, 0.0) : wispPoint(k, vv + 0.03);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec4 w2 = modelMatrix * vec4(q, 1.0);
  vec3 tng = w2.xyz - w.xyz;
  tng = length(tng) > 1e-5 ? normalize(tng) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - w.xyz);
  vec3 side = cross(tng, toCam);
  side = length(side) > 1e-5 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  // Seen end-on (from overhead) a rising ribbon would lie flat over the
  // vortex as a loop: it fades out as the view runs along it.
  float endOn = 1.0 - smoothstep(0.7, 0.95, abs(dot(tng, toCam))) * smoothstep(0.7, 0.95, toCam.y);
  // Wide at the foot, easing to a fine tip (the column a broad soft mist).
  float taper = smoothstep(0.0, 0.08, vv) * pow(1.0 - vv, 0.85);
  float width = column ? uWidth * 5.0 * (0.4 + 0.6 * (1.0 - vv)) : uWidth * (0.12 + 0.88 * taper);
  w.xyz += side * aSide * width;
  vSide = aSide;
  vV = vv;
  // Light flowing up each ribbon (a slow travelling swell); lightning adds
  // only a faint flicker to its brightness, never to its shape.
  float flow = 0.6 + 0.4 * sin(vv * 6.0 - uTime * uSpeed * 2.2 + k * 1.7);
  float flick = 1.0 - uJag * 0.25 * step(0.6, h1(floor(uTime * 12.0) + k * 7.0));
  // An ease-out fade to the top.
  float top = 1.0 - vv;
  // Overhead the strands' feet would ride the rim and its pips: from above
  // they thin to a whisper (the floor's information stays clear).
  float above = 1.0 - 0.8 * smoothstep(0.75, 0.97, toCam.y);
  vFade = smoothstep(0.04, 0.2, vv) * top * top * (3.0 - 2.0 * top) * flow * flick * endOn * above;
  if (column) vFade = smoothstep(0.0, 0.15, vv) * top * top * 0.16;
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
  // A soft gaussian cross-section: a bright core and a soft glowing edge.
  float x = vSide;
  float coreG = exp(-x * x * 18.0);
  float glowG = exp(-x * x * 4.0);
  float a = min(1.0, vFade * (coreG + 0.45 * glowG) * 1.5) * uAlpha;
  vec3 col = mix(uBright, uHot, coreG * (1.0 - 0.5 * vV));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}
`;

/** Segments up a wisp. */
const WISP_SEGMENTS = 40;

/** The geometry a pool of markers shares (built once by the owner). */
export interface SoakMarkerGeometry {
  disc: THREE.BufferGeometry;
  wisps: THREE.BufferGeometry;
}

export function buildSoakMarkerGeometry(geometries?: THREE.BufferGeometry[]): SoakMarkerGeometry {
  // Past the rim by SOAK_MARKER.outer: only the rim's own soft halo.
  const disc = new THREE.CircleGeometry(SOAK_MARKER.outer, 112).rotateX(-Math.PI / 2);
  // Ribbon 0 is the axis's glow column, then the strands.
  const n = SOAK_MARKER.wisps + 1;
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
        uBorn: { value: 1 },
        uOuter: { value: SOAK_MARKER.outer },
        uArms: { value: SOAK_MARKER.arms },
        uPitch: { value: SOAK_MARKER.pitch },
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
        uCount: { value: SOAK_MARKER.wisps },
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
    u.uBorn.value = _look.born;
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
    const want = (n + 1) * WISP_SEGMENTS * 6;
    if (this.wisps.geometry.drawRange.count !== want) this.wisps.geometry.setDrawRange(0, want);
    w.uCount.value = n;
    this.group.position.set(p.x, p.y, p.z);
    this.disc.position.y = 0.14;
    this.disc.scale.setScalar(p.radius);
    this.wisps.position.y = 0.1;
    this.wisps.scale.set(p.radius, soakWispHeight(p.radius), p.radius);
    w.uRise.value = _look.wisp;
    this.group.visible = true;
  }
}
