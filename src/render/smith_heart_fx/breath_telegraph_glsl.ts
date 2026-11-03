// The Guardian of the Breath's floor warning shaders (numbers:
// painted_telegraph_core.ts; dressing: painted_telegraphs.ts), at the Heat
// telegraph's bar (heat_telegraph_glsl.ts). One source, compiled per paint
// (`BT_BOLT`, `BT_CHARGED`, `BT_WIND`, `BT_CALM`) and per pass, read off the
// shared floor telegraph's own uniforms (shape, fill, front, warning, fade:
// ../floor_telegraph) plus the kind's look:
//  - the CHAR pass (`PT_CHAR`, a multiply): the stone under the mark taken by
//    the element (storm-scorched slate under the lightning, blackened under
//    the charged ground, a cold air shadow between the wind's streaks, the
//    calm's faint mint), darkest under the lines so the light reads on the
//    pale Cornice;
//  - the GLOW pass (additive): the edge a crisp line in the THREAT colour with
//    a white core and a halo (the exact radius, on every tier); then the paint:
//      bolt: forked lightning racing out from the strike point with the bar
//      (`boltReach`), re-struck `BOLT_RESTRIKE_HZ` times a second, thick main
//      arms (a white hot core in a saturated storm blue body, a blue glow
//      falling off) over a deep indigo scorch, the stone's cracks lit near
//      every fork, a crackling ring just inside the edge, the fill's front a
//      ragged arc, the bolts surging and the swept stone flashing blue over
//      the bar's last stretch (`boltFlare`);
//      charged: the stone's crack net glowing a steady electric blue, arcs
//      crawling and jumping over it (`CHARGED_CRAWL_HZ`);
//      wind: pale streaks of air on a spiral that turns (`uSpin`), flowing in
//      or out along it (`uFlow`), grit riding the stream;
//      calm: a still mint pool, slow ripples out from the middle, a soft
//      swirl of settled air (no flicker, never a threat's look).
// The flicker, the halo's breath, the fine cracks and the motes are the
// cosmetic layers (`uDetail`); the edge, the lines and the front draw on every
// tier. Multiplies and sums commute, so crossing marks look the same from every
// angle. The noise runs on yards off the mark's own spot (`vP`), never raw
// world coordinates; every vertex goes through `modelViewMatrix`.

import { HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { HEAT_TELEGRAPH_VERT } from './heat_telegraph_glsl';
import { BOLT_RESTRIKE_HZ, CHARGED_CRAWL_HZ } from './painted_telegraph_core';

/** The vertex stage: the Heat's own (the footprint's measure and the yards
 *  off its spot). */
export const BREATH_TELEGRAPH_VERT = HEAT_TELEGRAPH_VERT;

/** The shared uniforms and the footprint's measure (both fights' shaders). */
export const PAINTED_TELEGRAPH_HEAD_GLSL = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uShape;
uniform float uFill;
uniform float uTime;
uniform float uRange;
uniform float uHalfArc;
uniform float uLen;
uniform float uHalf;
uniform vec2 uDir;
uniform float uFront;
uniform float uRim;
uniform float uWarn;
uniform float uDetail;
uniform float uFade;
uniform float uChar;
uniform float uBody;
uniform float uCells;
uniform float uCrack;
uniform float uRimK;
uniform float uSpin;
uniform float uFlow;
uniform float uSeed;
uniform float uHeat;
uniform float uShadow;
uniform float uShadowK;
varying vec2 vLocal;
varying vec2 vP;
${HEAT_NOISE_GLSL}
float ridge(vec2 p) { return 1.0 - abs(vn(p) * 2.0 - 1.0); }
// The crack net: x the distance to the nearest cell's edge, y the nearest
// cell's own hash (which segments a flicker lights).
vec2 cellNet(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hh2(i + g), hh2(i + g + 17.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = hh2(i + g + 5.1); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec2(d2 - d1, id);
}
`;

/** The footprint's measure, exactly the kit's: radial 0..1, the yards to the
 *  nearest edge, the span in yards. */
export const PAINTED_TELEGRAPH_MEASURE_GLSL = /* glsl */ `
  float radial;
  float edge;
  float span;
  if (uShape > 0.5) {
    radial = clamp(vLocal.y, 0.0, 1.0);
    span = uLen;
    edge = min((1.0 - abs(vLocal.x)) * uHalf, min(vLocal.y, 1.0 - vLocal.y) * uLen);
  } else {
    float r0 = length(vLocal);
    radial = r0;
    span = uRange;
    float ang0 = abs(atan(vLocal.x, vLocal.y));
    float flank = uHalfArc > 3.1 ? 1e3 : (uHalfArc - ang0) * r0 * uRange;
    edge = min((1.0 - r0) * uRange, flank);
  }
  float yards = radial * span;
  float fillYards = uFill * span;
  float landed = step(0.999, uFill) * (1.0 - step(0.001, uFront));
`;

/** The edge: a crisp line of the threat with a white core, and its halo
 *  (the exact radius, every tier). Adds into `col`. */
export const PAINTED_TELEGRAPH_RIM_GLSL = /* glsl */ `
  float rimCore = 1.0 - smoothstep(0.05, 0.17, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 0.65, edge);
  col += uColor * rimSoft * 0.26 * uRim * uRimK;
  col += mix(uColor * 1.3, rimWhite, 0.32) * rimCore * uRim * uRimK * (1.0 + 0.6 * uWarn);
`;

export const BREATH_TELEGRAPH_FRAG = /* glsl */ `
${PAINTED_TELEGRAPH_HEAD_GLSL}
#if defined(BT_BOLT) || defined(BT_CHARGED)
// The bolts' thickness (yards; set per mark from its span) and the hot white
// core every fork carries inside its blue body.
float gW = 0.13;
float gHot = 0.0;
// One fork: a jagged arm out of the origin toward angle \`a\`, \`len\` yards
// long, wandering up to \`wander\` yards aside, a branch peeling off partway.
// Returns the bolt's blue body; \`gHot\` its white core, \`halo\` its glow.
float fork(vec2 q, float a, float len, float wander, float st, float seed, float fi, inout float halo) {
  float core = 0.0;
  for (int b = 0; b < 2; b++) {
    float fb = float(b);
    float b0 = fb * len * (0.3 + 0.3 * hh2(vec2(st + fi, seed + 9.7)));
    float ba = a + fb * (hh2(vec2(fi, st + seed)) > 0.5 ? 0.62 : -0.62);
    vec2 o = fb * vec2(sin(a), cos(a)) * b0;
    vec2 d = vec2(sin(ba), cos(ba));
    vec2 p = q - o;
    float t = dot(p, d);
    float perp = d.x * p.y - d.y * p.x;
    float off = (vn(vec2(t * 0.8 + fi * 5.3 + fb * 2.0, st * 1.7 + seed)) - 0.5) * wander * min(t * 0.45, 1.0)
              + (vn(vec2(t * 3.4 + fi * 2.1, st + seed * 3.0 + fb)) - 0.5) * 0.42 * min(t, 1.0);
    float dist = abs(perp - off);
    float l = (len - b0) * (1.0 - 0.45 * fb);
    float m = step(0.0, t) * (1.0 - smoothstep(l - 0.7, l, t));
    float w = gW * (1.0 - 0.55 * fb) * (1.0 - 0.55 * clamp(t / max(l, 0.01), 0.0, 1.0));
    core = max(core, m * (1.0 - smoothstep(w * 0.55, w + 0.03, dist)));
    gHot = max(gHot, m * (1.0 - smoothstep(0.0, w * 0.42 + 0.012, dist)) * (1.0 - 0.35 * fb));
    halo = max(halo, m * exp(-dist * (3.0 + 2.0 * fb) / (0.55 + 2.2 * gW)) * (1.0 - 0.4 * fb));
  }
  return core;
}
// Forked lightning: six arms out of the strike point, each up to \`reach\`
// yards, re-struck every step \`st\`. Returns the hot core; \`halo\` its light.
float bolts(vec2 q, float reach, float st, float seed, out float halo) {
  float core = 0.0;
  halo = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = (fi + 0.8 * hh2(vec2(st, fi + seed))) * 1.0472;
    float len = reach * (0.55 + 0.45 * hh2(vec2(fi + seed, st + 3.1)));
    core = max(core, fork(q, a, len, 2.0, st, seed, fi, halo));
  }
  return core;
}
// A lane's lightning: three forks running down it from its foot, abreast,
// each up to \`reach\` yards, held inside its half width.
float laneBolts(vec2 q, vec2 dir, float hw, float reach, float st, float seed, out float halo) {
  float core = 0.0;
  halo = 0.0;
  vec2 side = vec2(dir.y, -dir.x);
  float a0 = atan(dir.x, dir.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = side * (fi - 1.0) * hw * 0.45;
    float a = a0 + (hh2(vec2(st, fi + seed)) - 0.5) * 0.12;
    float len = reach * (0.7 + 0.3 * hh2(vec2(fi + seed, st + 3.1)));
    core = max(core, fork(q - o, a, len, hw * 0.5, st, seed, fi, halo));
  }
  return core;
}
#endif
void main() {
${PAINTED_TELEGRAPH_MEASURE_GLSL}
  float ang = atan(vP.x, vP.y);
  float r = length(vP);
  vec3 rimWhite = vec3(0.95, 0.98, 1.0);
  // ---- the paint's lines (both passes) ----------------------------------------------------
#if defined(BT_BOLT)
  // The fill's front: a crackling ragged arc racing out from the strike point.
  float st = floor(uTime * ${BOLT_RESTRIKE_HZ.toFixed(1)} + uSeed);
  float jag = (vn(vec2(ang * 5.0, st * 0.9)) - 0.5) * 0.9 + (vn(vP * 3.1) - 0.5) * 0.3;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.12, 0.12, ahead);
  float reach = span * (0.45 + 0.51 * clamp(uFill, 0.0, 1.0));
  float flare = uFill > 0.86 ? pow((uFill - 0.86) / 0.14, 2.0) : 0.0;
  flare *= 1.0 - landed;
  // Thick main arms on a big strike, finer on a small mark; thickening as
  // the bar fills.
  gW = clamp(span * 0.03, 0.07, 0.2) * (0.75 + 0.35 * clamp(uFill, 0.0, 1.0));
  float halo;
  float core = uShape > 0.5
    ? laneBolts(vP, uDir, uHalf, uLen * (0.25 + 0.75 * clamp(uFill, 0.0, 1.0)), st, uSeed, halo)
    : bolts(vP, reach, st, uSeed, halo);
  // The stone's cracks, lit near the forks (the lightning running in them).
  vec2 net = cellNet(vP * uCells + vec2(uSeed, 1.7));
  float netLine = 1.0 - smoothstep(0.0, 0.07, net.x);
  float near = clamp(halo * 1.6, 0.0, 1.0);
  float lines = max(core, netLine * near * 0.8);
  float flick = uDetail > 0.0 ? 0.62 + 0.38 * hh2(vec2(st, uSeed + 1.3)) : 0.85;
#elif defined(BT_CHARGED)
  float ahead = -1.0;
  float swept = 1.0;
  float st = floor(uTime * ${CHARGED_CRAWL_HZ.toFixed(1)} + uSeed);
  float slow = floor(uTime * 2.3 + uSeed);
  vec2 net = cellNet(vP * uCells + vec2(uSeed, 4.2));
  float netLine = 1.0 - smoothstep(0.0, 0.09, net.x);
  gW = clamp(span * 0.022, 0.06, 0.13);
  // Arcs crawling over the net: a few segments lit each step.
  float lit = step(0.72, hh2(vec2(net.y * 31.0, st)));
  float halo = 0.0;
  float h2 = 0.0;
  // Two arcs leaping out of wandering points on the scorch.
  vec2 o1 = (vec2(hh2(vec2(slow, uSeed)), hh2(vec2(uSeed, slow + 2.0))) - 0.5) * span * 1.1;
  vec2 o2 = (vec2(hh2(vec2(slow + 5.0, uSeed)), hh2(vec2(uSeed + 3.0, slow))) - 0.5) * span * 1.1;
  float core = bolts(vP - o1, span * 0.5, st, uSeed, halo);
  core = max(core, bolts(vP - o2, span * 0.4, st + 7.0, uSeed + 2.0, h2) * 0.85);
  halo = max(halo, h2);
  core *= step(0.0, edge - 0.15);
  gHot *= step(0.0, edge - 0.15);
  float lines = max(core, netLine * mix(0.35, 1.0, lit));
  float flare = 0.0;
  float flick = uDetail > 0.0 ? 0.7 + 0.3 * hh2(vec2(st, uSeed + 1.3)) : 0.85;
#elif defined(BT_WIND)
  // Streaks on a spiral that turns: the angle twisted by the radius, turning
  // with time, flowing along the radius.
  float lr = log(r + 0.6);
  float s = ang + uSpin * lr * 1.7 - uTime * uSpin * 0.9;
  float flowPh = r * uCells * 1.6 - uTime * uFlow * 2.4;
  float bands = 7.0 + floor(span * 0.6);
  float strand = sin(s * bands + vn(vec2(s * 2.0, lr * 3.0)) * 2.2);
  float breakup = vn(vec2(s * bands * 0.5, flowPh));
  float streak = smoothstep(0.55, 0.98, strand) * smoothstep(0.25, 0.75, breakup);
  // Its soft body (the air thick round each streak).
  float body = smoothstep(0.05, 0.9, strand) * smoothstep(0.15, 0.8, breakup);
  // A second, faster layer of thin streaks on a tighter twist (the gust
  // inside the gust): the air reads as moving in depth, not a painted swirl.
  float s2 = ang + uSpin * lr * 2.4 - uTime * uSpin * 1.6 + 1.7;
  float flow2 = r * uCells * 2.3 - uTime * uFlow * 3.6;
  float bands2 = floor(bands * 0.6) + 3.0;
  float streak2 = smoothstep(0.82, 0.99, sin(s2 * bands2 + vn(vec2(s2 * 3.0, lr * 4.0)) * 2.6))
                * smoothstep(0.35, 0.8, vn(vec2(s2 * bands2 * 0.5, flow2)));
  // The fine streaks between (cosmetic).
  float fine = smoothstep(0.75, 1.0, sin(s * bands * 2.7 + 1.3)) * smoothstep(0.4, 0.8, vn(vec2(s * 9.0, flowPh * 1.7)));
  float jag = (vn(vec2(ang * 4.0, uTime * 0.7)) - 0.5) * 0.6;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.15, 0.15, ahead);
  // The eye: the air densest where the spiral closes (the vortex's pull).
  float eye = (1.0 - smoothstep(0.0, 0.55, radial)) * clamp(-uFlow, 0.0, 1.0);
  float lines = max(streak, streak2);
  float flare = 0.0;
  float flick = 1.0;
