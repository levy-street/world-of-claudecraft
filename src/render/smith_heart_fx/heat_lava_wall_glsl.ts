// The Guardian of the Heat's wall of fire in GLSL (heat_lava_wall_fx.ts; the plan
// heat_lava_wall_core.ts): one ring of lava rolling out of the wellspring drawn as
//  - the curtain: stacked sheets of fire standing on the ring (domain-warped noise
//    rising through them, columns of flame of uneven height, tips eroding into
//    licks, a white-yellow core at the foot cooling to deep red at the tips), the
//    sheets set a little in and out of the ring so the wall has depth;
//  - its smoke: a taller sheet behind it, dark billows rolling up off the tips,
//    their undersides lit by the fire;
//  - its tongues: camera-facing ribbons leaping off the wall and breaking away;
//  - its embers and sparks: points swirling up off it, the sparks flung ahead;
//  - its haze: faint warm streaks wavering in the air over it (cosmetic);
//  - its foot on the floor: the molten band at the sim's own front and depth,
//    the floor ahead lit by it, the scorched basalt cooling behind it, the
//    corridors dark crust with glowing parted edges;
//  - the corridors on the floor: cool light down each line, chevrons running out
//    toward the walls, the warning throbbing quicker to the launch.
// Every piece clips to the Hearth's eight-sided floor (its polygon in uPoly) and
// parts at the corridors (wallOpen: heat_lava_wall_core.ts). Strings only.

import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { LAVA_WALL } from './heat_lava_wall_core';
import { HEAT_LIP_CLIP_R } from './heat_lip_clip_core';

/** Hearth floor polygon corners (FORGE_POINTS) as a uniform array. */
export const WALL_POLY_N = 12;

/** The ring's shared uniforms and helpers: where its wall stands, where it parts,
 *  where the floor ends. Every wall shader includes it. */
export const WALL_COMMON_GLSL = /* glsl */ `
uniform vec3 uCenter;
uniform float uR;
uniform vec4 uGaps;
uniform vec2 uPoly[${WALL_POLY_N}];
uniform float uRise;
uniform float uTime;
const float WALL_PART = ${LAVA_WALL.part.toFixed(3)};
// The lip clip (heat_lip_clip_core.ts): nothing of a ring draws over the boss's
// disc; its fire stands up as its front clears the lip wall's outer face.
const float WALL_LIP = ${HEAT_LIP_CLIP_R.toFixed(3)};
float wallOffLip(float r) { return smoothstep(WALL_LIP, WALL_LIP + 0.8, r); }
// The Hearth's floor polygon: negative inside, the distance to its edge.
float wallPolySd(vec2 p) {
  float d = dot(p - uPoly[0], p - uPoly[0]);
  float s = 1.0;
  for (int i = 0, j = ${WALL_POLY_N - 1}; i < ${WALL_POLY_N}; j = i, i++) {
    vec2 e = uPoly[j] - uPoly[i];
    vec2 w = p - uPoly[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uPoly[i].y, p.y < uPoly[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
// How much flame stands at bearing a (0 in a corridor, 1 well clear of it).
float wallOpen(float a) {
  float o = 1.0;
  for (int i = 0; i < 2; i++) {
    if (float(i) >= uGaps.w) break;
    float g = i == 0 ? uGaps.x : uGaps.y;
    float d = a - g;
    float across = cos(d) > 0.0 ? abs(sin(d)) * uR : 1000.0;
    o = min(o, smoothstep(uGaps.z, uGaps.z + WALL_PART, across));
  }
  return o;
}
// Inside the floor, faded over its last yard.
float wallInFloor(vec2 xz) {
  return smoothstep(-0.2, 1.2, -wallPolySd(xz));
}
`;

/** Hash and value noise (cheap), a three-octave fbm. */
const NOISE = /* glsl */ `
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), u.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float wfbm(vec2 p) {
  return wn(p) * 0.55 + wn(p * 2.03 + 1.7) * 0.3 + wn(p * 4.01 + 3.1) * 0.15;
}
`;

