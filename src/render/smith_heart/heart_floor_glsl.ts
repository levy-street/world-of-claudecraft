// The Anvil of the World's floor painted (phase 2N, design doc section 5.21):
// the Heart kit lays each quarter's share of the one floor as a flat sheet
// carrying only its broad paint (docs/design/raid/kit/quarter_pieces.py
// `sheet_paint`: the warm neutral stone, its value groups, the light pooled
// mid-quarter, the soot round the circle, the dust toward the wall); this
// paints the stone on it, as a painter would:
//   - large soft slabs of varied sizes (a weighted cell field over a bowed
//     plan, laid once over the whole walk, so the joints run on unbroken
//     across the seams);
//   - joints thin, broken and inconsistent: most a fine dark line wavering
//     in width, some fading away to nothing along their run, some deep
//     cracks, chipped where the arrises broke;
//   - each slab its own value and a touch of hue, a painted light across
//     it, a pale worn arris on its lit side and a darker one away from it,
//     brush strokes along its grain, now and then a hairline crack, a slab
//     broken in two or a patch of small mended stones;
//   - wear paths polished pale (round the circle, in from the bridge, out to
//     each altar), soot smudges, dust settled in the joints toward the wall.
// The arris and the cracks bend the lit normal too (the standard tier), so a
// point light rakes them. Close up it holds detail; from the raid camera the
// fine detail fades with the pixel's footprint (`fwidth`), the floor calm.
//
// Room-local: the floor pieces stand unturned at the room's centre, so the
// vertex's own `position` is yards from the centre (no world point, no
// float32 wobble far out in the instance band). Only the flat sheet takes the
// paint (an up-facing face at the sheet's height): the sockets' tipped
// fragments and pits keep their own. Pure strings, Three-free.
//
// A crack's scar (the wide band under its light) only stands whole in a quarter
// the flood has reached: in a sleeping one it is cut away to the odd chip broken
// off the crack's edge, the painted sheet showing through under it, so a sleeping
// crack has no outline (`heartFloorScar`).

import { HEART_QUARTERS } from '../../sim/content/smith_heart_quarters';

/** The look's numbers (yards, shares). */
export const HEART_FLOOR_LOOK = {
  /** A slab's mean size: about three times 2M's, fewer and larger. */
  slab: 8.4,
  /** How far each slab's seed wanders in its cell (share of the cell). */
  jitter: 0.86,
  /** The spread of slab sizes (each cell's additive weight, share of the
   *  cell): the big ones swallow their neighbours' share. */
  weight: 0.34,
  /** How far the plan bows (yards): no slab side ruler-straight. */
  bow: 1.7,
  /** A joint's half width, thinnest to widest (yards). */
  joint: [0.028, 0.075],
  /** The shares of joints that fade away along their run, and that are
   *  deep cracks. */
  vanish: 0.26,
  deep: 0.1,
  /** The shares of slabs patched with small mended stones and broken in two. */
  patch: 0.07,
  broken: 0.1,
  /** The painted light's side in the plan (x, z): the 2M painters'. */
  light: [-0.42, -0.58],
  /** The sheet's height (quarter_pieces.py SHEET_Z) and the faces it paints. */
  sheetY: 0.02,
  /** The Heart Bridge lands on this bearing (degrees clockwise from north). */
  bridgeDeg: 225,
} as const;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const L = HEART_FLOOR_LOOK;
const Q = HEART_QUARTERS;
/** The height of a crackle's scar (quarter_pieces.py `_rim_crackle`, SKIN less a
 *  hair): the flat band of one colour laid under each crack's light. */
const SCAR_Y = 0.036;

/** The vertex half: the room-local point and the face's facing. */
export const HEART_FLOOR_VERT_HEAD = /* glsl */ `
varying vec3 vHfP;
varying float vHfUp;`;
export const HEART_FLOOR_VERT_BODY = /* glsl */ `
  vHfP = position;
  vHfUp = normal.y;`;

