// The shaders of the Anvil of the World's quarters awake (phase 2K,
// heart_quarters.ts paints with them): the quarters' seams, the ridges' veins,
// the dais's crystal, the light washed over each quarter's floor, and the
// air each element raises off its quarter. Texture-free; every motion runs
// on the shared clock; every point goes through `modelViewMatrix` on a
// positioned mesh (the room's centre), so its own `position` is room-local
// and its radius is the platform's.
//
// A flat effect quad is drawn double sided; no `pow()` of a value that can go
// negative (src/render/smith_heart/CLAUDE.md).

import { HEART_QUARTERS } from '../../sim/content/smith_heart_quarters';
import { HEART_QUARTERS_LOOK } from './heart_quarters_core';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const RING = f(HEART_QUARTERS.ringR);
const RIM = f(HEART_QUARTERS.rimR);

/** The vertex half every kit glow here shares: the facet's shade (its
 *  vertex colour) and its room-local point. */
export const KIT_GLOW_VERT = /* glsl */ `
varying vec3 vShade;
varying vec3 vP;
void main() {
  vShade = color;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Each quarter's own life in its seams (sets `flav` 0 to about 2, and
 *  `hot`, the white in it). */
const FLAVOUR: Record<string, string> = {
  // A tremor running out through the slabs every few seconds.
  hammer: `
    float tp = fract(uTime / 2.6);
    float pr = mix(${RING}, ${RIM} + 4.0, tp);
    float tremor = exp(-(r - pr) * (r - pr) / 1.8) * (1.0 - tp);
    float flav = 0.82 + 1.15 * tremor;
    float hot = tremor * 0.6;`,
  // Bands of light wheeling round with the wind's spiral.
  breath: `
    float band = 0.5 + 0.5 * sin(ang * 5.0 + r * 0.32 - uTime * 2.6);
    float flav = 0.62 + 0.62 * band * band;
    float hot = band * band * band * 0.35;`,
  // A slow cold shimmer, glints of frost catching.
  quench: `
    float sh = 0.5 + 0.5 * sin(r * 0.7 - uTime * 0.8 + ang * 2.0);
    float glint = max(0.0, sin(dot(vP.xz, vec2(12.9898, 78.233)) * 3.1 + uTime * 2.3));
    glint = glint * glint * glint * glint * glint * glint * glint * glint;
    float flav = 0.72 + 0.4 * sh + 0.9 * glint;
    float hot = glint * 0.8;`,
  // Molten light flowing out along the seams.
  heat: `
    float flow = 0.5 + 0.5 * sin(r * 1.6 - uTime * 3.4 + sin(ang * 7.0 + uTime * 0.7) * 1.8);
    float flav = 0.7 + 0.65 * flow;
    float hot = flow * flow * 0.7;`,
};

/** A quarter's seams (its kit glow slot): dark but for a faint base glow,
 *  lit inside its flood's front with its own life, the front itself a
 *  bright wave. */
export function quarterGlowFrag(vein: string): string {
  return /* glsl */ `