#else
  // The calm: still air.
  float ripple = 0.5 + 0.5 * sin(yards * 2.6 - uTime * 1.4);
  ripple = smoothstep(0.82, 1.0, ripple) * (0.4 + 0.6 * radial);
  float s = ang + log(r + 0.6) * 0.8 - uTime * 0.22;
  float swirl = smoothstep(0.7, 1.0, sin(s * 5.0)) * smoothstep(0.35, 0.8, vn(vec2(s * 3.0, r * 0.7 - uTime * 0.3)));
  float jag = (vn(vP * 1.2) - 0.5) * 0.4;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.2, 0.2, ahead);
  float lines = ripple;
  float flare = 0.0;
  float flick = 1.0;
#endif

#ifdef PT_CHAR
  // ---- the stone taken by the element (a multiply) -----------------------------------------
#if defined(BT_BOLT)
  // Storm-scorched slate: a deep indigo under the whole mark, burnt near
  // black under the bolts (the light pops on the pale Cornice).
  vec3 tint = vec3(0.2, 0.25, 0.5);
  vec3 deep = vec3(0.05, 0.07, 0.2);
  float c = uChar * (0.8 + 0.2 * swept) * (0.88 + 0.12 * vn(vP * 0.6)) * (1.0 + 0.15 * flare);
  float under = max(max(core, halo * 0.75), netLine * 0.55) * (0.55 + 0.45 * swept);
