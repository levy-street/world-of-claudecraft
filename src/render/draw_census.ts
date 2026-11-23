// The production draw census, Three half: the scene walk and its idle-time
// sampler. The ranking, bounding, and rolling window are the pure core
// (draw_census_core.ts); this file only touches the scene graph.
//
// The walk mirrors three's own render-list pass (WebGLRenderer.projectObject)
// closely enough that a ranking reads as "what the main camera drew": an
// invisible object hides its subtree, a renderable must pass the camera's
// layer mask, its material's `visible`, and (unless `frustumCulled` is off)
// the camera frustum, and a count-0 InstancedMesh draws nothing. Shadow,
// reflection, and post passes are not walked, so the total sits below
// `renderer.info.render.calls`; the ranking is the attribution, not the count.
//
// It runs on idle time every DRAW_CENSUS_SAMPLE_MS, never inside a frame, and
// it is gameplay-neutral: it reads the scene, changes nothing, and feeds only
// the perf beacon.

import * as THREE from 'three';
import {
  DRAW_CENSUS_SAMPLE_MS,
  type DrawCensusSample,
  type DrawCensusSnapshot,
  DrawCensusWindow,
  drawCensusLabel,
  rankDrawCounts,
} from './draw_census_core';

type CensusObject = THREE.Object3D & {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  count?: number;
};

const UNKNOWN_CATEGORY = 'unknown';

/** Whether three's renderBufferDirect submits (and counts in
 *  `info.render.calls`) a draw for this geometry and optional group: the draw
 *  range clipped to the group and to the index or position count. A negative
 *  span (a group outside the range) or an unbounded one (no index, no
 *  position) is skipped; a zero-length span still counts as a call. */
function submits(geometry: THREE.BufferGeometry | undefined, group: THREE.GeometryGroup | null) {
  if (!geometry) return true;
  const range = geometry.drawRange;
  let start = range.start;
  let end = range.start + range.count;
  if (group) {
    start = Math.max(start, group.start);
    end = Math.min(end, group.start + group.count);
  }
  const index = geometry.index;
  const position = geometry.attributes.position;
  if (index) {
    start = Math.max(start, 0);
    end = Math.min(end, index.count);
  } else if (position) {
    start = Math.max(start, 0);
    end = Math.min(end, position.count);
  }
  const count = end - start;
  return count >= 0 && count !== Number.POSITIVE_INFINITY;
}

/** Draws one renderable submits, as three's projectObject and
 *  renderBufferDirect count them: a single material one draw unless it is
 *  hidden, and a multi-material mesh one draw per geometry group whose own
 *  material is visible (no groups, no draws), each only if its span submits. */
function drawsFor(obj: CensusObject): number {
  const geometry = obj.geometry;
  const material = obj.material;
  if (!material) return 0;
  if (!Array.isArray(material)) {
    return material.visible === false || !submits(geometry, null) ? 0 : 1;
  }
  let draws = 0;
  for (const group of geometry?.groups ?? []) {
    const groupMaterial = material[group.materialIndex ?? 0];
    if (groupMaterial && groupMaterial.visible !== false && submits(geometry, group)) draws++;
  }
  return draws;
}

function categoryOf(obj: THREE.Object3D, inherited: string): string {
  const tag = obj.userData?.renderCategory;
  return typeof tag === 'string' && tag.length > 0 ? tag : inherited;
}

function rootLabel(obj: THREE.Object3D): string {
  const tag = obj.userData?.renderCategory;
  return obj.name || (typeof tag === 'string' ? tag : '') || obj.type;
}

/** Bound and charset-clean every label, merging any that collide after. */
function relabel(counts: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [label, n] of counts) {
    const key = drawCensusLabel(label);
    out.set(key, (out.get(key) ?? 0) + n);
  }
  return out;
}

const scratchFrustum = new THREE.Frustum();
const scratchMatrix = new THREE.Matrix4();

/**
 * One walk of `scene` as `camera` last rendered it. A null camera skips the
 * layer and frustum tests (every visible renderable counts), which is what a
 * test without a camera wants and never what the renderer passes.
 */
