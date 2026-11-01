// The shaders of the Anvil of the World's quarters awake (phases 2K to 2M,
// heart_quarters.ts paints with them): each quarter's edges (since 2M the
// crackle out of the central circle's rim and the border light along its
// seams), the seams' veins, the rim's crystal, the light washed over each
// quarter's floor, and the air each element raises off its quarter. Texture-
// free; every motion runs on the shared clock; every point goes through
// `modelViewMatrix` on a positioned mesh (the room's centre), so its own
// `position` is room-local and its radius is the platform's.
//
// A flat effect quad is drawn double sided; no `pow()` of a value that can go
// negative (src/render/smith_heart/CLAUDE.md).

import { HEART_QUARTERS } from '../../sim/content/smith_heart_quarters';
import { HEART_FLOOR_LOOK } from './heart_floor_glsl';
import { HEART_QUARTERS_LOOK } from './heart_quarters_core';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
/** A sleeping crack: its half width (yards, the kit's main lines, about) and the
 *  painted light it is lit by, the floor's own (`HEART_FLOOR_LOOK.light`). */
const CRACK_HALF_WIDTH = 0.2;
const CRACK_LIGHT = (() => {
  const [x, z] = HEART_FLOOR_LOOK.light;
  const l = Math.hypot(x, z);
  return [x / l, z / l];
})();
const RING = f(HEART_QUARTERS.ringR);
const RIM = f(HEART_QUARTERS.rimR);
const SHOCK_SPEED = f(HEART_QUARTERS_LOOK.shockSpeed);
const SHOCK_LIFE = f(HEART_QUARTERS_LOOK.shockLife);
/** The Hammer's tremor: a wave out of the ring every few seconds (the seams,
 *  the grit, the chips and the dust all read the same clock). */
const TREMOR = /* glsl */ `
    float tp = fract(uTime / 2.6);
    float pr = mix(${RING}, ${RIM} + 4.0, tp);`;

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

/** Each quarter's crackle's own life (sets `flav` 0 to about 2.5, and
 *  `hot`, the white in it; `idleK` its life while it sleeps). Since phase 2M
 *  the glow lives on the edges: the crackle bursting out of the central
 *  circle's rim, the border light along its seams. */
const FLAVOUR: Record<string, string> = {
  // A tremor running out of the rim through the fissures every few
  // seconds, the gold glinting in them.
  hammer: `${TREMOR}
    float tremor = exp(-(r - pr) * (r - pr) / 2.2) * (1.0 - tp);
    float flav = 0.9 + 1.7 * tremor;
    float hot = tremor * 0.8;
    float idleK = 1.0 + 1.4 * tremor;`,
  // Storm crackle: the forks flashing in bursts, a jolt running out.
  breath: `
    float slot = floor(uTime * 13.0);
    float fl = step(0.5, fract(sin(slot * 12.9898 + floor(r * 1.1) * 78.233 + floor(ang * 9.0) * 3.1) * 43758.5453));
    float jr = r - ${RING} - fract(uTime * 0.9) * 14.0;
    float jolt = exp(-jr * jr / 3.0);
    float flav = 0.55 + 1.5 * fl + 1.2 * jolt;
    float hot = fl * 0.7 + jolt * 0.5;
    float idleK = 0.7 + 0.6 * fl;`,
  // Frost cracks: a cold shimmer, glints of frost catching, rime spreading.
  quench: `
    float sh = 0.5 + 0.5 * sin(r * 0.7 - uTime * 0.8 + ang * 2.0);
    float glint = max(0.0, sin(dot(vP.xz, vec2(12.9898, 78.233)) * 3.1 + uTime * 2.3));
    glint = glint * glint * glint * glint * glint * glint * glint * glint;
    float sr = r - ${RING} - fract(uTime * 0.35) * 12.0;
    float spread = exp(-sr * sr / 5.0);
    float flav = 0.85 + 0.45 * sh + 1.1 * glint + 0.8 * spread;
    float hot = glint * 0.85 + 0.15 * sh + spread * 0.3;
    float idleK = 0.85 + 0.3 * sh;`,
  // Molten cracks: light flowing out along them, a pulse of lava running
  // out of the rim every few seconds (asleep too: the Heat smoulders).
  heat: `
    float flow = 0.5 + 0.5 * sin(r * 1.6 - uTime * 3.4 + sin(ang * 7.0 + uTime * 0.7) * 1.8);
    float lp = fract(uTime / 3.4);
    float lpr = mix(${RING} - 1.0, ${RING} + 14.0, lp);
    float pulse = exp(-(r - lpr) * (r - lpr) / 4.0);
    float flav = 0.75 + 0.6 * flow + 1.1 * pulse;
    float hot = flow * flow * 0.55 + pulse * 0.75;
    float idleK = 0.7 + 0.25 * flow + 1.2 * pulse;`,
};

