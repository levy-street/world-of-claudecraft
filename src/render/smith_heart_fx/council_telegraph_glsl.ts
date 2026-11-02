// The Hammer Council's floor warning shaders (numbers:
// painted_telegraph_core.ts; dressing: painted_telegraphs.ts), at the Heat
// telegraph's bar (heat_telegraph_glsl.ts). One source, compiled per paint
// (`CT_QUAKE`, `CT_RUBBLE`) and per pass, read off the shared floor
// telegraph's own uniforms plus the kind's look (the head, the measure and the
// rim are the Breath's: breath_telegraph_glsl.ts):
//  - the CHAR pass (`PT_CHAR`, a multiply): the Quarry's floor under the mark
//    taken by the stone: dark granite, each plate its own shade (the slabs
//    heaving), the fissures deepest; the rubble's gaps black between the
//    stones;
//  - the GLOW pass (additive): the edge a crisp line in the THREAT colour with
//    a warm white core (the exact radius, every tier); then the paint:
//      quake: fissures splitting out from the middle with the fill (a pillar
//      or a rock coming), each a dark trench with a molten core (orange to
//      white hot toward the root) and a tight glow, only scored ahead of the
//      front, the plates' seams opening, a lip of dust riding the front, the
//      cores throbbing over the bar's last stretch; the live dressing heats
//      them (`uHeat`: a rock's crescendo, a crater cooling) and the char pass
//      lays the Falling Rock's shadow under them (`uShadow`, `uShadowK`:
//      rockShadowLook), so the cores burn through the dark;
//      rubble: broken stone and gravel, the gaps glowing faintly ochre, dust
//      drifting over it.
// The dust, the fine cracks and the glints are the cosmetic layers (`uDetail`);
// the edge, the fissures and the front draw on every tier.

import {
  PAINTED_TELEGRAPH_HEAD_GLSL,
  PAINTED_TELEGRAPH_MEASURE_GLSL,
  PAINTED_TELEGRAPH_RIM_GLSL,
} from './breath_telegraph_glsl';

