import * as THREE from 'three';
import { prepareSceneryBandGeometry, SceneryIndexCache, sceneryBandIndices } from './geometry';
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

interface PartTemplate {
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
}

const templateCache = new WeakMap<Uint32Array, PartTemplate>();

function getPartTemplate(source: THREE.BufferGeometry, reducedIndices: Uint32Array): PartTemplate {
  const cached = templateCache.get(reducedIndices);
  if (cached) return cached;

  const srcPos = source.attributes.position;
  const srcNrm = source.attributes.normal;
  const srcUv = source.attributes.uv;
  const srcCol = source.attributes.color;
  const idxCount = reducedIndices.length;

  if (srcNrm) {
    const remap = new Int32Array(srcPos.count).fill(-1);
    const uniqueVertices: number[] = [];
    const indices = new Uint32Array(idxCount);
    for (let i = 0; i < idxCount; i++) {
      const v = reducedIndices[i];
      let mapped = remap[v];
      if (mapped === -1) {
        mapped = uniqueVertices.length;
        remap[v] = mapped;
        uniqueVertices.push(v);
      }
      indices[i] = mapped;
    }
    const vertexCount = uniqueVertices.length;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = srcUv ? new Float32Array(vertexCount * 2) : null;
    const colors = srcCol ? new Float32Array(vertexCount * 3) : null;
    for (let i = 0; i < vertexCount; i++) {
      const v = uniqueVertices[i];
      const i3 = i * 3;
      positions[i3] = srcPos.getX(v);
      positions[i3 + 1] = srcPos.getY(v);
      positions[i3 + 2] = srcPos.getZ(v);
      normals[i3] = srcNrm.getX(v);
      normals[i3 + 1] = srcNrm.getY(v);
      normals[i3 + 2] = srcNrm.getZ(v);
      if (uvs && srcUv) {
        const i2 = i * 2;
        uvs[i2] = srcUv.getX(v);
        uvs[i2 + 1] = srcUv.getY(v);
      }
      if (colors && srcCol) {
        colors[i3] = srcCol.getX(v);
        colors[i3 + 1] = srcCol.getY(v);
        colors[i3 + 2] = srcCol.getZ(v);
      }
    }
    const template: PartTemplate = {
      vertexCount,
      positions,
      normals,
      uvs,
      colors,
      indices,
    };
    templateCache.set(reducedIndices, template);
    return template;
  }

  // Fallback for un-normaled source geometries: expand triangles and compute face normals.
  const vertexCount = idxCount;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = srcUv ? new Float32Array(vertexCount * 2) : null;
  const colors = srcCol ? new Float32Array(vertexCount * 3) : null;
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 3) {
    const v0 = reducedIndices[i];
    const v1 = reducedIndices[i + 1];
    const v2 = reducedIndices[i + 2];
    const ax = srcPos.getX(v0),
      ay = srcPos.getY(v0),
      az = srcPos.getZ(v0);
    const bx = srcPos.getX(v1),
      by = srcPos.getY(v1),
      bz = srcPos.getZ(v1);
    const cx = srcPos.getX(v2),
      cy = srcPos.getY(v2),
      cz = srcPos.getZ(v2);
    const abx = cx - bx,
      aby = cy - by,
      abz = cz - bz;
    const acx = ax - bx,
      acy = ay - by,
      acz = az - bz;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    const verts = [v0, v1, v2];
    const coords = [ax, ay, az, bx, by, bz, cx, cy, cz];
    for (let k = 0; k < 3; k++) {
      const outIdx = i + k;
      const out3 = outIdx * 3;
      indices[outIdx] = outIdx;
      positions[out3] = coords[k * 3];
      positions[out3 + 1] = coords[k * 3 + 1];
      positions[out3 + 2] = coords[k * 3 + 2];
      normals[out3] = nx;
      normals[out3 + 1] = ny;
      normals[out3 + 2] = nz;
      const sv = verts[k];
      if (uvs && srcUv) {
        const out2 = outIdx * 2;
        uvs[out2] = srcUv.getX(sv);
        uvs[out2 + 1] = srcUv.getY(sv);
      }
      if (colors && srcCol) {
        colors[out3] = srcCol.getX(sv);
        colors[out3 + 1] = srcCol.getY(sv);
        colors[out3 + 2] = srcCol.getZ(sv);
      }
    }
  }
  const template: PartTemplate = {
    vertexCount,
    positions,
    normals,
    uvs,
    colors,
    indices,
  };
  templateCache.set(reducedIndices, template);
  return template;
}