/** The fragment's helpers (`#include <common>`): hashes, noise, the cells. */
export function heartFloorFragHead(lowGfx: boolean): string {
  return /* glsl */ `
varying vec3 vHfP;
varying float vHfUp;
uniform vec4 uHfAwake;
uniform vec4 uHfFront;
float hfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hfHash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float hfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hfHash(i), hfHash(i + vec2(1.0, 0.0)), u.x),
             mix(hfHash(i + vec2(0.0, 1.0)), hfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Turned between octaves so no grid shows.
float hfFbm(vec2 p) {
  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);
  float v = 0.5 * hfNoise(p);
  p = m * p * 2.03 + 3.7;
  v += 0.28 * hfNoise(p);${
    lowGfx
      ? ''
      : `
  p = m * p * 2.01 - 1.3;
  v += 0.14 * hfNoise(p);`
  }
  return v / ${lowGfx ? '0.78' : '0.92'};
}
// The slabs: the nearest two weighted cells of q (cell units). g the cell,
// c its seed, d its weighted distance.
void hfCells(vec2 q, float jit, float wgt, out vec2 g1, out vec2 c1, out float d1,
             out vec2 g2, out vec2 c2, out float d2) {
  vec2 gi = floor(q);
  d1 = 1e9; d2 = 1e9;
  g1 = gi; g2 = gi; c1 = q; c2 = q;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = gi + vec2(float(i), float(j));
      vec2 c = g + 0.5 + (hfHash2(g) - 0.5) * jit;
      float d = length(q - c) - (hfHash(g + 17.31) - 0.5) * wgt;
      if (d < d1) { d2 = d1; g2 = g1; c2 = c1; d1 = d; g1 = g; c1 = c; }
      else if (d < d2) { d2 = d; g2 = g; c2 = c; }
    }
  }
}
float hfBand(float d, float w) { return exp(-(d * d) / (w * w)); }
float hfArc(float a, float b) { return abs(mod(a - b + 3.14159265, 6.2831853) - 3.14159265); }`;
}

/** The paint (after `#include <color_fragment>`: `diffuseColor.rgb` is the
 *  sheet's broad paint). Leaves `hfTilt` (the arris's lean in the plan),
 *  `hfWear` and `hfOn` for the later stages. */
