// Shared scenery detail, installed by the world renderer before scene build.
// The original mesh remains the visibility/reveal/occluder owner. Its child
// batches borrow the EXACT materials, UVs and normals and partition original
// placements. Leaf clusters own positions; fog/light/horizon stay unchanged.
import * as THREE from 'three';
import { ZONES } from '../sim/data';
import {
  type BackgroundGpuQueue,
  GPU_WORK_PRIORITY,
  isGpuQueueShutdown,
} from './background_gpu_queue';
import { GFX, SCENERY_DETAIL_BANDS } from './gfx';
import { GHOST_HIDE_ATTRIBUTE } from './instanced_dither_fade';
import { LowSceneryBands, type SceneryBandsRenderer, sceneryBandsHost } from './scenery_bands';
import { LOW_SCENERY_BUDGET } from './scenery_bands/policy_core';
import { SceneryDetailBatches } from './scenery_detail_batches';
import {
  inSceneryRegion,
  SCENERY_DETAIL_EDGES,
  type SceneryDetailBands,
  sceneryDetailLevel,
  sceneryFullDistance,
} from './scenery_detail_core';
import {
  type SceneryDetailPlacement,
  sceneryDetailPlacements,
  sceneryPlacementDistance,
} from './scenery_detail_placements';
import { preserveSceneryShadow } from './scenery_detail_shadow';
import { skipEmptySceneryDraws } from './scenery_empty_draw';

interface ModelLevels {
  source: THREE.BufferGeometry;
  palm: boolean;
  canopy: boolean;
  positions: Map<number, THREE.BufferAttribute>;
  indices: Map<number, THREE.BufferAttribute>;
  canonical: Map<number, number>;
}

interface Batch {
  model: ModelLevels;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  hideAttr?: THREE.InstancedBufferAttribute;
  level: number;
  slots: number[];
}

interface Entry {
  mesh: THREE.Mesh;
  source: THREE.BufferGeometry;
  hideAttr?: THREE.InstancedBufferAttribute;
  model: ModelLevels;
  palmModel?: ModelLevels;
  palmFlags: Uint8Array;
  count: number;
  externalCount: boolean;
  colorMesh?: THREE.Mesh;
  shadowGeometry?: THREE.BufferGeometry;
  positions: Float32Array;
  levels: Uint8Array;
  margins: Float32Array;
  batches: Batch[];
  batchLookup: (Batch | undefined)[];
  variants: Map<number, THREE.BufferGeometry>;
  radius: number;
  x: number;
  z: number;
  selectX: number;
  selectZ: number;
  safeStepSq: number;
  matrixVersion: number;
  colorVersion: number;
  hideVersion: number;
  readyLevels: number;
  lastMaterial?: THREE.Material | THREE.Material[];
  restoreShadow: () => void;
  placements?: SceneryDetailPlacement[];
}

const palmRegion = ZONES.find((zone) => zone.id === 'palmreach')!;
let active: SceneryDetailSession | undefined;
let lowBands: LowSceneryBands | undefined;
let restoreEmptyDraws: (() => void) | undefined;

function shell(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.attributes = { ...source.attributes };
  result.index = source.index;
  result.boundingBox = source.boundingBox;
  result.boundingSphere = source.boundingSphere;
  result.userData.sharedRendererResource = true;
  return result;
}

function disposeShell(geometry: THREE.BufferGeometry, source: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    if (geometry.attributes[name] === source.attributes[name]) geometry.deleteAttribute(name);
  }
  // Rendered shells own Three's GPU disposal listeners. They all leave
  // together; retain reduced indices so those listeners release their GPU
  // buffers. Repeated removes are safe. Never delete the borrowed base index.
  if (geometry.index === source.index) geometry.index = null;
  geometry.dispose();
}

