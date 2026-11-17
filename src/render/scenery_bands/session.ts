import * as THREE from 'three';
import { ZONES } from '../../sim/data';
import {
  type BackgroundGpuQueue,
  GPU_WORK_PRIORITY,
  isGpuQueueShutdown,
} from '../background_gpu_queue';
import { compileTargetPrepared } from '../compile_target_readiness';
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
import { lowSceneryBandMaterial, lowSceneryBandMaterialCurrent } from './material';
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
/** The replacement bands of one preparation window, committed as soon as
 *  they are built. */
interface Prepared {
  roots: ReadonlySet<THREE.Object3D>;
  x: number;
  z: number;
  items: SceneryPlacement[];
  bands: SceneryBand[];
  selected: Uint8Array[];
  /** This window's giant-tree objects of roots the current sprites did not
   *  collect (streamed in after their window was prepared). Each stays native
   *  on its own until sprites holding it land (cutting it at 60 yd would drop
   *  it from the view); the rest of its root keeps its bands. A giant of a
   *  root the sprites did collect is not lagging even when they lack it:
   *  inside their coverage such a giant is past the fog (giantsCover), and
   *  counting it rebaked the sprites at almost every window while walking
   *  into a zone with giants. Replaced by a smaller set when sprites land. */
  giantsLag: ReadonlySet<THREE.Object3D>;
  /** This window's giant trees, their landmark objects and each object's
   *  root: what a giant bake started for it collects into sprites. */
  giantItems: SceneryPlacement[];
  giantObjects: ReadonlySet<THREE.Object3D>;
  giantRoots: ReadonlyMap<THREE.Object3D, THREE.Object3D>;
  /** The session band materials this window's bands draw with. */
  materials: ReadonlySet<THREE.Material>;
  dispose(): void;
}
/** The giant-tree sprites, baked by their own job beside the band windows:
 *  the atlas bake is the slowest step by far (30 s for the giants of a zone
 *  streaming in on the reference phone), and band windows that waited for it
 *  stalled behind a walking player. The previous sprites keep covering the
 *  view while it runs (giantsCover); a giant they lack stays native. */
interface PreparedGiants {
  x: number;
  z: number;
  /** The roots their window collected from. */
  roots: ReadonlySet<THREE.Object3D>;
  items: SceneryPlacement[];
  giants: GiantSprites;
  selected: Uint8Array;
  dispose(): void;
}
/** Collection radius of a preparation window (yd). */
const WINDOW_RADIUS = 630;
/** How far the camera may move from the bands' centre before they stop
 *  covering the near-to-middle ring. */
const BANDS_VALID_YD = 64;
/** How far it moves before the next window is prepared. */
const REPREPARE_YD = 32;
/** How far the camera may move from the giant sprites' centre before a window
 *  bakes new ones, at most: the bake is seconds of atlas work (25 s for Veiled
 *  Hollow's giants on the reference phone), so it starts well inside the
 *  sprites' coverage instead of every window. */
const GIANTS_REBAKE_YD = 128;
/** How long a failed giant bake waits before trying again, doubling per
 *  consecutive failure up to GIANTS_RETRY_MAX_MS. */
const GIANTS_RETRY_MS = 10_000;
const GIANTS_RETRY_MAX_MS = 160_000;
/** A bake still pending after this long is abandoned so it cannot hold every
 *  later one (the slowest measured, Veiled Hollow on the reference phone,
 *  took 30 s). */
const GIANTS_BAKE_TIMEOUT_MS = 120_000;
/** The camera re-enters the sprites' coverage this far inside its edge, so a
 *  camera hovering on the edge does not swap giant trees between sprites and
 *  native drawing (and repack the near sources) frame after frame. */
const GIANTS_COVER_HYSTERESIS_YD = 8;
/** How often the window on screen checks its band materials against their
 *  sources (a leaf atlas that lands while the camera stands still). */
const BAND_SOURCE_CHECK_MS = 2000;
const NONE: ReadonlySet<THREE.Object3D> = new Set();

function materialsUnder(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) materials.push(...mesh.material);
    else materials.push(mesh.material);
  });
  return materials;
}

