// Per-zone softness for the cel light ramp. The cel look steps the sun's
// falloff into hard bands (cel_shading_core.ts); the art bible's painterly
// world wants a soft ramp with a blended terminator instead
// (docs/design/art-direction.md). One shared uniform object, bound by
// reference on every lit ShaderLib entry, blends the hard band toward a wide
// smooth falloff: 0 is the shipped hard band exactly, 1 is fully soft. The
// palette runtime writes the zone look's `render.rampSoft`, eased across zone
// borders. Three-free so a plain Vitest pins it.

/** The GLSL uniform name the ramp patch reads. */
export const CEL_RAMP_SOFT_UNIFORM_NAME = 'uWocCelSoft';

/** The uniform's backing array (x: softness; yzw reserved). A vec4 over a
 *  Float32Array because three's cloneUniforms passes a typed array BY REFERENCE
 *  into every material's uniforms (a plain number would be copied per
 *  material and never see a later write); same trick as lab_lighting.ts. */
export const CEL_RAMP_SOFT_VALUES = new Float32Array([0, 0, 0, 0]);

/** The shared uniform the lit materials bind. */
export const CEL_RAMP_SOFT_UNIFORM: { value: Float32Array } = { value: CEL_RAMP_SOFT_VALUES };

/** The GLSL read of the softness: `.r`, not `.x`, because it lands inside the
 *  `WOC_CEL_BAND( x )` macro, whose parameter `x` would rewrite an `.x` swizzle. */
export const CEL_RAMP_SOFT_GLSL = `${CEL_RAMP_SOFT_UNIFORM_NAME}.r`;

/** The current zone ramp softness. */
export function celRampSoftZone(): number {
  return CEL_RAMP_SOFT_VALUES[0];
}

/** Set the zone ramp softness; clamps to 0..1, non-finite restores the hard band. */
export function setCelRampSoftZone(value: number): void {
  CEL_RAMP_SOFT_VALUES[0] = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The soft falloff the band blends toward, as a GLSL expression of `x`
 *  (NL times the shadow factor) and the band's lit level. */
export function celSoftRampExpression(x: string, lit: string): string {
  return `( ${lit} * smoothstep( 0.0, 0.6, ${x} ) )`;
}