interface StagedBatch {
  material: THREE.Material;
  ranges: Range[];
  vertexOffset: number;
  indexOffset: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  localPositions: Float32Array | null;
  localNormals: Float32Array | null;
  matrix0: Float32Array | null;
  matrix1: Float32Array | null;
  matrix2: Float32Array | null;
  matrix3: Float32Array | null;
  indices: Uint32Array;
}

interface PreparedPartTask {
  itemIndex: number;
  part: SceneryPart;
  template: PartTemplate;
  batch: StagedBatch;
}

const _normalMatrix = new THREE.Matrix3();

function writePartIntoBatch(task: PreparedPartTask, localCoordinates: boolean): void {
  const { itemIndex, part, template, batch } = task;
  const count = template.vertexCount;
  const vOffset = batch.vertexOffset;
  const iOffset = batch.indexOffset;
  const srcPos = template.positions;
  const srcNrm = template.normals;
  const srcUv = template.uvs;
  const srcCol = template.colors;

  const dstPos = batch.positions;
  const dstNrm = batch.normals;
  const dstUv = batch.uvs;
  const dstCol = batch.colors;

  const me = part.matrix.elements;
  const m00 = me[0],
    m01 = me[1],
    m02 = me[2],
    m03 = me[3];
  const m10 = me[4],
    m11 = me[5],
    m12 = me[6],
    m13 = me[7];
  const m20 = me[8],
    m21 = me[9],
    m22 = me[10],
    m23 = me[11];
  const m30 = me[12],
    m31 = me[13],
    m32 = me[14],
    m33 = me[15];

  _normalMatrix.getNormalMatrix(part.matrix);
  const ne = _normalMatrix.elements;
  const n00 = ne[0],
    n01 = ne[1],
    n02 = ne[2];
  const n10 = ne[3],
    n11 = ne[4],
    n12 = ne[5];
  const n20 = ne[6],
    n21 = ne[7],
    n22 = ne[8];

  if (localCoordinates) {
    batch.localPositions!.set(srcPos, vOffset * 3);
    batch.localNormals!.set(srcNrm, vOffset * 3);
    const mat0 = batch.matrix0!;
    const mat1 = batch.matrix1!;
    const mat2 = batch.matrix2!;
    const mat3 = batch.matrix3!;
    for (let i = 0; i < count; i++) {
      const o4 = (vOffset + i) * 4;
      mat0[o4] = m00;
      mat0[o4 + 1] = m01;
      mat0[o4 + 2] = m02;
      mat0[o4 + 3] = m03;
      mat1[o4] = m10;
      mat1[o4 + 1] = m11;
      mat1[o4 + 2] = m12;
      mat1[o4 + 3] = m13;
      mat2[o4] = m20;
      mat2[o4 + 1] = m21;
      mat2[o4 + 2] = m22;
      mat2[o4 + 3] = m23;
      mat3[o4] = m30;
      mat3[o4 + 1] = m31;
      mat3[o4 + 2] = m32;
      mat3[o4 + 3] = m33;
    }
  }

  const clampLeafNormals = !localCoordinates && /^Leaves_/.test(part.source.material.name);
  const tr = part.tint.r;
  const tg = part.tint.g;
  const tb = part.tint.b;

  if (srcUv) {
    dstUv.set(srcUv, vOffset * 2);
  }

  for (let i = 0; i < count; i++) {
    const s3 = i * 3;
    const d3 = (vOffset + i) * 3;
    const px = srcPos[s3];
    const py = srcPos[s3 + 1];
    const pz = srcPos[s3 + 2];
    const w = 1 / (m03 * px + m13 * py + m23 * pz + m33);
    dstPos[d3] = (m00 * px + m10 * py + m20 * pz + m30) * w;
    dstPos[d3 + 1] = (m01 * px + m11 * py + m21 * pz + m31) * w;
    dstPos[d3 + 2] = (m02 * px + m12 * py + m22 * pz + m32) * w;

    const nx0 = srcNrm[s3];
    const ny0 = srcNrm[s3 + 1];
    const nz0 = srcNrm[s3 + 2];
    let nx = n00 * nx0 + n10 * ny0 + n20 * nz0;
    let ny = n01 * nx0 + n11 * ny0 + n21 * nz0;
    let nz = n02 * nx0 + n12 * ny0 + n22 * nz0;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen > 0) {
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
    }
    if (clampLeafNormals) {
      ny = Math.max(0.48, Math.abs(ny));
      const inv = 1 / Math.max(1e-4, Math.hypot(nx, ny, nz));
      nx *= inv;
      ny *= inv;
      nz *= inv;
    }
    dstNrm[d3] = nx;
    dstNrm[d3 + 1] = ny;
    dstNrm[d3 + 2] = nz;

    if (srcCol) {
      dstCol[d3] = srcCol[s3] * tr;
      dstCol[d3 + 1] = srcCol[s3 + 1] * tg;
      dstCol[d3 + 2] = srcCol[s3 + 2] * tb;
    } else {
      dstCol[d3] = tr;
      dstCol[d3 + 1] = tg;
      dstCol[d3 + 2] = tb;
    }
  }

  const tplIndices = template.indices;
  const idxLen = tplIndices.length;
  const dstIndices = batch.indices;
  for (let k = 0; k < idxLen; k++) {
    dstIndices[iOffset + k] = tplIndices[k] + vOffset;
  }

  batch.ranges.push({
    item: itemIndex,
    start: iOffset,
    end: iOffset + idxLen,
  });
  batch.vertexOffset += count;
  batch.indexOffset += idxLen;
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
  const reductions = options.cache ?? new SceneryIndexCache();
  const localCoordinates = options.localCoordinates !== false;
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
    const pendingParts: {
      itemIndex: number;
      part: SceneryPart;
      template: PartTemplate;
    }[] = [];
    const totalsByMaterial = new Map<THREE.Material, { vertices: number; indices: number }>();

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
        const template = getPartTemplate(source, indices);
        pendingParts.push({ itemIndex, part, template });
        let totals = totalsByMaterial.get(part.source.material);
        if (!totals) {
          totals = { vertices: 0, indices: 0 };
          totalsByMaterial.set(part.source.material, totals);
        }
        totals.vertices += template.vertexCount;
        totals.indices += template.indices.length;
      }
    }

    const staging = new Map<THREE.Material, StagedBatch>();
    for (const [srcMat, totals] of totalsByMaterial) {
      const material = options.material(srcMat);
      material.vertexColors = true;
      materials.push(material);
      const vCount = totals.vertices;
      staging.set(srcMat, {
        material,
        ranges: [],
        vertexOffset: 0,
        indexOffset: 0,
        positions: new Float32Array(vCount * 3),
        normals: new Float32Array(vCount * 3),
        uvs: new Float32Array(vCount * 2),
        colors: new Float32Array(vCount * 3),
        localPositions: localCoordinates ? new Float32Array(vCount * 3) : null,
        localNormals: localCoordinates ? new Float32Array(vCount * 3) : null,
        matrix0: localCoordinates ? new Float32Array(vCount * 4) : null,
        matrix1: localCoordinates ? new Float32Array(vCount * 4) : null,
        matrix2: localCoordinates ? new Float32Array(vCount * 4) : null,
        matrix3: localCoordinates ? new Float32Array(vCount * 4) : null,
        indices: new Uint32Array(totals.indices),
      });
    }

    const tasks: PreparedPartTask[] = pendingParts.map((entry) => ({
      ...entry,
      batch: staging.get(entry.part.source.material)!,
    }));

    // Keep 1 part per unit on small fixtures (<= 32 parts) and chunk up to 24
    // parts per unit on large world bands to cut queue scheduling overhead.
    const chunkSize = tasks.length <= 32 ? 1 : 24;
    for (let i = 0; i < tasks.length; i += chunkSize) {
      const end = Math.min(tasks.length, i + chunkSize);
      await options.prepare(() => {
        assertActive();
        for (let j = i; j < end; j++) {
          writePartIntoBatch(tasks[j], localCoordinates);
        }
      }, `scenery-band-part:${options.name}`);
    }

    for (const staged of staging.values()) {
      assertActive();
      await options.prepare(() => {
        assertActive();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(staged.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(staged.normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(staged.uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(staged.colors, 3));
        if (localCoordinates) {
          geometry.setAttribute(
            'sceneryLocalPosition',
            new THREE.BufferAttribute(staged.localPositions!, 3),
          );
          geometry.setAttribute(
            'sceneryLocalNormal',
            new THREE.BufferAttribute(staged.localNormals!, 3),
          );
          geometry.setAttribute('sceneryMatrix0', new THREE.BufferAttribute(staged.matrix0!, 4));
          geometry.setAttribute('sceneryMatrix1', new THREE.BufferAttribute(staged.matrix1!, 4));
          geometry.setAttribute('sceneryMatrix2', new THREE.BufferAttribute(staged.matrix2!, 4));
          geometry.setAttribute('sceneryMatrix3', new THREE.BufferAttribute(staged.matrix3!, 4));
        }
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(staged.indices.length), 1));
        geometry.setDrawRange(0, 0);
        owned.add(geometry);
        const mesh = new THREE.Mesh(geometry, staged.material);
        mesh.frustumCulled = false;
        root.add(mesh);
        batches.push({ mesh, indices: staged.indices, ranges: staged.ranges });
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