export function heartFloorPaint(lowGfx: boolean): string {
  return /* glsl */ `
  vec2 hfTilt = vec2(0.0);
  float hfWear = 0.0;
  float hfOn = step(0.9995, vHfUp) * (1.0 - step(0.012, abs(vHfP.y - ${f(L.sheetY)})));
  if (hfOn > 0.5) {
    vec2 p = vHfP.xz;
    vec3 base = diffuseColor.rgb;
    // The pixel's footprint (yards): the fine detail fades as it grows.
    float fw = max(length(fwidth(p)), 1e-4);
    float near = 1.0 - smoothstep(0.035, 0.22, fw);
    // The slabs over a bowed plan.
    vec2 bow = vec2(hfFbm(p * 0.07 + 2.1), hfFbm(p * 0.07 - 6.3)) - 0.5;
    vec2 q = (p + bow * ${f(L.bow * 2)}) / ${f(L.slab)};
    vec2 g1; vec2 c1; float d1; vec2 g2; vec2 c2; float d2;
    hfCells(q, ${f(L.jitter)}, ${f(L.weight)}, g1, c1, d1, g2, c2, d2);
    // Yards from the joint (half the weighted gap), wavering a little.
    float e = (d2 - d1) * 0.5 * ${f(L.slab)} + (hfNoise(p * 1.7) - 0.5) * 0.05;
    vec2 nrm = normalize(c2 - c1 + 1e-5);
    float hs = hfHash(g1 + 3.7);
    float hs2 = hfHash(g1 + 9.1);
    float hs3 = hfHash(g1 + 5.3);
    // Wear paths: round the circle, in from the bridge, out to each altar.
    float r = length(p);
    float b = atan(p.x, p.y);
    float wear = hfBand(r - 21.0, 3.6);
    wear = max(wear, hfBand(r * hfArc(b, radians(${f(L.bridgeDeg)})), 3.8) * smoothstep(15.0, 22.0, r));
    for (int k = 0; k < 4; k++) {
      float ab = hfArc(b, radians(90.0 * float(k)));
      wear = max(wear, 0.75 * hfBand(r * ab, 2.9) * smoothstep(18.0, 26.0, r) * (1.0 - smoothstep(49.0, 55.0, r)));
    }
    wear *= 0.55 + 0.45 * hfNoise(p * 0.16 + 4.0);
    hfWear = wear;
    // Each slab's own value, a touch of hue, a light painted across it.
    float tone = 0.86 + 0.28 * hs;
    vec2 ld = vec2(${f(L.light[0])}, ${f(L.light[1])});
    float lit = clamp(dot(q - c1, ld) * 1.6, -1.0, 1.0);
    tone *= 1.0 + 0.07 * lit;
    // A soft pillow: the slab's middle catches the light, its margins sink
    // a little toward the joint (painted, never a bevel band).
    tone *= 0.9 + 0.1 * smoothstep(0.15, 2.4, e);
    // A painted pool of light or a shadow wandering across it.
    tone *= 1.0 + 0.1 * (hfNoise(p * 0.19 + hs * 17.0) - 0.5);
    vec3 col = base * tone * vec3(1.0 + 0.06 * (hs2 - 0.5), 1.0, 1.0 - 0.07 * (hs2 - 0.5));
    // Brush strokes along the slab's grain, and a fine mottle.${
      lowGfx
        ? ''
        : `
    float ang = hs3 * 3.14159;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 sp = rot * p;
    float stroke = hfNoise(sp * vec2(0.45, 2.1) + hs * 40.0) - 0.5;
    float mottle = hfFbm(p * 0.95 + hs * 13.0) - 0.5;
    col *= 1.0 + (0.075 * stroke + 0.06 * mottle) * near * (1.0 - 0.6 * wear);`
    }
    // A patch of small mended stones (their own little joints).
    float mend = step(hs, ${f(L.patch)});
    float jw = mix(${f(L.joint[0])}, ${f(L.joint[1])}, hfHash(g1 + g2 + 0.37));
    float js = 0.55 + 0.45 * hfNoise(p * 0.33 + hs * 7.0);
    float deepK = 0.0;
    float ehash = hfHash(g1 + g2 + 0.37);
    if (ehash < ${f(L.vanish)}) {
      // A joint that fades away along its run (worn level, filled with grit).
      js *= smoothstep(0.35, 0.75, hfNoise(p * 0.21 + ehash * 31.0)) * 0.7;
    } else if (ehash > ${f(1 - L.deep)}) {
      // A deep crack: wider, darker, jagged.
      deepK = 1.0;
      jw *= 1.35 + 0.8 * hfNoise(p * 2.3);
      js = 0.9;
    } else {
      // Broken along its run here and there.
      js *= 0.35 + 0.65 * smoothstep(0.18, 0.45, hfNoise(p * 0.17 + ehash * 11.0));
    }
    // Chips where an arris broke: the joint widened into a notch.
    float chip = smoothstep(0.72, 0.84, hfNoise(p * 1.05 + ehash * 5.0)) * (1.0 - smoothstep(jw, jw + 0.5, e));
    float jwe = jw + chip * 0.12;
    float afw = max(fwidth(e), 1e-4);
    float joint = 1.0 - smoothstep(jwe - afw, jwe + afw, e);
    // A line thinner than the pixel fades rather than shimmering.
    joint *= clamp(jwe / afw, 0.25, 1.0);
    joint *= js * (1.0 - 0.5 * wear);
    // The arris: pale on the slab's lit side, darker away from it.
    float lip = (1.0 - smoothstep(jwe, jwe + 0.34, e)) * (1.0 - joint);
    float face = dot(nrm, normalize(ld));
    col *= 1.0 + lip * (0.06 + 0.14 * max(face, 0.0) - 0.1 * max(-face, 0.0)) * (0.4 + 0.6 * near);
    col = mix(col, col * 1.15, chip * lip * 0.5);
    hfTilt = nrm * lip * (0.55 + 0.45 * deepK);
    // A slab broken in two.
    float brk = step(${f(L.patch)}, hs) * step(hs, ${f(L.patch + L.broken)});
    if (brk > 0.5) {
      float ba = hs2 * 3.14159;
      vec2 bn = vec2(cos(ba), sin(ba));
      float bd = abs(dot((q - c1) * ${f(L.slab)}, bn) + (hfNoise(p * 0.9 + hs * 9.0) - 0.5) * 1.1);
      float bw = 0.05 + 0.04 * hfNoise(p * 2.7);
      float bfw = max(fwidth(bd), 1e-4);
      float bl = (1.0 - smoothstep(bw - bfw, bw + bfw, bd)) * smoothstep(0.4, 0.9, e);
      joint = max(joint, bl);
      deepK = max(deepK, bl);
    }${
      lowGfx
        ? ''
        : `
    // A hairline crack wandering across a big stone, now and then.
    float hl = abs(hfNoise(p * 0.42 + hs * 23.0) - 0.5);
    float hfw = max(fwidth(hl), 1e-4);
    float hair = (1.0 - smoothstep(0.012 - hfw, 0.012 + hfw, hl)) * step(0.7, hs3)
      * smoothstep(0.55, 0.75, hfNoise(p * 0.12 + hs2 * 17.0)) * smoothstep(0.5, 1.2, e) * near;
    col *= 1.0 - 0.35 * hair;`
    }
    if (mend > 0.5) {
      vec2 sq = p / 1.7;
      vec2 h1; vec2 k1; float s1; vec2 h2; vec2 k2; float s2;
      hfCells(sq, 0.8, 0.0, h1, k1, s1, h2, k2, s2);
      float se = (s2 - s1) * 0.85;
      float sfw = max(fwidth(se), 1e-4);
      float sj = 1.0 - smoothstep(0.04 - sfw, 0.04 + sfw, se);
      col = base * (0.84 + 0.18 * hfHash(h1)) * vec3(0.97, 0.98, 1.02);
      joint = max(joint, sj * 0.8 * smoothstep(0.25, 0.6, e));
    }
    // Soot smudged here and there, dust settled toward the wall.
    float soot = smoothstep(0.62, 0.82, hfFbm(p * 0.045 + 11.0));
    col *= 1.0 - 0.2 * soot;
    float dust = smoothstep(44.0, 60.0, r) * (0.5 + 0.5 * hfNoise(p * 0.3));
    // The worn paths: paler, a touch greyer, smoother.
    col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))), 0.12 * wear) * (1.0 + 0.08 * wear);
    vec3 grit = mix(base * 0.42, base * 0.85 + vec3(0.03, 0.025, 0.02), dust * 0.6);
    grit = mix(grit, base * 0.2, deepK);
    col = mix(col, grit, clamp(joint, 0.0, 1.0));
    diffuseColor.rgb = col;
  }
  ${heartFloorScar()}`;
}

