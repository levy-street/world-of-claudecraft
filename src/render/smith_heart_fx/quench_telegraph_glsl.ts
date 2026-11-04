// The Guardian of the Quench's floor warning shader (numbers:
// painted_telegraph_core.ts QUENCH_TELEGRAPH_LOOKS; dressing:
// painted_telegraphs.ts QuenchTelegraphs), brought to the Breath's and the
// Council's bar (Jose's playtest of 2026-11-04: "generic red circles and red
// cones"). One source (`QT_FROST`), compiled per pass, read off the shared
// floor telegraph's own uniforms (shape, fill, front, warning, fade:
// ../floor_telegraph) plus the kind's look; the head, the measure and the rim
// are the family's (breath_telegraph_glsl.ts):
//  - the CHAR pass (`PT_CHAR`, a multiply): the lake under the mark frozen
//    deep: glacier blue plates each its own shade, darkest in their seams,
//    deeper where the frost has crept (behind the fill's front) and over the
//    bar's last stretch; a crack's hole opening to black water in its middle
//    (`uFlow`: the water); a slash's groove cut dark down its lane;
//  - the GLOW pass (additive): the edge a crisp line in the THREAT colour with
//    an icy white core (the exact radius, every tier), a band of rime just
//    inside it, and shards of ice standing along every edge, their points
//    inward (`uSpin`: the shards' length), each lit on one facet and shaded
//    on the other; the frost's fracture lines and the rime's feathers lit
//    behind the ragged crystallising front and only scored ahead of it (the
//    fill IS the cast); spokes of fracture out of the origin (the maw, the
//    crack's heart); a slash's lane split down its middle by the blade's
//    groove with frost ferns branching off it; the bar's last stretch
//    flashing the frozen floor white-blue and pulsing the fractures. Mist
//    drifting low over the frost, fine crazing and glints are the cosmetic
//    layers the low tier sheds (`uDetail`); the edge, the shards, the
//    fractures and the front draw on every tier.
// Multiplies and sums commute, so crossing marks look the same from every
// angle. The noise runs on yards off the mark's own spot (`vP`), never raw
// world coordinates; every vertex goes through `modelViewMatrix`.

import {
  PAINTED_TELEGRAPH_HEAD_GLSL,
  PAINTED_TELEGRAPH_MEASURE_GLSL,
  PAINTED_TELEGRAPH_RIM_GLSL,
} from './breath_telegraph_glsl';