function visibleInTree(mesh: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

export class SceneryDetailSession {
  private entries: Entry[] = [];
  private models: ModelLevels[] = [];
  private registered = new WeakSet<THREE.Object3D>();
  private disposed = false;
  private pending = new Set<Promise<void>>();
  private readonly wanted: number[];
  private readonly fullDistance: number;
  private batchRevision = -1;
  private batches?: SceneryDetailBatches;
  private batching = false;
  private preparingBatches?: SceneryDetailBatches;
  private retiredBatches: SceneryDetailBatches[] = [];
  private finalBatchAttributes = new Set<THREE.BufferAttribute>();

  constructor(
    private readonly queue: Pick<BackgroundGpuQueue, 'run'>,
    private readonly bands: SceneryDetailBands,
    private readonly batchHost?: {
      camera: THREE.Camera;
      gate(root: THREE.Object3D): Promise<unknown>;
    },
  ) {
    this.wanted = [...new Set(bands)].filter((level) => level > 0);
    this.fullDistance = sceneryFullDistance(bands);
  }

  private modelFor(source: THREE.BufferGeometry, palm: boolean, canopy: boolean): ModelLevels {
    // Ghost geometry shells share their source's attribute/index objects.
    let model = this.models.find(
      (entry) =>
        entry.palm === palm &&
        entry.canopy === canopy &&
        entry.source.index === source.index &&
        entry.source.attributes.position === source.attributes.position,
    );
    if (model) return model;
    model = {
      source,
      palm,
      canopy,
      indices: new Map(),
      positions: new Map(),
      canonical: new Map(),
    };
    this.models.push(model);
    const own = model;
    const job = (async () => {
      // The diagnostic off switch keeps the original loading path intact.
      const {
        buildSceneryDetail,
        releaseSceneryTopology,
        retainSceneryTopology,
        scenerySimplifierReady,
      } = await import('./scenery_detail_indices');
      retainSceneryTopology(source);
      await scenerySimplifierReady;
      try {
        for (const level of this.wanted) {
          if (this.disposed) return;
          await this.queue.run(
            () => {
              if (this.disposed) return;
              const detail = buildSceneryDetail(source, level, palm, canopy);
              let canonical = level;
              // Do not allocate copies or split another draw for an unchanged
              // surface. Several coarse targets can converge to the same mesh.
              if (!detail.position && source.index && detail.index.count >= source.index.count) {
                detail.index = source.index;
                canonical = 0;
              } else if (!detail.position)
                for (const [other, index] of own.indices) {
                  if (
                    index.count === detail.index.count &&
                    index.array.every((value, i) => value === detail.index.array[i])
                  ) {
                    detail.index = index;
                    canonical = own.canonical.get(other) ?? other;
                    break;
                  }
                }
              own.indices.set(level, detail.index);
              own.canonical.set(level, canonical);
              if (detail.position) own.positions.set(level, detail.position);
            },
            GPU_WORK_PRIORITY.BACKGROUND,
            `scenery-index:${source.id}:${level}`,
          );
        }
      } finally {
        releaseSceneryTopology(source);
      }
    })().catch((error: unknown) => {
      if (!this.disposed && !isGpuQueueShutdown(error))
        console.warn('[scenery-detail] retained full geometry', error);
    });
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
    return model;
  }

  /** Construction only, before the owner's normal compile/reveal gate. */
  prepare(mesh: THREE.Mesh, placements?: SceneryDetailPlacement[]): void {
    if (
      this.disposed ||
      this.registered.has(mesh) ||
      mesh.name.startsWith('scenery-detail:') ||
      mesh.name === 'scenery-batched'
    )
      return;
    const source = mesh.geometry;
    const material = mesh.material;
    if (
      !source?.attributes.position ||
      Array.isArray(material) ||
      material.transparent ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      source.groups.length ||
      Object.keys(source.morphAttributes).length ||
      source.drawRange.start !== 0 ||
      source.drawRange.count !== Infinity ||
      ((source.index?.count ?? source.attributes.position.count) < 96 &&
        !placements?.some((placement) => placement.small))
    )
      return;
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (
        (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute &&
        name !== GHOST_HIDE_ATTRIBUTE
      )
        return;
    }
    mesh.updateWorldMatrix(true, false);
    if (!source.boundingBox) source.computeBoundingBox();
    if (!source.boundingSphere) source.computeBoundingSphere();
    const instanced = mesh as THREE.InstancedMesh;
    // Far prop cells own a count=0/1 switch and custom shadow hooks. Their
    // geometry may change, but neither their count nor their bounds belongs
    // to this system. Other empty/dynamically populated batches stay untouched.
    const externalCount = instanced.isInstancedMesh && mesh.name.startsWith('far-bake:');
    if (instanced.isInstancedMesh && !externalCount && !instanced.count) return;
    const count = instanced.isInstancedMesh && !externalCount ? instanced.count : 1;
    const positions = new Float32Array(count * 2);
    const palmFlags = new Uint8Array(count);
    const matrix = new THREE.Matrix4();
    let palm = false;
    for (let i = 0; i < count; i++) {
      if (instanced.isInstancedMesh) {
        instanced.getMatrixAt(i, matrix);
        matrix.premultiply(mesh.matrixWorld);
      } else matrix.copy(mesh.matrixWorld);
      const x = matrix.elements[12],
        z = matrix.elements[14];
      positions[i * 2] = x;
      positions[i * 2 + 1] = z;
      const inPalm = inSceneryRegion(x, z, palmRegion);
      palmFlags[i] = inPalm ? 1 : 0;
      palm ||= inPalm;
    }
    // Region policy follows each tree placement, including mixed batches.
    // Generic props with a tripo material are not necessarily palm trees.
    let jungle = false;
    for (let node: THREE.Object3D | null = mesh; node; node = node.parent)
      jungle ||= node.name === 'jungle-features';
    const palmFamily =
      /^Leaves/.test(material.name) || (jungle && /^(Atlas|tripo)/.test(material.name));
    const palmOnly =
      palm &&
      Array.from({ length: count }, (_, i) =>
        inSceneryRegion(positions[i * 2], positions[i * 2 + 1], palmRegion),
      ).every(Boolean);
    // Externally managed prop batches retain their own shadow path, which
    // uploads the currently selected positions before its count callback.
    const canopy = !externalCount && /^Leaves/.test(material.name);
    const model = this.modelFor(source, palmOnly && palmFamily, canopy);
    const palmModel =
      palm && !palmOnly && palmFamily ? this.modelFor(source, true, canopy) : undefined;
    const entry: Entry = {
      mesh,
      source,
      hideAttr: source.attributes[GHOST_HIDE_ATTRIBUTE] as
        | THREE.InstancedBufferAttribute
        | undefined,
      model,
      palmModel,
      palmFlags,
      count,
      externalCount,
      positions,
      levels: new Uint8Array(count),
      margins: new Float32Array(count),
      batches: [],
      batchLookup: new Array(12),
      variants: new Map(),
      radius: 0,
      x: NaN,
      z: NaN,
      selectX: NaN,
      selectZ: NaN,
      safeStepSq: 0,
      matrixVersion: -1,
      colorVersion: -1,
      hideVersion: -1,
      readyLevels: -1,
      restoreShadow: preserveSceneryShadow(mesh, source, externalCount ? null : count),
      placements,
    };
    if (instanced.isInstancedMesh && !externalCount) {
      instanced.computeBoundingBox();
      instanced.computeBoundingSphere();
      for (const batchModel of palmModel ? [model, palmModel] : [model])
        for (const level of batchModel === model ? [0, ...this.wanted] : this.wanted) {
          const geometry = shell(source);
          let hideAttr: THREE.InstancedBufferAttribute | undefined;
          if (source.hasAttribute(GHOST_HIDE_ATTRIBUTE)) {
            hideAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
            geometry.setAttribute(GHOST_HIDE_ATTRIBUTE, hideAttr);
          }
          const child = new THREE.InstancedMesh(geometry, material, count);
          child.name = `scenery-detail:${level}`;
          child.matrixAutoUpdate = false;
          child.count = 0;
          child.visible = false;
          if (instanced.instanceColor)
            child.instanceColor = new THREE.InstancedBufferAttribute(
              new Float32Array(count * 3),
              3,
            );
          child.boundingBox = instanced.boundingBox?.clone() ?? null;
          child.boundingSphere = instanced.boundingSphere?.clone() ?? null;
          child.castShadow = false;
          preserveSceneryShadow(child, geometry, 0);
          child.receiveShadow = mesh.receiveShadow;
          child.frustumCulled = mesh.frustumCulled;
          child.layers.mask = mesh.layers.mask;
          child.renderOrder = mesh.renderOrder;
          mesh.add(child);
          // Frozen owners will not force a later compose for this new child.
          child.updateMatrixWorld(true);
          const batch: Batch = {
            mesh: child,
            geometry,
            hideAttr,
            level,
            slots: [],
            model: batchModel,
          };
          entry.batches.push(batch);
          entry.batchLookup[(batchModel === palmModel ? 6 : 0) + level] = batch;
        }
    } else {
      // Landmarks use their whole footprint, not their trunk origin.
      const box = new THREE.Box3().setFromObject(mesh);
      entry.positions[0] = (box.min.x + box.max.x) / 2;
      entry.positions[1] = (box.min.z + box.max.z) / 2;
      entry.radius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      for (const level of this.wanted) entry.variants.set(level, shell(source));
      if (!instanced.isInstancedMesh) {
        // The parent always uploads ORIGINAL positions before a shadow pass,
        // including first appearance at far detail. Colour uses a child; a
        // zero draw range suppresses only the parent colour draw, not shadows.
        entry.shadowGeometry = shell(source);
        entry.shadowGeometry.setDrawRange(0, 0);
        const color = new THREE.Mesh(source, material);
        color.name = 'scenery-detail:color';
        color.matrixAutoUpdate = false;
        color.visible = false;
        color.castShadow = false;
        color.receiveShadow = mesh.receiveShadow;
        color.frustumCulled = mesh.frustumCulled;
        color.layers.mask = mesh.layers.mask;
        color.renderOrder = mesh.renderOrder;
        preserveSceneryShadow(color, source, 0);
        mesh.add(color);
        // Bake the owner's placement before any colour draw or frustum test.
        color.updateMatrixWorld(true);
        entry.colorMesh = color;
      }
    }
    this.registered.add(mesh);
    this.entries.push(entry);
  }

  prepareRoot(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const placements = sceneryDetailPlacements(root);
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Transport ships have their own moving hierarchy and authored LOD.
      // The placement snapshots below are exclusively static scenery.
      for (let node: THREE.Object3D | null = mesh; node; node = node.parent)
        if (node.userData.decorative === false) return;
      meshes.push(mesh);
    });
    for (const mesh of meshes) {
      // Flat paving, water and ground strips keep their existing geometry.
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      if (!bounds) continue;
      const size = bounds.getSize(new THREE.Vector3());
      if (size.y <= 0 || size.x <= 0 || size.z <= 0) continue;
      this.prepare(mesh, placements.get(mesh));
    }
  }

  ownsMesh(mesh: THREE.Object3D): boolean {
    return this.registered.has(mesh);
  }

  update(x: number, z: number): void {
    if (this.disposed) return;
    for (const entry of this.entries) {
      if (!visibleInTree(entry.mesh)) continue;
      const source = entry.mesh as THREE.InstancedMesh;
      // Camera occlusion can replace a prop material with its existing fade
      // clone. Follow that owner in the same frame, even at a fixed camera.
      if (entry.lastMaterial !== source.material) {
        entry.lastMaterial = source.material;
        if (entry.colorMesh) entry.colorMesh.material = source.material;
        for (const batch of entry.batches) batch.mesh.material = source.material;
      }
      const hide =
        entry.hideAttr ??
        (entry.source.attributes[GHOST_HIDE_ATTRIBUTE] as
          | THREE.InstancedBufferAttribute
          | undefined);
      const matrixVersion = source.instanceMatrix?.version ?? 0;
      const colorVersion = source.instanceColor?.version ?? 0;
      const hideVersion = hide?.version ?? 0;
      const readyLevels = entry.model.indices.size + (entry.palmModel?.indices.size ?? 0);
      const moved = entry.x !== x || entry.z !== z;
      if (
        !moved &&
        entry.matrixVersion === matrixVersion &&
        entry.colorVersion === colorVersion &&
        entry.hideVersion === hideVersion &&
        entry.readyLevels === readyLevels
      )
        continue;
      let changed =
        entry.matrixVersion !== matrixVersion ||
        entry.colorVersion !== colorVersion ||
        entry.hideVersion !== hideVersion ||
        entry.readyLevels !== readyLevels;
      const dx = x - entry.selectX;
      const dz = z - entry.selectZ;
      const stepSq = dx * dx + dz * dz;
      const readyChanged = entry.readyLevels !== readyLevels;
      const select = readyChanged || (moved && !(stepSq < entry.safeStepSq));
      entry.x = x;
      entry.z = z;
      entry.matrixVersion = matrixVersion;
      entry.colorVersion = colorVersion;
      entry.hideVersion = hideVersion;
      entry.readyLevels = readyLevels;
      if (select) {
        const stepDist = readyChanged || !(stepSq < Infinity) ? Infinity : Math.sqrt(stepSq);
        let minMargin = Infinity;
        const smallEdge = this.fullDistance + 4;
        const margins = entry.margins;
        for (let i = 0; i < entry.count; i++) {
          const rem = margins[i] - stepDist;
          if (rem > 0) {
            margins[i] = rem;
            if (rem < minMargin) minMargin = rem;
            continue;
          }
          const placement = entry.placements?.[i];
          const distance = placement
            ? sceneryPlacementDistance(placement, x, z)
            : Math.max(
                0,
                Math.hypot(x - entry.positions[i * 2], z - entry.positions[i * 2 + 1]) -
                  entry.radius,
              );
          let itemMargin = Infinity;
          if (!entry.externalCount && placement?.small) {
            const smallMargin = Math.abs(distance - smallEdge);
            if (smallMargin < itemMargin) itemMargin = smallMargin;
            if (distance > smallEdge) {
              changed ||= entry.levels[i] !== 6;
              entry.levels[i] = 6;
              const safeItem = Math.max(0, itemMargin - 1e-4);
              margins[i] = safeItem;
              if (safeItem < minMargin) minMargin = safeItem;
              if (entry.colorMesh && entry.shadowGeometry) {
                entry.colorMesh.visible = false;
                entry.mesh.geometry = entry.shadowGeometry;
              }
              continue;
            }
          }
          const previous = entry.levels[i];
          let level = sceneryDetailLevel(distance, previous, this.bands);
          let model = entry.palmModel && entry.palmFlags[i] ? entry.palmModel : entry.model;
          if (level && !model.indices.has(level)) level = 0;
          level = (model.canonical.get(level) ?? level) as typeof level;
          if (level === 0) model = entry.model;
          changed ||= previous !== level;
          entry.levels[i] = level;
          for (let band = 0; band < SCENERY_DETAIL_EDGES.length; band++) {
            const edge = SCENERY_DETAIL_EDGES[band];
            const threshold = edge + (level > this.bands[band] ? 0 : Math.min(8, edge * 0.05));
            const margin = Math.abs(distance - threshold);
            if (margin < itemMargin) itemMargin = margin;
          }
          const safeItem = Math.max(0, itemMargin - 1e-4);
          margins[i] = safeItem;
          if (safeItem < minMargin) minMargin = safeItem;
          if (!source.isInstancedMesh || entry.externalCount) {
            const geometry = entry.variants.get(level) ?? entry.source;
            const index = entry.model.indices.get(level);
            if (index) geometry.index = index;
            const position = entry.model.positions.get(level);
            if (position) geometry.setAttribute('position', position);
            if (entry.colorMesh && entry.shadowGeometry) {
              entry.colorMesh.geometry = geometry;
              entry.colorMesh.visible = level > 0;
              entry.mesh.geometry = level > 0 ? entry.shadowGeometry : entry.source;
            } else entry.mesh.geometry = geometry;
          }
        }
        entry.safeStepSq = minMargin * minMargin;
        entry.selectX = x;
        entry.selectZ = z;
      }
      if (!source.isInstancedMesh || entry.externalCount || !changed) continue;
      for (const batch of entry.batches) batch.slots.length = 0;
      for (let i = 0; i < entry.count; i++) {
        const level = entry.levels[i];
        if (level === 6) continue;
        const model =
          level > 0 && entry.palmModel && entry.palmFlags[i] ? entry.palmModel : entry.model;
        entry.batchLookup[(model === entry.palmModel ? 6 : 0) + level]!.slots.push(i);
      }
      const srcMatArr = source.instanceMatrix.array;
      const srcColArr = source.instanceColor?.array;
      const srcHideArr = hide?.array;
      for (const batch of entry.batches) {
        const target = batch.mesh;
        const index = batch.model.indices.get(batch.level);
        if (index) batch.geometry.index = index;
        const position = batch.model.positions.get(batch.level);
        if (position) batch.geometry.setAttribute('position', position);
        target.count = batch.slots.length;
        target.visible = target.count > 0;
        const targetHide = batch.hideAttr;
        const dstMatArr = target.instanceMatrix.array;
        const dstColArr = target.instanceColor?.array;
        const dstHideArr = targetHide?.array;
        for (let j = 0; j < batch.slots.length; j++) {
          const i = batch.slots[j];
          const srcM = i * 16;
          const dstM = j * 16;
          for (let k = 0; k < 16; k++) dstMatArr[dstM + k] = srcMatArr[srcM + k];
          if (srcColArr && dstColArr) {
            const srcC = i * 3;
            const dstC = j * 3;
            dstColArr[dstC] = srcColArr[srcC];
            dstColArr[dstC + 1] = srcColArr[srcC + 1];
            dstColArr[dstC + 2] = srcColArr[srcC + 2];
          }
          if (srcHideArr && dstHideArr) dstHideArr[j] = srcHideArr[i];
        }
        if (target.count) {
          target.instanceMatrix.clearUpdateRanges();
          target.instanceMatrix.addUpdateRange(0, target.count * 16);
          target.instanceMatrix.needsUpdate = true;
          if (target.instanceColor) {
            target.instanceColor.clearUpdateRanges();
            target.instanceColor.addUpdateRange(0, target.count * 3);
            target.instanceColor.needsUpdate = true;
          }
          if (targetHide) {
            targetHide.clearUpdateRanges();
            targetHide.addUpdateRange(0, target.count);
            targetHide.needsUpdate = true;
          }
        }
      }
      source.count = 0;
    }
    this.batches?.update(this.batchHost!.camera);
    if (
      this.batchHost &&
      !this.pending.size &&
      !this.batching &&
      this.batchRevision !== this.entries.length
    )
      this.prepareBatches();
  }

  private prepareBatches(): void {
    const revision = this.entries.length;
    this.batchRevision = revision;
    this.batching = true;
    let candidate: SceneryDetailBatches | undefined;
    void (async () => {
      await this.queue.run(
        () => {
          if (this.disposed) return;
          const children: THREE.InstancedMesh[] = [];
          const owners = new Map<THREE.InstancedMesh, THREE.Object3D>();
          for (const entry of this.entries)
            for (const batch of entry.batches) {
              batch.geometry.index = batch.model.indices.get(batch.level) ?? entry.source.index;
              batch.geometry.setAttribute(
                'position',
                batch.model.positions.get(batch.level) ?? entry.source.attributes.position,
              );
              children.push(batch.mesh);
              owners.set(batch.mesh, entry.mesh);
            }
          candidate = new SceneryDetailBatches(children, owners);
          this.preparingBatches = candidate;
        },
        GPU_WORK_PRIORITY.BACKGROUND,
        'scenery-batch:prepare',
      );
      if (!candidate) return;
      await candidate.prepare(this.batchHost!.gate);
      if (this.disposed || revision !== this.entries.length) {
        this.retireBatches(candidate);
        return;
      }
      if (this.batches) this.retireBatches(this.batches);
      this.batches = candidate;
    })()
      .catch((error: unknown) => {
        if (candidate) this.retireBatches(candidate);
        if (!this.disposed && !isGpuQueueShutdown(error))
          console.warn('[scenery-detail] retained cell batches', error);
      })
      .finally(() => {
        if (this.preparingBatches === candidate) this.preparingBatches = undefined;
        this.batching = false;
      });
  }

  private retireBatches(batches: SceneryDetailBatches): void {
    if (this.disposed) batches.dispose(this.finalBatchAttributes, false);
    else {
      batches.retire();
      this.retiredBatches.push(batches);
    }
  }

  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  snapshot(): {
    entries: number;
    models: number;
    pending: number;
    levels: number[];
    indexBytes: number;
    positionBytes: number;
    batches: ReturnType<SceneryDetailBatches['snapshot']> | null;
  } {
    const levels = [0, 0, 0, 0, 0, 0, 0];
    for (const entry of this.entries) for (const level of entry.levels) levels[level]++;
    return {
      entries: this.entries.length,
      models: this.models.length,
      pending: this.pending.size + (this.batching ? 1 : 0),
      batches: this.batches?.snapshot() ?? null,
      levels,
      indexBytes: this.models.reduce(
        (n, model) =>
          n +
          [...new Set(model.indices.values())].reduce(
            (sum, index) => sum + (index === model.source.index ? 0 : index.array.byteLength),
            0,
          ),
        0,
      ),
      positionBytes: this.models.reduce(
        (n, model) =>
          n +
          [...model.positions.values()].reduce(
            (sum, position) => sum + position.array.byteLength,
            0,
          ),
        0,
      ),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.models) {
      for (const attribute of model.indices.values())
        if (attribute !== model.source.index) this.finalBatchAttributes.add(attribute);
      for (const attribute of model.positions.values()) this.finalBatchAttributes.add(attribute);
    }
    this.preparingBatches?.dispose(this.finalBatchAttributes, false);
    this.batches?.dispose(this.finalBatchAttributes, false);
    for (const batches of this.retiredBatches) batches.dispose(this.finalBatchAttributes, false);
    this.retiredBatches.length = 0;
    for (const entry of this.entries) {
      entry.restoreShadow();
      entry.mesh.geometry = entry.source;
      if ((entry.mesh as THREE.InstancedMesh).isInstancedMesh && !entry.externalCount)
        (entry.mesh as THREE.InstancedMesh).count = entry.count;
      for (const batch of entry.batches) {
        batch.mesh.removeFromParent();
        batch.mesh.dispose();
        disposeShell(batch.geometry, entry.source);
      }
      for (const geometry of entry.variants.values()) disposeShell(geometry, entry.source);
      entry.colorMesh?.removeFromParent();
      if (entry.shadowGeometry) disposeShell(entry.shadowGeometry, entry.source);
    }
    this.entries.length = 0;
    this.models.length = 0;
  }
}

