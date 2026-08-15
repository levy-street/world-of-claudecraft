// Sampled scene-census diagnostics behind ?perfTrace (the hitch-forensics
// instrument: per-category draw/triangle estimates, program/texture deltas,
// first-seen materials and first-visible objects). Dev-only and localhost
// gated; the sampled walk runs on idle time, never inside a frame. Extracted
// from renderer.ts behind a small host seam (the monolith ratchet); the
// renderer owns one instance and feeds it per-frame timestamps.
//
// English output by design: this feeds the ?perf overlay and hitchReport(),
// a dev diagnostic under the src/game CLAUDE.md perf-overlay carve-out.

import type * as THREE from 'three';

export const RENDER_DIAGNOSTICS_SAMPLE_MS = 2000;
const RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS = 1000;

export type RenderableDiagnosticObject = THREE.Object3D & {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
  isLineSegments?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  count?: number;
};

export interface RenderDiagnosticsCategoryStats {
  objects: number;
  draws: number;
  triangles: number;
  points: number;
  materials: number;
  materialSamples: string[];
}

export interface RenderDiagnosticsSnapshot {
  enabled: boolean;
  totalObjects: number;
  estimatedDraws: number;
  estimatedTriangles: number;
  estimatedPoints: number;
  programs: number;
  programDelta: number;
  textures: number;
  textureDelta: number;
  newMaterials: string[];
  firstVisibleObjects: string[];
  categories: Record<string, RenderDiagnosticsCategoryStats>;
}

export function emptyRenderDiagnosticsSnapshot(): RenderDiagnosticsSnapshot {
  return {
    enabled: false,
    totalObjects: 0,
    estimatedDraws: 0,
    estimatedTriangles: 0,
    estimatedPoints: 0,
    programs: 0,
    programDelta: 0,
    textures: 0,
    textureDelta: 0,
    newMaterials: [],
    firstVisibleObjects: [],
    categories: {},
  };
}

function loopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export function localRenderDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  if (!loopbackHostname(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return (
    params.get('perfTrace') === '1' ||
    params.get('perf_trace') === '1' ||
    params.get('renderTrace') === '1'
  );
}

function materialLabels(material: THREE.Material | THREE.Material[] | undefined): string[] {
  const mats = Array.isArray(material) ? material : material ? [material] : [];
  return mats.map((mat) => `${mat.name || mat.type}:${mat.uuid.slice(0, 8)}`);
}

function drawCountFor(
  material: THREE.Material | THREE.Material[] | undefined,
  geometry?: THREE.BufferGeometry,
): number {
  if (!material) return 1;
  if (Array.isArray(material)) return Math.max(1, geometry?.groups.length || material.length);
  return Math.max(
    1,
    geometry?.groups.length && geometry.groups.length > 0 ? geometry.groups.length : 1,
  );
}

function triangleCountFor(geometry?: THREE.BufferGeometry): number {
  if (!geometry) return 0;
  const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.max(0, Math.floor(drawCount / 3));
}

function objectDiagnosticLabel(obj: THREE.Object3D, category: string, labels: string[]): string {
  const name = obj.name || obj.type;
  const material = labels[0] ?? 'no-material';
  return `${category}:${name}:${material}`.slice(0, 140);
}

export interface RenderDiagnosticsHost {
  /** Live program and texture counters (the renderer maps webgl.info). */
  counters(): { programs: number; textures: number };
  scene(): THREE.Object3D;
  /** Lifecycle generation, read at SCHEDULE time: a queued idle sample from
   *  a dead generation must never write into the next one's snapshot. */
  generation(): number;
  shutdown(): boolean;
  /** Idle scheduling; injectable so tests drive the sample synchronously. */
  scheduleIdle?(run: () => void, timeoutMs: number): void;
}

function defaultScheduleIdle(run: () => void, timeoutMs: number): void {
  const win = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  };
  if (win.requestIdleCallback) win.requestIdleCallback(run, { timeout: timeoutMs });
  else window.setTimeout(run, 100);
}

export class RenderDiagnostics {
  private snapshot = emptyRenderDiagnosticsSnapshot();
  private nextSampleAt = 0;
  private samplePending = false;
  private readonly knownMaterials = new Set<string>();
  private readonly knownVisibleObjects = new Set<string>();
  private lastPrograms = 0;
  private lastTextures = 0;

  constructor(
    private readonly host: RenderDiagnosticsHost,
    readonly enabled = localRenderDiagnosticsEnabled(),
  ) {}

  current(): RenderDiagnosticsSnapshot {
    return this.snapshot;
  }