uniform vec3 uColor;
uniform float uBase;
uniform float uAwake;
uniform float uFront;
uniform float uGain;
uniform float uTime;
uniform float uDark;
varying vec3 vShade;
varying vec3 vP;
void main() {
  float r = length(vP.xz);
  float ang = atan(vP.x, vP.z);
  ${FLAVOUR[vein]}
  float inside = uAwake * (1.0 - smoothstep(uFront - 2.2, uFront, r));
  float dr = r - uFront;
  float edge = uAwake * exp(-dr * dr / 2.4) * (1.0 - smoothstep(${RIM} - 1.0, ${RIM} + 1.5, uFront));
  float breathe = 0.82 + 0.18 * sin(uTime * 1.3 + r * 0.4);
  float level = max(uBase * breathe, inside * flav);
  vec3 dark = mix(vec3(0.035, 0.035, 0.045), uColor * 0.1, 0.5) * (0.5 + 0.6 * vShade.r);
  vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 lit = uColor * (0.5 + 0.65 * vShade.r) * level * 1.3 * mix(1.0, uGain, step(uBase * breathe, inside * flav));
  lit += mix(uColor, white, 0.35 + 0.5 * hot) * hot * inside * 0.55;
  lit += mix(uColor, white, 0.6) * edge * 1.5;
  lit += white * smoothstep(0.9, 1.0, vShade.r) * 0.3 * inside;
  gl_FragColor = vec4((dark + lit) * (1.0 - 0.85 * uDark), 1.0);
  #include <colorspace_fragment>
}`;
}

/** A ridge's vein (its kit glow slot, the ridge turned into place): the
 *  awake neighbours' light running out along it to its horn, and the
 *  shockwave racing both ways from where the boss crossed. */
export const RIDGE_GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShockColor;
uniform float uBase;
uniform float uLit;
uniform float uFront;
uniform float uShockR;
uniform float uShockAge;
uniform float uTime;
uniform float uDark;
varying vec3 vShade;
varying vec3 vP;
void main() {
  float r = length(vP.xz);
  float inside = uLit * (1.0 - smoothstep(uFront - 2.2, uFront, min(r, ${RIM} - 0.5)));
  float flow = 0.7 + 0.45 * sin(r * 0.55 - uTime * 3.2);
  float shock = 0.0;
  if (uShockAge >= 0.0) {
    float d = abs(abs(r - uShockR) - uShockAge * ${f(HEART_QUARTERS_LOOK.shockSpeed)});
    shock = exp(-d * d / 1.6) * (1.0 - smoothstep(${f(HEART_QUARTERS_LOOK.shockLife * 0.5)}, ${f(HEART_QUARTERS_LOOK.shockLife)}, uShockAge));
  }
  float level = max(uBase * (0.85 + 0.15 * sin(uTime * 1.1 + r * 0.3)), inside * flow);
  vec3 dark = vec3(0.04, 0.038, 0.045) * (0.5 + 0.6 * vShade.r);
  vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 lit = uColor * (0.5 + 0.65 * vShade.r) * level * 2.1;
  lit += mix(uShockColor, white, 0.55) * shock * 3.6;
  gl_FragColor = vec4((dark + lit) * (1.0 - 0.85 * uDark), 1.0);
  #include <colorspace_fragment>
}`;

/** The dais's crystal (its kit glow slot): the heart's white-gold beating,
 *  the rays and the kerb toward each quarter in its vein as it wakes, all of
 *  it blazing in the final phase; a pulse runs through it when the light
 *  passes the ring. */
export const DAIS_GLOW_FRAG = /* glsl */ `
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uV3;
uniform vec4 uQ;
uniform float uRing;
uniform float uBlaze;
uniform float uPulse;
uniform float uTime;
uniform float uDark;
varying vec3 vShade;
varying vec3 vP;
void main() {
  float r = length(vP.xz);
  float b = degrees(atan(vP.x, vP.z));
  // The quarter this bearing opens onto at the ring (the sweep unwound).
  float phi = mod(b + ${f(HEART_QUARTERS.sweepDeg)} - (${f(-45 + HEART_QUARTERS.rimOffsetDeg)}), 360.0);
  float idx = floor(phi / 90.0);
  vec3 vc = uV0; float ql = uQ.x;
  if (idx > 0.5) { vc = uV1; ql = uQ.y; }
  if (idx > 1.5) { vc = uV2; ql = uQ.z; }
  if (idx > 2.5) { vc = uV3; ql = uQ.w; }
  vec3 heart = vec3(1.0, 0.86, 0.55);
  float beat = 0.8 + 0.2 * sin(uTime * 2.856);
  float spin = 0.75 + 0.25 * sin(b * 0.0349 * 4.0 - uTime * 1.6 + r * 0.5);
  vec3 c = heart * uRing * beat * spin;
  c += vc * ql * smoothstep(2.5, 8.5, r) * 1.1;
  c *= 1.0 + uBlaze * (1.3 + 0.7 * sin(uTime * 4.2 - r * 0.9));
  float pr = (1.0 - uPulse) * ${RING};
  c += vec3(1.0, 0.95, 0.85) * uPulse * exp(-(r - pr) * (r - pr) / 4.0) * 1.6;
  vec3 dark = vec3(0.05, 0.045, 0.045) * (0.5 + 0.6 * vShade.r);
  vec3 lit = c * (0.55 + 0.6 * vShade.r);
  gl_FragColor = vec4((dark + lit) * (1.0 - 0.85 * uDark), 1.0);
  #include <colorspace_fragment>
}`;

/** The light washed over a quarter's floor (an additive floor mark on the
 *  ground rung): the vein's colour pooled on the stones inside the flood,
 *  brighter at its front; `aEdge` fades it toward the ridges and the rim. */
