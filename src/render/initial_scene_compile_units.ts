// Three-facing construction of the world-entry compile units. The renderer
// owns timing/admission; this module owns root collection, ordering and
// program-content dedupe for one fresh snapshot of scene + staged groups.

import type * as THREE from 'three';
import { materialProgramSignature, prewarmProgramContentKeys } from './prewarm_policy';
import {
  buildPrewarmCompileUnits,
  compileRootDistanceSq,
  orderRootsByDistanceSq,
  type PrewarmResumeUnit,
} from './prewarm_resume';

export interface InitialSceneCompileDedupe {
  seen: Set<THREE.Object3D>;
  seenKeys: Set<unknown>;
}

export interface InitialSceneCompileUnitOptions {
  scene: THREE.Scene;
  stagedGroups: readonly (readonly [string, THREE.Group | null])[];
  includeGroup: (groupId: string) => boolean;
  playerX: number;
  playerZ: number;
  batchSize: number;
  sharedDedupe: InitialSceneCompileDedupe;
  compileColor: (root: THREE.Object3D) => Promise<unknown>;
  compileShadow: (root: THREE.Object3D) => Promise<unknown>;
  onCompiledRoot: () => void;
}

function compileRoots(roots: readonly THREE.Object3D[], visibleOnly: boolean): THREE.Object3D[] {
  const materialRoots: THREE.Object3D[] = [];
  const collect = (child: THREE.Object3D): void => {
    if ((child as THREE.Mesh).material) materialRoots.push(child);
  };
  for (const root of roots) {
    if (visibleOnly) root.traverseVisible(collect);
    else root.traverse(collect);
  }
  return materialRoots;
}

function programContentKeys(root: THREE.Object3D): unknown[] {
  const mesh = root as THREE.Mesh & {
    isSkinnedMesh?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    instanceColor?: unknown;
  };
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  const morphs = mesh.geometry?.morphAttributes;
  const colorAttribute = mesh.geometry?.attributes?.color as { itemSize?: number } | undefined;
  return prewarmProgramContentKeys(
    {
      isSkinnedMesh: mesh.isSkinnedMesh === true,
      isInstancedMesh: mesh.isInstancedMesh === true,
      hasInstanceColor: mesh.instanceColor != null,
      isBatchedMesh: mesh.isBatchedMesh === true,
      hasMorphPositions: morphs?.position !== undefined,
      morphTargetCount: morphs?.position?.length ?? 0,
      morphNormalCount: morphs?.normal?.length ?? 0,
      morphColorCount: morphs?.color?.length ?? 0,
      hasTangents: mesh.geometry?.attributes?.tangent !== undefined,
      hasNormals: mesh.geometry?.attributes?.normal !== undefined,
      vertexColorItemSize: colorAttribute?.itemSize ?? 0,
      castShadow: mesh.castShadow === true,
    },
    materials.map((entry) => materialProgramSignature(entry)),
  );
}

export function buildInitialSceneCompileUnits(
  options: InitialSceneCompileUnitOptions,
): PrewarmResumeUnit[] {
  // One compileAsync call still has a synchronous traversal prologue and its
  // linker cannot be cancelled. Material-bearing leaves keep each unit small
  // enough for the hard-deadline check between units to remain meaningful.
  const stagedRoots = new Set<THREE.Object3D>(
    options.stagedGroups.flatMap(([, group]) => (group ? [group] : [])),
  );
  return buildPrewarmCompileUnits(
    [
      ...(options.includeGroup('scene')
        ? [
            {
              id: 'scene',
              // Near-first: the resume lane drains these in order, and the
              // debt the camera can reach first must be the debt paid first
              // (hitch-hunt P3a; the S10 632-681 ms submit stalls were reveals
              // winning the race against their own compile). Anchor on the
              // PLAYER: the camera is still at its constructor default during
              // early submission.
              roots: orderRootsByDistanceSq(
                compileRoots(
                  options.scene.children.filter((root) => !stagedRoots.has(root)),
                  true,
                ),
                (root) => compileRootDistanceSq(root, options.playerX, options.playerZ),
              ),
            },
          ]
        : []),
      ...options.stagedGroups.flatMap(([id, group]) =>
        group && options.includeGroup(id)
          ? [{ id, roots: compileRoots(group.children, false) }]
          : [],
      ),
    ],
    async (root) => {
      await options.compileColor(root);
      await options.compileShadow(root);
      options.onCompiledRoot();
    },
    {
      // NOT batched into one compileAsync call per unit: an A/B measured no
      // gain (11.5 s vs 11.9 s on a cold full entry) because the remaining
      // time is the driver's parallel link work, not the prologue walk.
      // Program-content keys collapse leaves only when material signatures
      // and mesh-shape bits produce the same PROGRAM. Distinct GLB material
      // UUIDs by the hundred share programs; UUID dedupe kept 2,725 roots for
      // about 500 programs and paid roughly 5,450 prologues (12.4 s). An
      // imperfect signature is fail-soft: first draw links any residue.
      dedupeKeys: programContentKeys,
      sharedDedupe: options.sharedDedupe,
      batchSize: options.batchSize,
    },
  );
}