/** A quarter's edges (its kit glow slot): the crackle bursting out of the
 *  rim (grey faces, fading out into the stone; the Heat's fire bed under
 *  the walk) and the border light along its two seams (faces tagged green
 *  over red). Asleep both keep a quiet glow of the quarter's tint (its
 *  idle life: the Heat smoulders); inside its flood they blaze with its
 *  element's life, the flood's front a bright wave running out along the
 *  seams to the wall. */
export function quarterGlowFrag(vein: string): string {
  return /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uBase;
uniform float uIdle;
uniform float uAwake;
uniform float uFront;
uniform float uGain;
uniform float uTime;
uniform float uDark;
varying vec3 vShade;
varying vec3 vP;
float wh(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 q) {
  vec2 i = floor(q);
  vec2 u = fract(q);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), u.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vP.xz);
  float ang = atan(vP.x, vP.z);
  ${FLAVOUR[vein]}
  float inside = uAwake * (1.0 - smoothstep(uFront - 2.2, uFront, r));
  float dr = r - uFront;
  float edge = uAwake * exp(-dr * dr / 2.4) * (1.0 - smoothstep(${RIM} - 1.0, ${RIM} + 1.5, uFront));
  vec3 white = vec3(1.0, 0.97, 0.9);
  float breathe = 0.85 + 0.15 * sin(uTime * 1.3 + r * 0.4);
  float quiet = max(uBase * 4.5 * breathe, uIdle * idleK);
  if (vShade.g - vShade.r > 0.2) {
    // The border light: a thin line of the quarter's tint, its light
    // running out along the seam while it is awake.
    float run = 0.55 + 0.45 * sin(r * 0.8 - uTime * 5.5);
    // Phase 2N: a bright core over a dimmer halo (the halo's tag a value
    // lower), so the line reads soft-edged and crisp from above.
    float core = smoothstep(0.55, 0.68, vShade.g);
    float k = mix(0.42, 1.0, core);
    float lvl = max(quiet * 0.8, inside * (1.3 + 0.9 * run)) * k;
    vec3 c = uColor * lvl * 1.35 + mix(uColor, white, 0.6) * edge * 2.4 * k;
    c += mix(uColor, uHot, 0.5) * inside * run * run * 0.6 * core;
    c += mix(uColor, white, 0.35) * core * max(quiet * 0.35, inside * 0.5);
    gl_FragColor = vec4(c * (1.0 - 0.85 * uDark), 1.0);
    #include <colorspace_fragment>
    return;
  }
  float level = max(quiet, inside * flav * uGain);
  float bed = step(vP.y, -0.001);
  vec3 lit = uColor * (0.4 + 0.8 * vShade.r) * level * (1.5 + 0.4 * bed);
  lit += mix(uColor, uHot, 0.4 + 0.5 * hot) * hot * max(inside, uIdle * 0.5) * (0.4 + 0.8 * vShade.r);
  lit += mix(uColor, white, 0.6) * edge * 1.7 * vShade.r;
  lit += uHot * smoothstep(0.9, 1.0, vShade.r) * 0.4 * max(inside, uIdle);
  vec3 dark = uColor * 0.04;
  vec3 awakeC = dark + lit;
  // Asleep (the AAA pass): a crack cut into the stone, never a ribbon of flat
  // colour. The ribbon's own shade rises from its edges to its middle, so its
  // slope in the plan gives each side of the crack as a wall of a V cut down to
  // that middle: the wall facing the floor's painted light a broken pale stone,
  // the other in shadow, the throat dark, and only a thread down the deepest
  // middle keeps its quarter's quiet glow; the flood's front lights it.
  vec2 pdx = dFdx(vP.xz);
  vec2 pdy = dFdy(vP.xz);
  float sdx = dFdx(vShade.r);
  float sdy = dFdy(vShade.r);
  float pdet = pdx.x * pdy.y - pdx.y * pdy.x;
  vec2 slope = abs(pdet) > 1e-9
    ? vec2(sdx * pdy.y - sdy * pdx.y, sdy * pdx.x - sdx * pdy.x) / pdet
    : vec2(0.0);
  float slopeLen = length(slope);
  vec2 toMiddle = slopeLen > 1e-5 ? slope / slopeLen : vec2(0.0);
  // How far down the wall (0 the arris, 1 the throat): a shade is half its
  // middle's at the edge, and the slope gives that middle's own value.
  float mid = slopeLen * ${CRACK_HALF_WIDTH.toFixed(2)} * 2.0;
  float cut = mid > 1e-4 ? clamp((vShade.r / mid - 0.5) * 2.0, 0.0, 1.0) : 1.0;
  float faced = 0.5 + 0.5 * dot(toMiddle, vec2(${CRACK_LIGHT[0].toFixed(3)}, ${CRACK_LIGHT[1].toFixed(3)}));
  float wall = wn(vP.xz * 2.3);
  vec3 stone = mix(vec3(0.05, 0.038, 0.032), vec3(0.2, 0.15, 0.115), faced * faced) * (0.75 + 0.5 * wall);
  vec3 throat = vec3(0.01, 0.008, 0.009);
  float thread = smoothstep(0.84, 1.0, cut) * smoothstep(0.42, 0.72, wn(vP.xz * 0.55 + 5.0));
  vec3 asleep = mix(stone, throat, smoothstep(0.18, 0.6, cut)) + uColor * thread * min(level, 0.5) * 1.4;
  float wake = clamp(max(inside, edge) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(mix(asleep, awakeC, wake) * (1.0 - 0.85 * uDark), 1.0);
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
    float d = abs(abs(r - uShockR) - uShockAge * ${SHOCK_SPEED});
    shock = exp(-d * d / 5.0) * (1.0 - smoothstep(${f(HEART_QUARTERS_LOOK.shockLife * 0.5)}, ${SHOCK_LIFE}, uShockAge));
  }
  float level = max(uBase * (0.85 + 0.15 * sin(uTime * 1.1 + r * 0.3)), inside * flow);
  vec3 dark = vec3(0.04, 0.038, 0.045) * (0.5 + 0.6 * vShade.r);
  vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 lit = uColor * (0.5 + 0.65 * vShade.r) * level * 2.3;
  lit += mix(uShockColor, white, 0.55) * shock * 5.0;
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
  // Phase 2M: the rim's light, each side in the quarter it opens onto: a
  // quiet tint while the room is awake, blazing with its quarter.
  vec3 c = heart * uRing * beat * spin * 0.75;
  c += vc * (0.22 * uRing + ql * 2.1);
  c *= 1.0 + uBlaze * (1.8 + 0.9 * sin(uTime * 4.2 - r * 0.9));
  float pr = (1.0 - uPulse) * ${RING};
  c += vec3(1.0, 0.95, 0.85) * uPulse * exp(-(r - pr) * (r - pr) / 4.0) * 2.2;
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
/** Phase 2N: each element's own life in the wash round the circle's rim,
 *  layered under the crackle's crisp lines (sets `life`, an additive
 *  glow in the quarter's colour, `hotL` the white in it): the Breath's
 *  storm forks flashing, the Quench's frost glinting and spreading, the
 *  Hammer's tremor rings with gold glinting in them, the Heat's molten
 *  glow flowing out with embers. */