export const QUENCH_TELEGRAPH_FRAG = /* glsl */ `
${PAINTED_TELEGRAPH_HEAD_GLSL}
void main() {
${PAINTED_TELEGRAPH_MEASURE_GLSL}
  float ang = atan(vP.x, vP.y);
  float r = length(vP);
  vec3 rimWhite = vec3(0.9, 0.98, 1.0);
  float wk = clamp(span / 6.0, 0.55, 1.3);
  // A warp so no fracture is a ruler.
  vec2 wp = vP + vec2(fbm(vP * 0.35 + uSeed) - 0.5, fbm(vP * 0.35 + uSeed + 7.0) - 0.5) * 1.3;
  // The crystallising front: ragged, racing out with the bar.
  float jag = (vn(wp * 1.1) - 0.5) * 0.8 + (vn(wp * 3.3 + 2.1) - 0.5) * 0.3;
  float ahead = yards + jag * wk - fillYards;
  float swept = 1.0 - smoothstep(-0.12, 0.12, ahead);
  // The frost's plates and their fracture lines (every tier).
  vec2 plate = cellNet(wp * uCells + vec2(uSeed, 2.7));
  float frac = 1.0 - smoothstep(0.0, 0.065, plate.x);
  // Spokes of fracture out of the origin (the maw, the crack's heart).
  float spokes = 6.0 + floor(span * 0.25);
  float aw = ang + (fbm(vec2(r * 0.4, uSeed)) - 0.5) * 0.32 / max(r * 0.3, 0.4);
  float sp = aw * spokes / 6.2832 + uSeed;
  float fr = fract(sp) - 0.5 - (hh2(vec2(floor(sp), uSeed)) - 0.5) * 0.4;
  float dArc = abs(fr) * r * 6.2832 / spokes;
  float spokeW = (0.04 + 0.06 * (1.0 - clamp(r / max(span, 0.01), 0.0, 1.0))) * wk;
  float spoke = (1.0 - smoothstep(spokeW * 0.5, spokeW, dArc)) * smoothstep(0.2, 0.8, r);
  // Rime feathers: dendrites growing in off the edges and riding the front.
  float feather = pow(ridge(wp * 2.3 + vec2(fbm(wp * 0.7) * 2.0, uSeed)), 8.0);
  float rimeBand = 1.0 - smoothstep(0.0, 0.55 + 0.9 * wk, edge);
  float frontBand = 1.0 - smoothstep(0.0, 0.9 * wk, abs(ahead));
  // Where along the nearest edge a point lies (yards), for the shards.
  float along;
  if (uShape > 0.5) {
    float side = (1.0 - abs(vLocal.x)) * uHalf;
    float endD = min(vLocal.y, 1.0 - vLocal.y) * uLen;
    along = side < endD ? vLocal.y * uLen : vLocal.x * uHalf;
  } else {
    float r0 = length(vLocal);
    float a0 = atan(vLocal.x, vLocal.y);
    float flankD = uHalfArc > 3.1 ? 1e3 : (uHalfArc - abs(a0)) * r0 * uRange;
    float arcD = (1.0 - r0) * uRange;
    along = flankD < arcD ? r0 * uRange : a0 * r0 * uRange;
  }
  // The shards: teeth of ice standing on every edge, points inward, each its
  // own length, growing with the frost (never past a third of the span).
  float tw = 0.75 + 0.25 * wk;
  float tf = along / tw;
  float tid = floor(tf);
  float tt = fract(tf);
  float th = hh2(vec2(tid, uSeed + 4.2));
  float tLen = uSpin * (0.35 + 0.65 * th) * (0.45 + 0.55 * max(swept, uFill)) * wk;
  tLen = min(tLen, span * 0.33);
  float tProf = 1.0 - abs(tt * 2.0 - 1.0);
  float shard = step(0.02, uSpin) * (1.0 - smoothstep(tLen * tProf - 0.05, tLen * tProf + 0.03, edge));
  float facet = tt < 0.5 ? 1.0 : 0.45;
  float shardTip = shard * smoothstep(tLen * 0.45, tLen, edge);
  // The lane: the blade's groove down its middle, frost ferns off it.
  float groove = 0.0;
  float fern = 0.0;
  if (uShape > 0.5) {
    vec2 lq = vec2(vLocal.x * uHalf, vLocal.y * uLen);
    float wob = (vn(vec2(lq.y * 0.35, uSeed)) - 0.5) * 0.35;
    float mid = abs(lq.x - wob);
    float cut = smoothstep(0.3, 1.1, lq.y) * (1.0 - smoothstep(uLen - 0.8, uLen, lq.y));
    groove = (1.0 - smoothstep(0.1 * wk, 0.22 * wk, mid)) * cut;
    float fy = lq.y - mid * 1.1;
    float fid = floor(fy * 1.4);
    float fv = abs(fract(fy * 1.4) - 0.5);
    fern = (1.0 - smoothstep(0.03, 0.09, fv)) * step(0.15, mid)
         * (1.0 - smoothstep(uHalf * (0.45 + 0.4 * hh2(vec2(fid, uSeed))), uHalf * 0.95, mid)) * cut;
    spoke = 0.0;
  }
  // A crack's hole: black water opening in its middle as the bar runs.
  float water = 0.0;
  if (uFlow > 0.0) {
    float wr = uFlow * span * (0.18 + 0.4 * uFill * uFill);
    float lip = 1.0 + 0.18 * (vn(vec2(ang * 2.5, uSeed)) - 0.5);
    water = 1.0 - smoothstep(wr * lip * 0.85, wr * lip, r);
  }
  float lines = max(frac * (0.3 + 0.7 * swept), spoke * swept);
  lines = max(lines, fern * swept);
#ifdef PT_CHAR
  vec3 tint = vec3(0.4, 0.58, 0.8);
  vec3 deep = vec3(0.07, 0.15, 0.3);
  float shade = 0.8 + 0.3 * plate.y;
  float c = uChar * (0.45 + 0.42 * swept + 0.12 * uWarn) * shade;
  c *= smoothstep(-0.02, 0.3, edge);
  c = clamp(c * uFade, 0.0, 0.9);
  vec3 floorTint = mix(vec3(1.0), tint, c);
  // The seams and the groove cut deep, the shards' feet shadowed, the water black.
  float under = max(frac * 0.55 * (0.4 + 0.6 * swept), groove * swept);
  under = max(under, shard * (1.0 - facet) * 0.6);
  floorTint = mix(floorTint, floorTint * deep * 1.6, clamp(under * uCrack * uFade, 0.0, 0.9));
  floorTint *= 1.0 - water * 0.88 * uFade;
  gl_FragColor = vec4(floorTint, 1.0);
#else
  vec3 col = vec3(0.0);
${PAINTED_TELEGRAPH_RIM_GLSL}
  // The danger reads first: the edge held in the THREAT colour (never washed
  // white by the frost), a band of it glowing in off the edge, a faint wash
  // of it over the frozen floor, burning up over the bar's last stretch.
  float threatBand = 1.0 - smoothstep(0.0, 1.0 + 0.5 * wk, edge);
  col += uColor * rimCore * 0.85 * uRim * uRimK;
  col += uColor * threatBand * (0.2 + 0.18 * uWarn) * uRimK;
  col += uColor * 0.08 * uWarn * swept * (1.0 - water);
  vec3 cDim = vec3(0.16, 0.32, 0.48);
  vec3 cLit = vec3(0.5, 0.82, 1.0);
  vec3 cHot = vec3(0.86, 0.97, 1.0);
  // The bar's last stretch: the fractures pulse, the frozen floor flashes.
  float pulse = 1.0 + 0.5 * uWarn * (0.5 + 0.5 * sin(uTime * 15.0));
  float bright = mix(0.25, 1.0, swept) * pulse;
  col += mix(cDim, cLit, swept) * frac * (0.1 + 0.42 * swept) * uCrack * pulse;
  col += mix(cLit, cHot, 0.3 + 0.4 * uWarn) * spoke * 0.5 * bright * uCrack;
  // Each frozen plate its own cold sheen (ice, never bare stone).
  col += vec3(0.1, 0.22, 0.34) * (0.35 + 0.65 * plate.y) * swept * 0.55 * uBody * (1.0 - water);
  col += cLit * fern * 0.3 * swept * uCrack * pulse;
  // The groove's bevelled lips catching the light.
  col += cHot * groove * (1.0 - groove) * 2.2 * swept * uCrack;
  // Rime along the edges and riding the front.
  col += cLit * feather * (rimeBand * (0.08 + 0.2 * swept) + frontBand * 0.35) * uBody;
  col += cHot * frontBand * 0.22 * uFront * uBody;
  // The shards: one facet lit, one shaded, their tips white.
  col += mix(cDim * 0.6, cLit * 0.7, facet) * shard * (0.35 + 0.25 * swept) * uBody;
  col += cHot * shardTip * facet * 0.3 * uBody;
  // The water's rim of slush.
  col += cLit * water * (1.0 - water) * 2.0 * uBody;
  col += mix(cLit, cHot, 0.5) * 0.14 * uWarn * swept * smoothstep(0.0, 0.4, edge) * (1.0 - water);
  if (uDetail > 0.0) {
    // Fine crazing in the frost.
    float fine = 1.0 - smoothstep(0.0, 0.05, cellNet(wp * uCells * 2.8 + 5.1).x);
    col += cLit * fine * 0.1 * swept * uBody;
    // Mist drifting low over the frost.
    float mist = fbm(vP * 0.45 + vec2(uTime * 0.18, -uTime * 0.11) + uSeed);
    col += vec3(0.42, 0.6, 0.72) * smoothstep(0.45, 0.85, mist) * 0.16 * (0.3 + 0.7 * swept) * uBody;
    // Glints winking in the ice.
    vec2 g = vP * 1.6;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id + uSeed);
    vec2 o = vec2(hh2(id + 3.1), hh2(id + 7.3)) - 0.5;
    float glint = (1.0 - smoothstep(0.0, 0.07, length(f - o * 0.6))) * step(0.86, h);
    col += cHot * glint * max(0.0, sin(uTime * 3.0 + h * 50.0)) * 0.7 * swept;
  }
  gl_FragColor = vec4(col * uFade, 1.0);
#endif
}
`;
