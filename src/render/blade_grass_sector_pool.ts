import * as THREE from 'three';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from './blade_grass_dense_core';
import {
  poolSectorAxisCount,
  poolSectorLines,
  poolSectorOfSlot,
  poolSectorWidth,
} from './blade_grass_pool_core';
import {
  clearUploadBands,
  collectUploadRanges,
  createUploadBands,
  createUploadRangeScratch,
  markUploadDirty,
  type UploadBands,
} from './blade_grass_upload_bands_core';

// The instanced-mesh half of a toroidal blade pool, shared by the near carpet
// (blade_grass.ts) and the mid band (blade_grass_band.ts): the sector meshes,
// the dense packing inside each of them, the banded update ranges, and the
// bounding sphere that lets three cull a sector the camera is not looking at.
//
// Which sector a slot belongs to is fixed for the life of the pool (see
// blade_grass_pool_core.ts, "Sector split"), so a cluster is written into one
// buffer and never migrates. Every sector shares ONE geometry and ONE material
// instance, so the split adds draw calls but no program: whatever prewarms the
// pool's material covers all of them.
//
// Bounds are MEASURED, never derived from the grid: the flush pass reads each
// sector's own instance translations, so the sphere is exact even mid-backfill
// after a teleport, when some slots still carry cells from an older block.

interface Sector {
  readonly im: THREE.InstancedMesh;
  readonly dense: DenseSlotState;
  readonly bands: UploadBands;
  readonly ranges: Int32Array;
}

export interface BladeSectorPoolOptions {
  /** Slots per axis in the toroidal grid. */
  gridW: number;
  /** Sectors per axis; 1 keeps the historical single mesh. */
  axis: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /**
   * World-space slack one placed cluster reaches beyond its instance origin:
   * the cluster geometry's own radius times the largest scale placement can
   * compose, plus the cell jitter.
   */
  clusterPad: number;
}

export interface BladeSectorPool {
  /** One mesh per sector, for the caller to add to its group. */
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Submitted instances across every sector. */
  count(): number;
  /** Write a placed cluster into the sector that owns its slot. */
  place(slot: number, matrix: THREE.Matrix4, color: THREE.Color): void;
  /** Drop a slot from its sector, keeping that sector's prefix dense. */
  remove(slot: number): void;
  /** Queue this pass's update ranges on every touched sector. */
  queueUploads(): void;
  /** Forget this pass's marks without queueing them. */
  dropUploads(): void;
  /** Re-publish every sector's draw count and measured bounding sphere. */
  syncSectors(): void;
}

export function buildBladeSectorPool(opts: BladeSectorPoolOptions): BladeSectorPool {
  const { gridW, geometry, material, clusterPad } = opts;
  const pool = gridW * gridW;
  const width = poolSectorWidth(gridW, opts.axis);
  const axisCount = poolSectorAxisCount(gridW, width);

  // One logical slot lives in exactly one sector for the pool's whole life, so
  // every sector's packer can share this one slot -> dense index table.
  const slotToDense = new Int32Array(pool).fill(-1);
  const slotSector = new Uint8Array(pool);
  for (let slot = 0; slot < pool; slot++) {
    slotSector[slot] = poolSectorOfSlot(slot, gridW, width, axisCount);
  }

  const sectors: Sector[] = [];
  for (let sj = 0; sj < axisCount; sj++) {
    for (let si = 0; si < axisCount; si++) {
      const capacity = poolSectorLines(gridW, width, si) * poolSectorLines(gridW, width, sj);
      // one block per sector row of dense indices, the same derivation the
      // unsplit pool used with its own grid width
      const bands = createUploadBands(capacity, width);
      const im = new THREE.InstancedMesh(geometry, material, capacity);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.receiveShadow = true;
      im.castShadow = false;
      im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
      // the sphere below is measured off this sector's own instances, so the
      // cull is exact rather than an estimate over the grid
      im.frustumCulled = true;
      sectors.push({
        im,
        dense: { count: 0, slotToDense, denseToSlot: new Int32Array(capacity).fill(-1) },
        bands,
        ranges: createUploadRangeScratch(bands),
      });
    }
  }

  const movedMatrix = new THREE.Matrix4();
  const movedColor = new THREE.Color();

  return {
    meshes: sectors.map((s) => s.im),
    count(): number {
      let total = 0;
      for (const s of sectors) total += s.dense.count;
      return total;
    },
    place(slot: number, matrix: THREE.Matrix4, color: THREE.Color): void {
      const s = sectors[slotSector[slot]];
      const dense = activateDenseSlot(s.dense, slot);
      s.im.setMatrixAt(dense, matrix);
      s.im.setColorAt(dense, color);
      markUploadDirty(s.bands, dense);
    },
    remove(slot: number): void {
      const s = sectors[slotSector[slot]];
      const removedDense = s.dense.slotToDense[slot];
      if (removedDense < 0) return;
      const movedSlot = deactivateDenseSlot(s.dense, slot);
      if (movedSlot < 0) return;
      // The old last element remains readable at the new count index until
      // this copy completes. Moving it into the gap keeps the submitted
      // prefix dense without changing the matrix or colour bytes.
      s.im.getMatrixAt(s.dense.count, movedMatrix);
      s.im.setMatrixAt(removedDense, movedMatrix);
      s.im.getColorAt(s.dense.count, movedColor);
      s.im.setColorAt(removedDense, movedColor);
      markUploadDirty(s.bands, removedDense);
    },
    queueUploads(): void {
      for (const s of sectors) {
        const ranges = collectUploadRanges(s.bands, s.ranges);
        clearUploadBands(s.bands);
        if (ranges === 0) continue;
        for (let r = 0; r < ranges; r++) {
          const start = s.ranges[r * 2];
          const count = s.ranges[r * 2 + 1];
          s.im.instanceMatrix.addUpdateRange(start * 16, count * 16);
          if (s.im.instanceColor) s.im.instanceColor.addUpdateRange(start * 3, count * 3);
        }
        s.im.instanceMatrix.needsUpdate = true;
        if (s.im.instanceColor) s.im.instanceColor.needsUpdate = true;
      }
    },
    dropUploads(): void {
      for (const s of sectors) clearUploadBands(s.bands);
    },
    syncSectors(): void {
      for (const s of sectors) {
        const count = s.dense.count;
        s.im.count = count;
        const sphere = s.im.boundingSphere;
        if (!sphere) continue;
        if (count === 0) {
          sphere.radius = 0;
          continue;
        }
        const m = s.im.instanceMatrix.array as Float32Array;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (let d = 0; d < count; d++) {
          const at = d * 16;
          const x = m[at + 12];
          const y = m[at + 13];
          const z = m[at + 14];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        const halfX = (maxX - minX) / 2;
        const halfY = (maxY - minY) / 2;
        const halfZ = (maxZ - minZ) / 2;
        sphere.center.set(minX + halfX, minY + halfY, minZ + halfZ);
        sphere.radius = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ) + clusterPad;
      }
    },
  };
}