/** The curtain's vertex: the ring's sheets standing on the floor, parted and
 *  clipped, swaying, leaning back from the way the wall rolls. */
export const WALL_CURTAIN_VERT = /* glsl */ `
uniform float uH;
uniform float uLift;
attribute vec2 aSheet;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${WALL_COMMON_GLSL}
${CAMERA_RELATIVE_GLSL}
void main() {
  float a = position.x * 6.2831853;
  float R = max(uR + aSheet.x, 0.5);
  vec2 dir = vec2(sin(a), cos(a));
  vec2 xz = uCenter.xz + dir * R;
  float m = wallOpen(a) * wallInFloor(uCenter.xz + dir * uR) * uRise * wallOffLip(uR);
  vMask = m;
  vSeed = aSheet.y;
  float v = position.y;
  float s = aSheet.y * 37.0;
  float arc = a * uR;
  // The fire leans back off its roll and sways with the gusts it makes.
  float sway = sin(arc * 0.31 + uTime * 1.7 + s) * 0.32 + sin(arc * 0.83 - uTime * 2.9 + s * 1.3) * 0.16;
  xz += dir * (sway - 0.9) * v * v;
  float h = uH * (0.35 + 0.65 * m);
  vec3 w = vec3(xz.x, uCenter.y + 0.03 + uLift * uH + v * h, xz.y);
  vUv = vec2(arc, v);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** The fire's colour ramp: deep red at the tips through orange to a
 *  white-yellow core (the Hearth's fire ramp, heat_flame_core.ts). */
export function wallFireFrag(rampGlsl: string): string {
  return /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uGain;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${NOISE}
${rampGlsl}
void main() {
  if (vMask < 0.01) discard;
  float x = vUv.x;
  float y = vUv.y;
  float t = uTime * (0.95 + 0.2 * vSeed);
  float sd = vSeed * 19.0;
  // Tongues of uneven height: a ridged field along the wall (sharp peaks, a
  // tongue every yard or two), breathing on its own slow clock.
  float r1 = 1.0 - abs(2.0 * wn(vec2(x * 0.62 + sd, t * 0.9)) - 1.0);
  float r2 = 1.0 - abs(2.0 * wn(vec2(x * 1.35 - sd, t * 1.7 + 3.0)) - 1.0);
  float col = wfbm(vec2(x * 0.18 + sd, t * 0.35));
  float top = (0.3 + 0.48 * r1 * r1 + 0.22 * r2 * r2 + 0.3 * col) * (0.55 + 0.45 * vMask);
  // The flow: noise rising faster than the wall, warped by a slower field.
  vec2 q = vec2(x * 0.42 + sd, y * 1.65 - t * 2.1);
  vec2 warp = vec2(wfbm(q * 0.7 + vec2(0.0, -t * 0.45)), wfbm(q * 0.7 + vec2(4.1, 2.3 - t * 0.45))) - 0.5;
  float n = wfbm(q * 1.8 + warp * 2.1 + vec2(0.0, -t * 1.3));
  float yy = y / max(0.05, top);
  // Each tongue's root: the flames rise from roots a yard or so apart, darker
  // and thinner between them, so even the foot of the wall has a grain.
  float roots = 0.55 + 0.45 * r1 + 0.25 * (wn(vec2(x * 2.6 + sd, t * 3.1)) - 0.5);
  float I = (1.0 - yy) * 1.1 * roots + (n - 0.5) * 1.35;
  // The tips break into licks and gaps as they climb.
  I -= smoothstep(0.4, 1.05, yy) * (1.0 - n) * 0.85;
  // The foot boils out of the molten band: hot, broken by the flow.
  float foot = 1.0 - smoothstep(0.0, 0.1, y);
  I += foot * (0.05 + 0.3 * wn(vec2(x * 1.7 + sd, t * 2.3)));
  I = clamp(I * 1.3, 0.0, 1.0) * smoothstep(0.0, 0.25, vMask);
#ifdef SOFT_FOOT
  // The foot melts into the floor (no straight line where the sheet meets
  // it: the floor's own molten seam carries the fire down to the stone).
  I *= smoothstep(0.0, 0.16, y);
#endif
#ifdef WALL_DARK
  // The wall's dark body under the fire (normal blend): a smoky deep-red mass
  // a little wider than the flames, so the bright fire has a dark edge and the
  // wall reads as a body, never a see-through glow.
  float body = smoothstep(0.0, 0.22, I + 0.08) * (1.0 - 0.45 * smoothstep(0.5, 1.0, yy));
  vec3 dark = mix(vec3(0.16, 0.035, 0.01), vec3(0.04, 0.02, 0.016), smoothstep(0.2, 0.9, yy));
  gl_FragColor = vec4(dark, body * 0.62);
#else
  // White-yellow low in the wall, orange through it, deep red at the tips.
  float h = I * uHeat * 0.94 * (1.0 - 0.42 * smoothstep(0.0, 1.0, yy));
  vec3 c = fireRamp(h) * (1.0 + 0.35 * foot * h) * uGain;
  float alpha = smoothstep(0.04, 0.3, I) * (0.8 + 0.2 * n);
  gl_FragColor = vec4(c, alpha);
#endif
}
`;
}