const WASH_LIFE: Record<string, string> = {
  breath: `
    float slotW = floor(uTime * 11.0);
    float fork = abs(wn(vec2(r * 0.9 + slotW * 3.7, ang * 7.0 + slotW)) - 0.5);
    float flash = step(0.55, fract(sin(slotW * 12.9898 + floor(ang * 6.0) * 4.1) * 43758.5453));
    float life = (1.0 - smoothstep(0.0, 0.035, fork)) * flash * 1.6 + 0.25 * flash;
    float hotL = flash * (1.0 - smoothstep(0.0, 0.02, fork));`,
  quench: `
    vec2 gq = floor(vP * 1.6);
    float gh = fract(sin(dot(gq, vec2(127.1, 311.7))) * 43758.5453);
    float tw = max(0.0, sin(uTime * (1.5 + 2.0 * gh) + gh * 40.0));
    float glint = step(0.93, gh) * tw * tw * tw;
    float sr = r - ${RING} - fract(uTime * 0.3) * 16.0;
    float spread = exp(-sr * sr / 6.0);
    float life = 0.35 + 1.6 * glint + 0.6 * spread;
    float hotL = glint + 0.3 * spread;`,
  hammer: `${TREMOR}
    float ring = exp(-(r - pr) * (r - pr) / 1.6) * (1.0 - tp);
    vec2 gq = floor(vP * 1.3);
    float gh = fract(sin(dot(gq, vec2(269.5, 183.3))) * 43758.5453);
    float glint = step(0.94, gh) * (0.5 + 0.5 * sin(uTime * 3.0 + gh * 30.0));
    float life = 0.3 + 1.8 * ring + 1.2 * glint * (0.4 + ring);
    float hotL = ring * 0.6 + glint;`,
  heat: `
    float flowW = wn(vec2(r * 0.35 - uTime * 0.9, ang * 4.0 + sin(uTime * 0.3)));
    float molten = smoothstep(0.45, 0.8, flowW);
    vec2 gq = floor(vP * 1.4 + vec2(0.0, uTime * 0.6));
    float gh = fract(sin(dot(gq, vec2(127.1, 311.7))) * 43758.5453);
    float ember = step(0.95, gh) * (0.5 + 0.5 * sin(uTime * 7.0 + gh * 50.0));
    float life = 0.35 + 1.3 * molten + 1.4 * ember;
    float hotL = molten * 0.4 + ember;`,
};

