// The CPU half of the WOC tint layers' colour-space math (woc_head_tint.ts draws with
// it). The skin and eye transfers read some of their UNIFORM colours through sRGB hue,
// saturation and value: the material's measured reference (the skin band is centred on
// its hue, the iris test starts above its saturation) and, for the eye, the look's
// target colour (the iris takes its hue and saturation, and its value as a gain). The
// shader used to work those out again for every fragment, which inlined its HSV
// conversion (and the gamma curve under it) five times in a merged head: twice for the
// texel, where it has to run, and three times for a constant of the draw. A uniform's
// HSV is converted here instead, once, when the uniform is written, and the fragment
// reads the result. What a transfer reads of the same colours LINEARLY (the skin's
// luminance and chroma ratios against its reference, its target as it is) stays in the
// shader, untouched.
//
// The functions mirror the layer's GLSL helpers statement for statement (wocHtLin2Srgb
// and wocHtRgb2Hsv in woc_head_tint.ts): the same expression, in double precision where
// the shader ran it in single, so the two agree to float rounding and nothing a player
// sees moves. tests/woc_tint_hsv_core.test.ts runs the shipped GLSL text against this
// mirror, so a change to either one alone fails there.
//
// Three-free and DOM-free.
import type { WocLinearRgb } from './woc_head_look_core';

type Rgb = readonly [number, number, number];

/** GLSL `wocHtLin2Srgb`: the gamma 2.2 curve, a negative channel held at 0. */
export function wocTintLin2Srgb(c: Rgb): [number, number, number] {
  const g = 1 / 2.2;
  return [Math.max(c[0], 0) ** g, Math.max(c[1], 0) ** g, Math.max(c[2], 0) ** g];
}

/**
 * GLSL `wocHtRgb2Hsv`: hue, saturation and value, each in 0..1. Its two `mix` calls take a
 * `step` (0 or 1) as their weight, so each selects one of its operands whole; the epsilon
 * that keeps a grey (no chroma) and a black (no value) off a division by zero is the
 * shader's own, and gives a grey the hue 0 and a pure primary a saturation a hair under 1.
 */
export function wocTintRgb2Hsv(c: Rgb): [number, number, number] {
  const [r, g, b] = c;
  // vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  const gb = g >= b;
  const px = gb ? g : b;
  const py = gb ? b : g;
  const pz = gb ? 0 : -1;
  const pw = gb ? -1 / 3 : 2 / 3;
  // vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  const rp = r >= px;
  const qx = rp ? r : px;
  const qy = py;
  const qz = rp ? pz : pw;
  const qw = rp ? px : r;
  const d = qx - Math.min(qw, qy);
  const e = 1.0e-10;
  return [Math.abs(qz + (qw - qy) / (6 * d + e)), d / (qx + e), qx];
}

/** What the shader's `wocHtRgb2Hsv(wocHtLin2Srgb(c))` answers for a linear colour: its
 *  sRGB hue, saturation and value, as the skin and eye transfers read a uniform colour. */
export function wocTintSrgbHsv(c: WocLinearRgb): [number, number, number] {
  return wocTintRgb2Hsv(wocTintLin2Srgb(c));
}
