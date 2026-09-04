// The compile gate's shadow arm, lifted out of renderer.ts: put a cached
// MeshDepthMaterial twin on EVERY mesh under a gated root, run compileAsync's
// synchronous prologue against the sun's shadow camera, and restore the
// originals BEFORE awaiting the parallel linker. The twin's derivation (why it
// never sets depthPacking, why one instance per caster shape) is
// prewarm_depth_material.ts; this module owns the swap and the render state
// around the compile.
//
// compileAsync(scene, camera) does not enumerate three's renderer-owned shadow
// materials, so without this arm a caster's depth program links cold at its
// first shadow draw. EVERY mesh wears a twin, casting at gate time or not:
// castShadow is a runtime distance toggle (entity shadow band, zone shadow
// volume, gather nodes, the feast shadow budget) that flips frames after the
// gate ran, and a mesh gated beyond the band otherwise linked its depth program
// in a live frame (eleven depth programs of 20 to 41 ms in 0.3 s on the 3090
// ride, ten through Eastbrook in production). Depth twins are few, cached per
// (material inputs x mesh shape): a non-caster costs a cache hit, never a link.

import type * as THREE from 'three';
import { prewarmDepthMaterial } from './prewarm_depth_material';

/** The slice of the WebGLRenderer the shadow arm drives. */
export interface ShadowCompileRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  compileAsync(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ): Promise<THREE.Object3D>;
}

/** The world scene as the light source only: its fog is suppressed for the
 *  compile, so `fog` is the one field read and written here. */
export interface ShadowCompileScene {
  fog: THREE.Scene['fog'];
}

/**
 * Link the depth program three's WebGLShadowMap will draw for every mesh under
 * `root`. Match the real shadow pass's program key exactly: a bare
 * compileAsync(root, shadowCamera) uses the canvas output colour space and sees
 * no scene lights, producing a skinned depth program that still misses both
 * the render-target and shadow-map bits; passing the world scene verbatim would
 * add fog bits WebGLShadowMap omits (its renderBufferDirect call uses a null
 * scene). So the world stays the light source only, its fog is briefly
 * suppressed, and the compile runs while `prewarmTarget` is bound so
 * outputColorSpace is the linear working space. compileAsync runs its compile()
 * prologue synchronously; the globals AND the swapped materials are restored
 * before the parallel linker is awaited: the boot-resume lane runs these units
 * on VISIBLE post-reveal scene meshes, and a swap held across the awaited link
 * (10 ms+ of real frames) would draw them as depth noise. The link tracks the
 * depth material object, not the mesh, so restoring early is safe. A throw
 * mid-walk still restores every swap made so far. The linker is never raced
 * against a timer: it cannot be cancelled, so a timeout would only let it
 * overlap the next piece and gameplay.
 */
export async function compileShadowDepthPrograms(
  webgl: ShadowCompileRenderer,
  scene: ShadowCompileScene,
  shadowCamera: THREE.Camera,
  depthMaterials: Map<string, THREE.MeshDepthMaterial>,
  prewarmTarget: THREE.WebGLRenderTarget,
  root: THREE.Object3D,
): Promise<void> {
  const swaps: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  const swapMaterials = (): void => {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const material = mesh.material;
      swaps.push({ mesh, material });
      mesh.material = Array.isArray(material)
        ? material.map((item) => prewarmDepthMaterial(depthMaterials, item, mesh))
        : prewarmDepthMaterial(depthMaterials, material, mesh);
    });
  };
  const previousTarget = webgl.getRenderTarget();
  const previousFog = scene.fog;
  let compilePromise: Promise<THREE.Object3D> | null = null;
  try {
    swapMaterials();
    if (swaps.length > 0) {
      scene.fog = null;
      webgl.setRenderTarget(prewarmTarget);
      compilePromise = webgl.compileAsync(root, shadowCamera, scene as THREE.Scene);
    }
  } finally {
    webgl.setRenderTarget(previousTarget);
    scene.fog = previousFog;
    for (const swap of swaps) swap.mesh.material = swap.material;
  }
  if (compilePromise) await compilePromise;
}
