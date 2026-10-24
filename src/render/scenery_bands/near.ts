import * as THREE from 'three';
import { footprintDistance } from './policy_core';
import type { Bounds } from './types';

interface InstanceSource {
  root: THREE.Object3D;
  mesh: THREE.InstancedMesh;
  count: number;
  matrix: Float32Array;
  color: Float32Array | null;
  bounds: [number, number, number, number][];
  retained: Uint8Array;
}
interface ObjectSource {
  root: THREE.Object3D;
  object: THREE.Object3D;
  visible: boolean;
  bounds: Bounds;
}

/** Owns only the prototype's static jungle packing and whole landmark color
 * visibility. Native props/towns/foliage consume the same cap through their
 * existing distance APIs. Shadow-enabled callers require a separate owner. */
export class SceneryNearSources {
  private entries = new Map<THREE.InstancedMesh, InstanceSource>();
  private objects = new Map<THREE.Object3D, ObjectSource>();
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private cap = 0;
  private serial = 0;
  private exemptRoots?: ReadonlySet<THREE.Object3D>;

  register(root: THREE.Object3D, zoneFeature = false): void {
    if (
      !zoneFeature &&
      !['garden-features', 'jungle-features', 'haunt-features', 'realm-flora'].includes(root.name)
    )
      return;
    root.updateWorldMatrix(true, true);
    if (root.name === 'jungle-features') {
      for (const child of root.children) {
        const mesh = child as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || this.entries.has(mesh)) continue;
        if (
          mesh.morphTexture ||
          Object.values(mesh.geometry.attributes).some(
            (attribute) => (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute,
          )
        )
          throw new Error('Unsupported packed scenery attributes');
        if (mesh.count !== mesh.instanceMatrix.count)
          throw new Error('Scenery source already packed');
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const matrix = new THREE.Matrix4();
        const bounds: InstanceSource['bounds'] = [];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld);
          const box = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
          bounds.push([box.min.x, box.max.x, box.min.z, box.max.z]);
        }
        this.entries.set(mesh, {
          root,
          mesh,
          count: mesh.count,
          matrix: Float32Array.from(mesh.instanceMatrix.array),
          color: mesh.instanceColor ? Float32Array.from(mesh.instanceColor.array) : null,
          bounds,
          retained: new Uint8Array(mesh.count).fill(1),
        });
      }
      // Union the footprint of every part sharing an authored placement.
      const placements = new Map<string, InstanceSource['bounds'][number]>();
      for (const entry of this.entries.values()) {
        for (let i = 0; i < entry.count; i++) {
          const key = `${entry.mesh.parent?.uuid}:${entry.matrix.subarray(i * 16, i * 16 + 16).join(',')}`;
          const bounds = entry.bounds[i];
          const shared = placements.get(key);
          if (shared) {
            shared[0] = Math.min(shared[0], bounds[0]);
            shared[1] = Math.max(shared[1], bounds[1]);
            shared[2] = Math.min(shared[2], bounds[2]);
            shared[3] = Math.max(shared[3], bounds[3]);
            entry.bounds[i] = shared;
          } else placements.set(key, bounds);
        }
      }
    }
    for (const object of root.children) {
      if (
        this.objects.has(object) ||
        object.userData.decorative === false ||
        (object as THREE.InstancedMesh).isInstancedMesh
      )
        continue;
      const box = new THREE.Box3();
      let supported = true;
      let meshes = 0;
      object.traverse((node) => {
        if (
          node.matrixAutoUpdate ||
          (node as THREE.InstancedMesh).isInstancedMesh ||
          (node as THREE.SkinnedMesh).isSkinnedMesh
        )
          supported = false;
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        meshes++;
      });
      if (!supported || !meshes || box.isEmpty()) continue;
      this.objects.set(object, {
        root,
        object,
        visible: object.visible,
        bounds: [box.min.x, box.max.x, box.min.z, box.max.z],
      });
    }
    this.lastX = Number.NaN;
  }

  retains(mesh: THREE.Mesh, index: number): boolean | null {
    const entry = this.entries.get(mesh as THREE.InstancedMesh);
    return entry ? !!entry.retained[index] : null;
  }

  /** Collection reads immutable authored slots, not last frame's packed prefix.
   * No render or asynchronous callback may run inside this bracket. */
  withOriginalInstances<T>(read: () => T): T {
    for (const entry of this.entries.values()) {
      entry.mesh.count = entry.count;
      entry.mesh.instanceMatrix.array.set(entry.matrix);
      if (entry.color) entry.mesh.instanceColor!.array.set(entry.color);
    }
    try {
      return read();
    } finally {
      for (const entry of this.entries.values()) this.pack(entry);
    }
  }

  update(x: number, z: number, cap: number, exemptRoots?: ReadonlySet<THREE.Object3D>): void {
    const changed =
      exemptRoots !== this.exemptRoots ||
      cap !== this.cap ||
      !Number.isFinite(this.lastX) ||
      (cap > 0 && Math.hypot(x - this.lastX, z - this.lastZ) >= 4);
    this.cap = cap;
    this.exemptRoots = exemptRoots;
    if (changed) {
      this.lastX = x;
      this.lastZ = z;
      this.serial++;
      for (const entry of this.entries.values()) {
        for (let i = 0; i < entry.count; i++)
          entry.retained[i] =
            !cap ||
            exemptRoots?.has(entry.root) ||
            footprintDistance(entry.bounds[i], x, z) <= cap + 4
              ? 1
              : 0;
        this.pack(entry);
      }
    }
    // Native root sweeps run first. The child keeps its original own flag;
    // this never reveals a parent still held behind its compile gate.
    for (const source of this.objects.values())
      source.object.visible =
        source.visible &&
        (!cap ||
          exemptRoots?.has(source.root) ||
          footprintDistance(source.bounds, x, z) <= cap + 4);
  }

  private pack(entry: InstanceSource): void {
    let count = 0;
    for (let i = 0; i < entry.count; i++) {
      if (!entry.retained[i]) continue;
      entry.mesh.instanceMatrix.array.set(entry.matrix.subarray(i * 16, i * 16 + 16), count * 16);
      if (entry.color) {
        const size = entry.mesh.instanceColor!.itemSize;
        entry.mesh.instanceColor!.array.set(
          entry.color.subarray(i * size, i * size + size),
          count * size,
        );
      }
      count++;
    }
    entry.mesh.count = count;
    for (const attribute of [entry.mesh.instanceMatrix, entry.mesh.instanceColor]) {
      if (!attribute) continue;
      attribute.clearUpdateRanges();
      if (count) attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  snapshot(): object {
    let total = 0,
      retained = 0,
      nearOmissions = 0,
      placementErrors = 0;
    for (const entry of this.entries.values()) {
      total += entry.count;
      retained += entry.mesh.count;
      let packed = 0;
      for (let i = 0; i < entry.count; i++) {
        if (!entry.retained[i]) {
          if (footprintDistance(entry.bounds[i], this.lastX, this.lastZ) < 40) nearOmissions++;
          continue;
        }
        for (let component = 0; component < 16; component++)
          if (
            entry.matrix[i * 16 + component] !==
            entry.mesh.instanceMatrix.array[packed * 16 + component]
          )
            placementErrors++;
        packed++;
      }
    }
    return {
      serial: this.serial,
      cap: this.cap,
      total,
      retained,
      nearOmissions,
      placementErrors,
      objects: this.objects.size,
      visibleObjects: [...this.objects.values()].filter((source) => source.object.visible).length,
    };
  }
  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.retained.fill(1);
      this.pack(entry);
    }
    for (const source of this.objects.values()) source.object.visible = source.visible;
    this.entries.clear();
    this.objects.clear();
  }
}