export function washFrag(vein: string): string {
  return /* glsl */ `
uniform vec3 uColor;
uniform float uAwake;
uniform float uFront;
uniform float uGain;
uniform float uTime;
uniform float uDark;
varying vec2 vP;
varying float vEdge;
float wh(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 q) {
  vec2 i = floor(q);
  vec2 u = fract(q);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), u.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vP);
  float ang = atan(vP.x, vP.y);
  float inside = uAwake * (1.0 - smoothstep(uFront - 3.0, uFront, r));
  float dr = r - uFront;
  float edge = uAwake * exp(-dr * dr / 3.0) * (1.0 - smoothstep(${RIM} - 1.0, ${RIM} + 1.5, uFront));
  float pool = 0.55 + 0.45 * sin(uTime * 0.9 + r * 0.25);
  // Phase 2M: the floor's tint deepens a little over the whole quarter and
  // more toward its edges (the circle's rim and the wall), where its
  // element lives.
  float nearRing = 1.0 - smoothstep(${RING}, ${RING} + 12.0, r);
  float nearRim = smoothstep(${RIM} - 14.0, ${RIM}, r);
  ${WASH_LIFE[vein]}
  // Phase 2N: the element's own life layered round the rim, fading out
  // into the quarter.
  float band = (1.0 - smoothstep(${RING} + 2.0, ${RING} + 17.0, r)) * smoothstep(${RING} - 0.2, ${RING} + 0.8, r);
  float a = (inside * (0.05 + 0.13 * nearRing + 0.08 * nearRim) * pool + edge * 0.26) * uGain * vEdge;
  float l = inside * band * life * 0.16 * uGain * vEdge;
  a = (a + l) * (1.0 - uDark);
  if (a < 0.003) discard;
  vec3 c = mix(uColor, vec3(1.0, 0.97, 0.9), clamp(hotL * 0.5, 0.0, 0.7) * step(0.003, l));
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;
}

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
 *  flood (`uLit`, `uFront`), hidden (collapsed) otherwise; `stretch` draws
 *  the quad taller than wide (a flame, a column of haze). */
const gate = (stretch = '1.0') => /* glsl */ `
  float rr = length(position.xz);
  vFade *= uLit * (1.0 - smoothstep(uFront - 1.5, uFront + 0.5, rr));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * vec2(1.0, ${stretch}) * size * step(0.002, vFade);
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

/** The Hammer's floating grit: glints of ochre and sand lifting off the
 *  blocks and hanging in the air, kicked higher as each tremor runs under
 *  them. */
export const HAMMER_GRIT_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(uTime * aParams.z * 0.07 + seed);
  float r0 = length(position.xz);
  ${TREMOR}
  float hop = exp(-(r0 - pr) * (r0 - pr) / 2.0) * (1.0 - tp);
  vec3 p = position;
  p.y = 0.2 + life * (1.4 + 3.4 * aParams.w) + hop * 1.1;
  p.xz += vec2(sin(uTime * 0.4 + seed * 30.0), cos(uTime * 0.33 + seed * 17.0)) * 0.7 * life;
  vFade = sin(3.14159 * life) * (0.6 + 0.4 * sin(uTime * 7.0 + seed * 50.0)) + hop * 0.8;
  vHot = hop;
  float size = 0.1 + 0.14 * aParams.y + hop * 0.1;
  ${gate()}
}`;

/** The Hammer's dust: great puffs bursting off the floor as a tremor runs
 *  under them, rising and spreading. */
export const HAMMER_DUST_VERT = /* glsl */ `${HEAD}
void main() {
  float r0 = length(position.xz);
  ${TREMOR}
  float hop = exp(-(r0 - pr) * (r0 - pr) / 7.0) * (1.0 - tp);
  float since = clamp((tp - (r0 - ${RING}) / (${RIM} + 4.0 - ${RING})) * 2.6, 0.0, 2.6);
  float puff = step(0.001, since) * exp(-since * 1.2);
  vec3 p = position;
  p.y = 0.4 + since * 0.9;
  vFade = puff * (0.55 + 0.45 * aParams.x);
  vHot = 0.0;
  float size = (1.4 + 2.2 * aParams.y) * (0.6 + 0.6 * since);
  ${gate()}
}`;

/** The Hammer's chips: shards of stone thrown up where the tremor's front
 *  passes and falling back. */
export const HAMMER_CHIP_VERT = /* glsl */ `${HEAD}
void main() {
  float r0 = length(position.xz);
  ${TREMOR}
  float t = (tp - (r0 - ${RING}) / (${RIM} + 4.0 - ${RING})) * 2.6;
  float on = step(0.0, t) * step(t, 0.9);
  float v = 3.0 + 3.0 * aParams.w;
  vec3 p = position + vec3((aParams.y - 0.5) * 2.4 * t, max(0.0, v * t - 6.5 * t * t), (aParams.z - 0.5) * 2.4 * t);
  vFade = on * (1.0 - t / 0.9);
  vHot = 1.0 - t;
  float size = 0.12 + 0.12 * aParams.x;
  ${gate()}
}`;

/** The Breath's dust devils: columns of dust spiralling up and wandering
 *  over the quarter (every mote of a devil shares its anchor). */
export const BREATH_DEVIL_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  vec2 c = position.xz + vec2(sin(uTime * 0.27 + aParams.w * 6.28), cos(uTime * 0.21 + aParams.w * 4.0)) * 3.0;
  float h = fract(seed + uTime * aParams.z * 0.16);
  float rad = 0.4 + h * 2.5;
  float ang = seed * 40.0 + uTime * (3.8 - h * 1.6);
  vec3 p = vec3(c.x + sin(ang) * rad, h * 8.5, c.y + cos(ang) * rad);
  vFade = sin(3.14159 * h) * 0.9;
  vHot = h * 0.45;
  float size = (0.16 + 0.3 * aParams.y) * (0.6 + h);
  ${gate()}
}`;

