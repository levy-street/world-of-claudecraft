// The two compile arms every gate, manifest entry and reveal shares: the
// colour compile under the tier's render target, and the shadow compile with
// depth twins swapped onto every mesh. Lifted out of renderer.ts so ONE code
// path sets the renderer state a program's cache key reads (the bound
// target's colour space, the scene fog, the shadow camera, the depth twin),
// whether the arm LINKS the programs (three's compileAsync) or only ASSEMBLES
// the sources that link would use (the dry compile the pnpm three patch adds,
// consumed by program_sources.ts). Same state by construction: a dry pass
// that set the state differently would describe programs the link never
// asks for.

import type * as THREE from 'three';
import { prewarmDepthMaterial } from './prewarm_depth_material';

/** The renderer surface both arms drive. `compileAsync` is the link; the
 *  dry compile rides the same slice through program_sources.ts. */
export interface CompileArmRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  compileAsync(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ): Promise<THREE.Object3D>;
}

/** The game context's own contract, as the shader warm worker needs it
 *  (its attributes and the extensions it enabled). */
export interface CompileArmGlContext {
  getContextAttributes(): object | null;
  getExtension(name: string): unknown;
  /** The renderer string read (the warm client's backend class). */
  getParameter?(name: number): unknown;
}

/** What the arms read off the renderer. Read-through closures, not a
 *  snapshot: the post pipeline is rebuilt on a graphics change, the depth
 *  cache fills during the session and the offscreen target is minted lazily. */
export interface CompileArmHost {
  webgl(): CompileArmRenderer;
  /** The raw GL context, when the host has one (a test stub need not): the
   *  warm worker reproduces its contract. */
  context?(): CompileArmGlContext | null;
  camera(): THREE.Camera;
  scene(): THREE.Scene;
  /** The sun's shadow camera: the view the shadow pass keys its programs on. */
  shadowCamera(): THREE.Camera;
  /** Composer tiers draw the scene into a render target; direct tiers draw
   *  to the canvas, so their gameplay variant is the canvas one. */
  offscreen(): boolean;
  /** The tiny throwaway target the offscreen variant is compiled against
   *  (its bound colour space is what the key reads), built once and kept. */
  offscreenTarget(): THREE.WebGLRenderTarget;
  depthMaterials(): Map<string, THREE.MeshDepthMaterial>;
  /** Dynamic shadows on and the parallel compile available: without either
   *  the shadow arm has nothing to prepare. */
  shadowArm(): boolean;
}

/** The operation an arm runs while the state is set. It runs synchronously
 *  inside the state (compileAsync's prologue is synchronous, and so is the
 *  dry compile); what it returns is consumed after the state is restored. */
export type CompileArmOp<T> = (root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene) => T;

/** Told right before an arm LINKS a root (never for a dry pass), so an
 *  observer can compare the link's moment with an earlier announcement. One
 *  slot, module-owned: the shader warm audit installs it under the perf
 *  flags; nothing else listens. */
export type CompileArmObserver = (root: THREE.Object3D, arm: 'color' | 'shadow') => void;

let armObserver: CompileArmObserver | null = null;

export function setCompileArmObserver(observer: CompileArmObserver | null): void {
  armObserver = observer;
}

/** Run `op` with `target` bound, restoring the previous target before
 *  returning, so an awaited link never holds a throwaway target across
 *  live frames. */
export function underRenderTarget<T>(
  host: CompileArmHost,
  target: THREE.WebGLRenderTarget | null,
  op: () => T,
): T {
  const webgl = host.webgl();
  const previousTarget = webgl.getRenderTarget();
  try {
    webgl.setRenderTarget(target);
    return op();
  } finally {
    webgl.setRenderTarget(previousTarget);
  }
}

/** The colour targets the arm covers, in order: the canvas variant on direct
 *  tiers (their gameplay variant), then the offscreen variant on composer
 *  tiers, or on a direct tier whose caller asked for it (a bounded offscreen
 *  geometry upload would otherwise link that variant itself). */
export function colorArmTargets(
  host: CompileArmHost,
  includeOffscreenVariant: boolean,
): Array<THREE.WebGLRenderTarget | null> {
  const targets: Array<THREE.WebGLRenderTarget | null> = [];
  if (!host.offscreen()) targets.push(null);
  if (host.offscreen() || includeOffscreenVariant) targets.push(host.offscreenTarget());
  return targets;
}

