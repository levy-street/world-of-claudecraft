// The palette lab's colour grade: one shared uniform block plus the GLSL the
// output grade pass compiles in under its PALETTE_GRADE define (only when the
// lab is on, `?palette=on`). The block is shared BY REFERENCE with every grade
// pass (the main one and its FXAA twin), so the lab writes a look once and
// every chain draws it on the next frame, whatever pass the shed has active.
//
// The look's white balance REPLACES the stock grade's warm GAIN (that line in
// post_output_grade.ts mixes GAIN toward `uPalWB.rgb` by `uPalWB.a`): the
// stock gain lands every white about 25 code values bluer-short than red, so
// a pale cyan sky or haze can only ever read cream under it. The rest runs on
// the display-referred image after the stock S-curve, before the vignette,
// the cel ink and the spirit drain, so the dead still drain to grey under any
// look. `uPalWB.a` is the master mix: 0 is the stock image exactly.

import { Vector4 } from 'three';

export interface PaletteGradeUniforms {
  /** rgb: white-balance gains (replacing the stock GAIN), a: master mix (0 = off). */
  uPalWB: { value: Vector4 };
  /** x: contrast about mid-grey, y: saturation, z: vibrance, w: black lift. */
  uPalTone: { value: Vector4 };
  /** rgb: shadow tint (display space), a: its amount. */
  uPalShadow: { value: Vector4 };
  /** rgb: highlight tint (display space), a: its amount. */
  uPalHighlight: { value: Vector4 };
  /** x: foliage-band hue shift (turns), y: its saturation gain, z: its value gain. */
  uPalGreen: { value: Vector4 };
}

const uniforms: PaletteGradeUniforms = {
  uPalWB: { value: new Vector4(1, 1, 1, 0) },
  uPalTone: { value: new Vector4(1, 1, 0, 0) },
  uPalShadow: { value: new Vector4(0.5, 0.5, 0.5, 0) },
  uPalHighlight: { value: new Vector4(0.5, 0.5, 0.5, 0) },
  uPalGreen: { value: new Vector4(0, 1, 1, 0) },
};

/** The shared block every grade pass merges into its own uniforms. */
export function paletteGradeUniforms(): PaletteGradeUniforms {
  return uniforms;
}

/** Declarations plus `vec3 paletteGrade(vec3 c)`, for a GLSL3 fragment. */
export const PALETTE_GRADE_GLSL = /* glsl */ `
  uniform vec4 uPalWB;
  uniform vec4 uPalTone;
  uniform vec4 uPalShadow;
  uniform vec4 uPalHighlight;
  uniform vec4 uPalGreen;

  vec3 wocPalRgb2Hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x);
  }

  vec3 wocPalHsv2Rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 paletteGrade(vec3 c) {
    if (uPalWB.a <= 0.0) return c;
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    vec3 src = c;
    c = clamp(c, 0.0, 1.0);
    // The foliage band: yellow-green through teal (about 50 to 180 degrees),
    // only on coloured pixels, so stone, skin and cloth greys stay put. This is
    // what turns every leaf, blade and meadow at once (no foliage rebuild).
    vec3 hsv = wocPalRgb2Hsv(clamp(c, 0.0, 1.0));
    float hue = hsv.x * 360.0;
    float band = smoothstep(42.0, 72.0, hue) * (1.0 - smoothstep(165.0, 195.0, hue))
      * smoothstep(0.06, 0.22, hsv.y);
    if (band > 0.0) {
      hsv.x = fract(hsv.x + uPalGreen.x * band);
      hsv.y = clamp(hsv.y * mix(1.0, uPalGreen.y, band), 0.0, 1.0);
      hsv.z *= mix(1.0, uPalGreen.z, band);
      c = wocPalHsv2Rgb(hsv);
    }
    c = max((c - 0.5) * uPalTone.x + 0.5, vec3(0.0));
    float l = clamp(dot(c, W), 0.0, 1.0);
    // Split tone: luminance-neutral chroma pushes (cool shade, warm light).
    float sw = 1.0 - smoothstep(0.04, 0.55, l);
    float hw = smoothstep(0.42, 0.95, l);
    c += (uPalShadow.rgb - dot(uPalShadow.rgb, W)) * (uPalShadow.a * sw);
    c += (uPalHighlight.rgb - dot(uPalHighlight.rgb, W)) * (uPalHighlight.a * hw);
    // Painterly black lift toward the shadow tint (no pure blacks).
    c += uPalShadow.rgb * (uPalTone.w * (1.0 - l) * (1.0 - l));
    // Never negative from here: a negative channel made the saturation
    // estimate explode on near-black pixels and the vibrance term flip sign.
    c = max(c, vec3(0.0));
    // Saturation with vibrance: muted colours gain more than vivid ones.
    l = dot(c, W);
    float cmax = max(c.r, max(c.g, c.b));
    float cmin = min(c.r, min(c.g, c.b));
    float sat = clamp((cmax - cmin) / max(cmax, 1.0e-3), 0.0, 1.0);
    c = mix(vec3(l), c, uPalTone.y * (1.0 + uPalTone.z * (1.0 - sat)));
    return mix(src, max(c, vec3(0.0)), uPalWB.a);
  }
`;
