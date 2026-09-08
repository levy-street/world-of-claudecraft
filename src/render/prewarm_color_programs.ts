import type * as THREE from 'three';

/** Link the exact live colour variants while restoring the renderer target synchronously. */
export async function compileColorVariants(
  webgl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  root: THREE.Object3D,
  offscreenTarget: THREE.WebGLRenderTarget | null,
  composer: boolean,
  includeOffscreen: boolean,
): Promise<void> {
  const compileAtTarget = async (target: THREE.WebGLRenderTarget | null): Promise<void> => {
    const previousTarget = webgl.getRenderTarget();
    let pending: Promise<THREE.Object3D>;
    try {
      webgl.setRenderTarget(target);
      pending = webgl.compileAsync(root, camera, scene);
    } finally {
      // Three reads output colour space in compileAsync's synchronous prologue.
      webgl.setRenderTarget(previousTarget);
    }
    await pending;
  };
  if (!composer) await compileAtTarget(null);
  if (composer || includeOffscreen) {
    await compileAtTarget(offscreenTarget);
  }
}
