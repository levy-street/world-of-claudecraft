import type * as THREE from 'three';
import { skeletonPaletteNeedsUpdate } from './skeleton_update_core';

export interface SkeletonUpdateStats {
  requests: number;
  updates: number;
  skips: number;
  paletteMatricesUpdated: number;
}

interface SkeletonUpdateEntry {
  skeleton: THREE.Skeleton;
  originalUpdate: THREE.Skeleton['update'];
  wrappedUpdate: THREE.Skeleton['update'];
  appliedPoseRevision: number;
  worldMatrix: number[] | null;
}

/**
 * Three asks every visible skeleton to rebuild its palette once per render,
 * even when distance cadence skipped the mixer. Each character owns its
 * skeletons, so an exact pose revision plus the first bone's world matrix is
 * sufficient to reuse that character's unchanged palette and bone texture.
 */
export class SkeletonUpdateCache {
  private poseRevision = 0;
  private readonly entries: SkeletonUpdateEntry[] = [];
  private readonly counters: SkeletonUpdateStats = {
    requests: 0,
    updates: 0,
    skips: 0,
    paletteMatricesUpdated: 0,
  };

  constructor(model: THREE.Object3D) {
    const skeletons = new Set<THREE.Skeleton>();
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) skeletons.add(mesh.skeleton);
    });
    for (const skeleton of skeletons) this.install(skeleton);
  }

  markPoseChanged(): void {
    this.poseRevision++;
  }

  stats(): SkeletonUpdateStats {
    return { ...this.counters };
  }

  dispose(): void {
    for (const entry of this.entries) {
      if (entry.skeleton.update === entry.wrappedUpdate) {
        entry.skeleton.update = entry.originalUpdate;
      }
    }
    this.entries.length = 0;
  }

  private install(skeleton: THREE.Skeleton): void {
    const originalUpdate = skeleton.update;
    const entry: SkeletonUpdateEntry = {
      skeleton,
      originalUpdate,
      wrappedUpdate: () => undefined,
      appliedPoseRevision: -1,
      worldMatrix: null,
    };
    entry.wrappedUpdate = () => {
      this.counters.requests++;
      const currentWorldMatrix = skeleton.bones[0]?.matrixWorld.elements;
      if (
        !currentWorldMatrix ||
        skeletonPaletteNeedsUpdate(
          this.poseRevision,
          entry.appliedPoseRevision,
          entry.worldMatrix,
          currentWorldMatrix,
        )
      ) {
        originalUpdate.call(skeleton);
        entry.appliedPoseRevision = this.poseRevision;
        entry.worldMatrix ??= new Array<number>(currentWorldMatrix?.length ?? 0);
        if (currentWorldMatrix) {
          for (let i = 0; i < currentWorldMatrix.length; i++) {
            entry.worldMatrix[i] = currentWorldMatrix[i];
          }
        }
        this.counters.updates++;
        this.counters.paletteMatricesUpdated += skeleton.bones.length;
      } else {
        this.counters.skips++;
      }
    };
    skeleton.update = entry.wrappedUpdate;
    this.entries.push(entry);
  }
}