/** The Breath's streaks: lines of wind running low over the quarter along
 *  the spiral (`aOther`: the wind's direction there). */
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
  float travel = 12.0;
  float s = fract(uTime * aParams.z / travel + seed * 7.13);
  vec3 p = position + aOther * (s - 0.5) * travel;
  p.y = 0.3 + 1.9 * aParams.w + sin(uTime * 0.9 + seed * 20.0) * 0.2;
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
  mv.xy += side * aCorner.y * 0.09 * step(0.002, vFade);
  vCorner = vec2(0.0, aCorner.y);
  vHot = 0.35;
  gl_Position = projectionMatrix * mv;
}`;

/** The Breath's ground sheets: wide veils of dust skating low over the
 *  stones along the wind (`aOther`: its direction). */
export const BREATH_SHEET_VERT = /* glsl */ `
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
  float s = fract(uTime * 0.08 * (0.7 + aParams.z) + seed * 3.7);
  vec3 p = position + aOther * (s - 0.5) * 9.0;
  p.y = 0.35 + 0.3 * aParams.w;
  vFade = sin(3.14159 * s) * (0.6 + 0.4 * aParams.y);
  vHot = 0.0;
  float size = 2.4 + 2.2 * aParams.y;
  ${gate('0.45')}
}`;

/** The Quench's frost mist: wide soft banks hugging the floor, drifting. */
export const QUENCH_MIST_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  vec3 p = position;
  p.xz += vec2(sin(uTime * 0.11 + seed * 9.0), cos(uTime * 0.09 + seed * 5.0)) * 1.8;
  p.y = 0.45 + 0.7 * aParams.w;
  vFade = 0.55 + 0.45 * sin(uTime * 0.35 + seed * 20.0);
  vHot = 0.15 * aParams.z;
  float size = 3.0 + 3.4 * aParams.y;
  ${gate()}
}`;