/** Whether giant sprites collected around (gx, gz) still hold every giant a
 *  camera at (x, z) can see out to `maxDistance` (the fog far). The previous
 *  window's sprites therefore keep drawing while the next atlas bakes, and a
 *  window with its own sprites always covers within BANDS_VALID_YD of its
 *  centre (64 plus the 560 yd fog cap fits inside the 630 yd window). */
export function giantsCover(
  gx: number,
  gz: number,
  x: number,
  z: number,
  maxDistance: number,
  margin = 0,
): boolean {
  return Math.hypot(x - gx, z - gz) <= giantsCoverYd(maxDistance) - margin;
}
function giantsCoverYd(maxDistance: number): number {
  return Math.max(BANDS_VALID_YD, WINDOW_RADIUS - maxDistance);
}

/** Whether a window at (x, z) bakes new giant sprites over sprites centred at
 *  (gx, gz): once the camera is past half their coverage (at most
 *  GIANTS_REBAKE_YD), so the bake has the other half to land in. */
export function giantsRebakeDue(
  gx: number,
  gz: number,
  x: number,
  z: number,
  maxDistance: number,
): boolean {
  return Math.hypot(x - gx, z - gz) > Math.min(GIANTS_REBAKE_YD, giantsCoverYd(maxDistance) / 2);
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
  private currentGiants?: PreparedGiants;
  private pending = false;
  private giantsPending = false;
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
  private capShort?: ReadonlySet<THREE.Object3D>;
  /** One Low replacement material per source material, kept for the session:
   *  every window's bands then reuse linked programs, so a band gate whose
   *  programs and textures are all ready is skipped (bandGate). */
  private bandMaterials = new Map<THREE.Material, THREE.Material>();
  /** Band materials replaced after their source changed. The window on screen
   *  may still draw one, so they are disposed with the session; at most one
   *  per late source texture. */
  private retiredBandMaterials: THREE.Material[] = [];
  /** The current window's giant-tree objects the held sprites do not serve
   *  at the camera (giantsShort), and the roots holding them; refreshed by
   *  update. */
  private shortObjects: ReadonlySet<THREE.Object3D> = NONE;
  private shortRoots: ReadonlySet<THREE.Object3D> = NONE;
  private giantsInside = false;
  private giantsRetryAt = 0;
  private giantsFailures = 0;
  private giantsGeneration = 0;
  private giantsStartedAt = 0;
  /** Rejects every await of the bake in flight, so an abandoned bake that
   *  is stuck still releases what it baked (buildGiantSprites cleanup). */
  private abortGiants?: () => void;
  private sourceCheckAt = 0;
  /** Replacement roots the current window does not hold: drawn natively. */
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
      if (this.roots.has(root) && this.exempt(root)) return distance;
    }
    const camera = this.getHost().camera.position;
    return this.covers(camera.x, camera.z) ? Math.min(distance, 60) : distance;
  }

  /** A replacement root the prepared bands do not hold yet (wholly native),
   *  or one holding a giant tree the sprites do not serve: its sweep keeps the
   *  native horizon so that giant stays in view, while the near sources still
   *  cap its other objects and its bands draw them. */
  private exempt(root: THREE.Object3D): boolean {
    return isSceneryReplacementRoot(root.name) && (this.unheld(root) || this.shortRoots.has(root));
  }

  private unheld(root: THREE.Object3D): boolean {
    return isSceneryReplacementRoot(root.name) && !this.current?.roots.has(root);
  }

  /** The current window's giant-tree objects the held sprites do not serve
   *  at (x, z): all of them while there are no sprites or the camera is past
   *  their coverage (with hysteresis), else the ones they lack. Each stays
   *  native on its own; every other object keeps its bands, so a slow giant
   *  bake never restores the distant population. Giant trees are landmarks of
   *  non-foliage roots only (collect.ts), whose objects the near sources
   *  own. */
  private giantsShort(x: number, z: number, maxDistance: number): ReadonlySet<THREE.Object3D> {
    const current = this.current;
    if (!current) return NONE;
    const giants = this.currentGiants;
    this.giantsInside =
      !!giants &&
      giantsCover(
        giants.x,
        giants.z,
        x,
        z,
        maxDistance,
        this.giantsInside ? 0 : GIANTS_COVER_HYSTERESIS_YD,
      );
    const short = this.giantsInside ? current.giantsLag : current.giantObjects;
    return short.size ? short : NONE;
  }

  /** Refresh which giant trees the sprites miss, the roots holding them and
   *  the roots wholly native, for a camera at (x, z). The renderer's sweep
   *  reads these (cullFar) before the next update, so a window commit and a
   *  sprite landing refresh them at once: a stale set let a giant's root be
   *  cut at 60 yd for a frame. Sets are replaced only when their contents
   *  change, because each new identity repacks the near sources. */
  private refreshCoverage(x: number, z: number, maxDistance: number): void {
    this.shortObjects = this.giantsShort(x, z, maxDistance);
    if (this.capShort !== this.shortObjects) {
      this.capShort = this.shortObjects;
      this.shortRoots = this.rootsHolding(this.shortObjects);
    }
    if (this.capRevision !== this.revision || this.capPrepared !== this.current) {
      this.capRevision = this.revision;
      this.capPrepared = this.current;
      const unheld = [...this.roots].filter((root) => this.unheld(root));
      if (
        unheld.length !== this.exemptRoots.size ||
        unheld.some((root) => !this.exemptRoots.has(root))
      )
        this.exemptRoots = new Set(unheld);
    }
  }

  private refreshCoverageAtCamera(host: SceneryBandsHost): void {
    const camera = host.camera.position;
    this.refreshCoverage(camera.x, camera.z, this.maxDistance(host));
  }

  /** The registered roots holding `objects`. */
  private rootsHolding(objects: ReadonlySet<THREE.Object3D>): ReadonlySet<THREE.Object3D> {
    if (!objects.size) return NONE;
    const roots = new Set<THREE.Object3D>();
    for (const object of objects)
      for (let node: THREE.Object3D | null = object; node; node = node.parent)
        if (this.roots.has(node)) {
          roots.add(node);
          break;
        }
    return roots;
  }

  /** The prepared bands cover a camera at (x, z). */
  private covers(x: number, z: number): boolean {
    const current = this.current;
    if (!current || this.uncoveredFoliage) return false;
    return Math.hypot(x - current.x, z - current.z) <= BANDS_VALID_YD;
  }

  /** The fog far the bands draw under: installFog caps it at fadeEnd while
   *  they are active, and selection never reaches past it. */
  private maxDistance(host: SceneryBandsHost): number {
    const fog = host.scene.fog;
    return fog instanceof THREE.Fog
      ? Math.min(fog.far, LOW_SCENERY_BUDGET.fadeEnd)
      : LOW_SCENERY_BUDGET.fadeEnd;
  }

  update(x: number, z: number): void {
    if (this.disposed || this.sourceFailed) return;
    const host = this.getHost();
    if (host.outdoor?.() === false) {
      this.active = false;
      this.near.update(x, z, 0);
      for (const band of this.current?.bands ?? []) band.root.visible = false;
      if (this.currentGiants) this.currentGiants.giants.root.visible = false;
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
      this.currentGiants?.dispose();
      this.currentGiants = undefined;
      this.disposeBandMaterials();
      this.near.dispose();
      this.restoreFog?.();
      this.error = String(error);
      console.warn('[scenery-bands] retained native scenery', error);
      return;
    }
    const current = this.current;
    const giants = this.currentGiants;
    const maxDistance = this.maxDistance(host);
    this.refreshCoverage(x, z, maxDistance);
    this.active = this.covers(x, z);
    // A streamed root stays native until covered; existing prepared roots
    // retain their cheap bands throughout that root's asynchronous gate, and a
    // giant tree the sprites miss stays native on its own.
    this.near.update(x, z, this.active ? 60 : 0, this.exemptRoots, this.shortObjects);
    if (current) {
      for (const selected of current.selected) selected.fill(0);
      if (this.active) {
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
      }
      for (let i = 0; i < current.bands.length; i++) current.bands[i].select(current.selected[i]);
    }
    if (giants) {
      giants.selected.fill(0);
      if (this.active) {
        for (let i = 0; i < giants.items.length; i++) {
          const item = giants.items[i];
          if (
            !this.sourceOwns(item) &&
            lowSceneryRepresentation(item, x, z, true, maxDistance) === 'sprite'
          )
            giants.selected[i] = 1;
        }
      }
      giants.giants.update(giants.selected, x, z);
    }
    const now = performance.now();
    if (current && !this.pending && now >= this.sourceCheckAt) {
      this.sourceCheckAt = now + BAND_SOURCE_CHECK_MS;
      if (this.bandSourcesChanged(current)) this.dirty = true;
    }
    if (
      !this.pending &&
      (this.dirty ||
        (!this.error && (!current || Math.hypot(x - current.x, z - current.z) >= REPREPARE_YD)))
    )
      void this.prepare(x, z, host);
    if (this.giantsPending && now - this.giantsStartedAt > GIANTS_BAKE_TIMEOUT_MS)
      this.abandonGiants();
    // A bake cancelled indoors resumes here once outdoors, and a failed one
    // after its backoff, without waiting for the camera to move on.
    if (current) this.maybeBakeGiants(current, host);
  }

  /** Whether a band material the window on screen draws no longer matches
   *  its source, so the next window must rebuild it (bandMaterial). */
  private bandSourcesChanged(current: Prepared): boolean {
    for (const [source, material] of this.bandMaterials)
      if (current.materials.has(material) && !lowSceneryBandMaterialCurrent(material, source))
        return true;
    return false;
  }

  private bandMaterial(source: THREE.Material): THREE.Material {
    // A window still building after the session let go must not refill it.
    if (this.disposed || this.sourceFailed) throw new Error('Scenery registration changed');
    let material = this.bandMaterials.get(source);
    if (material && !lowSceneryBandMaterialCurrent(material, source)) {
      this.retiredBandMaterials.push(material);
      material = undefined;
    }
    if (!material) {
      material = lowSceneryBandMaterial(source);
      // Named so a live link or a leak in a capture names its owner.
      material.name = `scenery-band:low:${source.name}`;
      this.bandMaterials.set(source, material);
    } else {
      const color = (source as THREE.MeshLambertMaterial).color;
      if (color) (material as THREE.MeshLambertMaterial).color.copy(color);
    }
    return material;
  }

  /** A window's band reuses the session's materials, so after the first
   *  window its programs are usually linked and its textures resident. The
   *  gate is then skipped: in the paced deferred mode even an all-cached
   *  gate queued behind a streaming zone's links for 5 to 8 s on the
   *  reference phone, and the window expired meanwhile. Anything unproven
   *  (a new source material, a program still linking) takes the gate, and so
   *  does a material neither in the current window (assigned to its bands,
   *  drawn while selected) nor proven by this window's own gates: a program
   *  proven long ago may be the wrong variant for today's lights. */
  private async bandGate(
    host: SceneryBandsHost,
    root: THREE.Group,
    proven: Set<THREE.Material>,
  ): Promise<void> {
    const materials = materialsUnder(root);
    const drawn = this.current?.materials;
    const properties = host.webgl.properties;
    if (
      properties &&
      materials.every((material) => proven.has(material) || !!drawn?.has(material)) &&
      compileTargetPrepared(properties, root)
    )
      return;
    await host.gate(root);
    for (const material of materials) proven.add(material);
  }

  private sourceOwns(item: SceneryPlacement): boolean {
    // The sweep may hide the root while near keeps the object's own flag (a
    // giant the sprites miss, a frame before the sets refresh): the native
    // draw then does not happen, so the replacement must.
    if (item.kind === 'landmark') return item.owner.visible && !!item.owner.parent?.visible;
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
    let bandsCommitted = false;
    const materials = new Set<THREE.Material>();
    const proven = new Set<THREE.Material>();
    // A root registered meanwhile does not cancel the window: it is prepared
    // for the roots it started with, a later root stays native until the next
    // window covers it (exemptRoots, cullFar), and that window follows at once
    // (dirty). Cancelling threw away seconds of queued gate waits per streamed
    // zone on the phone, three times in a row while walking into Thornpeak.
    const cancelled = (): boolean => this.cancelled(host);
    const prepare = <T>(work: () => T | Promise<T>, label: string): Promise<T> =>
      this.queued(host, work, label);
    try {
      const all = await prepare(
        () => collectSceneryPlacements([...roots], x, z, WINDOW_RADIUS, this.authored),
        'scenery-band-collect:placements',
      );
      const items = all.filter((item) => !isGiantTree(item));
      const giantItems = all.filter(isGiantTree);
      const giantObjects = new Set(giantItems.map((item) => item.owner));
      const giantRoots = new Map<THREE.Object3D, THREE.Object3D>();
      for (const object of giantObjects)
        for (let node: THREE.Object3D | null = object; node; node = node.parent)
          if (roots.has(node)) {
            giantRoots.set(object, node);
            break;
          }
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
            material: (source) => {
              const material = this.bandMaterial(source);
              materials.add(material);
              return material;
            },
            ownsMaterials: false,
            localCoordinates: false,
            prepare,
            gate: (root) => this.bandGate(host, root, proven),
            cancelled,
          }),
        );
      }
      if (cancelled()) throw new Error('Scenery registration changed');
      // Commit the bands now, never behind a giant bake: holding them for one
      // let a walking player outrun the window, and every distant source was
      // then drawn natively until it landed.
      const readyBands: Prepared = {
        roots,
        x,
        z,
        items,
        bands,
        selected: bands.map(() => new Uint8Array(items.length)),
        giantsLag: new Set(
          [...giantObjects].filter(
            (object) => !this.currentGiants?.roots.has(giantRoots.get(object) as THREE.Object3D),
          ),
        ),
        giantItems,
        giantObjects,
        giantRoots,
        materials,
        dispose: () => {
          for (const band of bands) band.dispose();
        },
      };
      for (const band of bands) host.scene.add(band.root);
      const previous = this.current;
      this.current = readyBands;
      bandsCommitted = true;
      this.stage = 'ready';
      this.uncoveredFoliage = [...this.roots].some(
        (root) => root.name === 'foliage' && !roots.has(root),
      );
      this.dirty = revision !== this.revision;
      this.error = null;
      this.refreshCoverageAtCamera(host);
      previous?.dispose();
      this.maybeBakeGiants(readyBands, host);
    } catch (error) {
      if (bandsCommitted) {
        // The window is on screen; only its retirement work failed.
        console.warn('[scenery-bands] committed window with an error', error);
        return;
      }
      for (const band of bands) band.dispose();
      // The session let go while this window's gate ran: the gate may have
      // relinked materials disposeBandMaterials already released, and a
      // band built with ownsMaterials false never disposes them, so release
      // their programs again now that the gate has settled.
      if (this.disposed || this.sourceFailed) for (const material of materials) material.dispose();
      if (!cancelled() && !isGpuQueueShutdown(error)) {
        this.error = String(error);
        this.stage = 'failed';
        this.dirty = revision !== this.revision;
        console.warn('[scenery-bands] retained previous scenery', error);
      }
    } finally {
      this.pending = false;
    }
  }

  private cancelled(host: SceneryBandsHost): boolean {
    return this.disposed || this.sourceFailed || host.outdoor?.() === false;
  }

  private queued<T>(host: SceneryBandsHost, work: () => T | Promise<T>, label: string): Promise<T> {
    return this.queue.run(
      () => {
        if (this.cancelled(host)) throw new Error('Scenery registration changed');
        return work();
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      label,
    );
  }

  /** Start a giant bake for `window` when its sprites are missing, lack one
   *  of its roots, or the camera is past half their coverage. One bake runs
   *  at a time; the newest window is reconsidered when it ends. */
  private maybeBakeGiants(window: Prepared, host: SceneryBandsHost): void {
    if (this.giantsPending || this.cancelled(host)) return;
    const held = this.currentGiants;
    if (
      held &&
      !window.giantsLag.size &&
      !giantsRebakeDue(held.x, held.z, window.x, window.z, this.maxDistance(host))
    )
      return;
    if (performance.now() < this.giantsRetryAt) return;
    void this.bakeGiants(window, host);
  }

  /** A bake that never settles must not hold every later one: the next bake
   *  backs off, and this one's late result disposes itself (generation). */
  private abandonGiants(): void {
    this.giantsGeneration++;
    this.giantsPending = false;
    this.abortGiants?.();
    this.abortGiants = undefined;
    this.giantsFailed();
    console.warn('[scenery-bands] abandoned a giant bake that did not settle');
  }

  private giantsFailed(): void {
    this.giantsFailures++;
    this.giantsRetryAt =
      performance.now() +
      Math.min(GIANTS_RETRY_MAX_MS, GIANTS_RETRY_MS * 2 ** (this.giantsFailures - 1));
  }

  private async bakeGiants(window: Prepared, host: SceneryBandsHost): Promise<void> {
    const generation = ++this.giantsGeneration;
    const live = (): boolean => generation === this.giantsGeneration;
    const cancelled = (): boolean => this.cancelled(host) || !live();
    let abort!: (error: Error) => void;
    const aborted = new Promise<never>((_, reject) => {
      abort = reject;
    });
    aborted.catch(() => undefined);
    this.abortGiants = () => abort(new Error('Giant bake abandoned'));
    const abortable = <T>(work: Promise<T>): Promise<T> => {
      const raced = Promise.race([work, aborted]);
      // A raced unit nobody awaits any more must not report an unhandled abort.
      raced.catch(() => undefined);
      return raced;
    };
    this.giantsPending = true;
    this.giantsStartedAt = performance.now();
    let giants: GiantSprites | undefined;
    let landed = false;
    try {
      giants = await buildGiantSprites({
        items: window.giantItems,
        ...host,
        gate: (root) => abortable(host.gate(root)),
        // A queue unit of an abandoned bake does no more work.
        prepare: (work, label) =>
          abortable(
            this.queued(
              host,
              () => {
                if (!live()) throw new Error('Giant bake abandoned');
                return work();
              },
              label,
            ),
          ),
        cancelled,
        prepareBake: (scene, camera, target) =>
          abortable(prepareSceneryAtlas(this.queue, host.webgl, scene, camera, target)),
      });
      if (cancelled()) throw new Error('Scenery registration changed');
      const readyGiants = giants;
      host.scene.add(giants.root);
      const previous = this.currentGiants;
      this.currentGiants = {
        x: window.x,
        z: window.z,
        roots: window.roots,
        items: window.giantItems,
        giants,
        selected: new Uint8Array(window.giantItems.length),
        dispose: () => readyGiants.dispose(),
      };
      landed = true;
      this.giantsFailures = 0;
      previous?.dispose();
      // The bands committed meanwhile may wait on roots these sprites
      // collected. Only shrinking the lag is safe because inside the new
      // sprites' coverage every giant they did not collect is past the fog
      // (giantsCover, maxDistance) and roots are never removed.
      const current = this.current;
      if (current?.giantsLag.size)
        current.giantsLag = new Set(
          [...current.giantsLag].filter(
            (object) => !window.roots.has(current.giantRoots.get(object) as THREE.Object3D),
          ),
        );
      // New sprites, new centre: re-enter them through the hysteresis margin.
      this.giantsInside = false;
      this.refreshCoverageAtCamera(host);
    } catch (error) {
      if (!landed) giants?.dispose();
      if (live() && !this.cancelled(host)) {
        if (isGpuQueueShutdown(error)) {
          // The queue never runs again: stop baking instead of retrying.
          this.giantsRetryAt = Number.POSITIVE_INFINITY;
        } else {
          this.giantsFailed();
          console.warn('[scenery-bands] retained previous giant sprites', error);
        }
      }
    } finally {
      if (live()) {
        this.giantsPending = false;
        this.abortGiants = undefined;
      }
    }
    if (!live()) return;
    // The newest window, when it is not this one (update covers the rest).
    const current = this.current;
    if (current && current !== window) this.maybeBakeGiants(current, host);
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

  private disposeBandMaterials(): void {
    for (const material of this.bandMaterials.values()) material.dispose();
    for (const material of this.retiredBandMaterials) material.dispose();
    this.bandMaterials.clear();
    this.retiredBandMaterials.length = 0;
  }

  snapshot(): object {
    return {
      active: this.active,
      pending: this.pending,
      giantsPending: this.giantsPending,
      giantsFailures: this.giantsFailures,
      giantsStopped: this.giantsRetryAt === Number.POSITIVE_INFINITY,
      error: this.error,
      stage: this.stage,
      near: this.near.snapshot(),
      bands: this.current?.bands.map((band) => band.snapshot()) ?? [],
      giants: this.currentGiants?.giants.snapshot() ?? null,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.restoreFog?.();
    this.current?.dispose();
    this.current = undefined;
    this.currentGiants?.dispose();
    this.currentGiants = undefined;
    this.disposeBandMaterials();
    this.near.dispose();
    this.roots.clear();
  }
}
