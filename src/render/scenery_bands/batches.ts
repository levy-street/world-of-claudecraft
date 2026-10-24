import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareSceneryBandGeometry, SceneryIndexCache, sceneryBandIndices } from './geometry';
import { addSceneryLocalAttributes } from './material';
import type { SceneryPart, SceneryPlacement } from './types';

interface Range {
  item: number;
  start: number;
  end: number;
}
interface Batch {
  mesh: THREE.Mesh;
  indices: Uint32Array;
  ranges: Range[];
}
export interface BandBuildOptions {
  name: string;
  cache?: SceneryIndexCache;
  items: readonly SceneryPlacement[];
  include?(item: SceneryPlacement): boolean;
  reduction(
    item: SceneryPlacement,
    part: SceneryPart,
  ): {
    triangles: number;
    mode: 'quality' | 'palm' | 'coarse';
  };
  material(source: THREE.Material): THREE.Material;
  /** Source shader hooks need authored coordinates; the selected Low
   * Lambert replacements consume the already transformed geometry. */
  localCoordinates?: boolean;
  prepare<T>(work: () => T, label: string): Promise<T>;
  gate(root: THREE.Group): Promise<void>;
  cancelled(): boolean;
}

/** Merges the selected large placements by material, just as the measured
 * prototype did. It never creates a child draw for every original cell/LOD. */
export async function buildSceneryBand(options: BandBuildOptions): Promise<SceneryBand> {
  const root = new THREE.Group();
  root.name = options.name;
  root.visible = false;
  const materials: THREE.Material[] = [];
  const owned = new Set<THREE.BufferGeometry>();
  const batches: Batch[] = [];
  const staging = new Map<
    THREE.Material,
    {
      material: THREE.Material;
      parts: THREE.BufferGeometry[];
      ranges: Range[];
      vertices: number;
    }
  >();
  const reductions = options.cache ?? new SceneryIndexCache();
  const dispose = (): void => {
    root.removeFromParent();
    for (const geometry of owned) geometry.dispose();
    for (const material of materials) material.dispose();
    owned.clear();
    materials.length = 0;
  };
  const assertActive = (): void => {
    if (options.cancelled()) throw new Error('Scenery preparation cancelled');
  };
  try {
    await prepareSceneryBandGeometry();
    for (const [itemIndex, item] of options.items.entries()) {
      if (options.include && !options.include(item)) continue;
      for (const part of item.parts) {
        assertActive();
        const source = part.source.geometry;
        const policy = options.reduction(item, part);
        const key = `${policy.mode}:${policy.triangles}`;
        let indices = reductions.find(source, key);
        if (!indices) {
          indices = await options.prepare(() => {
            assertActive();
            return sceneryBandIndices(source, policy.triangles, policy.mode);
          }, `scenery-band-reduce:${options.name}`);
          reductions.store(source, key, indices);
        }
        const reducedIndices = indices;
        await options.prepare(() => {
          assertActive();
          // Temporary shell borrows source arrays. toNonIndexed creates owned
          // packed arrays; never dispose a shell that borrowed GPU attributes.
          const shell = new THREE.BufferGeometry();
          for (const name of ['position', 'normal', 'uv', 'color'])
            if (source.attributes[name]) shell.setAttribute(name, source.attributes[name]);
          shell.setIndex(new THREE.BufferAttribute(reducedIndices, 1));
          const geometry = shell.toNonIndexed();
          owned.add(geometry);
          if (!geometry.attributes.normal) geometry.computeVertexNormals();
          if (options.localCoordinates !== false) addSceneryLocalAttributes(geometry, part.matrix);
          geometry.applyMatrix4(part.matrix);
          const count = geometry.attributes.position.count;
          if (options.localCoordinates === false && /^Leaves_/.test(part.source.material.name)) {
            const nrm = geometry.attributes.normal as THREE.BufferAttribute;
            for (let i = 0; i < count; i++) {
              const nx = nrm.getX(i);
              const ny = Math.max(0.48, Math.abs(nrm.getY(i)));
              const nz = nrm.getZ(i);
              const inv = 1 / Math.max(1e-4, Math.hypot(nx, ny, nz));
              nrm.setXYZ(i, nx * inv, ny * inv, nz * inv);
            }
          }
          if (!geometry.attributes.uv)
            geometry.setAttribute(
              'uv',
              new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
            );
          const colors = new Float32Array(count * 3);
          const sourceColors = geometry.attributes.color;
          for (let i = 0; i < count; i++) {
            colors[i * 3] = (sourceColors?.getX(i) ?? 1) * part.tint.r;
            colors[i * 3 + 1] = (sourceColors?.getY(i) ?? 1) * part.tint.g;
            colors[i * 3 + 2] = (sourceColors?.getZ(i) ?? 1) * part.tint.b;
          }
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          let batch = staging.get(part.source.material);
          if (!batch) {
            const material = options.material(part.source.material);
            material.vertexColors = true;
            materials.push(material);
            batch = { material, parts: [], ranges: [], vertices: 0 };
            staging.set(part.source.material, batch);
          }
          batch.ranges.push({
            item: itemIndex,
            start: batch.vertices,
            end: batch.vertices + count,
          });
          batch.vertices += count;
          batch.parts.push(geometry);
        }, `scenery-band-part:${options.name}`);
      }
    }
    for (const staged of staging.values()) {
      assertActive();
      await options.prepare(() => {
        assertActive();
        const geometry = mergeGeometries(staged.parts);
        if (!geometry) throw new Error('Incompatible scenery attributes');
        owned.add(geometry);
        for (const part of staged.parts) {
          part.dispose();
          owned.delete(part);
        }
        const indices = Uint32Array.from(
          { length: geometry.attributes.position.count },
          (_, i) => i,
        );
        geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
        geometry.setDrawRange(0, 0);
        const mesh = new THREE.Mesh(geometry, staged.material);
        mesh.frustumCulled = false;
        root.add(mesh);
        batches.push({ mesh, indices, ranges: staged.ranges });
      }, `scenery-band-merge:${options.name}`);
    }
    await options.gate(root);
    assertActive();
    return new SceneryBand(root, batches, options.items.length, dispose);
  } catch (error) {
    dispose();
    throw error;
  }
}

