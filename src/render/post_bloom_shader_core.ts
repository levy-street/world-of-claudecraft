const SHAPE_ERROR = 'Pinned UnrealBloom composite tint shader shape changed';

function tintTerm(mip: number): RegExp {
  const index = `\\[\\s*${mip}\\s*\\]`;
  return new RegExp(
    `\\s*\\*\\s*(?:vec4\\s*\\(\\s*bloomTintColors${index}\\s*,\\s*1\\.0\\s*\\)|bloomTintColors${index})`,
  );
}

/**
 * Removes the identity tint multipliers from Three's UnrealBloom composite
 * shader while accepting the legacy vec4 and current vec3 shader shapes.
 */
export function removeUnrealBloomTintMultipliers(shader: string, nMips: number): string {
  const withoutUniform = shader.replace(
    /uniform\s+vec3\s+bloomTintColors\s*\[\s*NUM_MIPS\s*\]\s*;/,
    '',
  );
  if (withoutUniform === shader) throw new Error(SHAPE_ERROR);

  let patched = withoutUniform;
  for (let mip = 0; mip < nMips; mip++) {
    const next = patched.replace(tintTerm(mip), '');
    if (next === patched) throw new Error(SHAPE_ERROR);
    patched = next;
  }
  if (patched.includes('bloomTintColors')) throw new Error(SHAPE_ERROR);
  return patched;
}