export const WASH_VERT = /* glsl */ `
attribute float aEdge;
varying vec2 vP;
varying float vEdge;
void main() {
  vP = position.xz;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
export const WASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAwake;
uniform float uFront;
uniform float uGain;
uniform float uTime;
uniform float uDark;
varying vec2 vP;
varying float vEdge;
void main() {
  float r = length(vP);
  float inside = uAwake * (1.0 - smoothstep(uFront - 3.0, uFront, r));
  float dr = r - uFront;
  float edge = uAwake * exp(-dr * dr / 3.0) * (1.0 - smoothstep(${RIM} - 1.0, ${RIM} + 1.5, uFront));
  float pool = 0.55 + 0.45 * sin(uTime * 0.9 + r * 0.25);
  float a = (inside * 0.16 * pool + edge * 0.34) * uGain * vEdge * (1.0 - uDark);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The quad particles' shared fragment: a soft round mote. */
export const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHotColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float d = length(vCorner);
  float a = (1.0 - smoothstep(0.15, 1.0, d)) * vFade * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColor, uHotColor, vHot) * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The gate every quarter particle shares: shown inside its quarter's
 *  flood (`uLit`, `uFront`), hidden (collapsed) otherwise. */
const GATE = /* glsl */ `
  float rr = length(position.xz);
  vFade *= uLit * (1.0 - smoothstep(uFront - 1.5, uFront + 0.5, rr));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * step(0.002, vFade);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;`;

const HEAD = /* glsl */ `
uniform float uTime;
uniform float uLit;
uniform float uFront;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
`;

/** The Hammer's grit: glints of ochre-gold rising slowly off the slabs and
 *  hanging, kicked up as each tremor runs under them. */
export const HAMMER_GRIT_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(uTime * aParams.z * 0.08 + seed);
  float r0 = length(position.xz);
  float tp = fract(uTime / 2.6);
  float pr = mix(${RING}, ${RIM} + 4.0, tp);
  float hop = exp(-(r0 - pr) * (r0 - pr) / 2.0) * (1.0 - tp);
  vec3 p = position;
  p.y = 0.15 + life * (1.0 + 2.6 * aParams.w) + hop * 0.7;
  p.xz += vec2(sin(uTime * 0.4 + seed * 30.0), cos(uTime * 0.33 + seed * 17.0)) * 0.5 * life;
  vFade = sin(3.14159 * life) * (0.55 + 0.45 * sin(uTime * 7.0 + seed * 50.0)) + hop * 0.6;
  vHot = hop;
  float size = 0.045 + 0.06 * aParams.y + hop * 0.04;
  ${GATE}
}`;

/** The Hammer's dust: soft puffs lifting off the floor as a tremor runs
 *  under them. */
export const HAMMER_DUST_VERT = /* glsl */ `${HEAD}
void main() {
  float r0 = length(position.xz);
  float tp = fract(uTime / 2.6);
  float pr = mix(${RING}, ${RIM} + 4.0, tp);
  float hop = exp(-(r0 - pr) * (r0 - pr) / 6.0) * (1.0 - tp);
  vec3 p = position;
  p.y = 0.35 + hop * 0.8;
  vFade = hop * (0.5 + 0.5 * aParams.x);
  vHot = 0.0;
  float size = (1.0 + 1.4 * aParams.y) * (0.7 + 0.5 * hop);
  ${GATE}
}`;

/** The Breath's dust devils: columns of dust spiralling up and wandering
 *  over the quarter (every mote of a devil shares its anchor). */