/** The Quench's frost motes: points of rime rising slowly off the ice and
 *  twinkling as they turn. */
export const QUENCH_FROST_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(seed + uTime * aParams.z * 0.05);
  vec3 p = position;
  p.y = 0.15 + life * (2.5 + 3.5 * aParams.w);
  p.xz += vec2(sin(uTime * 0.6 + seed * 23.0), cos(uTime * 0.5 + seed * 31.0)) * 0.5 * life;
  float tw = 0.5 + 0.5 * sin(uTime * 9.0 + seed * 80.0);
  vFade = sin(3.14159 * life) * (0.35 + 0.65 * tw * tw);
  vHot = tw;
  float size = 0.07 + 0.1 * aParams.y;
  ${gate()}
}`;

/** The Heat's embers: sparks of fire rising off the fissures, cooling from
 *  gold to deep red as they climb. */
export const HEAT_EMBER_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(seed + uTime * aParams.z * 0.11);
  vec3 p = position;
  p.y = 0.1 + life * (4.0 + 8.0 * aParams.w);
  p.xz += vec2(sin(uTime * 1.3 + seed * 40.0), cos(uTime * 1.1 + seed * 23.0)) * 0.9 * life;
  vFade = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.5, 1.0, life)) * (0.6 + 0.4 * sin(uTime * 11.0 + seed * 70.0));
  vHot = 1.0 - life;
  float size = 0.09 + 0.13 * aParams.y;
  ${gate()}
}`;

