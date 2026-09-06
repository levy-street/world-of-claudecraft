// The one non-finite guard the post chain splices into every fullscreen
// shader that reads a HalfFloat target (the output grade, the bloom
// high-pass). Shared as a snippet so the test is written once and every
// consumer carries the same bit-exact form.
//
// Why bit-exact and not a comparison: GLSL ES leaves NaN comparisons
// implementation-defined, and Mali (Android Chrome, Mali-G715, 2026-09) evaluates
// `(x < 0.0 || x >= 0.0)` as true for NaN, so the comparison-based scrub that
// stops ANGLE-GL's NaN on desktop let a NaN through on the phone. The tonemap's
// saturate then collapsed it to 0 and the whole frame went black. A float is
// NaN or Inf exactly when its exponent bits are all set; floatBitsToUint reads
// those bits with no arithmetic and no comparison the driver can fold.
//
// Every integer here is qualified highp on purpose. GLSL ES 3.00 predeclares
// `precision mediump int;` in the fragment language, a host that declares only
// `precision highp float;` (the grade's RawShaderMaterial) leaves it there, and
// mediump uint is allowed to be 16 bits wide: the mask 0x7f800000 would then
// truncate to zero on exactly the mobile GPUs this guard exists for, and
// equal(0, 0) would flag every texel.
//
// Inf is scrubbed as well: ACES of Inf is Inf/Inf = NaN, so an infinite sample
// blacks the frame the same way a NaN does. Scrubbing to zero rather than to a
// large finite value is a deliberate tradeoff: an Inf in a HalfFloat target is
// a value past 65504 that no lit surface in this renderer produces, so the
// choice only affects an already defective texel, and zero is the value that
// cannot feed the bloom a frame-wide smear. (The grade's later quantizeHalf can
// still mint an Inf from a finite sum past 65504; that one stays a single
// pixel, nothing blurs after the grade.)
//
// Selection, never arithmetic: `mix(v, 0.0, weight)` is `v * (1 - w) + 0 * w`,
// and NaN times zero stays NaN.
export const FINITE_GUARD_GLSL = /* glsl */ `
  bvec4 wocNonFinite(highp vec4 v) {
    highp uvec4 exponentBits = floatBitsToUint(v) & uvec4(0x7f800000u);
    return equal(exponentBits, uvec4(0x7f800000u));
  }

  vec4 wocSanitizeFinite4(highp vec4 v) {
    bvec4 bad = wocNonFinite(v);
    return vec4(
      bad.x ? 0.0 : v.x,
      bad.y ? 0.0 : v.y,
      bad.z ? 0.0 : v.z,
      bad.w ? 0.0 : v.w
    );
  }

  vec3 wocSanitizeFinite(highp vec3 v) {
    return wocSanitizeFinite4(vec4(v, 0.0)).xyz;
  }
`;

/**
 * The same test as a statement, for a chunk splice inside main() where no
 * function can be declared (final_color_nan_guard_core.ts): `target` is
 * rewritten to 0.0 when its exponent bits are all set.
 */
export function finiteGuardStatement(target: string): string {
  return `${target} = ( ( floatBitsToUint( ${target} ) & 0x7f800000u ) == 0x7f800000u ) ? 0.0 : ${target};\n`;
}