export class SceneryBand {
  private selected: Uint8Array;
  private disposed = false;
  constructor(
    readonly root: THREE.Group,
    private readonly batches: Batch[],
    count: number,
    private readonly release: () => void,
  ) {
    this.selected = new Uint8Array(count);
  }

  select(selected: Uint8Array): void {
    if (this.disposed) return;
    if (selected.length !== this.selected.length) throw new Error('Scenery population changed');
    // Outdoor resume can restore the same membership after its root was
    // hidden underwater or indoors. Visibility is independent of repacking.
    this.root.visible = true;
    let changed = false;
    for (let i = 0; i < selected.length; i++)
      if (selected[i] !== this.selected[i]) {
        changed = true;
        break;
      }
    if (!changed) return;
    this.selected.set(selected);
    for (const batch of this.batches) {
      const geometry = batch.mesh.geometry;
      const index = geometry.index!;
      let count = 0;
      for (const range of batch.ranges) {
        if (!selected[range.item]) continue;
        index.array.set(batch.indices.subarray(range.start, range.end), count);
        count += range.end - range.start;
      }
      geometry.setDrawRange(0, count);
      index.clearUpdateRanges();
      if (count) index.addUpdateRange(0, count);
      index.needsUpdate = true;
      batch.mesh.visible = count > 0;
    }
  }

  snapshot(): { placements: number; draws: number; triangles: number } {
    return {
      placements: this.selected.reduce((sum, value) => sum + value, 0),
      draws: this.batches.filter((batch) => batch.mesh.geometry.drawRange.count > 0).length,
      triangles: this.batches.reduce(
        (sum, batch) => sum + batch.mesh.geometry.drawRange.count / 3,
        0,
      ),
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }
}
