// The Masterless Strength's element telegraph shaders (numbers:
// final_telegraph_core.ts; dressing: final_telegraphs.ts): the Quench's,
// the Breath's and the Hammer's floor warnings brought to the Heat's molten
// telegraph's bar (heat_telegraph_glsl.ts), each in its own element's
// language. One source, compiled per element (`FT_FROST`, `FT_STORM`,
// `FT_STONE`) and per pass, read off the shared floor telegraph's own
// uniforms (shape, fill, front, warning, fade: ../floor_telegraph) plus the
// kind's look:
//  - the CHAR pass (`FT_CHAR`, a multiply): the floor under the mark taken
//    by the element (frost-bitten blue, storm-scorched violet, the granite
//    split dark), deeper where the fill has swept and over the warning, its
//    lines (fractures, burns, fissures) deepest;
//  - the GLOW pass (additive): the edge a crisp hot line in the THREAT colour
//    with the element's white core and a halo; the element's lines (frost
//    fractures and rime feathers creeping in from the rim; storm streaks and
//    forks crawling out from the middle; granite fissures with gold glints)
//    dim ahead of the fill's front and lit behind it; the front a ragged line
//    of the element (crystallising frost, a crackling arc, a crack splitting
//    open with gold light); the bar's last stretch flaring; glints (the fine
//    lines, the glints and the flicker are the cosmetic layers: `uDetail`).
// Multiplies and sums commute, so crossing marks look the same from every
// angle. The noise runs on yards off the mark's own spot (`vP`), never raw
// world coordinates; every vertex goes through `modelViewMatrix`.

import { HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { HEAT_TELEGRAPH_VERT } from './heat_telegraph_glsl';

/** The vertex stage: the Heat's own (the footprint's measure and the yards
 *  off its spot). */
export const FINAL_TELEGRAPH_VERT = HEAT_TELEGRAPH_VERT;

export const FINAL_TELEGRAPH_FRAG = /* glsl */ `
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
uniform float uInward;
varying vec2 vLocal;
varying vec2 vP;
${HEAT_NOISE_GLSL}
float ridge(vec2 p) { return 1.0 - abs(vn(p) * 2.0 - 1.0); }
void main() {
  // The footprint's measure, exactly the kit's.
  float radial;
  float edge;
  float span;
  if (uShape > 0.5) {
    radial = clamp(vLocal.y, 0.0, 1.0);
    span = uLen;
    edge = min((1.0 - abs(vLocal.x)) * uHalf, min(vLocal.y, 1.0 - vLocal.y) * uLen);
  } else {
    float r = length(vLocal);
    radial = r;
    span = uRange;
    float ang0 = abs(atan(vLocal.x, vLocal.y));
    float flank = uHalfArc > 3.1 ? 1e3 : (uHalfArc - ang0) * r * uRange;
    edge = min((1.0 - r) * uRange, flank);
  }
  float yards = radial * span;
  // Frost creeps in from the rim (uInward 1): its fill measures from the
  // edge; storm and stone break out from the middle.
  float along = mix(yards, span - yards, uInward);
  float fillYards = uFill * span;
  float ang = atan(vP.x, vP.y);
#if defined(FT_FROST)
  float jag = (vn(vP * 1.4) - 0.5) * 0.8 + (vn(vP * 4.1 + 2.3) - 0.5) * 0.35;
#elif defined(FT_STORM)
  float jag = (vn(vec2(ang * 6.0, uTime * 9.0)) - 0.5) * 1.1 + (vn(vP * 3.3) - 0.5) * 0.3;
#else
  float jag = (vn(vP * 0.7) - 0.5) * 1.0 + (vn(vP * 2.6 + 4.1) - 0.5) * 0.4;
#endif
  float ahead = along + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.12, 0.12, ahead);
  float landed = step(0.999, uFill) * (1.0 - step(0.001, uFront));

  // ---- the element's lines -------------------------------------------------------------
#if defined(FT_FROST)
  // Ice fractures: angular plates, and shards running in from the rim.
  float plates = 1.0 - smoothstep(0.0, 0.06, cellEdge(vP * uCells + vec2(3.1, 7.7)));
  float shards = pow(max(ridge(vec2(ang * 7.0, radial * 2.2) + 1.7), 0.0), 16.0) * smoothstep(0.15, 0.9, radial);
  float lines = max(plates, shards * 0.9);
  // Rime feathers: dendrites growing in off the edge.
  float feather = pow(max(ridge(vP * 2.6 + vec2(fbm(vP * 0.8) * 2.4, 0.0)), 0.0), 7.0);
  float rimeZone = 1.0 - smoothstep(0.0, 0.8 + 2.2 * uFill, edge);
  vec3 cDim = vec3(0.30, 0.46, 0.62);
  vec3 cLit = vec3(0.62, 0.86, 1.0);
  vec3 cHot = vec3(0.9, 0.97, 1.0);
  vec3 tint = vec3(0.46, 0.6, 0.84);
  vec3 deep = vec3(0.16, 0.26, 0.44);
  float lineK = 1.6;
#elif defined(FT_STORM)
  // Storm streaks riding round with the wind, forks crawling out.
  float t9 = floor(uTime * 11.0);
  float forkA = pow(max(ridge(vec2(ang * 4.0 + hh2(vec2(t9, 1.3)) * 6.0, radial * 3.0)), 0.0), 18.0);
  float forkB = pow(max(ridge(vP * 0.9 + vec2(t9 * 0.37, 0.0)), 0.0), 24.0);
  float streak = smoothstep(0.55, 1.0, sin(ang * 22.0 + radial * 9.0 - uTime * 6.0)) * 0.6;
  float lines = max(forkA * smoothstep(0.1, 0.5, radial), forkB);
  float feather = streak;
  float rimeZone = 1.0;
  vec3 cDim = vec3(0.32, 0.24, 0.55);
  vec3 cLit = vec3(0.72, 0.6, 1.0);
  vec3 cHot = vec3(0.95, 0.92, 1.0);
  vec3 tint = vec3(0.62, 0.58, 0.74);
  vec3 deep = vec3(0.32, 0.26, 0.4);
  float lineK = 1.2;
#else
  // Granite fissures: big jagged plates splitting, gold in the splits.
  vec2 wp = vP * uCells + vec2(fbm(vP * 0.35) * 1.6, fbm(vP * 0.35 + 7.0) * 1.6);
  float lines = 1.0 - smoothstep(0.0, 0.085, cellEdge(wp + 5.3));
  float feather = pow(max(ridge(vP * 1.7 + 3.0), 0.0), 10.0);
  float rimeZone = 1.0;
  vec3 cDim = vec3(0.42, 0.3, 0.14);
  vec3 cLit = vec3(1.0, 0.76, 0.32);
  vec3 cHot = vec3(1.0, 0.95, 0.78);
  vec3 tint = vec3(0.5, 0.45, 0.4);
  vec3 deep = vec3(0.24, 0.2, 0.17);
  float lineK = 1.25;
#endif

#ifdef FT_CHAR
  // The floor taken by the element: tinted where the mark lies, deeper where
  // swept and in the warning, its lines deepest.
  float c = uChar * (0.5 + 0.35 * swept + 0.15 * uWarn);
  c *= mix(1.0, 0.45, landed);
  c *= 0.85 + 0.15 * vn(vP * 0.6);
  c *= smoothstep(-0.02, 0.35, edge);
  c = clamp(c * uFade, 0.0, 0.92);
  vec3 floorTint = mix(vec3(1.0), tint, c);
  float lineDepth = lines * uCrack * (0.35 + 0.65 * swept) * uFade;
  floorTint = mix(floorTint, floorTint * deep * 1.6, clamp(lineDepth * 0.8, 0.0, 0.85));
  gl_FragColor = vec4(floorTint, 1.0);
#else
  // The edge: a crisp line of the threat, the element's white at its core.
  float rimCore = 1.0 - smoothstep(0.05, 0.17, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 1.1, edge);
  vec3 col = uColor * rimSoft * 0.3 * uRim * uRimK;
  col += mix(uColor * 1.3, cHot, 0.32) * rimCore * uRim * uRimK * (1.0 + 0.6 * uWarn);
  // The lines: dim ahead of the front, lit behind it.
  float ln = lines * uCrack;
  float lit = mix(0.22, 0.8 + 0.2 * uWarn, swept);
  col += mix(cDim, cLit, swept) * ln * lit * (0.55 + 0.45 * swept) * lineK;
  // The element's second layer: rime, streaks, the stone's grain.
  if (uDetail > 0.0) {
#if defined(FT_FROST)
    col += cLit * feather * rimeZone * (0.18 + 0.5 * swept) * uBody;
#elif defined(FT_STORM)
    col += cLit * feather * (0.08 + 0.3 * swept) * uBody;
#else
    col += cDim * feather * (0.1 + 0.25 * swept) * uBody;
#endif
  }
  // The swept part: a faint wash of the threat and the element.
  col += (uColor * 0.06 + cLit * 0.07) * swept * (1.0 - 0.6 * landed);
  // The front: a ragged line of the element racing to the hit.
  float flick = uDetail > 0.0 ? 0.75 + 0.25 * vn(vP * 1.9 + vec2(uTime * 4.0, 0.0)) : 1.0;
  float seam = (1.0 - smoothstep(0.0, 0.22, abs(ahead))) * uFront;
  float lick = (1.0 - smoothstep(0.0, 1.0, ahead)) * step(0.0, ahead) * uFront;
  col += mix(cLit, cHot, 0.5) * seam * 0.65 * flick + cLit * lick * 0.22 * flick;
  // The bar's last stretch: the swept part flares in the threat and the
  // element's white.
  col += (uColor * 0.32 + cHot * 0.14) * uWarn * swept;
  // Glints (cosmetic): frost sparkle, storm motes, gold mica.
  if (uDetail > 0.0) {
    vec2 g = vP * 1.2 + vec2(0.0, -uTime * 0.35);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id);
    vec2 o = vec2(hh2(id + 3.1), hh2(id + 7.3)) - 0.5;
    float mote = (1.0 - smoothstep(0.0, 0.08, length(f - o * 0.6))) * step(0.78, h);
    col += uAccent * mote * (0.3 + 0.4 * sin(uTime * 6.0 + h * 40.0)) * (0.35 + 0.65 * swept);
  }
  gl_FragColor = vec4(col * uFade, 1.0);
#endif
}
`;
