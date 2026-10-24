import * as THREE from 'three';
import { ZONES } from '../../sim/data';
import {
  type BackgroundGpuQueue,
  GPU_WORK_PRIORITY,
  isGpuQueueShutdown,
} from '../background_gpu_queue';
import { prepareSceneryAtlas } from './atlas_preparation';
import { buildSceneryBand, type SceneryBand } from './batches';
import {
  type AuthoredInstances,
  collectSceneryPlacements,
  isGiantTree,
  isSceneryReplacementRoot,
} from './collect';
import { SceneryIndexCache } from './geometry';
import { buildGiantSprites, type GiantSprites } from './giants';
import { lowSceneryBandMaterial } from './material';
import { SceneryNearSources } from './near';
import {
  LOW_SCENERY_BUDGET,
  lowSceneryRepresentation,
  palmBudgetTree,
  placementDistance,
} from './policy_core';
import type { SceneryPlacement } from './types';

export interface SceneryBandsHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  webgl: THREE.WebGLRenderer;
  gate(root: THREE.Group): Promise<unknown>;
  outdoor?(): boolean;
}
export interface SceneryBandsRenderer {
  scene: THREE.Scene;
  camera: THREE.Camera;
  webgl: THREE.WebGLRenderer;
  readonly fogState: string;
}
export function sceneryBandsHost(
  renderer: SceneryBandsRenderer,
  gate: (root: THREE.Object3D) => Promise<unknown>,
): SceneryBandsHost {
  return {
    get scene() {
      return renderer.scene;
    },
    get camera() {
      return renderer.camera;
    },
    get webgl() {
      return renderer.webgl;
    },
    gate,
    outdoor: () => renderer.fogState === 'outdoor',
  };
}
interface Prepared {
  roots: ReadonlySet<THREE.Object3D>;
  x: number;
  z: number;
  items: SceneryPlacement[];
  giantItems: SceneryPlacement[];
  bands: SceneryBand[];
  giants: GiantSprites;
  selected: Uint8Array[];
  giantSelected: Uint8Array;
  dispose(): void;
}
const palmZone = ZONES.find((zone) => zone.id === 'palmreach')!;
const palm = { ...palmZone, xMin: palmZone.xMin ?? -180, xMax: palmZone.xMax ?? 180 };

/** Low's measured population/batching port. Register authored sources once;
 * replace a bounded moving preparation window atomically behind its gate. */
export class LowSceneryBands {
  private roots = new Set<THREE.Object3D>();
  private registeredRoots = new WeakSet<THREE.Object3D>();
  private zoneRoots = new WeakSet<THREE.Object3D>();
  private authored = new WeakMap<THREE.Object3D, AuthoredInstances>();
  private near = new SceneryNearSources();
  private indices = new SceneryIndexCache();
  private current?: Prepared;
  private pending = false;
  private disposed = false;
  private sourceFailed = false;
  private dirty = true;
  private revision = 0;
  private active = false;
  private error: string | null = null;
  private stage = 'waiting';
  private restoreFog?: () => void;
  private capRevision = -1;
  private capPrepared?: Prepared;
  private exemptRoots = new Set<THREE.Object3D>();
  private uncoveredFoliage = false;

  constructor(
    private readonly queue: Pick<BackgroundGpuQueue, 'run'>,
    private readonly getHost: () => SceneryBandsHost,
  ) {}

