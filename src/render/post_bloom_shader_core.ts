const SHAPE_ERROR = 'Pinned UnrealBloom composite shader shape changed';

// three r182 rewrote the composite body: the mip sum became rgb-only scaled by
// 3.0 (its blend material moved to One-factor premultiplied additive blending)
// and alpha became max(bloom.rgb). PreparedBloomPass skips that blend draw
// entirely and OutputGradePass adds the composite target as
// bloom.rgb * bloom.a, the r165 SrcAlpha additive contribution, so the r182+
// body is not a drop-in. This rewrite rebuilds the r165-shaped accumulation
// (full vec4 samples, no 3.0 scale, no tint terms; alpha stays the accumulated
// blurred bright-pass alpha) so the COMPOSITE STAGE's math is identical across
// the three 0.165 to 0.185 train. The stages feeding it are upstream's and
// did move: r182+ reworked the separable Gaussian mip blur coefficients
// (three PR 31528, same strength, removes blockiness) and the bright-pass
// luminance weights went Rec.601 to Rec.709, so shipped bloom PIXELS are
// near-identical, not byte-identical; both feeder deltas are part of the
// phase 6 r181-bucket visual acceptance. Fails closed on every unexpected
// composite shape so a future three bump cannot silently change how bloom
// grades.

const TINT_UNIFORM = /uniform\s+vec3\s+bloomTintColors\s*\[\s*NUM_MIPS\s*\]\s*;/;

/** One r182+ mip term: factor * tint * rgb-only sample, whitespace-tolerant. */
function shippedMipTerm(mip: number): string {
  return (
    `lerpBloomFactor\\(\\s*bloomFactors\\[\\s*${mip}\\s*\\]\\s*\\)` +
    `\\s*\\*\\s*bloomTintColors\\[\\s*${mip}\\s*\\]` +
    `\\s*\\*\\s*texture2D\\(\\s*blurTexture${mip + 1}\\s*,\\s*vUv\\s*\\)\\s*\\.rgb`
  );
}

/** The whole r182+ composite main(), pinned: 3.0-scaled rgb sum plus the
 *  max-component alpha derivation. Anything else fails closed. */
function shippedCompositeMain(nMips: number): RegExp {
  const terms = Array.from({ length: nMips }, (_, mip) => shippedMipTerm(mip)).join('\\s*\\+\\s*');
  return new RegExp(
    'void main\\(\\)\\s*\\{\\s*' +
      '(?:\\/\\/[^\\n]*\\s*)?' +
      'vec3 bloom = 3\\.0 \\* bloomStrength \\* \\(\\s*' +
      terms +
      '\\s*\\);\\s*' +
      'float bloomAlpha = max\\(\\s*bloom\\.r\\s*,\\s*max\\(\\s*bloom\\.g\\s*,\\s*bloom\\.b\\s*\\)\\s*\\);\\s*' +
      'gl_FragColor = vec4\\(\\s*bloom\\s*,\\s*bloomAlpha\\s*\\);\\s*' +
      '\\}',
  );
}

/** The r165-equivalent tint-free body the pre-upgrade renderer shipped. */
function classicCompositeMain(nMips: number): string {
  const terms = Array.from(
    { length: nMips },
    (_, mip) =>
      `lerpBloomFactor( bloomFactors[ ${mip} ] ) * texture2D( blurTexture${mip + 1}, vUv )`,
  ).join(' +\n\t\t\t\t\t\t');
  return `void main() {\n\n\t\t\t\t\tgl_FragColor = bloomStrength * (\n\t\t\t\t\t\t${terms}\n\t\t\t\t\t);\n\n\t\t\t\t}`;
}

/**
 * Replaces three's r182+ UnrealBloom composite main() with the r165-equivalent
 * tint-free accumulation and drops the tint uniform declaration. Tolerant of
 * whitespace within the pinned shipped shape, and fails closed on every other
 * shape so a three bump cannot silently change how bloom grades.
 */
export function restoreClassicBloomComposite(shader: string, nMips: number): string {
  const withoutUniform = shader.replace(TINT_UNIFORM, '');
  if (withoutUniform === shader) throw new Error(`${SHAPE_ERROR} (tint uniform declaration)`);

  const mainPattern = shippedCompositeMain(nMips);
  if (!mainPattern.test(withoutUniform)) throw new Error(`${SHAPE_ERROR} (composite main body)`);
  const patched = withoutUniform.replace(mainPattern, classicCompositeMain(nMips));

  if (patched.includes('bloomTintColors')) {
    throw new Error(`${SHAPE_ERROR} (residual tint reference)`);
  }
  if (patched.includes('3.0 * bloomStrength')) {
    throw new Error(`${SHAPE_ERROR} (residual 3.0 scale)`);
  }
  return patched;
}
