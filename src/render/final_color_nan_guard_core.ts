const OPAQUE_GUARD_MARKER = 'WOC_OPAQUE_NAN_GUARD';
const FOG_GUARD_MARKER = 'WOC_FOG_NAN_GUARD';

const OPAQUE_WRITE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
const FOG_WRITE = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';

// Every NaN comparison is false, so (x < 0.0 || x >= 0.0) keeps finite and
// infinite values and rewrites only NaN to zero. This is generic hardening,
// installed unconditionally on every tier and platform: GLES leaves the
// conversion of a NaN fragment output into a fixed-point (UNSIGNED_BYTE)
// render target undefined, so "the direct-to-canvas tiers clamp it away" is
// an observation from one driver family, not a portability guarantee, and
// the IBL/PBR path that emits these NaNs on some drivers (observed on
// ANGLE's OpenGL backend with NVIDIA on Linux, see post_output_grade.ts) is
// reachable from every tier, composer or not. On the composer/gradePass
// tiers this is on top of, not instead of, OutputGradePass's sanitizeFinite
// (post_output_grade.ts): whether scrubbing this much earlier (at the
// fragment write, before the bloom pass's own blur can touch the value at
// all) closes a gap sanitizeFinite's later, per-output-pixel scrub does not
// is not verified here either way; the unconditional install does not
// depend on the answer.
function scrubStatements(target: string): string {
  return (
    `${target}.x = ( ${target}.x < 0.0 || ${target}.x >= 0.0 ) ? ${target}.x : 0.0;\n` +
    `${target}.y = ( ${target}.y < 0.0 || ${target}.y >= 0.0 ) ? ${target}.y : 0.0;\n` +
    `${target}.z = ( ${target}.z < 0.0 || ${target}.z >= 0.0 ) ? ${target}.z : 0.0;\n`
  );
}

function scrubScalar(target: string): string {
  return `${target} = ( ${target} < 0.0 || ${target} >= 0.0 ) ? ${target} : 0.0;\n`;
}

/**
 * Scrub NaN out of diffuseColor.a and outgoingLight immediately before
 * opaque_fragment writes them to gl_FragColor. Every material that includes
 * this chunk (lit and basic alike) gets the guard, applied once, right
 * before the write it protects.
 *
 * The alpha scrub is unconditional (never gated on USE_FOG): fog_fragment
 * never touches gl_FragColor.a, so this is the only defense a NaN source
 * alpha gets. It is a true no-op on the common case, an OPAQUE material
 * (diffuseColor.a is the folded constant 1.0 by the time it runs, from the
 * #ifdef OPAQUE block above), and only ever sees a real, non-constant alpha
 * on a transparent material or one using transmission, where a NaN would
 * poison the destination colour once blended. The outgoingLight (rgb) scrub
 * is also unconditional: fog_fragment may mix in a finite fog color using a
 * non-zero fogFactor, and mix(NaN, fogColor, f) is still NaN, so the value
 * needs to be finite before the opaque write feeds fog_fragment. The
 * fog_fragment guard below remains necessary for NaNs introduced by fog
 * inputs themselves.
 */
export function patchOpaqueFragmentNanGuard(source: string): string {
  if (source.includes(OPAQUE_GUARD_MARKER)) return source;
  const index = source.indexOf(OPAQUE_WRITE);
  if (index < 0) throw new Error('Three opaque_fragment anchor changed');
  return (
    source.slice(0, index) +
    `// ${OPAQUE_GUARD_MARKER}\n` +
    scrubScalar('diffuseColor.a') +
    scrubStatements('outgoingLight') +
    source.slice(index)
  );
}

/**
 * opaque_fragment's guard is not the last word: fog_fragment mixes fogColor
 * into gl_FragColor.rgb afterward, so a NaN arriving through vFogDepth or a
 * fog uniform would still reach the backbuffer unscrubbed. Copy to a local
 * before scrubbing: chained-swizzle assignment (gl_FragColor.rgb.x = ...) is
 * not reliable GLSL ES across drivers.
 */
export function patchFogFragmentNanGuard(source: string): string {
  if (source.includes(FOG_GUARD_MARKER)) return source;
  const index = source.indexOf(FOG_WRITE);
  if (index < 0) throw new Error('Three fog_fragment anchor changed');
  const insertAt = index + FOG_WRITE.length;
  return (
    source.slice(0, insertAt) +
    `\n// ${FOG_GUARD_MARKER}\n` +
    'vec3 wocFogNanGuard = gl_FragColor.rgb;\n' +
    scrubStatements('wocFogNanGuard') +
    'gl_FragColor.rgb = wocFogNanGuard;' +
    source.slice(insertAt)
  );
}