  registerMesh(mesh: THREE.Mesh): void {
    if (this.disposed || this.authored.has(mesh)) return;
    const instance = mesh as THREE.InstancedMesh;
    if (!instance.isInstancedMesh || !instance.count) return;
    this.authored.set(mesh, {
      count: instance.count,
      matrices: Float32Array.from(instance.instanceMatrix.array),
      colors: instance.instanceColor ? Float32Array.from(instance.instanceColor.array) : null,
    });
  }
  registerRoot(root: THREE.Object3D, zoneFeature = false): void {
    if (this.disposed || this.roots.has(root)) return;
    if (zoneFeature) this.zoneRoots.add(root);
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) this.registerMesh(node as THREE.Mesh);
    });
    this.roots.add(root);
    // Other zone dressing participates in the original-scene cutoff, but
    // contributes no replacement geometry. It must not invalidate ready
    // tree/rock bands and temporarily restore the whole distant population.
    if (!isSceneryReplacementRoot(root.name)) return;
    if (root.name === 'foliage') this.uncoveredFoliage = true;
    this.dirty = true;
    this.revision++;
  }
  ownsMesh(mesh: THREE.Object3D): boolean {
    return this.authored.has(mesh);
  }
  cullFar(distance: number, group?: THREE.Object3D): number {
    if (this.getHost().outdoor?.() === false) return distance;
    // Cull groups may be children of a registered source. Until its replacement
    // gate completes, preserve the native sweep horizon for that source only.
    for (let root = group; root; root = root.parent ?? undefined) {
      if (
        this.roots.has(root) &&
        isSceneryReplacementRoot(root.name) &&
        !this.current?.roots.has(root)
      )
        return distance;
    }
    const camera = this.getHost().camera.position;
    const ready =
      this.current &&
      !this.uncoveredFoliage &&
      Math.hypot(camera.x - this.current.x, camera.z - this.current.z) <= 64;
    return ready ? Math.min(distance, 60) : distance;
  }

  update(x: number, z: number): void {
    if (this.disposed || this.sourceFailed) return;
    const host = this.getHost();
    if (host.outdoor?.() === false) {
      this.active = false;
      this.near.update(x, z, 0);
      for (const band of this.current?.bands ?? []) band.root.visible = false;
      if (this.current) this.current.giants.root.visible = false;
      return;
    }
    if (host.webgl.shadowMap.enabled) return;
    if (!this.restoreFog) this.installFog(host);
    for (const root of host.scene.children)
      if (root.name === 'foliage' && !this.roots.has(root)) this.registerRoot(root);
    try {
      for (const root of this.roots) {
        if (this.registeredRoots.has(root) || !root.parent) continue;
        // Renderer registration freezes static roots before the first update.
        if (root.name !== 'foliage') this.near.register(root, this.zoneRoots.has(root));
        this.registeredRoots.add(root);
      }
    } catch (error) {
      // A new unsupported producer keeps its native rendering. It must not
      // throw from the game frame, leave a half-packed source or attach a
      // pending replacement after this session has declined ownership.
      this.sourceFailed = true;
      this.active = false;
      this.current?.dispose();
      this.current = undefined;
      this.near.dispose();
      this.restoreFog?.();
      this.error = String(error);
      console.warn('[scenery-bands] retained native scenery', error);
      return;
    }
    const current = this.current;
    this.active =
      !!current && !this.uncoveredFoliage && Math.hypot(x - current.x, z - current.z) <= 64;
    if (this.capRevision !== this.revision || this.capPrepared !== current) {
      this.capRevision = this.revision;
      this.capPrepared = current;
      this.exemptRoots = new Set(
        [...this.roots].filter(
          (root) => isSceneryReplacementRoot(root.name) && !current?.roots.has(root),
        ),
      );
    }
    // A streamed root stays native until covered; existing prepared roots
    // retain their cheap bands throughout that root's asynchronous gate.
    this.near.update(x, z, this.active ? 60 : 0, this.exemptRoots);
    if (current) {
      for (const selected of current.selected) selected.fill(0);
      current.giantSelected.fill(0);
      if (this.active) {
        const maxDistance =
          host.scene.fog instanceof THREE.Fog ? host.scene.fog.far : LOW_SCENERY_BUDGET.fadeEnd;
        for (let i = 0; i < current.items.length; i++) {
          const item = current.items[i];
          if (this.sourceOwns(item)) continue;
          const representation = lowSceneryRepresentation(item, x, z, false, maxDistance);
          const band =
            representation === 'middle'
              ? 0
              : representation === 'far'
                ? 1
                : representation === 'outer'
                  ? 2
                  : -1;
          if (band >= 0) current.selected[band][i] = 1;
        }
        for (let i = 0; i < current.giantItems.length; i++) {
          const item = current.giantItems[i];
          if (
            !this.sourceOwns(item) &&
            lowSceneryRepresentation(item, x, z, true, maxDistance) === 'sprite'
          )
            current.giantSelected[i] = 1;
        }
      }
      for (let i = 0; i < current.bands.length; i++) current.bands[i].select(current.selected[i]);
      current.giants.update(current.giantSelected, x, z);
    }
    if (
      !this.pending &&
      (this.dirty || (!this.error && (!current || Math.hypot(x - current.x, z - current.z) >= 32)))
    )
      void this.prepare(x, z, host);
  }

  private sourceOwns(item: SceneryPlacement): boolean {
    if (item.kind === 'landmark') return item.owner.visible;
    if (item.kind !== 'zone-instance') return false;
    return item.parts.some(
      (part) =>
        this.near.retains(part.source, part.index!) ??
        (part.source.visible && !!part.source.parent?.visible),
    );
  }

  private async prepare(x: number, z: number, host: SceneryBandsHost): Promise<void> {
    this.pending = true;
    this.stage = 'collect';
    const revision = this.revision;
    const roots = new Set(this.roots);
    const bands: SceneryBand[] = [];
    let giants: GiantSprites | undefined;
    const cancelled = (): boolean =>
      this.disposed ||
      this.sourceFailed ||
      revision !== this.revision ||
      host.outdoor?.() === false;
    const prepare = <T>(work: () => T | Promise<T>, label: string): Promise<T> =>
      this.queue.run(
        () => {
          if (cancelled()) throw new Error('Scenery registration changed');
          return work();
        },
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        label,
      );
    try {
      const all = await prepare(
        () => collectSceneryPlacements([...roots], x, z, 630, this.authored),
        'scenery-band-collect:placements',
      );
      const items = all.filter((item) => !isGiantTree(item));
      const giantItems = all.filter(isGiantTree);
      for (const [index, name] of ['middle', 'far', 'outer'].entries()) {
        this.stage = name;
        bands.push(
          await buildSceneryBand({
            name: `scenery-band:${name}`,
            cache: this.indices,
            items,
            include: (item) => placementDistance(item, x, z) <= [190, 310, 630][index],
            reduction: (item, part) => {
              const matName = part.source.material.name;
              const regional = palmBudgetTree(item.x, item.z, item.owner.name, matName, palm);
              const isBark = /^Bark_/i.test(matName);
              if (item.owner.name === 'jungle-features' && matName === 'Atlas') {
                return { triangles: 256, mode: 'palm' };
              }
              if (index === 0) {
                if (isBark) return { triangles: 48, mode: 'coarse' };
                return { triangles: regional ? 256 : 512, mode: regional ? 'palm' : 'quality' };
              }
              const isLeaf = /leaves|foliage|canopy|needle|palm|frond|bush|fern|vine/i.test(
                matName,
              );
              return {
                triangles: index === 1 ? (isLeaf ? 64 : 24) : isLeaf ? 24 : 12,
                mode: 'coarse',
              };
            },
            material: lowSceneryBandMaterial,
            localCoordinates: false,
            prepare,
            gate: async (root) => {
              await host.gate(root);
            },
            cancelled,
          }),
        );
      }
      this.stage = 'giants';
      giants = await buildGiantSprites({
        items: giantItems,
        ...host,
        prepare,
        cancelled,
        prepareBake: (scene, camera, target) =>
          prepareSceneryAtlas(this.queue, host.webgl, scene, camera, target),
      });
      if (cancelled()) throw new Error('Scenery registration changed');
      const readyGiants = giants;
      const ready: Prepared = {
        roots,
        x,
        z,
        items,
        giantItems,
        bands,
        giants,
        selected: bands.map(() => new Uint8Array(items.length)),
        giantSelected: new Uint8Array(giantItems.length),
        dispose: () => {
          for (const band of bands) band.dispose();
          readyGiants.dispose();
        },
      };
      for (const band of bands) host.scene.add(band.root);
      host.scene.add(giants.root);
      const previous = this.current;
      this.current = ready;
      this.uncoveredFoliage = false;
      this.dirty = false;
      this.error = null;
      this.stage = 'ready';
      previous?.dispose();
    } catch (error) {
      for (const band of bands) band.dispose();
      giants?.dispose();
      if (!cancelled() && !isGpuQueueShutdown(error)) {
        this.error = String(error);
        this.stage = 'failed';
        this.dirty = false;
        console.warn('[scenery-bands] retained previous scenery', error);
      }
    } finally {
      this.pending = false;
    }
  }

  private installFog(host: SceneryBandsHost): void {
    const original = host.webgl.render;
    const owner = this;
    function render(this: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): void {
      const fog = scene === host.scene ? host.scene.fog : null;
      if (!owner.active || host.outdoor?.() === false || !(fog instanceof THREE.Fog)) {
        original.call(this, scene, camera);
        return;
      }
      const { near, far } = fog;
      fog.near = Math.min(near, 320);
      fog.far = Math.min(far, 560);
      try {
        original.call(this, scene, camera);
      } finally {
        fog.near = near;
        fog.far = far;
      }
    }
    host.webgl.render = render;
    this.restoreFog = () => {
      if (host.webgl.render === render) host.webgl.render = original;
    };
  }

  snapshot(): object {
    return {
      active: this.active,
      pending: this.pending,
      error: this.error,
      stage: this.stage,
      near: this.near.snapshot(),
      bands: this.current?.bands.map((band) => band.snapshot()) ?? [],
      giants: this.current?.giants.snapshot() ?? null,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.restoreFog?.();
    this.current?.dispose();
    this.near.dispose();
    this.roots.clear();
  }
}