export function installSceneryDetail(
  queue: Pick<BackgroundGpuQueue, 'run'>,
  renderer?: SceneryBandsRenderer,
  gate?: (root: THREE.Object3D) => Promise<unknown>,
): void {
  disposeSceneryDetail();
  if (!GFX.sceneryDetail) return;
  if (GFX.tier === 'low' && renderer && gate) {
    const host = sceneryBandsHost(renderer, gate);
    lowBands = new LowSceneryBands(queue, () => host);
  } else
    active = new SceneryDetailSession(
      queue,
      SCENERY_DETAIL_BANDS[GFX.tier],
      renderer && gate
        ? {
            get camera() {
              return renderer.camera;
            },
            gate,
          }
        : undefined,
    );
  if (active && renderer && GFX.tier !== 'low')
    restoreEmptyDraws = skipEmptySceneryDraws(renderer.webgl, isSceneryDetailMesh);
}
export function prepareSceneryDetailMesh(mesh: THREE.Mesh): void {
  lowBands?.registerMesh(mesh);
  active?.prepare(mesh);
}
export function prepareSceneryDetailRoot(root: THREE.Object3D, zoneFeature = false): void {
  lowBands?.registerRoot(root, zoneFeature);
  active?.prepareRoot(root);
}
export function isSceneryDetailMesh(mesh: THREE.Object3D): boolean {
  return lowBands?.ownsMesh(mesh) ?? active?.ownsMesh(mesh) ?? false;
}
export function updateSceneryDetail(x: number, z: number): void {
  active?.update(x, z);
  lowBands?.update(x, z);
}
export function sceneryCullFar(distance: number, group?: THREE.Object3D): number {
  return lowBands?.cullFar(distance, group) ?? distance;
}
export function sceneryFar(
  horizon: { sceneryCullFar(distance: number): number },
  distance: number,
): number {
  return sceneryCullFar(horizon.sceneryCullFar(distance));
}
export function isLowSceneryCullActive(fogFar: number): boolean {
  return !!lowBands || fogFar <= LOW_SCENERY_BUDGET.full;
}
export function sceneryClutterFar(fogFar: number): number {
  return isLowSceneryCullActive(fogFar)
    ? Math.max(fogFar, LOW_SCENERY_BUDGET.full + LOW_SCENERY_BUDGET.placementMargin)
    : fogFar;
}
export function sceneryStructureFar(fogFar: number): number {
  return isLowSceneryCullActive(fogFar) ? Math.max(fogFar, LOW_SCENERY_BUDGET.middle) : fogFar;
}
export function sceneryDetailSnapshot(): object | null {
  if (lowBands) return lowBands.snapshot();
  return active ? { ...active.snapshot(), emptyDrawGuard: !!restoreEmptyDraws } : null;
}
export function disposeSceneryDetail(): void {
  restoreEmptyDraws?.();
  restoreEmptyDraws = undefined;
  active?.dispose();
  active = undefined;
  lowBands?.dispose();
  lowBands = undefined;
}
