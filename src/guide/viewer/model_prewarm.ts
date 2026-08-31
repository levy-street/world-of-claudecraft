// GPU preparation for the Guide's secondary WebGL context. Keep the sequencing in
// this small adapter so the standalone Guide and the in-game raid journal share the
// same invariant: link programs, upload textures, then allow the first draw.

import type * as THREE from 'three';
import {
  collectPrewarmTextures,
  uploadTexturesInSlices,
  yieldToMainThread,
} from '../../render/texture_prewarm';

interface TraversableScene {
  traverse(callback: (object: unknown) => void): void;
}

interface ModelViewerPrewarmRenderer<TScene, TCamera> {
  compileAsync(scene: TScene, camera: TCamera): Promise<unknown>;
  initTexture(texture: THREE.Texture): void;
}

export interface ModelViewerPrewarmOptions {
  isCancelled(): boolean;
  yieldToMain?: () => Promise<void>;
  touchPrograms?: () => Promise<unknown>;
}

export async function prewarmModelViewer<TScene extends TraversableScene, TCamera>(
  renderer: ModelViewerPrewarmRenderer<TScene, TCamera>,
  scene: TScene,
  camera: TCamera,
  options: ModelViewerPrewarmOptions,
): Promise<void> {
  const { isCancelled, touchPrograms, yieldToMain = yieldToMainThread } = options;
  if (isCancelled()) return;
  await renderer.compileAsync(scene, camera);
  if (isCancelled()) return;

  const textures = new Set<THREE.Texture>();
  collectPrewarmTextures(scene, textures);
  await uploadTexturesInSlices(renderer, textures, { isCancelled, yieldToMain });
  if (isCancelled()) return;
  await touchPrograms?.();
}