/**
 * The colour arm's link: compile the variant pair the boot prewarm proved
 * out, never a bare compileAsync at the ambient render target. three keys a
 * program on the bound target's output colour space, so on composer tiers an
 * unbound compile links the canvas srgb variant while the scene pass draws
 * the linear one, and the first visible frame still linked the real program
 * synchronously (the measured 300 to 500 ms border-crossing stall). Each
 * target's link is awaited before the next is submitted.
 */
export async function linkColorPrograms(
  host: CompileArmHost,
  root: THREE.Object3D,
  includeOffscreenVariant: boolean,
): Promise<void> {
  armObserver?.(root, 'color');
  for (const target of colorArmTargets(host, includeOffscreenVariant)) {
    await underRenderTarget(host, target, () =>
      host.webgl().compileAsync(root, host.camera(), host.scene()),
    );
  }
}

/** The colour arm's state, applied to any operation: `op` runs once per
 *  target the arm covers, under that target. */
export function runColorArm<T>(
  host: CompileArmHost,
  root: THREE.Object3D,
  includeOffscreenVariant: boolean,
  op: CompileArmOp<T>,
): T[] {
  return colorArmTargets(host, includeOffscreenVariant).map((target) =>
    underRenderTarget(host, target, () => op(root, host.camera(), host.scene())),
  );
}

/**
 * The shadow arm's state, applied to any operation. compileAsync(scene,
 * camera) does not enumerate three's renderer-owned shadow materials, so
 * equivalent MeshDepthMaterials go on EVERY mesh under the root, skinned or
 * not, so the variants link before the shadow pass asks getUniforms for
 * them: static and instanced casters, and meshes NOT casting at gate time,
 * because castShadow is toggled at runtime by distance (entity shadow band,
 * zone shadow volume, gather nodes) frames after this arm ran, so a rig
 * created beyond the band linked cold at its first shadow draw. Depth twins
 * are few, cached per (material inputs x mesh shape): a cache hit, no link.
 *
 * The state matches the real shadow pass's program key exactly. A bare
 * compileAsync(root, shadowCamera) uses the canvas output colour space and
 * sees no scene lights, producing a skinned depth program that still misses
 * both the render-target and shadow-map bits. Conversely, passing the world
 * scene verbatim would add fog bits that WebGLShadowMap omits (its
 * renderBufferDirect call uses a null scene). So the world is kept only as
 * the light source, its fog briefly suppressed, and the offscreen target is
 * current so outputColorSpace is the linear working space. `op` runs
 * synchronously inside that state; the globals AND the swapped materials are
 * restored before its result is consumed: the boot-resume lane runs these
 * units on VISIBLE post-reveal scene meshes, and a swap held across an
 * awaited link (10 ms+ of real frames) would draw them as depth noise. A link
 * tracks the depth material object, not the mesh, so restoring early is safe.
 * Returns null when the arm has nothing to do (no shadows, no parallel
 * compile, or no mesh under the root).
 */
export function runShadowArm<T>(
  host: CompileArmHost,
  root: THREE.Object3D,
  op: CompileArmOp<T>,
): T | null {
  if (!host.shadowArm()) return null;
  const depthMaterials = host.depthMaterials();
  const swaps: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  // Walked inside the try below so a throw mid-walk still restores every swap.
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
  const scene = host.scene();
  const webgl = host.webgl();
  const previousTarget = webgl.getRenderTarget();
  const previousFog = scene.fog;
  let bound = false;
  let result: T | null = null;
  try {
    swapMaterials();
    if (swaps.length > 0) {
      scene.fog = null;
      webgl.setRenderTarget(host.offscreenTarget());
      bound = true;
      result = op(root, host.shadowCamera(), scene);
    }
  } finally {
    // Only what was touched is restored: three's setRenderTarget rebinds the
    // framebuffer and copies the viewport even for the same target.
    if (bound) webgl.setRenderTarget(previousTarget);
    scene.fog = previousFog;
    for (const swap of swaps) swap.mesh.material = swap.material;
  }
  return result;
}

/** The shadow arm's link. No timer races it: the underlying linker cannot be
 *  cancelled, so a timeout would only let it overlap the next child and
 *  gameplay. */
export async function linkShadowPrograms(
  host: CompileArmHost,
  root: THREE.Object3D,
): Promise<void> {
  // Told inside the arm, so a root with nothing to link announces nothing.
  const link = runShadowArm(host, root, (target, camera, scene) => {
    armObserver?.(root, 'shadow');
    return host.webgl().compileAsync(target, camera, scene);
  });
  if (link) await link;
}
