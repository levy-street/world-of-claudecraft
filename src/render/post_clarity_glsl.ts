// Clarity for the output grade (clarity_core.ts), as a GLSL arm the grade pass compiles in
// under CLARITY_GRADE (post_output_grade.ts). Like the FXAA and ink arms it is no pass and
// no target of its own: its taps reuse the grade's own displayColor and its uInputUvRect
// remap and clamp, so the region-remapped chain keeps its dynamic resolution.
//
// It is an unsharp mask in display space: eight taps on two rings give the neighbourhood's
// mean, and the pixel is pushed away from it. The inner ring sits at 0.7 of the radius and
// the outer at 1.6, weighted as a Gaussian of that radius would weight them, so the result
// tracks a true Gaussian unsharp of the same radius closely enough for the eye.

/** Ring radii, in units of the settings' radius. */
export const CLARITY_INNER_RING = 0.7;
export const CLARITY_OUTER_RING = 1.6;
/** Weights of the centre, of each inner tap and of each outer tap. */
export const CLARITY_WEIGHTS = { centre: 0.07, inner: 0.125, outer: 0.1075 } as const;

function f(value: number): string {
  const text = String(value);
  return text.includes('.') ? text : `${text}.0`;
}

/** Declarations + helpers; splice after displayColor is defined. */
export const CLARITY_GLSL = /* glsl */ `
  // x amount, y limit, z radius as a fraction of the rendered height.
  uniform vec3 uClarity;

  vec3 clarityTap(vec2 uv, vec2 o, vec2 uvMax) {
    return displayColor(clamp(uv + o, vec2(0.0), uvMax)).rgb;
  }

  vec3 clarityApply(vec3 displayM, vec2 uv, vec2 uvMax) {
    // one radius in input uv: a fraction of the RENDERED height, squared up by the aspect
    vec2 r = uClarity.z * uInputUvRect.y * vec2(uInputTexelSize.x / uInputTexelSize.y, 1.0);
    vec2 a = r * ${f(CLARITY_INNER_RING)};
    vec2 b = r * ${f(CLARITY_OUTER_RING)} * 0.7071;
    vec3 inner = clarityTap(uv, vec2(a.x, 0.0), uvMax) + clarityTap(uv, vec2(-a.x, 0.0), uvMax) +
      clarityTap(uv, vec2(0.0, a.y), uvMax) + clarityTap(uv, vec2(0.0, -a.y), uvMax);
    vec3 outer = clarityTap(uv, b, uvMax) + clarityTap(uv, -b, uvMax) +
      clarityTap(uv, vec2(b.x, -b.y), uvMax) + clarityTap(uv, vec2(-b.x, b.y), uvMax);
    vec3 mean = displayM * ${f(CLARITY_WEIGHTS.centre)} + inner * ${f(CLARITY_WEIGHTS.inner)} +
      outer * ${f(CLARITY_WEIGHTS.outer)};
    vec3 detail = clamp(displayM - mean, vec3(-uClarity.y), vec3(uClarity.y));
    return max(displayM + uClarity.x * detail, vec3(0.0));
  }
`;
