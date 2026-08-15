const SHAPE_ERROR = 'Pinned UnrealBloom composite tint shader shape changed';
// three r182 rewrote the whole composite body, not just the tint term: it scales
// the mip sum by 3.0 and derives alpha from max(bloom.rgb) instead of
// accumulating the blurred sample alpha. post_output_grade adds the result as
// bloom.rgb * bloom.a, so that rewrite is not a drop-in and stripping its tint
// terms would grade a visibly different bloom. Name it in the throw instead.
const REWRITTEN_ERROR =
  'UnrealBloom composite rewritten (three r182 and later): the mip sum is scaled by 3.0 and alpha is derived from max(bloom.rgb) instead of the blurred sample alpha. post_output_grade adds it as bloom.rgb * bloom.a, so re-check the bloom before bumping three.';

const TINT_UNIFORM = /uniform\s+vec3\s+bloomTintColors\s*\[\s*NUM_MIPS\s*\]\s*;/;
// A bare `* bloomTintColors[i]` multiply, meaning the r182 rewrite rather than
// the r165 shape, where the same array is always wrapped in vec4(..., 1.0).
const BARE_TINT_MULTIPLY = /\*\s*bloomTintColors\s*\[\s*\d+\s*\]/;

function tintTerm(mip: number): RegExp {
  return new RegExp(
    `\\s*\\*\\s*vec4\\s*\\(\\s*bloomTintColors\\s*\\[\\s*${mip}\\s*\\]\\s*,\\s*1\\.0\\s*\\)`,
  );
}

/**
 * Removes the identity tint multipliers from three's UnrealBloom composite
 * shader. Tolerant of whitespace within the pinned r165 shape, and fails closed
 * on every other shape so a three bump cannot silently change how bloom grades.
 */
export function removeUnrealBloomTintMultipliers(shader: string, nMips: number): string {
  if (BARE_TINT_MULTIPLY.test(shader)) throw new Error(REWRITTEN_ERROR);

  const withoutUniform = shader.replace(TINT_UNIFORM, '');
  if (withoutUniform === shader) throw new Error(`${SHAPE_ERROR} (tint uniform declaration)`);

  let patched = withoutUniform;
  for (let mip = 0; mip < nMips; mip++) {
    const next = patched.replace(tintTerm(mip), '');
    if (next === patched) throw new Error(`${SHAPE_ERROR} (mip ${mip})`);
    patched = next;
  }
  if (patched.includes('bloomTintColors')) throw new Error(`${SHAPE_ERROR} (residual reference)`);
  return patched;
}