#elif defined(BT_CHARGED)
  vec3 tint = vec3(0.24, 0.27, 0.42);
  vec3 deep = vec3(0.05, 0.06, 0.16);
  float c = uChar * (0.85 + 0.15 * vn(vP * 0.9)) * (0.8 + 0.2 * smoothstep(0.0, 1.2, edge));
  float under = max(netLine * 0.95, halo * 0.5);
#elif defined(BT_WIND)
  // A cold air shadow between the streaks (so the pale air reads on the
  // pale stone), deepest in the eye.
  vec3 tint = vec3(0.45, 0.54, 0.7);
  vec3 deep = vec3(0.32, 0.4, 0.56);
  float c = uChar * (0.55 + 0.2 * swept + 0.25 * (1.0 - body));
  float under = (1.0 - body) * 0.5 + eye * 0.55;
#else
  vec3 tint = vec3(0.86, 0.98, 0.93);
  vec3 deep = vec3(0.7, 0.9, 0.82);
  float c = uChar * (0.6 + 0.4 * swept);
  float under = 0.0;
#endif
  c *= mix(1.0, 0.45, landed);
  c *= smoothstep(-0.02, 0.35, edge);
  c = clamp(c * uFade, 0.0, 0.9);
  vec3 floorTint = mix(vec3(1.0), tint, c);
  floorTint = mix(floorTint, floorTint * deep * 1.5, clamp(under * uCrack * uFade, 0.0, 0.85));
  gl_FragColor = vec4(floorTint, 1.0);