/** The Heat's haze: columns of shimmering heat rising off the fissures. */
export const HEAT_GLOW_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float life = fract(seed + uTime * 0.16 * (0.7 + aParams.y));
  vec3 p = position;
  p.y = 0.4 + life * 3.2;
  vFade = sin(3.14159 * life) * (0.6 + 0.4 * sin(uTime * 2.3 + seed * 13.0));
  vHot = 0.35 + 0.4 * (1.0 - life);
  float size = 1.3 + 1.2 * aParams.y;
  ${gate('1.9')}
}`;

/** The Heat's flames: tongues of fire licking up out of the fissures,
 *  flickering and dying back. */
export const HEAT_FLAME_VERT = /* glsl */ `${HEAD}
void main() {
  float seed = aParams.x;
  float cyc = fract(seed + uTime * (0.45 + 0.35 * aParams.z));
  float lick = sin(3.14159 * cyc);
  vec3 p = position;
  p.y = 0.25 + lick * (0.55 + 0.6 * aParams.w);
  p.x += sin(uTime * 6.0 + seed * 40.0) * 0.08;
  vFade = lick * (0.7 + 0.3 * sin(uTime * 17.0 + seed * 90.0));
  vHot = 0.35 + 0.65 * (1.0 - cyc);
  float size = (0.3 + 0.3 * aParams.y) * (0.6 + 0.6 * lick);
  ${gate('2.4')}
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
  float tp = abs(r0 - uShockR) / ${SHOCK_SPEED};
  float t = uShockAge - tp;
  float on = step(0.0, uShockAge) * step(0.0, t) * step(t, 1.2);
  vec2 out2 = normalize(position.xz + vec2(1e-4));
  vec2 lat = vec2(-out2.y, out2.x) * (aParams.y - 0.5) * 8.0;
  vec3 v = vec3(lat.x + out2.x * (aParams.z - 0.5) * 4.0, 6.0 + 7.0 * aParams.w, lat.y + out2.y * (aParams.z - 0.5) * 4.0);
  vec3 p = position + v * t + vec3(0.0, -9.0 * t * t, 0.0);
  p.y = max(0.05, p.y + 0.5);
  vFade = on * (1.0 - t / 1.2);
  vHot = 1.0 - t;
  float size = 0.22 + 0.36 * aParams.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * on;
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** A ridge's dust: great puffs bursting off its flanks as the shockwave
 *  passes, rising and spreading. */
export const RIDGE_DUST_VERT = /* glsl */ `
uniform float uShockR;
uniform float uShockAge;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float r0 = length(position.xz);
  float tp = abs(r0 - uShockR) / ${SHOCK_SPEED};
  float t = uShockAge - tp;
  float on = step(0.0, uShockAge) * step(0.0, t) * step(t, 1.6);
  vec2 out2 = normalize(position.xz + vec2(1e-4));
  vec2 lat = vec2(-out2.y, out2.x) * (aParams.y - 0.5) * 3.0;
  vec3 p = position + vec3(lat.x * t, 0.6 + 2.2 * t * (0.6 + aParams.w), lat.y * t);
  vFade = on * exp(-t * 1.6) * (0.6 + 0.4 * aParams.z);
  vHot = 0.0;
  float size = (1.0 + 1.6 * aParams.x) * (0.6 + 0.9 * t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * size * on;
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** The final phase's blaze: slivers of the four veins' light spiralling up out
 *  of the ring's kerb (`aParams.w` picks each one's vein; never balls). */
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
  float ang = atan(position.x, position.z) + h * 2.6 + uTime * 0.55;
  float rad = length(position.xz) * (1.0 - 0.5 * h);
  vec3 p = vec3(sin(ang) * rad, h * 24.0, cos(ang) * rad);
  vFade = sin(3.14159 * h) * uBlaze;
  vHot = aParams.w;
  float size = (0.028 + 0.055 * aParams.y) * (1.0 + 0.7 * h);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * vec2(1.0, 3.4) * size * step(0.002, vFade);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

/** A sliver of the blaze: soft, tall and thin, in its vein's colour. */
export const BLAZE_FRAG = /* glsl */ `
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uV3;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float d = length(vCorner);
  float a = (1.0 - smoothstep(0.1, 1.0, d)) * vFade;
  if (a < 0.003) discard;
  float w = vHot * 4.0;
  vec3 c = w < 1.0 ? uV0 : w < 2.0 ? uV1 : w < 3.0 ? uV2 : uV3;
  gl_FragColor = vec4(mix(c, vec3(1.0, 0.96, 0.86), 0.4) * a * 1.5, 1.0);
  #include <colorspace_fragment>
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
  float a = (0.45 + 0.55 * vFace) * (0.6 + 0.5 * vH) * (1.0 - uDark);
  if (a < 0.003) discard;
  vec3 c = mix(uColor, vec3(0.95, 0.99, 1.0), 0.35 + 0.45 * vH);
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

/** A ridge's curtain of light: rising off its spine while a neighbour is
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
    float d = abs(abs(aR - uShockR) - uShockAge * ${SHOCK_SPEED});
    shock = exp(-d * d / 7.0) * (1.0 - smoothstep(${f(HEART_QUARTERS_LOOK.shockLife * 0.4)}, ${SHOCK_LIFE}, uShockAge));
  }
  vec3 p = position;
  // Phase 2N: at 120 yd the crossing's wall of light stands taller.
  p.y = 0.45 + aV * (1.3 + 13.0 * shock);
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
  float a = (inside * 0.6 * flick * fall + vShock * (1.0 - vV * 0.8) * 2.8) * (1.0 - uDark);
  if (a < 0.003) discard;
  vec3 c = mix(uColor, uShockColor, clamp(vShock * 1.5, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.97, 0.9), 0.25 + 0.35 * vShock);
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;
