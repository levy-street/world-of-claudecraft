// The programs a root WOULD link, before it links them: their exact GLSL, as
// the driver will see it (the browser keys its shared program cache on that
// text byte for byte), read through the dry compile the pnpm three patch adds
// (`renderer.collectProgramSources`, patches/three@0.185.1.patch: three's own
// parameters, cache key, onBeforeCompile and assembly, with no program
// created). The state a key reads (bound target, fog, shadow camera, depth
// twins) comes from the same arms the real link runs (compile_arms.ts), so
// the sources describe exactly the programs the gate's link will ask for.
//
// A renderer without the patch (a test's stub, a three bump that dropped the
// hunk) reports nothing rather than guessing: every consumer keeps its path.

import type * as THREE from 'three';
import {
  type CompileArmHost,
  type CompileArmRenderer,
  runColorArm,
  runShadowArm,
} from './compile_arms';

/** One entry of the patched renderer's dry compile. */
export interface DryProgramSource {
  cacheKey: string;
  name: string;
  vertexGlsl: string;
  fragmentGlsl: string;
  /** The attribute three binds at location 0 before the link (part of the
   *  browser's program key); empty when the program has none there. */
  index0Attribute: string;
}

/** The dry-compile surface of the patched WebGLRenderer, structurally. */
export interface DryCompileRenderer {
  collectProgramSources?(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ): DryProgramSource[];
}

export interface ProgramSourceEntry {
  /** three's own program cache key: what the link will look up. */
  cacheKey: string;
  /** three's shader name (a built-in material's type). */
  name: string;
  vertex: string;
  fragment: string;
  index0Attribute: string;
}

export function dryCompileSupported(webgl: unknown): boolean {
  return typeof (webgl as DryCompileRenderer | null)?.collectProgramSources === 'function';
}

/**
 * Every program under `root` that three has not linked yet, under the state
 * the colour arm and the shadow arm would link it in, deduped by cache key
 * (a mesh's colour program and its depth twin are two keys; the same twin
 * under two meshes is one). Empty without the patch.
 */
export function collectRootProgramSources(
  host: CompileArmHost,
  root: THREE.Object3D,
  includeOffscreenVariant = false,
): ProgramSourceEntry[] {
  const webgl = host.webgl() as CompileArmRenderer & DryCompileRenderer;
  const collect = webgl.collectProgramSources;
  if (typeof collect !== 'function') return [];
  const dry = (target: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene) =>
    collect.call(webgl, target, camera, scene);
  const batches = runColorArm(host, root, includeOffscreenVariant, dry);
  const shadow = runShadowArm(host, root, dry);
  if (shadow) batches.push(shadow);
  const seen = new Set<string>();
  const entries: ProgramSourceEntry[] = [];
  for (const batch of batches) {
    for (const source of batch) {
      if (seen.has(source.cacheKey)) continue;
      seen.add(source.cacheKey);
      entries.push({
        cacheKey: source.cacheKey,
        name: source.name,
        vertex: source.vertexGlsl,
        fragment: source.fragmentGlsl,
        index0Attribute: source.index0Attribute,
      });
    }
  }
  return entries;
}