/** The glow round the wall (additive, faint, wide): the air lit by it, so the
 *  wall reads as a source of light, not a cut-out. */
export const WALL_GLOW_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
void main() {
  if (vMask < 0.01) discard;
  float y = vUv.y;
  float breath = 0.85 + 0.15 * sin(uTime * 3.1 + vUv.x * 0.21);
  float a = (1.0 - smoothstep(0.0, 1.0, y)) * vMask * 0.1 * breath;
  gl_FragColor = vec4(vec3(1.0, 0.5, 0.16), a);
}
`;

/** The smoke rolling up off the wall's tips (normal blend): soot dark round
 *  the flames' tips, billows rolling up above them, their undersides lit by
 *  the fire, thinning to nothing up high. Drawn behind the fire: it gives the
 *  bright flames their dark edge against the bright Hearth. */
export const WALL_SMOKE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${NOISE}
void main() {
  if (vMask < 0.01) discard;
  float x = vUv.x;
  float y = vUv.y;
  float t = uTime;
  // Billows rolling up in plumes over the hottest stretches of the wall.
  vec2 q = vec2(x * 0.42 + vSeed * 9.0, y * 3.4 - t * 0.75);
  vec2 warp = vec2(wfbm(q * 0.7), wfbm(q * 0.7 + vec2(3.3, 1.7))) - 0.5;
  float n = wfbm(q * 1.3 + warp * 2.2);
  float plume = smoothstep(0.3, 0.68, wn(vec2(x * 0.11 + vSeed * 3.0, t * 0.12)));
  float body = smoothstep(0.42, 0.72, n + 0.18 * (1.0 - y)) * (0.35 + 0.65 * plume);
  float fade = smoothstep(0.1, 0.32, y) * (1.0 - smoothstep(0.55, 1.0, y));
  float a = body * fade * vMask * 0.85;
  vec3 smoke = vec3(0.06, 0.045, 0.04);
  vec3 lit = vec3(0.62, 0.22, 0.05);
  vec3 c = mix(smoke, lit, (1.0 - smoothstep(0.18, 0.52, y)) * (0.35 + 0.65 * n));
  gl_FragColor = vec4(c, a);
}
`;

