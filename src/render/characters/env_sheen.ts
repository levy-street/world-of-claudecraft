// VisualDef.envSheen: how much of the sky environment's reflection a body keeps. The shares,
// the GLSL line and its program-key token are the pure core (env_sheen_core.ts: why the
// reflection reads as a grey film on the dark painted atlases, and why the armour's sky cap lives
// there); this is the three.js layer that installs it on a standard material. The diffuse sky
// fill and every direct highlight are untouched.
import type * as THREE from 'three';
import { envSheenFragment, envSheenProgramKey } from './env_sheen_core';

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
    `${envSheenProgramKey(scale)}|${previousCompileSource}|${previousProgramKey()}`;
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
