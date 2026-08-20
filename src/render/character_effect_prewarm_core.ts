// Program identity of one character-rig draw that an effect overlay
// (ghost / stealth / shadowform / moonkin) will re-mount transparent, and the
// prewarm twin set derived from a description of every such draw
// (character_effect_prewarm.ts buildCharacterEffectPrewarmGroup).
//
// The lesson foliage_prewarm_twins_core.ts paid for applies here unchanged: a
// group that dedups by MATERIAL alone links one variant per material while the
// live rigs draw that material through several programs. Three's
// WebGLPrograms.getParameters keys on `skinning` (object.isSkinnedMesh), the
// geometry's tangent / VEC4 colour attributes, the morph attribute counts and
// the material's `side` on top of the material itself, so an uncovered
// combination links synchronously on the frame that first draws it.
//
// `side` is in the key twice over: `doubleSided` and `flipSided` are both
// program parameters, and three's own compile() splits a TRANSPARENT DoubleSide
// material into a BackSide pass and a FrontSide pass (WebGLRenderer
// prepareMaterial), which is why a double-sided rig material mints TWO programs
// the moment it goes transparent (the measured `mod_cloth` and `mod_jewel`
// pairs). A twin that carries the source's `side` therefore gets both face
// passes compiled for free; `doubleSidedSplit` records that a path is one of
// those, so the twin count can be reported honestly.
//
// It errs toward SPLITTING, like occluderGhostVariantKey: an extra twin is one
// redundant cache hit, while a wrong merge silently drops a variant back onto
// the first live effect.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/character_effect_prewarm.test.ts.

/** One live character draw, reduced to the inputs three's program cache reads. */
export interface CharacterEffectDrawPath {
  /** Stable identity of the TRANSPARENT clone's program-relevant material
   *  state (type, composed customProgramCacheKey, defines, map slots, ...). */
  materialKey: string;
  /** `<name>:<itemSize>` per geometry attribute, order-insensitive. */
  attributes: readonly string[];
  /** three: `skinning: object.isSkinnedMesh === true`. Every rig mesh is. */
  skinned: boolean;
  /** morphAttributes.position / .normal / .color lengths, in that order. */
  morphCounts: readonly [number, number, number];
  /** THREE.Material.side (FrontSide 0, BackSide 1, DoubleSide 2). */
  side: number;
  /** A transparent DoubleSide material three compiles as two face passes. */
  doubleSidedSplit: boolean;
}

/** Order-insensitive signature of a geometry's attribute set. */
export function characterEffectAttributeSignature(attributes: readonly string[]): string {
  return [...attributes].sort().join(',');
}

/** The program a transparent character draw binds. Two paths sharing this key
 *  provably share a program (or, for a split path, the same program PAIR), so
 *  one twin covers both; two paths differing in it do not. */
export function characterEffectProgramKey(path: CharacterEffectDrawPath): string {
  const kind = path.skinned ? 'skinned' : 'mesh';
  const morphs = path.morphCounts.join('/');
  return `${path.materialKey}|${kind}|side${path.side}|morph${morphs}|${characterEffectAttributeSignature(path.attributes)}`;
}

/**
 * The twin set for a described character rig population: one twin per distinct
 * program, in input order, so the twins come out in the order the boot scene
 * builds them.
 */
export function characterEffectPrewarmTwins(
  paths: readonly CharacterEffectDrawPath[],
): CharacterEffectDrawPath[] {
  const byKey = new Map<string, CharacterEffectDrawPath>();
  for (const path of paths) {
    const key = characterEffectProgramKey(path);
    if (byKey.has(key)) continue;
    byKey.set(key, { ...path, attributes: [...path.attributes] });
  }
  return [...byKey.values()];
}

/** How many GL programs a twin set links: a double-sided transparent twin is
 *  two (three compiles the back-face and front-face passes separately). */
export function characterEffectProgramCount(paths: readonly CharacterEffectDrawPath[]): number {
  return paths.reduce((total, path) => total + (path.doubleSidedSplit ? 2 : 1), 0);
}