export const BREATH_DEVIL_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  vec2 c = position.xz + vec2(sin(uTime * 0.27 + aParams.w * 6.28), cos(uTime * 0.21 + aParams.w * 4.0)) * 2.4;
  float h = fract(seed + uTime * aParams.z * 0.16);
  float rad = 0.3 + h * 1.7;
  float ang = seed * 40.0 + uTime * (3.6 - h * 1.6);
  vec3 p = vec3(c.x + sin(ang) * rad, h * 5.8, c.y + cos(ang) * rad);
  vFade = sin(3.14159 * h) * 0.85;
  vHot = h * 0.4;
  float size = (0.1 + 0.2 * aParams.y) * (0.6 + h);
  ${GATE}
}`;

/** The Breath's streaks: thin lines of wind running low over the quarter
 *  along the spiral (`aOther`: the wind's direction there). */
export const BREATH_STREAK_VERT = /* glsl */ `
uniform float uTime;
uniform float uLit;
uniform float uFront;
attribute vec2 aCorner;
attribute vec4 aParams;
attribute vec3 aOther;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float seed = aParams.x;
  float travel = 9.0;
  float s = fract(uTime * aParams.z / travel + seed * 7.13);
  vec3 p = position + aOther * (s - 0.5) * travel;
  p.y = 0.25 + 1.3 * aParams.w + sin(uTime * 0.9 + seed * 20.0) * 0.15;
  float len = aParams.y;
  vec4 a = modelViewMatrix * vec4(p, 1.0);
  vec4 b = modelViewMatrix * vec4(p + aOther * len, 1.0);
  vec2 d = b.xy - a.xy;
  float dl = length(d);
  d = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
  vec2 side = vec2(-d.y, d.x);
  float u = aCorner.x * 0.5 + 0.5;
  vec4 mv = mix(a, b, u);
  float rr = length(position.xz);
  vFade = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.7, 1.0, s));
  vFade *= uLit * (1.0 - smoothstep(uFront - 1.5, uFront + 0.5, rr));
  mv.xy += side * aCorner.y * 0.045 * step(0.002, vFade);
  vCorner = vec2(0.0, aCorner.y);
  vHot = 0.3;
  gl_Position = projectionMatrix * mv;
}`;

/** The Quench's frost mist: wide soft banks hugging the floor, drifting. */
export const QUENCH_MIST_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  vec3 p = position;
  p.xz += vec2(sin(uTime * 0.11 + seed * 9.0), cos(uTime * 0.09 + seed * 5.0)) * 1.6;
  p.y = 0.35 + 0.5 * aParams.w;
  vFade = 0.55 + 0.45 * sin(uTime * 0.35 + seed * 20.0);
  vHot = 0.0;
  float size = 2.2 + 2.4 * aParams.y;
  ${GATE}
}`;

/** The Heat's embers: sparks of white-gold rising off the fire crystal and
 *  the seams, cooling to gold as they climb. */
export const HEAT_EMBER_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(seed + uTime * aParams.z * 0.12);
  vec3 p = position;
  p.y = 0.1 + life * (3.0 + 5.0 * aParams.w);
  p.xz += vec2(sin(uTime * 1.3 + seed * 40.0), cos(uTime * 1.1 + seed * 23.0)) * 0.6 * life;
  vFade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life)) * (0.6 + 0.4 * sin(uTime * 11.0 + seed * 70.0));
  vHot = 1.0 - life;
  float size = 0.05 + 0.07 * aParams.y;
  ${GATE}
}`;

/** The Heat's glow: soft molten light breathing low over its fissures. */
export const HEAT_GLOW_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  vec3 p = position;
  p.y = 0.25;
  vFade = 0.55 + 0.45 * sin(uTime * 1.7 + seed * 13.0);
  vHot = 0.5;
  float size = 1.6 + 1.3 * aParams.y;
  ${GATE}
}`;

/** A ridge's sparks: thrown up as its shockwave passes (`uShockR`,
 *  `uShockAge`), falling back; hidden otherwise. */
export const RIDGE_SPARK_VERT = /* glsl */ `
uniform float uShockR;
uniform float uShockAge;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float r0 = length(position.xz);
  float tp = abs(r0 - uShockR) / ${f(HEART_QUARTERS_LOOK.shockSpeed)};
  float t = uShockAge - tp;
  float on = step(0.0, uShockAge) * step(0.0, t) * step(t, 1.0);
  vec2 out2 = normalize(position.xz + vec2(1e-4));
  vec2 lat = vec2(-out2.y, out2.x) * (aParams.y - 0.5) * 6.0;
  vec3 v = vec3(lat.x + out2.x * (aParams.z - 0.5) * 3.0, 4.0 + 5.0 * aParams.w, lat.y + out2.y * (aParams.z - 0.5) * 3.0);
  vec3 p = position + v * t + vec3(0.0, -9.0 * t * t, 0.0);
  p.y = max(0.05, p.y + 0.2);
  vFade = on * (1.0 - t);
  vHot = 1.0 - t;
  float size = 0.16 + 0.26 * aParams.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * on;
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** The final phase's blaze: motes of the four veins spiralling up out of
 *  the ring's kerb. */
export const BLAZE_VERT = /* glsl */ `
uniform float uTime;
uniform float uBlaze;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float seed = aParams.x;
  float h = fract(seed + uTime * aParams.z * 0.14);
  float ang = atan(position.x, position.z) + h * 2.2 + uTime * 0.45;
  float rad = length(position.xz) * (1.0 - 0.45 * h);
  vec3 p = vec3(sin(ang) * rad, h * 18.0, cos(ang) * rad);
  vFade = sin(3.14159 * h) * uBlaze;
  vHot = aParams.w;
  float size = (0.16 + 0.24 * aParams.y) * (1.0 + h);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * step(0.002, vFade);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** The Quench's crystals growing along its seams (an instanced spike, each
 *  rising as the flood reaches it): additive, so it never hides the floor
 *  marks under it. */