export const COUNCIL_TELEGRAPH_FRAG = /* glsl */ `
${PAINTED_TELEGRAPH_HEAD_GLSL}
void main() {
${PAINTED_TELEGRAPH_MEASURE_GLSL}
  float ang = atan(vP.x, vP.y);
  float r = length(vP);
  vec3 rimWhite = vec3(1.0, 0.94, 0.8);
  // A warp so no line is a ruler.
  vec2 wp = vP + vec2(fbm(vP * 0.32 + uSeed) - 0.5, fbm(vP * 0.32 + uSeed + 7.0) - 0.5) * 1.6;
  // The plates: big granite slabs, each its own shade.
  vec2 plate = cellNet(wp * uCells + vec2(uSeed, 3.3));
  float seamLine = 1.0 - smoothstep(0.0, 0.07, plate.x);
  // The heat (a rock's crescendo, a crater cooling) and the scale of the
  // lines (a small mark keeps its fissures in proportion).
  float heat = clamp(uHeat, 0.0, 1.0);
  float wk = clamp(span / 6.0, 0.5, 1.2);
#if defined(CT_QUAKE)
  // The fissures: jagged spokes out of the middle, lengths their own, each a
  // dark trench split open with a molten core and a glow round it.
  float spokes = 5.0 + floor(span * 0.32);
  float aw = ang + (fbm(vec2(r * 0.45, uSeed)) - 0.5) * 0.9 / max(r * 0.25, 0.35);
  float sp = aw * spokes / 6.2832 + uSeed;
  float cell = floor(sp);
  float fr = fract(sp) - 0.5 - (hh2(vec2(cell, uSeed)) - 0.5) * 0.5;
  float len = span * (0.62 + 0.38 * hh2(vec2(cell + 1.7, uSeed)));
  float taper = 1.0 - clamp(r / max(len, 0.01), 0.0, 1.0);
  float dArc = abs(fr) * r * 6.2832 / spokes;
  float tipCut = (1.0 - smoothstep(len - 0.9, len, r)) * smoothstep(0.1, 0.45, r);
  float trenchW = (0.07 + 0.3 * taper) * wk;
  float trench = (1.0 - smoothstep(trenchW * 0.55, trenchW, dArc)) * tipCut;
  float coreLine = (1.0 - smoothstep(0.0, trenchW * 0.42, dArc)) * tipCut;
  float glowF = exp(-dArc / (trenchW * 1.8 + 0.05)) * tipCut;
  float fissure = trench;
  // The front: a ragged split racing out with the bar.
  float jag = (vn(wp * 0.8) - 0.5) * 0.9 + (vn(wp * 2.5 + 4.1) - 0.5) * 0.35;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.14, 0.14, ahead);
  // A fissure is open behind the front only (the split travels); ahead of it
  // the stone is only scored.
  float open = trench * swept;
  float scored = trench * (1.0 - swept) * 0.35;
  float lines = max(open, seamLine * (0.25 + 0.75 * swept));
  // The middle: the root every fissure splits out of (the impact point).
  float root = 1.0 - smoothstep(0.0, 0.85 * wk, r);
#else
  // Rubble: small broken stones, the gaps between them dark.
  vec2 peb = cellNet(vP * uCells * 1.6 + vec2(uSeed, 9.1));
  float stone = smoothstep(0.02, 0.22, peb.x);
  float fissure = 0.0;
  float ahead = -1.0;
  float swept = 1.0;
  float open = 0.0;
  float lines = max(seamLine, 1.0 - stone);
#endif

  // The rock's shadow (the soak): a lumpy boulder's shade, soft and pale
  // while it hangs high, black and crisp as it lands (rockShadowLook). The
  // char pass darkens the stone under it; the glow pass keeps only the
  // fissures' cores burning through it.
  float sh = 0.0;
  float shDark = 0.0;
  if (uShadow > 0.0) {
    float lump = 1.0 + 0.14 * (vn(vec2(ang * 1.6 + uFill * 2.2, uSeed)) - 0.5)
               + 0.07 * (vn(vec2(ang * 4.8 - uFill * 3.0, uSeed + 3.0)) - 0.5);
    float rs = radial / max(uShadow * lump, 0.01);
    float k = clamp(uShadowK, 0.0, 1.0);
    float soft = 0.55 - 0.47 * pow(k, 0.8);
    shDark = 0.55 + 0.4 * pow(k, 0.6);
    sh = (1.0 - smoothstep(1.0 - soft, 1.0, rs)) * (0.78 + 0.22 * (1.0 - clamp(rs, 0.0, 1.0)));
  }
#ifdef PT_CHAR
  vec3 tint = vec3(0.36, 0.27, 0.19);
  vec3 deep = vec3(0.1, 0.065, 0.045);
  float shade = 0.82 + 0.3 * plate.y;
#if defined(CT_QUAKE)
  float c = uChar * (0.66 + 0.3 * swept + 0.1 * uWarn + 0.15 * heat) * shade;
  float under = max(max(open, scored), seamLine * 0.7 * (0.3 + 0.7 * swept));
  under = max(under, root * swept * 0.6);
#else
  float c = uChar * shade * (0.85 + 0.15 * peb.y);
  float under = max(1.0 - stone, seamLine) * 0.85;
#endif
  c *= mix(1.0, 0.45, landed * (1.0 - heat));
  c *= smoothstep(-0.02, 0.35, edge);
  c = clamp(c * uFade, 0.0, 0.92);
  vec3 floorTint = mix(vec3(1.0), tint, c);
  floorTint = mix(floorTint, floorTint * deep * 1.4, clamp(under * uCrack * uFade, 0.0, 0.92));
  floorTint *= 1.0 - sh * shDark * 0.94 * uFade;
  gl_FragColor = vec4(floorTint, 1.0);
#else
  vec3 col = vec3(0.0);
${PAINTED_TELEGRAPH_RIM_GLSL}
  vec3 cDim = vec3(0.34, 0.2, 0.08);
  vec3 cEmber = vec3(0.95, 0.3, 0.05);
  vec3 cLit = vec3(1.0, 0.56, 0.16);
  vec3 cHot = vec3(1.0, 0.9, 0.66);
#if defined(CT_QUAKE)
  // The fissures: a molten core in each trench, orange to white hot toward
  // the root, a glow bleeding over the stone round it (reads from afar);
  // only scored and dim ahead of the front.
  float rootK = 1.0 - clamp(r / max(span, 0.01), 0.0, 1.0);
  float hotK = clamp(rootK * 0.7 + 0.25 * uWarn + 0.55 * heat, 0.0, 1.0);
  // The last stretch: the cores throb (never a wash over the whole floor).
  float throb = 1.0 + 0.45 * uWarn * (0.5 + 0.5 * sin(uTime * 14.0));
  float bright = mix(0.22, 1.0, swept) * (0.9 + 0.6 * heat) * throb;
  float halo = 1.0 - 0.65 * sh;
  float glowT = exp(-dArc / (trenchW * 1.1 + 0.03)) * tipCut;
  col += mix(cLit, cHot, hotK) * coreLine * 1.3 * bright * uCrack;
  col += mix(cEmber, cLit, hotK * 0.5) * glowT * 0.24 * bright * uBody * swept * halo;
  col += cEmber * root * (0.12 + 0.4 * heat) * swept * uBody * halo;
  col += mix(cDim, cEmber, swept) * seamLine * mix(0.05, 0.16, swept) * uCrack * halo;
  if (uDetail > 0.0) {
    float fine = 1.0 - smoothstep(0.0, 0.05, cellNet(wp * uCells * 2.7 + 2.3).x);
    col += cEmber * fine * (0.05 + 0.08 * heat) * swept * uBody * halo;
    // The heat's shimmer along the cores.
    col += cHot * coreLine * 0.25 * heat * (0.5 + 0.5 * sin(uTime * 13.0 + r * 3.0 + uSeed));
  }
  // The front: a lip of split stone and dust racing out.
  float flick = uDetail > 0.0 ? 0.8 + 0.2 * vn(wp * 1.7 + vec2(uTime * 3.0, 0.0)) : 1.0;
  float seam = (1.0 - smoothstep(0.0, 0.22, abs(ahead))) * uFront;
  float lick = (1.0 - smoothstep(0.0, 1.1, ahead)) * step(0.0, ahead) * uFront;
  col += mix(cLit, cHot, 0.5) * seam * 0.6 * flick + vec3(0.75, 0.6, 0.42) * lick * 0.16 * flick;
  // The bar's last stretch: a low glow of the threat over the split floor.
  col += uColor * 0.06 * uWarn * swept * halo;
#else
  col += cLit * (1.0 - stone) * 0.16 * uCrack * (0.75 + 0.25 * sin(uTime * 1.6 + peb.y * 9.0));
  col += cDim * seamLine * 0.3 * uCrack;
#endif
  // Dust drifting over it (cosmetic).
  if (uDetail > 0.0) {
    vec2 g = vP * 1.3 + vec2(uTime * 0.25, -uTime * 0.4);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id + uSeed);
    vec2 o = vec2(hh2(id + 3.1), hh2(id + 7.3)) - 0.5;
    float mote = (1.0 - smoothstep(0.0, 0.1, length(f - o * 0.6))) * step(0.8, h);
    col += uAccent * mote * (0.25 + 0.3 * sin(uTime * 4.0 + h * 40.0)) * (0.3 + 0.7 * swept);
  }
  gl_FragColor = vec4(col * uFade, 1.0);
#endif
}
`;