export function sampleDrawCensus(
  scene: THREE.Object3D,
  camera: THREE.Camera | null,
): DrawCensusSample {
  const frustum = camera
    ? scratchFrustum.setFromProjectionMatrix(
        scratchMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      )
    : null;
  const startedAt = performance.now();
  const categories = new Map<string, number>();
  const roots = new Map<string, number>();
  const nodes = new Map<string, number>();
  let draws = 0;
  let objects = 0;
  const visit = (obj: THREE.Object3D, category: string, root: string, named: string): void => {
    if (!obj.visible) return;
    const node = obj as CensusObject;
    const renderable = Boolean(node.isMesh || node.isPoints || node.isSprite || node.isLine);
    const n = renderable ? drawsFor(node) : 0;
    if (
      n > 0 &&
      !(node.isInstancedMesh && node.count === 0) &&
      (!camera || node.layers.test(camera.layers)) &&
      (!frustum ||
        !node.frustumCulled ||
        (node.isSprite
          ? frustum.intersectsSprite(node as THREE.Sprite)
          : frustum.intersectsObject(node)))
    ) {
      draws += n;
      objects++;
      categories.set(category, (categories.get(category) ?? 0) + n);
      roots.set(root, (roots.get(root) ?? 0) + n);
      const nodeKey = `${category}>${obj.name || named}`;
      nodes.set(nodeKey, (nodes.get(nodeKey) ?? 0) + n);
    }
    for (const child of obj.children) {
      visit(child, categoryOf(child, category), root, obj.name || named);
    }
  };
  for (const child of scene.children) {
    const root = rootLabel(child);
    visit(child, categoryOf(child, UNKNOWN_CATEGORY), root, root);
  }
  // The ranking is part of the instrument's price, so it is timed too.
  const rankedCategories = rankDrawCounts(relabel(categories));
  const rankedRoots = rankDrawCounts(relabel(roots));
  const rankedNodes = rankDrawCounts(relabel(nodes));
  return {
    draws,
    objects,
    walkMs: Math.round((performance.now() - startedAt) * 10) / 10,
    categories: rankedCategories,
    roots: rankedRoots,
    nodes: rankedNodes,
  };
}

export interface DrawCensusHost {
  scene(): THREE.Object3D;
  camera(): THREE.Camera | null;
  /** True while the scene the idle walk would see is not what the frame
   *  drew (the underworld mask hides every root for the draw only): the due
   *  walk is skipped rather than recorded as a frame that never happened. */
  skip?(): boolean;
  generation(): number;
  shutdown(): boolean;
  scheduleIdle(run: () => void, timeoutMs: number): void;
}

const DRAW_CENSUS_IDLE_TIMEOUT_MS = 2000;

/** Paces the walk: at most one queued, one per DRAW_CENSUS_SAMPLE_MS. */
export class DrawCensusSampler {
  private readonly window = new DrawCensusWindow();
  // null until the first frame: the first walk waits a full interval after
  // it, which keeps it off the first boot frames (a load longer than the
  // interval can still see one, at the same idle-time cost as any other).
  private nextSampleAt: number | null = null;
  private pending = false;
  private snapshot: DrawCensusSnapshot = this.window.snapshot();

  constructor(private readonly host: DrawCensusHost) {}

  current(): DrawCensusSnapshot {
    return this.snapshot;
  }

  /** Called once per rendered frame; schedules a walk when one is due. */
  forFrame(now: number): void {
    if (this.nextSampleAt === null) {
      this.nextSampleAt = now + DRAW_CENSUS_SAMPLE_MS;
      return;
    }
    if (this.pending || now < this.nextSampleAt) return;
    this.pending = true;
    this.nextSampleAt = now + DRAW_CENSUS_SAMPLE_MS;
    const generation = this.host.generation();
    this.host.scheduleIdle(() => {
      try {
        if (this.host.shutdown() || generation !== this.host.generation()) return;
        if (this.host.skip?.()) return;
        this.window.push(sampleDrawCensus(this.host.scene(), this.host.camera()));
        this.snapshot = this.window.snapshot();
      } catch {
        // An always-on instrument never surfaces as a page error: a walk that
        // throws (a malformed renderable) is simply not recorded.
      } finally {
        this.pending = false;
      }
    }, DRAW_CENSUS_IDLE_TIMEOUT_MS);
  }
}
