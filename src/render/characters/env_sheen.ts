// VisualDef.envSheen: how much of the sky environment's reflection a body's NON-METAL
// surfaces keep. The dielectric image-based specular (a Fresnel F0 of 0.04 over the
// prefiltered sky) does not scale with albedo, so on a dark authored atlas (the WOC bodies:
// charcoal leather, black under-armor, skin in shade) it lays one cool grey film over
// everything at once. The scale follows the surface's metalness, so metal keeps its full
// reflection; the diffuse sky fill and every direct highlight are untouched.
import type * as THREE from 'three';

const LIGHTS_MAPS = '#include <lights_fragment_maps>';

/** The fragment source with the env reflection scaled after the IBL gather (a no-op on a
 *  program without that chunk: the low tier's Lambert rebuild). */
export function envSheenFragment(source: string, scale: number): string {
  return source.replace(
    LIGHTS_MAPS,
    `${LIGHTS_MAPS}\n#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )\n\tradiance *= mix( ${scale.toFixed(3)}, 1.0, metalnessFactor );\n#endif`,
  );
}

/** Install the scale on a standard material, chained after any hook it already carries
 *  (the rim, the dye, the surface detail), with a program key of its own. */
export function applyEnvSheen(mat: THREE.MeshStandardMaterial, scale: number): void {
  const previousCompile = mat.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(mat, shader, renderer);
    shader.fragmentShader = envSheenFragment(shader.fragmentShader, scale);
  };
  mat.customProgramCacheKey = () =>
    `env-sheen:${scale.toFixed(3)}|${previousCompileSource}|${previousProgramKey()}`;
  mat.needsUpdate = true;
  // recorded so a Material.clone() (which copies userData but drops the hook) can be
  // given the layer back: reapplyEnvSheenToClone
  mat.userData.envSheen = scale;
}

/** Re-attach the scale to a Material.clone() of a sheened material (material_clone_hooks.ts):
 *  clone() copies the scale recorded in userData but drops onBeforeCompile, so an effect clone
 *  (the buff glow, a form tint, the WOC head tint wrap) lost the sheen, drew the grey film
 *  back, and keyed a new program. No-op for clones of unsheened materials. */
export function reapplyEnvSheenToClone(clone: THREE.Material): void {
  const std = clone as THREE.MeshStandardMaterial;
  const scale = std.userData?.envSheen;
  if (!std.isMeshStandardMaterial || typeof scale !== 'number') return;
  applyEnvSheen(std, scale);
}