/** The heat haze over the wall (additive, faint): warm streaks wavering up. */
export const WALL_HAZE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
void main() {
  if (vMask < 0.01) discard;
  float x = vUv.x;
  float h = vUv.y;
  float bend = sin(h * 5.0 - uTime * 1.6 + x * 0.6) * 0.35;
  float wave = 0.5 + 0.5 * sin(x * 2.3 + bend * 6.0 + sin(x * 0.7 + uTime * 0.7));
  float rise = 0.5 + 0.5 * sin(h * 9.0 - uTime * 2.4 + x * 1.1);
  float streak = pow(max(wave, 0.0), 6.0) * (0.35 + 0.65 * rise);
  float fade = smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.4, 1.0, h));
  vec3 c = vec3(1.0, 0.7, 0.38) * streak * fade * 0.09 * vMask;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** A tongue of flame leaping off the wall (instanced ribbons turned to the
 *  camera round a bent spine): it grows, licks up, breaks off and fades. */
export const WALL_TONGUE_VERT = /* glsl */ `
uniform float uTongue;
attribute vec2 aTongue; // the bearing (0..1), the seed
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${WALL_COMMON_GLSL}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = aTongue.y;
  float a = aTongue.x * 6.2831853;
  vec2 dir = vec2(sin(a), cos(a));
  float m = wallOpen(a) * wallInFloor(uCenter.xz + dir * uR) * uRise * wallOffLip(uR);
  float period = 0.9 + 0.9 * fract(aTongue.y * 7.31);
  float ph = fract(uTime / period + aTongue.y * 3.7);
  // It swells, reaches its height, then breaks off and rises away.
  float grow = sin(min(ph, 0.75) / 0.75 * 3.14159);
  float lift = smoothstep(0.6, 1.0, ph) * 0.5;
  float hgt = uTongue * (0.45 + 0.55 * fract(aTongue.y * 13.7)) * (0.35 + 0.65 * grow) * m;
  vAlpha = m * (1.0 - smoothstep(0.62, 0.92, ph)) * smoothstep(0.0, 0.1, ph);
  if (vAlpha <= 0.002 || hgt < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float off = (fract(aTongue.y * 5.17) - 0.5) * 1.2;
  vec3 base = vec3(uCenter.x + dir.x * (uR + off), uCenter.y + 0.2 + lift * hgt * 0.9, uCenter.z + dir.y * (uR + off));
  float v = vUv.y;
  vec3 up = vec3(0.0, hgt, 0.0);
  vec3 lean = vec3(-dir.x, 0.0, -dir.y) * hgt * 0.35;
  vec3 spine = base + up * v + lean * v * v;
  vec3 tangent = normalize(up + 2.0 * lean * v);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 side = cross(tangent, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float s = aTongue.y * 40.0;
  float sBend = sin(v * 5.2 - uTime * 3.6 + s) * (0.6 + 0.4 * sin(uTime * 1.3 + s * 0.7));
  float flick = sin(uTime * 9.3 + s * 2.1) * 0.5 + sin(uTime * 13.7 + s * 3.3) * 0.3;
  spine += side * (sBend * 0.14 * v + flick * 0.1 * v * v * v) * hgt;
  float width = hgt * (0.42 + 0.2 * fract(aTongue.y * 3.3)) * (1.0 - 0.45 * lift);
  vec3 w = spine + side * position.x * width;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

export function wallTongueFrag(rampGlsl: string): string {
  return /* glsl */ `
