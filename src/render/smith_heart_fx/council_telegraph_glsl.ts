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
//      or a rock coming), dim umber ahead of the front and burning ochre and
//      gold behind it, the plates' seams opening, a lip of dust riding the
//      front, the swept floor flaring over the bar's last stretch;
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
#if defined(CT_QUAKE)
  // The fissures: jagged spokes out of the middle, lengths their own.
  float spokes = 6.0 + floor(span * 0.35);
  float aw = ang + (fbm(vec2(r * 0.45, uSeed)) - 0.5) * 0.9 / max(r * 0.25, 0.35);
  float sp = aw * spokes / 6.2832 + uSeed;
  float cell = floor(sp);
  float fr = fract(sp) - 0.5 - (hh2(vec2(cell, uSeed)) - 0.5) * 0.5;
  float len = span * (0.62 + 0.38 * hh2(vec2(cell + 1.7, uSeed)));
  float width = 0.11 * (1.0 - 0.6 * clamp(r / max(len, 0.01), 0.0, 1.0)) + 0.02;
  float fissure = (1.0 - smoothstep(width * 0.5, width + 0.04, abs(fr) * r * 6.2832 / spokes))
                * (1.0 - smoothstep(len - 0.8, len, r)) * step(0.15, r);
  // The front: a ragged split racing out with the bar.
  float jag = (vn(wp * 0.8) - 0.5) * 0.9 + (vn(wp * 2.5 + 4.1) - 0.5) * 0.35;
  float ahead = yards + jag - fillYards;
  float swept = 1.0 - smoothstep(-0.14, 0.14, ahead);
  // A fissure is open behind the front only (the split travels).
  float open = fissure * swept;
  float lines = max(open, seamLine * (0.25 + 0.75 * swept));
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

#ifdef PT_CHAR
  vec3 tint = vec3(0.5, 0.42, 0.34);
  vec3 deep = vec3(0.18, 0.13, 0.1);
  float shade = 0.82 + 0.3 * plate.y;
#if defined(CT_QUAKE)
  float c = uChar * (0.62 + 0.3 * swept + 0.08 * uWarn) * shade;
  float under = max(open, seamLine * 0.6 * (0.3 + 0.7 * swept));
#else
  float c = uChar * shade * (0.85 + 0.15 * peb.y);
  float under = max(1.0 - stone, seamLine) * 0.85;
#endif
  c *= mix(1.0, 0.45, landed);
  c *= smoothstep(-0.02, 0.35, edge);
  c = clamp(c * uFade, 0.0, 0.9);
  vec3 floorTint = mix(vec3(1.0), tint, c);
  floorTint = mix(floorTint, floorTint * deep * 1.5, clamp(under * uCrack * uFade, 0.0, 0.88));
  gl_FragColor = vec4(floorTint, 1.0);
#else
  vec3 col = vec3(0.0);
${PAINTED_TELEGRAPH_RIM_GLSL}
  vec3 cDim = vec3(0.34, 0.2, 0.08);
  vec3 cLit = vec3(1.0, 0.62, 0.22);
  vec3 cHot = vec3(1.0, 0.9, 0.62);
#if defined(CT_QUAKE)
  // The fissures: dim umber ahead, burning ochre to gold behind the front,
  // hottest at their roots.
  float heat = (1.0 - 0.55 * clamp(r / max(span, 0.01), 0.0, 1.0));
  col += mix(cDim * 0.6, mix(cLit, cHot, heat * 0.6 + 0.3 * uWarn), swept) * fissure
       * mix(0.35, 1.25, swept) * uCrack;
  col += mix(cDim, cLit, swept) * seamLine * mix(0.12, 0.42, swept) * uCrack;
  if (uDetail > 0.0) {
    float fine = 1.0 - smoothstep(0.0, 0.05, cellNet(wp * uCells * 2.7 + 2.3).x);
    col += cLit * fine * 0.18 * swept * uBody;
  }
  // The swept floor: a faint wash of the threat and the stone's ochre.
  col += cLit * 0.03 * swept * (1.0 - 0.6 * landed);
  // The front: a lip of split stone and dust racing out.
  float flick = uDetail > 0.0 ? 0.8 + 0.2 * vn(wp * 1.7 + vec2(uTime * 3.0, 0.0)) : 1.0;
  float seam = (1.0 - smoothstep(0.0, 0.22, abs(ahead))) * uFront;
  float lick = (1.0 - smoothstep(0.0, 1.1, ahead)) * step(0.0, ahead) * uFront;
  col += mix(cLit, cHot, 0.5) * seam * 0.6 * flick + vec3(0.75, 0.6, 0.42) * lick * 0.16 * flick;
  // The bar's last stretch: the split floor flares.
  col += (uColor * 0.3 + cHot * 0.14) * uWarn * swept;
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