export const CRYSTAL_VERT = /* glsl */ `
uniform float uLit;
uniform float uFront;
uniform float uTime;
varying float vH;
varying float vFace;
void main() {
  vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float r = length(at.xz);
  float grow = uLit * (1.0 - smoothstep(uFront - 3.0, uFront, r));
  vec3 q = position;
  q.y *= grow;
  q.xz *= 0.35 + 0.65 * grow;
  vH = position.y;
  vFace = 0.5 + 0.5 * sin(atan(position.x, position.z) * 3.0 + r);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(q, 1.0);
}`;
export const CRYSTAL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uDark;
varying float vH;
varying float vFace;
void main() {
  float a = (0.35 + 0.45 * vFace) * (0.55 + 0.45 * vH) * (1.0 - uDark);
  if (a < 0.003) discard;
  vec3 c = mix(uColor, vec3(0.95, 0.99, 1.0), 0.35 + 0.4 * vH);
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The shade laid over each quarter (a multiply floor mark on the ground
 *  rung, under its wash): a dormant quarter's stones dimmed, the flood
 *  lifting the shade as it runs out; the room resting, asleep or the heart
 *  dark between. */
export const SHADE_FRAG = /* glsl */ `
uniform float uShade;
uniform float uAwake;
uniform float uFront;
varying vec2 vP;
varying float vEdge;
void main() {
  float r = length(vP);
  float inside = uAwake * (1.0 - smoothstep(uFront - 3.0, uFront, r));
  float m = mix(uShade, 1.0, inside);
  m = mix(1.0, m, vEdge);
  gl_FragColor = vec4(vec3(0.94, 0.95, 1.0) * m + (1.0 - m) * vec3(0.0, 0.0, 0.03), 1.0);
}`;

/** A ridge's curtain of light: rising off its vein while a neighbour is
 *  awake (`aV` 0 at the crest to 1 at its top, `aR` its radius), flaring
 *  tall where the shockwave runs. */
export const CURTAIN_VERT = /* glsl */ `
uniform float uShockR;
uniform float uShockAge;
attribute float aV;
attribute float aR;
varying float vV;
varying float vR;
varying float vShock;
void main() {
  float shock = 0.0;
  if (uShockAge >= 0.0) {
    float d = abs(abs(aR - uShockR) - uShockAge * ${f(HEART_QUARTERS_LOOK.shockSpeed)});
    shock = exp(-d * d / 3.0) * (1.0 - smoothstep(${f(HEART_QUARTERS_LOOK.shockLife * 0.4)}, ${f(HEART_QUARTERS_LOOK.shockLife)}, uShockAge));
  }
  vec3 p = position;
  p.y = 0.18 + aV * (1.4 + 4.2 * shock);
  vV = aV;
  vR = aR;
  vShock = shock;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
export const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShockColor;
uniform float uLit;
uniform float uFront;
uniform float uTime;
uniform float uDark;
varying float vV;
varying float vR;
varying float vShock;
void main() {
  float inside = uLit * (1.0 - smoothstep(uFront - 2.2, uFront, vR));
  float flick = 0.7 + 0.3 * sin(vR * 1.3 - uTime * 4.0 + vV * 3.0);
  float fall = (1.0 - vV) * (1.0 - vV);
  float a = (inside * 0.5 * flick * fall + vShock * (1.0 - vV * 0.8) * 2.2) * (1.0 - uDark);
  if (a < 0.003) discard;
  vec3 c = mix(uColor, uShockColor, clamp(vShock * 1.5, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.97, 0.9), 0.25 + 0.35 * vShock);
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;