/** A crackle's scar in a sleeping quarter (the flood's front not yet over it):
 *  mostly cut away, the odd chip kept a paler broken stone. The quarter by the
 *  sim's own unwinding of the sweep (`heartQuarterIndexAt`). */
function heartFloorScar(): string {
  const first = -45 + Q.rimOffsetDeg;
  return /* glsl */ `
  if (vHfUp > 0.9995 && abs(vHfP.y - ${f(SCAR_Y)}) < 0.004) {
    vec2 sp = vHfP.xz;
    float sr = length(sp);
    float su = 1.0 - clamp((sr - ${f(Q.ringR)}) / ${f(Q.rimR - Q.ringR)}, 0.0, 1.0);
    float sweep = ${f(Q.sweepDeg)} * pow(su, ${f(Q.power)});
    float sphi = mod(degrees(atan(sp.x, sp.y)) + sweep - (${f(first)}), 360.0);
    float si = floor(sphi / 90.0);
    float sa = si < 0.5 ? uHfAwake.x : si < 1.5 ? uHfAwake.y : si < 2.5 ? uHfAwake.z : uHfAwake.w;
    float sf = si < 0.5 ? uHfFront.x : si < 1.5 ? uHfFront.y : si < 2.5 ? uHfFront.z : uHfFront.w;
    float sInside = sa * (1.0 - smoothstep(sf - 2.2, sf, sr));
    if (sInside < 0.5) {
      float chip = hfFbm(sp * 2.9 + 3.0);
      if (chip < 0.68) discard;
      diffuseColor.rgb = diffuseColor.rgb * 0.4 + vec3(0.1, 0.08, 0.068) * (0.8 + 0.5 * hfNoise(sp * 5.0));
    }
  }`;
}

/** The arris and the cracks bending the lit normal (after
 *  `#include <normal_fragment_maps>`, the standard tier): the slab's top
 *  rolls down toward its joint. A direction turned into view space. */
export const HEART_FLOOR_NORMAL = /* glsl */ `
  if (hfOn > 0.5) {
    vec3 hfN = (viewMatrix * vec4(hfTilt.x, 0.0, hfTilt.y, 0.0)).xyz;
    normal = normalize(normal + hfN * 0.9);
  }`;

/** The worn paths a little more polished (after
 *  `#include <roughnessmap_fragment>`, the standard tier). */
export const HEART_FLOOR_ROUGH = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor - 0.16 * hfWear, 0.3, 1.0);`;