uniform float uTime;
uniform float uHeat;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${NOISE}
${rampGlsl}
void main() {
  vec2 uv = vUv;
  float s = vSeed * 17.0;
  float t = uTime * (0.9 + 0.25 * vSeed);
  vec2 q = vec2(uv.x * 2.1 + s, uv.y * 1.7 - t * 1.8);
  vec2 warp = vec2(wfbm(q * 0.8 + vec2(0.0, -t * 0.5)), wfbm(q * 0.8 + vec2(5.2, 1.3 - t * 0.5))) - 0.5;
  float n = wfbm(q * 1.9 + warp * 1.7 + vec2(0.0, -t * 1.1));
  float x = (uv.x - 0.5) * 2.0 + warp.x * 1.1 * uv.y;
  float halfW = mix(0.8, 0.05, pow(clamp(uv.y, 0.0, 1.0), 0.8));
  float shape = 1.0 - smoothstep(halfW * 0.2, halfW, abs(x));
  float root = smoothstep(0.0, 0.16, uv.y);
  float I = shape * root * (0.45 + 0.8 * n) - uv.y * 0.38;
  I -= smoothstep(0.45, 1.0, uv.y) * (1.0 - n) * 0.55;
  I = clamp(I * 1.35, 0.0, 1.0);
  float h = I * uHeat * (1.0 - 0.36 * uv.y);
  vec3 col = fireRamp(h);
  float a = smoothstep(0.04, 0.24, I) * vAlpha;
  gl_FragColor = vec4(col, a);
}
`;
}

/** Embers swirling up off the wall and sparks flung ahead of it (points). */
export const WALL_EMBER_VERT = /* glsl */ `
uniform float uPx;
attribute vec4 aEmber; // the bearing (0..1), the seed, its speed, its size
varying float vLife;
varying float vSpark;
varying float vAlpha;
${WALL_COMMON_GLSL}
${CAMERA_RELATIVE_GLSL}
void main() {
  float a = aEmber.x * 6.2831853;
  vec2 dir = vec2(sin(a), cos(a));
  float m = wallOpen(a) * wallInFloor(uCenter.xz + dir * uR) * uRise * wallOffLip(uR);
  float seed = aEmber.y;
  float life = fract(uTime * aEmber.z + seed * 11.0);
  vLife = life;
  float spark = step(seed, 0.28);
  vSpark = spark;
  vec2 side = vec2(dir.y, -dir.x);
  vec3 p;
  if (spark > 0.5) {
    // Flung ahead of the wall and falling.
    float tau = life * 1.1;
    float out_ = 3.5 + 7.0 * fract(seed * 7.7);
    float up = 4.0 + 6.0 * fract(seed * 3.9);
    vec2 xz = uCenter.xz + dir * (uR + out_ * tau) + side * (fract(seed * 5.3) - 0.5) * 3.0 * tau;
    p = vec3(xz.x, uCenter.y + 0.6 + up * tau - 5.5 * tau * tau, xz.y);
    if (p.y < uCenter.y + 0.05) m = 0.0;
  } else {
    // Rising and curling on the fire's updraft.
    float hgt = life * (6.0 + 9.0 * fract(seed * 2.3));
    float curl = sin(uTime * 1.3 + seed * 40.0 + hgt * 0.4) * (0.6 + hgt * 0.12);
    float back = -0.8 + 1.6 * fract(seed * 9.1) - hgt * 0.12;
    vec2 xz = uCenter.xz + dir * (uR + back) + side * curl;
    p = vec3(xz.x, uCenter.y + 0.5 + hgt, xz.y);
  }
  vAlpha = m * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
  vec4 mv = wocCamRelView(p);
  gl_Position = projectionMatrix * mv;
  float sz = aEmber.w * (spark > 0.5 ? 0.7 : 1.0) * (1.0 - 0.5 * life);
  gl_PointSize = vAlpha > 0.002 ? clamp(sz * uPx / max(1.0, -mv.z), 1.0, 40.0) : 0.0;
}
`;

export const WALL_EMBER_FRAG = /* glsl */ `
varying float vLife;
varying float vSpark;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0 || vAlpha <= 0.002) discard;
  float core = 1.0 - smoothstep(0.0, 1.0, r);
  vec3 hot = vec3(1.0, 0.92, 0.62);
  vec3 warm = vec3(1.0, 0.5, 0.12);
  vec3 cool = vec3(0.7, 0.12, 0.03);
  vec3 c = mix(hot, warm, smoothstep(0.0, 0.45, vLife));
  c = mix(c, cool, smoothstep(0.45, 1.0, vLife));
  c *= vSpark > 0.5 ? 1.6 : 1.15;
  gl_FragColor = vec4(c, core * core * vAlpha);
}
`;

/** The wall's foot on the floor: the band's vertex (position.x the bearing
 *  0..1, position.y the row 0..1 from far behind to ahead of the front). */
export const WALL_BAND_VERT = /* glsl */ `
uniform float uBehind;
uniform float uAhead;
varying float vOff;
varying float vA;
varying vec3 vW;
varying vec2 vL;
${WALL_COMMON_GLSL}
${CAMERA_RELATIVE_GLSL}
void main() {
  float a = position.x * 6.2831853;
  // More rows near the front (the molten band), fewer out in the light and scorch.
  float k = position.y * 2.0 - 1.0;
  float off = k < 0.0 ? -uBehind * pow(max(-k, 0.0), 1.6) : uAhead * pow(max(k, 0.0), 1.6);
  float R = max(max(${T.ringStart.toFixed(3)}, WALL_LIP), uR + off);
  vec2 dir = vec2(sin(a), cos(a));
  vec3 w = vec3(uCenter.x + dir.x * R, uCenter.y + 0.06, uCenter.z + dir.y * R);
  vOff = R - uR;
  vA = a;
  vW = w;
  // Yards from the well's middle, small and steady (the noise's frame: world
  // yards a hundred thousand out shimmer, heat_lip_clip_core.ts).
  vL = dir * R;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** The band's fragment: molten under the wall, the floor lit ahead, scorched
 *  behind, dark crust in the corridors with their parted edges glowing. Written
 *  as one normal-blend source (heat_molten_decal.ts splits it char and glow). */
export function wallBandFrag(noiseGlsl: string, moltenGlsl: string, lavaGlsl: string): string {
  return /* glsl */ `
uniform float uHeat;
varying float vOff;
varying float vA;
varying vec3 vW;
varying vec2 vL;
${WALL_COMMON_GLSL}
${noiseGlsl}
${moltenGlsl}
${lavaGlsl}
void main() {
  float inF = wallInFloor(vW.xz);
  if (inF < 0.01 || uRise < 0.01) discard;
  float open = wallOpen(vA);
  float off = vOff;
  float B = ${LAVA_WALL.bandBehind.toFixed(3)};
  float A = ${LAVA_WALL.bandAhead.toFixed(3)};
  // The molten band itself (ragged edges), only where the wall stands.
  float rag = (vn(vec2(vA * uR * 0.5, uTime * 0.7)) - 0.5) * 0.9;
  float band = smoothstep(-B - 0.4 + rag, -B + 0.5 + rag, off) * (1.0 - smoothstep(A - 0.2, A + 0.5, off - rag * 0.4));
  float lvl = lavaLevel(vL, vec2(0.0), uTime, 1.25);
  float m = band * open * (0.35 + 0.7 * lvl) * uHeat * 0.85;
  vec3 col = molten(clamp(m, 0.0, 1.0));
  float alpha = band * open * 0.96;
  // Ahead: the floor lit by the fire coming (a warm pool, brightest at the foot).
  float ahead = max(0.0, off - A);
  float light = exp(-ahead / 2.6) * step(A, off) * (0.35 + 0.65 * open);
  col = mix(col, vec3(1.0, 0.55, 0.18) * 1.4, light * (1.0 - alpha));
  alpha = max(alpha, light * 0.42);
  // Behind: the scorched basalt cooling, its cracks dying red.
  float behind = max(0.0, -B - off);
  float scorch = (1.0 - smoothstep(0.0, ${LAVA_WALL.scorchBehind.toFixed(3)} - B, behind)) * step(off, -B) * open;
  float crack = (1.0 - smoothstep(0.0, 0.09, cellEdge(vL * 0.55))) * exp(-behind / 2.2);
  vec3 sc = mix(vec3(0.05, 0.04, 0.035), vec3(1.0, 0.35, 0.08) * 1.3, crack);
  col = mix(col, sc, scorch * (1.0 - alpha));
  alpha = max(alpha, scorch * (0.55 * (1.0 - smoothstep(0.0, 6.0, behind)) + crack * 0.6));
  // The corridors: dark cooled crust through the wall's foot, its edges glowing.
  float inGap = (1.0 - open) * smoothstep(-B - 0.4, -B + 0.4, off) * (1.0 - smoothstep(A, A + 0.6, off));
  float edge = smoothstep(0.08, 0.5, open) * (1.0 - smoothstep(0.5, 0.95, open)) * band;
  col = mix(col, vec3(0.035, 0.03, 0.028), inGap * (1.0 - edge));
  alpha = max(alpha, inGap * 0.7);
  col += vec3(1.0, 0.62, 0.22) * edge * 1.6;
  alpha = max(alpha, edge * 0.9);
  gl_FragColor = vec4(col, clamp(alpha * inF, 0.0, 0.97));
}
`;
}

/** A corridor on the floor (additive): cool light down its line, bright edges,
 *  chevrons running out toward the walls. position.x across (-1..1), position.y
 *  along (0..1 from uFrom to uTo). */
export const WALL_CORRIDOR_VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uGap;
uniform float uHalf;
uniform float uFrom;
uniform float uTo;
varying vec2 vC; // across (-1..1), along (yards)
varying vec3 vW;
${CAMERA_RELATIVE_GLSL}
void main() {
  vec2 dir = vec2(sin(uGap), cos(uGap));
  vec2 side = vec2(dir.y, -dir.x);
  float along = mix(uFrom, uTo, position.y);
  vec2 xz = uCenter.xz + dir * along + side * position.x * uHalf;
  vec3 w = vec3(xz.x, uCenter.y + 0.08, xz.y);
  vC = vec2(position.x, along);
  vW = w;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

export const WALL_CORRIDOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uBeat;
uniform float uWarn;
uniform float uHalf;
uniform float uFrom;
uniform float uTo;
uniform vec2 uPoly[${WALL_POLY_N}];
varying vec2 vC;
varying vec3 vW;
float corridorPolySd(vec2 p) {
  float d = dot(p - uPoly[0], p - uPoly[0]);
  float s = 1.0;
  for (int i = 0, j = ${WALL_POLY_N - 1}; i < ${WALL_POLY_N}; j = i, i++) {
    vec2 e = uPoly[j] - uPoly[i];
    vec2 w = p - uPoly[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uPoly[i].y, p.y < uPoly[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
void main() {
  float inF = smoothstep(-0.2, 0.8, -corridorPolySd(vW.xz));
  // Off the boss's disc (the lip clip, heat_lip_clip_core.ts).
  if (inF < 0.01 || vC.y < ${HEAT_LIP_CLIP_R.toFixed(3)}) discard;
  float x = abs(vC.x);
  float along = vC.y;
  float yards = x * uHalf;
  // The edges: a bright line on each side (a fixed yard width, any corridor).
  float edge = 1.0 - smoothstep(0.0, 0.3, abs(uHalf - yards));
  float inner = (1.0 - smoothstep(0.0, 1.6, abs(uHalf - yards))) * 0.2;
  float wash = (1.0 - smoothstep(0.5, 1.0, x)) * 0.035;
  // Chevrons running out along the corridor, pointing the way the fire rolls.
  float v = fract((along + yards * 0.7) * 0.2 - uTime * (uWarn > 0.5 ? 0.9 : 1.4));
  float chev = smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.14, 0.22, v)) * (1.0 - smoothstep(0.7, 1.0, x));
  float ends = smoothstep(uFrom, uFrom + 1.5, along) * (1.0 - smoothstep(uTo - 1.0, uTo, along));
  vec3 cool = uWarn > 0.5 ? vec3(0.22, 0.68, 1.0) : vec3(0.45, 0.88, 1.0);
  float k = (edge * 1.3 + inner + wash + chev * 0.38) * uGlow * (0.65 + 0.35 * uBeat) * ends * inF;
  gl_FragColor = vec4(cool * k * 1.25, 1.0);
}
`;