#else
  // ---- the light (additive) ----------------------------------------------------------------
  vec3 col = vec3(0.0);
${PAINTED_TELEGRAPH_RIM_GLSL}
#if defined(BT_BOLT)
  // A saturated storm blue (never a pale wash), an indigo depth, a white
  // hot core.
  vec3 cDeep = vec3(0.03, 0.1, 0.62);
  vec3 cBlue = vec3(0.08, 0.4, 1.0);
  vec3 cHot = vec3(0.86, 0.94, 1.0);
  // The forks: the white core inside a blue body, a blue glow falling off
  // round it; dim ahead of the front, full behind it, surging over the bar's
  // last stretch (the crescendo).
  float k = mix(0.45, 1.0, swept) * flick * (1.0 + 0.9 * flare);
  col += cBlue * core * 1.5 * k * uCrack;
  col += cHot * gHot * 2.2 * k * uCrack;
  col += cBlue * halo * 0.65 * k * uBody;
  // The whole stone electrified: its cracks humming blue, hotter near a fork.
  col += cDeep * netLine * (0.25 + 0.45 * swept) * k * uCrack;
  col += cBlue * netLine * near * 0.8 * k * uCrack;
  // The crackling ring just inside the edge (never outside it).
  float ringAt = 0.38 + 0.22 * vn(vec2(ang * 9.0, st));
  float ring = (1.0 - smoothstep(0.0, 0.08, abs(edge - ringAt))) * step(0.5, vn(vec2(ang * 14.0, st * 1.3)));
  col += mix(cBlue, cHot, 0.35) * ring * 1.1 * (0.6 + 0.4 * swept) * flick;
  // The swept part: a deep electric glow in the scorch.
  col += cDeep * 0.22 * swept * (1.0 - 0.6 * landed);
  // The front: a ragged arc of lightning racing out.
  float seam = (1.0 - smoothstep(0.0, 0.2, abs(ahead))) * uFront;
  col += mix(cBlue, cHot, 0.5) * seam * 0.7 * flick;
  // The bar's last stretch: the warning glows, the bolts surge, the swept
  // stone flashes blue white just before the hit.
  col += (uColor * 0.1 + cBlue * 0.22) * uWarn * swept;
  col += cBlue * flare * (0.5 + 0.5 * flick) * 0.28 * smoothstep(-0.05, 0.4, edge);
