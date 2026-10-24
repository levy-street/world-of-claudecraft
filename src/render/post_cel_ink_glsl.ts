// Ink outlines for the cel-shading R&D look (`?cel=on`, cel_shading_core.ts), as
// a GLSL arm the output grade pass compiles in under CEL_INK (post_output_grade.ts).
// It rides the grade the way the FXAA arm does: no pass, no target of its own,
// and the taps reuse the grade's own uInputUvRect remap and clamp, so the
// region-remapped grade-only chain (Medium) keeps its dynamic resolution. It
// reads the scene depth the chain already rasterizes (N8AO's beauty target on
// High and up with AO, the current composer scene target's depth otherwise).
//
// Edge test: 1/viewZ is affine in the perspective depth-buffer value AND affine
// across the screen on any plane, so its second difference is zero on every
// flat surface however steeply it is viewed and non-zero only where the surface
// folds or ends. Normalized by the centre's own 1/viewZ it reads as "how far the
// neighbourhood jumps relative to this pixel's depth". The NEGATIVE side is the
// near object's rim (both neighbours farther), so a silhouette inks one line on
// the object and none on the background behind it; a convex crease reads the
// same way at a smaller magnitude, and concave folds stay clean. Ink fades out
// with distance so far terrain does not dissolve into hatching.

export const CEL_INK_FADE_NEAR = 6;
export const CEL_INK_FADE_FAR = 15;
// The relative second difference at which a silhouette starts / is full ink.
const CEL_INK_EDGE_START = 0.12;
const CEL_INK_EDGE_FULL = 0.34;
// How dark the ink is: the line keeps this fraction of the colour under it, so
// it reads as a deep tone of the surface rather than a flat black stroke.
export const CEL_INK_TONE = 0.48;

function f(value: number): string {
  const text = String(value);
  return text.includes('.') ? text : `${text}.0`;
}

/** Declarations + helpers; splice after the grade's other uniforms. Applies
 *  the saturation first and the ink second, in display space. */
export const CEL_INK_GLSL = /* glsl */ `
  uniform sampler2D tCelDepth;
  // x ink strength, y saturation multiplier, z camera near, w camera far.
  uniform vec4 uCelInk;
  // One depth tap step in uv: the depth texel size times the ink width.
  uniform vec2 uCelTap;

  float celInvDist(vec2 uv) {
    float d = texture(tCelDepth, uv).x;
    return (uCelInk.w - (uCelInk.w - uCelInk.z) * d) / (uCelInk.z * uCelInk.w);
  }

  float celSecondDiff(vec2 uv, vec2 o, float ic, vec2 uvMax) {
    return celInvDist(clamp(uv - o, vec2(0.0), uvMax)) +
      celInvDist(clamp(uv + o, vec2(0.0), uvMax)) - 2.0 * ic;
  }

  float celInkAmount(vec2 uv, vec2 uvMax) {
    float ic = celInvDist(uv);
    float fade = 1.0 - smoothstep(${f(CEL_INK_FADE_NEAR)}, ${f(CEL_INK_FADE_FAR)}, 1.0 / max(ic, 1e-6));
    if (fade <= 0.0 || uCelInk.x <= 0.0) return 0.0;
    vec2 o = uCelTap;
    float e = min(
      min(celSecondDiff(uv, vec2(o.x, 0.0), ic, uvMax), celSecondDiff(uv, vec2(0.0, o.y), ic, uvMax)),
      min(celSecondDiff(uv, o, ic, uvMax), celSecondDiff(uv, vec2(o.x, -o.y), ic, uvMax))
    );
    return smoothstep(${f(CEL_INK_EDGE_START)}, ${f(CEL_INK_EDGE_FULL)}, -e / max(ic, 1e-6)) *
      fade * uCelInk.x;
  }

  vec3 celInkApply(vec3 c, vec2 uv, vec2 uvMax) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, uCelInk.y), vec3(0.0));
    return mix(c, c * ${f(CEL_INK_TONE)}, celInkAmount(uv, uvMax));
  }
`;
