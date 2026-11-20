// The Guardian of the Heat's molten telegraph shaders (numbers:
// heat_telegraph_core.ts; dressing: heat_telegraph.ts). One source, two
// passes, read off the shared floor telegraph's own uniforms (shape, fill,
// front, warning, fade: ../floor_telegraph/telegraph_material.ts) plus the
// kind's look:
//  - the CHAR pass (`HEAT_CHAR`, a multiply): the basalt under the mark
//    scorched dark, mottled, its joints charred deepest; deeper where the
//    fill has swept and over the warning, a third of it once landed;
//  - the GLOW pass (additive): the edge a crisp hot line in the threat colour
//    with a white-hot core and a halo, the joints split into cracks (dim
//    embers ahead of the front, molten white-gold behind it, heat rippling
//    out along them), the fill's front a ragged line of fire, the swept part
//    a faint threat wash with the molten flow churning under it, the flare of
//    the bar's last stretch, embers glinting (the flow, the fine cracks and
//    the embers are the cosmetic layers: `uDetail`).
// Multiplies and sums commute, so any number of marks crossing (two lanes,
// a lane over a river, seeds over seeds) look the same from every angle.
// The noise runs on yards off the mark's own spot (`vP`), never raw world
// coordinates (an instance far from the world's origin would break the hash).

import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';

export const HEAT_TELEGRAPH_VERT = /* glsl */ `
uniform float uShape;
uniform vec2 uDir;
uniform float uLen;
uniform float uHalf;
varying vec2 vLocal;
varying vec2 vP;
void main() {
  if (uShape > 0.5) {
    vec2 p = position.xz;
    vLocal = vec2(dot(p, vec2(uDir.y, -uDir.x)) / max(uHalf, 1e-3), dot(p, uDir) / max(uLen, 1e-3));
  } else {
    vLocal = position.xz;
  }
  // Yards from the mark's own spot (rotated and scaled, untranslated).
  vP = (mat3(modelMatrix) * vec3(position.x, 0.0, position.z)).xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const HEAT_TELEGRAPH_FRAG = /* glsl */ `
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
uniform float uFalloff;
uniform float uCells;
uniform float uCrack;
uniform float uRimK;
uniform float uSpent;
varying vec2 vLocal;
varying vec2 vP;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  // The footprint's measure, exactly the kit's: how far along (0 the caster,
  // 1 the far end or rim) and the yards to the nearest edge.
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
    float ang = abs(atan(vLocal.x, vLocal.y));
    float flank = uHalfArc > 3.1 ? 1e3 : (uHalfArc - ang) * r * uRange;
    edge = min((1.0 - r) * uRange, flank);
  }
  float yards = radial * span;
  float fillYards = uFill * span;
  // A lane's yards a wave has already rolled past (0 on everything else):
  // spent, so its warning clears behind the wave.
  float live = uShape > 0.5 ? smoothstep(uSpent - 1.2, uSpent, yards) : 1.0;
  if (live <= 0.001) discard;
  // The front is a ragged line of cracks, not a ruler (under a yard).
  float jag = (vn(vP * 0.8) - 0.5) * 0.9 + (vn(vP * 2.3 + 4.1) - 0.5) * 0.35;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.12, 0.12, ahead);
  float landed = step(0.999, uFill) * (1.0 - step(0.001, uFront));
  // A falloff of damage reads hotter toward the middle.
  float heatW = mix(1.0, 0.25 + 0.75 * pow(1.0 - clamp(radial, 0.0, 1.0), 1.4), uFalloff);
  // The basalt's joints, in yards (the same size on every mark of a kind).
  float joint = 1.0 - smoothstep(0.0, 0.075, cellEdge(vP * uCells + 11.3));
#ifdef HEAT_CHAR
  float c = uChar * (0.45 + 0.4 * swept + 0.15 * uWarn);
  c *= mix(1.0, 0.35, landed) * heatW;
  c *= 0.82 + 0.18 * vn(vP * 0.6) + 0.25 * joint;
  // Soft just inside the edge: the glow's hot line carries the exact edge.
  c *= smoothstep(-0.02, 0.35, edge);
  c = clamp(c * uFade * live, 0.0, 0.9);
  gl_FragColor = vec4(vec3(1.0 - c), 1.0);
#else
  vec3 hot = vec3(1.0, 0.93, 0.8);
  // The edge: a crisp line of the threat, white at its core, and its halo.
  float rimCore = 1.0 - smoothstep(0.05, 0.17, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 1.1, edge);
  vec3 col = uColor * rimSoft * 0.28 * uRim * uRimK;
  col += mix(uColor * 1.25, hot, 0.35) * rimCore * uRim * uRimK * (1.0 + 0.6 * uWarn);
  // The cracks: dim embers ahead of the front, molten behind it, the heat
  // rippling out along them.
  float crack = joint * uCrack;
  if (uDetail > 0.0) {
    float fine = 1.0 - smoothstep(0.0, 0.05, cellEdge(vP * uCells * 2.6 + 3.7));
    crack = max(crack, fine * 0.55 * swept * uCrack);
  }
  float ripple = 0.75 + 0.25 * sin(yards * 1.3 - uTime * 4.0);
  float crackHeat = mix(0.22, 0.72 + 0.28 * uWarn, swept);
  col += molten(crackHeat) * crack * (0.26 + 0.6 * swept) * ripple * heatW;
  // The swept part: a faint wash of the threat, the molten flow under it.
  col += uColor * swept * 0.07 * heatW * (1.0 - 0.6 * landed);
  if (uDetail > 0.0 && uBody > 0.0) {
    vec2 flow = uShape > 0.5 ? uDir * 2.2 : vec2(0.0);
    float lvl = lavaLevel(vP, flow, uTime, 1.0);
    col += molten(lvl * 0.8) * lvl * uBody * swept * 0.3 * heatW * (1.0 - 0.75 * landed);
  }
  // The fill's front: a ragged line of fire racing out (the timing): a thin
  // molten-gold seam (never blown to white: it reads as fire, not foam), an
  // amber glow licking ahead of it.
  float flick = 0.8 + 0.2 * vn(vP * 1.7 + vec2(uTime * 3.0, 0.0));
  float seam = (1.0 - smoothstep(0.0, 0.2, abs(ahead))) * uFront;
  float lick = (1.0 - smoothstep(0.0, 0.9, ahead)) * step(0.0, ahead) * uFront;
  col += molten(0.8) * seam * 0.5 * flick + molten(0.5) * lick * 0.3 * flick;
  // The bar's last stretch: the swept part flares with the warning.
  col += (uColor * 0.35 + hot * 0.12) * uWarn * swept * heatW;
  // Embers glinting over it (cosmetic).
  if (uDetail > 0.0) {
    vec2 g = vP * 1.1 + vec2(0.0, -uTime * 0.7);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id);
    vec2 o = vec2(hh2(id + 3.1), hh2(id + 7.3)) - 0.5;
    float mote = (1.0 - smoothstep(0.0, 0.09, length(f - o * 0.6))) * step(0.8, h);
    col += uAccent * mote * (0.35 + 0.35 * sin(uTime * 5.0 + h * 40.0)) * (0.3 + 0.7 * swept);
  }
  gl_FragColor = vec4(col * uFade * live, 1.0);
#endif
}
`;