#elif defined(BT_CHARGED)
  vec3 cDeep = vec3(0.04, 0.16, 0.8);
  vec3 cBlue = vec3(0.1, 0.45, 1.0);
  vec3 cHot = vec3(0.88, 0.96, 1.0);
  float breathe = uDetail > 0.0 ? 0.75 + 0.25 * sin(uTime * 3.1 + uSeed) : 0.9;
  // The crack net live with current (every tier: it is the danger's body).
  col += cBlue * netLine * (0.45 + 0.6 * lit * flick) * breathe * uCrack;
  col += cBlue * core * 1.2 * flick * uCrack;
  col += cHot * gHot * 1.6 * flick * uCrack;
  col += cBlue * halo * 0.5 * flick * uBody;
  // A charged glow banked up inside the edge and a deep hum over the scorch:
  // the whole patch reads live from across the Cornice.
  col += cBlue * (1.0 - smoothstep(0.0, 1.4, edge)) * 0.3 * breathe;
  col += cDeep * 0.12 * smoothstep(0.0, 0.8, edge);
#elif defined(BT_WIND)
  vec3 cAir = vec3(0.84, 0.93, 1.0);
  vec3 cCold = vec3(0.55, 0.75, 0.95);
  float k = mix(0.55, 1.0, swept);
  float inEdge = smoothstep(-0.05, 0.6, edge);
  col += cAir * streak * 0.85 * k * uCrack * inEdge;
  col += cCold * body * 0.12 * k * uBody * inEdge;
  col += cAir * streak2 * 0.55 * k * uCrack * inEdge;
  col += cCold * eye * 0.3 * uBody;
  if (uDetail > 0.0) {
    col += cAir * fine * 0.16 * k * uBody;
    // Dust and grit riding the stream: motes on the spiral.
    vec2 g = vec2(s * bands * 0.5, flowPh * 1.3);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id + uSeed);
    float mote = (1.0 - smoothstep(0.0, 0.16, length(f))) * step(0.72, h);
    col += vec3(0.78, 0.7, 0.56) * mote * 0.4 * k * inEdge;
  }
  col += cCold * 0.05 * swept * (1.0 - 0.6 * landed);
  float seam = (1.0 - smoothstep(0.0, 0.25, abs(ahead))) * uFront;
  col += cAir * seam * 0.4;
  // A standing wind (the vortex, a gale) has no last stretch: no flare.
  col += cAir * 0.12 * uWarn * swept * step(uFill, 0.995);
#else
  vec3 cMint = uColor;
  vec3 cLeaf = vec3(0.86, 1.0, 0.94);
  col += cMint * ripple * 0.26 * uCrack * (0.4 + 0.6 * swept);
  col += cMint * (1.0 - radial) * 0.08 * swept;
  if (uDetail > 0.0) col += cLeaf * swirl * 0.16 * uBody * swept;
  float seam = (1.0 - smoothstep(0.0, 0.3, abs(ahead))) * uFront;
  col += cLeaf * seam * 0.4;
#endif
  gl_FragColor = vec4(col * uFade, 1.0);
#endif
}
`;