  collect(): RenderDiagnosticsSnapshot {
    if (!this.enabled) return this.snapshot;
    const { programs, textures } = this.host.counters();
    const programDelta = programs - this.lastPrograms;
    const textureDelta = textures - this.lastTextures;
    this.lastPrograms = programs;
    this.lastTextures = textures;

    type MutableCategoryStats = RenderDiagnosticsCategoryStats & {
      materialKeys: Set<string>;
    };
    const categories: Record<string, MutableCategoryStats> = {};
    const totals = { objects: 0, draws: 0, triangles: 0, points: 0 };
    const newMaterials: string[] = [];
    const firstVisibleObjects: string[] = [];
    const categoryStats = (category: string): MutableCategoryStats => {
      categories[category] ??= {
        objects: 0,
        draws: 0,
        triangles: 0,
        points: 0,
        materials: 0,
        materialSamples: [],
        materialKeys: new Set<string>(),
      };
      return categories[category];
    };
    const visit = (
      obj: THREE.Object3D,
      inheritedCategory: string,
      inheritedVisible: boolean,
    ): void => {
      const visible = inheritedVisible && obj.visible;
      const category =
        typeof obj.userData.renderCategory === 'string'
          ? (obj.userData.renderCategory as string)
          : inheritedCategory;
      if (visible) {
        const renderable = obj as RenderableDiagnosticObject;
        const hasMesh = Boolean(
          renderable.isMesh || renderable.isInstancedMesh || renderable.isSkinnedMesh,
        );
        const hasPoints = Boolean(renderable.isPoints);
        const hasSprite = Boolean(renderable.isSprite);
        const hasLine = Boolean(renderable.isLine || renderable.isLineSegments);
        if (hasMesh || hasPoints || hasSprite || hasLine) {
          const geometry = renderable.geometry;
          const material = renderable.material;
          const stat = categoryStats(category);
          const labels = materialLabels(material);
          const draws = drawCountFor(material, geometry);
          let triangles = 0;
          let pointCount = 0;
          if (hasMesh) {
            const instanceCount = renderable.isInstancedMesh
              ? Math.max(0, renderable.count ?? 0)
              : 1;
            triangles = triangleCountFor(geometry) * instanceCount;
          } else if (hasSprite) {
            triangles = 2;
          } else if (hasPoints) {
            pointCount = geometry?.getAttribute('position')?.count ?? 0;
          }
          stat.objects++;
          stat.draws += draws;
          stat.triangles += triangles;
          stat.points += pointCount;
          totals.objects++;
          totals.draws += draws;
          totals.triangles += triangles;
          totals.points += pointCount;
          for (const label of labels) {
            if (!stat.materialKeys.has(label)) {
              stat.materialKeys.add(label);
              if (stat.materialSamples.length < 8) stat.materialSamples.push(label);
            }
            if (!this.knownMaterials.has(label)) {
              this.knownMaterials.add(label);
              if (newMaterials.length < 16) newMaterials.push(label);
            }
          }
          const visibleKey = `${category}|${obj.uuid}|${geometry?.uuid ?? ''}|${labels.join('|')}`;
          if (!this.knownVisibleObjects.has(visibleKey)) {
            this.knownVisibleObjects.add(visibleKey);
            if (firstVisibleObjects.length < 16)
              firstVisibleObjects.push(objectDiagnosticLabel(obj, category, labels));
          }
        }
      }
      for (const child of obj.children) visit(child, category, visible);
    };
    visit(this.host.scene(), 'unknown', true);

    const outCategories: Record<string, RenderDiagnosticsCategoryStats> = {};
    for (const [category, stat] of Object.entries(categories)) {
      outCategories[category] = {
        objects: stat.objects,
        draws: stat.draws,
        triangles: stat.triangles,
        points: stat.points,
        materials: stat.materialKeys.size,
        materialSamples: stat.materialSamples,
      };
    }
    this.snapshot = {
      enabled: true,
      totalObjects: totals.objects,
      estimatedDraws: totals.draws,
      estimatedTriangles: totals.triangles,
      estimatedPoints: totals.points,
      programs,
      programDelta,
      textures,
      textureDelta,
      newMaterials,
      firstVisibleObjects,
      categories: outCategories,
    };
    return this.snapshot;
  }

  forFrame(now: number, force = false): RenderDiagnosticsSnapshot {
    if (!this.enabled) return this.snapshot;
    if (force) {
      this.collect();
      this.nextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      return this.snapshot;
    }
    if (!this.samplePending && now >= this.nextSampleAt) {
      this.samplePending = true;
      this.nextSampleAt = now + RENDER_DIAGNOSTICS_SAMPLE_MS;
      const generation = this.host.generation();
      const run = (): void => {
        if (this.host.shutdown() || generation !== this.host.generation()) return;
        try {
          this.collect();
        } finally {
          this.samplePending = false;
        }
      };
      (this.host.scheduleIdle ?? defaultScheduleIdle)(run, RENDER_DIAGNOSTICS_IDLE_TIMEOUT_MS);
    }
    return this.snapshot;
  }
}
