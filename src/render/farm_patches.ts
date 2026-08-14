// The farm patch renderer: the static garden beds and compost bins everyone
// sees, plus the growth-stage meshes only the VIEWER'S OWN plots carry.
//
// Two halves, on purpose, because they have different lifetimes and different
// audiences:
//  - buildFarmPatchProps() is STATIC world furniture built once per renderer
//    lifecycle from IWorld.farmPatches (23 beds and 4 bins across 4 patches),
//    instanced per (kind x patch) exactly like stations.ts.
//  - FarmPatchVisuals is PER-VIEWER: it mirrors IWorld.myFarmPlots, which is
//    the caller's own plot rows and nobody else's, so a bed a stranger planted
//    stays bare to us. The rift_death_zone.ts idiom: sync() keyed by a content
//    signature creates, updates and disposes; update(dt) does per-frame writes
//    only and allocates nothing.
//
// NO COLLIDER AND NO GROUND PAD, deliberately: beds are decorative, walkable
// and non-blocking, the same ruling gather_nodes.ts and stations.ts already
// take for seated props, and tests/farm_patch_placement.test.ts has already
// guaranteed every bed sits on legal flat ground.
//
// FAIRNESS: the beds and the growth-stage meshes are ACTIONABLE (a player
// walks to a bed because it looks ready), so they draw at every graphics tier
// and read no preset, tier knob or FPS governor. The plant, harvest and wither
// flourishes are COSMETIC and go out through vfx.ts, whose scaledCount path IS
// the tier shed; there is no bespoke knob here.
import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import { terrainHeight } from '../sim/world';
import type { FarmPatchDef, FarmPlotView } from '../world_api/farming';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  FARM_ACCENT_MATERIAL_NAME,
  FARM_ACCENT_MESH_NAME,
  FARM_BED_MODEL_URL,
  FARM_COMPOST_BIN_MODEL_URL,
  FARM_SOIL_SOCKET_NAME,
  type FarmCropFamily,
  type FarmPlotVisual,
  type FarmPlotVisualKey,
  type FarmStageMesh,
  type FarmWetBand,
  farmBiomePalette,
  farmCompostBinPosition,
  farmModelUrls,
  farmPlotKeyMatches,
  farmStageModelUrl,
  resolveFarmPlotVisual,
} from './farm_patches_core';
import { surfaceMat } from './gfx';
import { addInstancedParts, type GlbTemplatePart, glbTemplateParts } from './glb_instanced_props';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { setRenderCategory } from './renderer_diagnostics';

/**
 * How long between plot-set reads, in seconds. The growth stages and the wet
 * bands are both banded in MINUTES, so a twice-a-second read cannot miss a
 * transition a player could notice, and a farm event forces an immediate one.
 *
 * FAIRNESS: this is a fixed wall-clock cadence, identical on every graphics
 * preset and every machine. It is not a tier knob and must never become one.
 */
const FARM_SYNC_INTERVAL_S = 0.5;

// Half-step (yd) used to finite-difference the local ground slope under each
// bed, so a bed tilts with the terrain (the stations.ts artisan_row idiom).
const PITCH_SAMPLE_STEP = 0.4;
// Target heights (yd) each GLB is normalized to, so authored-scale differences
// between exports never leak into the placements.
const BED_HEIGHT = 0.35;
const BIN_HEIGHT = 1.1;
const STAGE_HEIGHT: Readonly<Record<FarmStageMesh, number>> = Object.freeze({
  sprout: 0.18,
  stage2: 0.42,
  stage3: 0.75,
  stage4: 1.0,
  withered: 0.55,
});
// How much darker damp soil reads than dry, per wet band. Multiplied into the
// bed's own biome soil tint, so a watered Mirefen bed still reads as Mirefen.
const WET_SOIL_DARKEN: Readonly<Record<FarmWetBand, number>> = Object.freeze({
  0: 1,
  1: 0.86,
  2: 0.72,
});
// Where a stage mesh sits when the bed GLB carries no Socket_Soil node.
const SOIL_SOCKET_FALLBACK_Y = 0.3;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// RESIDENCY, stated on purpose (the Phase 7 QA deferral): these 15 scenes are
// retained for the whole session, never released. The templates serve every
// later plot create and the soil-socket resolve, so releasing them buys
// nothing back; the loader's own gltfCache redundantly retains the 15 gltf
// wrappers on top, bounded and accepted (calling releaseGltf in the .then
// would drop only the wrapper refs and must first prove no other consumer
// shares these URLs).
const loadedFarmGltf = new Map<string, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const url of farmModelUrls()) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        loadedFarmGltf.set(url, gltf.scene);
      }),
    );
  }
}

/** Test-only window into the preload asset set. */
export const farmPatchesPreloadInternalsForTest = {
  modelUrls: farmModelUrls(),
  bedUrl: FARM_BED_MODEL_URL,
  binUrl: FARM_COMPOST_BIN_MODEL_URL,
  /** Test-only: inject a loaded scene so a Node suite can exercise the
   *  GLB-loaded arm (the preload block above is window-gated and never runs
   *  headless). Pair with clearLoaded() so suites cannot leak into each
   *  other. */
  setLoaded(url: string, scene: THREE.Group): void {
    loadedFarmGltf.set(url, scene);
  },
  clearLoaded(): void {
    loadedFarmGltf.clear();
  },
};

// Local ground normal at (x, z), from a finite-difference terrainHeight sample.
function groundNormal(x: number, z: number, seed: number): THREE.Vector3 {
  const s = PITCH_SAMPLE_STEP;
  const hPX = terrainHeight(x + s, z, seed);
  const hNX = terrainHeight(x - s, z, seed);
  const hPZ = terrainHeight(x, z + s, seed);
  const hNZ = terrainHeight(x, z - s, seed);
  return new THREE.Vector3(-(hPX - hNX) / (2 * s), 1, -(hPZ - hNZ) / (2 * s)).normalize();
}

/**
 * The mesh primitives of one authored farm GLB, height-normalized, via the
 * shared glb_instanced_props kernel (the stations idiom): a primitive-box
 * fallback draws from the first frame, never waiting on an asset.
 */
function templateParts(
  url: string,
  targetHeight: number,
  fallbackColor: number,
): GlbTemplatePart[] {
  return glbTemplateParts(loadedFarmGltf.get(url), targetHeight, {
    fallbackWidthFactor: 2.2,
    makeFallbackMat: () => surfaceMat({ color: fallbackColor }),
    accentMeshName: FARM_ACCENT_MESH_NAME,
    accentMaterialName: FARM_ACCENT_MATERIAL_NAME,
  });
}

/** The soil socket's LOCAL offset inside a height-normalized bed, or the
 *  fallback lift when the export carries no socket node. */
function soilSocketOffset(): number {
  const bed = loadedFarmGltf.get(FARM_BED_MODEL_URL);
  if (!bed) return SOIL_SOCKET_FALLBACK_Y;
  const socket = bed.getObjectByName(FARM_SOIL_SOCKET_NAME);
  if (!socket) return SOIL_SOCKET_FALLBACK_Y;
  bed.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bed);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 1e-4 ? BED_HEIGHT / rawHeight : 1;
  const world = new THREE.Vector3();
  socket.getWorldPosition(world);
  return (world.y - box.min.y) * scale;
}

/** A bed's world seat: the terrain height at its (x, z) plus the tilt that
 *  matches the local ground normal. */
export interface FarmBedSeat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly quat: THREE.Quaternion;
  readonly patchId: string;
  readonly zoneId: string;
}

export interface FarmPatchPropsView {
  group: THREE.Group;
  /** bedId to its world seat, so the per-viewer half and the event flourishes
   *  never re-sample the terrain. */
  seats: Map<string, FarmBedSeat>;
}

/**
 * The static half: every bed and every compost bin, instanced per (kind x
 * patch) so a patch is one draw per model part and stays frustum-cullable on
 * its own bounds.
 */
export function buildFarmPatchProps(
  seed: number,
  patches: readonly FarmPatchDef[],
): FarmPatchPropsView {
  const group = new THREE.Group();
  group.name = 'farmPatches';
  const seats = new Map<string, FarmBedSeat>();
  if (patches.length === 0) return { group, seats };

  const matrix = new THREE.Matrix4();
  const holder = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const tint = new THREE.Color();

  for (const patch of patches) {
    const palette = farmBiomePalette(patch.zoneId);
    const bedMatrices: THREE.Matrix4[] = [];
    for (const bed of patch.beds) {
      const y = terrainHeight(bed.x, bed.z, seed);
      const quat = new THREE.Quaternion().setFromUnitVectors(
        WORLD_UP,
        groundNormal(bed.x, bed.z, seed),
      );
      seats.set(bed.id, {
        x: bed.x,
        y,
        z: bed.z,
        quat,
        patchId: patch.id,
        zoneId: patch.zoneId,
      });
      pos.set(bed.x, y, bed.z);
      holder.compose(pos, quat, one);
      bedMatrices.push(holder.clone());
    }
    addInstancedParts(
      group,
      `farmPatches:bed:${patch.id}`,
      templateParts(FARM_BED_MODEL_URL, BED_HEIGHT, 0x8a6a4a),
      bedMatrices,
      matrix,
      tint.setHex(palette.soil),
    );

    // One compost bin per patch, just outside the west edge of the grid.
    const bin = farmCompostBinPosition(patch);
    const binY = terrainHeight(bin.x, bin.z, seed);
    const binQuat = new THREE.Quaternion().setFromUnitVectors(
      WORLD_UP,
      groundNormal(bin.x, bin.z, seed),
    );
    pos.set(bin.x, binY, bin.z);
    holder.compose(pos, binQuat, one);
    addInstancedParts(
      group,
      `farmPatches:bin:${patch.id}`,
      templateParts(FARM_COMPOST_BIN_MODEL_URL, BIN_HEIGHT, 0x6f5a3e),
      [holder.clone()],
      matrix,
      tint.setHex(palette.wood),
    );
  }
  return { group, seats };
}

/** One live plot's crop meshes. Satisfies FarmPlotVisualKey structurally, so
 *  the steady-state sync check compares fields in place and allocates nothing. */
interface PlotVisual extends FarmPlotVisualKey {
  group: THREE.Group;
  /** Materials cloned for this plot alone (the accent tint and the damp soil
   *  overlay), disposed with it. */
  ownedMaterials: THREE.Material[];
  ownedGeometries: THREE.BufferGeometry[];
  /** The bed's terrain tilt. Kept so the sway can be composed ON TOP of it
   *  rather than overwriting it. */
  seatQuat: THREE.Quaternion;
  /** Idle sway phase (radians), advanced by update(dt). */
  phase: number;
  /** Sway amplitude, zero for a withered crop (dead stalks do not sway). */
  sway: number;
}

// A grown crop leans in the wind; the sway is slow and small, a background
// motion rather than a telegraph. Per-frame writes only, no allocation.
const SWAY_SPEED = 1.1;
// The sway leans the crop about the world z axis. Applied as a quaternion
// composed onto the seat tilt: writing group.rotation.z instead would rebuild
// the whole quaternion from Euler angles and silently DISCARD the terrain
// tilt, standing every crop bolt upright on a slope.
const SWAY_AXIS = new THREE.Vector3(0, 0, 1);
const swayQuat = new THREE.Quaternion();
const SWAY_AMPLITUDE: Readonly<Record<FarmStageMesh, number>> = Object.freeze({
  sprout: 0.01,
  stage2: 0.025,
  stage3: 0.04,
  stage4: 0.05,
  withered: 0,
});

/**
 * The per-viewer half: the growth-stage meshes standing in the viewer's OWN
 * beds, plus the plant, harvest and wither flourishes.
 */
export class FarmPatchVisuals {
  private readonly plots = new Map<string, PlotVisual>();
  private readonly seen = new Set<string>();
  private socketY = SOIL_SOCKET_FALLBACK_Y;
  // True once socketY came from a real loaded bed GLB: from then on the Box3
  // walk in soilSocketOffset() need not repeat on every plot create.
  private socketYResolved = false;
  // Seeded at the interval so the very first frame reads the plot set.
  private sinceReadS = FARM_SYNC_INTERVAL_S;
  // Set by a farm event, cleared by the first forced read that OBSERVES a
  // change: a plant or a harvest must show on the NEXT frame, not up to half
  // a second later. Online the event and the fplot rows arrive as two ws
  // messages in a fixed order (events first), so the frame between them would
  // otherwise spend the flag on a read of the pre-change rows and the change
  // itself would wait out the full throttle. dirtyForS bounds the arming at
  // one interval, so a change that never arrives cannot pin the read to every
  // frame forever.
  private dirty = false;
  private dirtyForS = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly seats: ReadonlyMap<string, FarmBedSeat>,
    private readonly vfx: FarmVfxSink,
  ) {}

  /**
   * Mirror the viewer's plot rows, at most once per FARM_SYNC_INTERVAL_S.
   *
   * The THROTTLE lives here rather than at the renderer's call sites because
   * the expensive part is the READ itself: the offline Sim's myFarmPlots is a
   * getter that projects and sorts a fresh array on every access, so a gate
   * downstream of the read would already have paid for it. Taking the world
   * instead of a plot array is what lets this decide before touching it.
   *
   * THE CADENCE IS UNIFORM AND TIER-INDEPENDENT BY CONTRACT. A growth stage is
   * actionable, so it may not refresh sooner on a strong machine than a weak
   * one: this reads no preset, no tier knob and no FPS governor, only wall dt,
   * and a farm event forces the next frame to read regardless.
   *
   * Rows are compared FIELDWISE against the live records, never by array or
   * row identity: the Sim allocates a fresh array (and fresh rows) per read
   * while ClientWorld keeps one array until the next fplot delta, so neither
   * === on the array nor === on a row means anything here. The steady-state
   * COMPARE therefore allocates nothing; the read itself is whatever the
   * world's myFarmPlots getter costs (offline it projects and sorts a fresh
   * array), which is exactly why the throttle sits in front of it.
   */
  sync(world: FarmPlotSource, dt: number): void {
    this.sinceReadS += dt;
    if (this.dirty) this.dirtyForS += dt;
    if (!this.dirty && this.sinceReadS < FARM_SYNC_INTERVAL_S) return;
    this.sinceReadS = 0;
    const changed = this.applyPlots(world.myFarmPlots, world.farmNowMs());
    // The event-forced read stays armed until it actually observes a change
    // (see the field comment: online the changed rows ride a LATER message
    // than the event), bounded at one interval so the normal cadence is the
    // worst case, never a permanent per-frame read.
    if (changed || this.dirtyForS >= FARM_SYNC_INTERVAL_S) {
      this.dirty = false;
      this.dirtyForS = 0;
    }
  }

  /** Mirrors the rows into the scene; true when any plot was created,
   *  rebuilt, or disposed by this read. */
  private applyPlots(plots: readonly FarmPlotView[], nowMs: number): boolean {
    let changed = false;
    this.seen.clear();
    for (const plot of plots) {
      const seat = this.seats.get(plot.bedId);
      if (!seat) continue;
      this.seen.add(plot.bedId);
      const existing = this.plots.get(plot.bedId);
      // The steady-state path: four field compares, no object and no string.
      if (existing && farmPlotKeyMatches(existing, plot, nowMs)) continue;
      if (existing) this.disposePlot(plot.bedId, existing);
      this.create(plot.bedId, seat, resolveFarmPlotVisual(plot, nowMs), plot);
      changed = true;
    }
    for (const [bedId, visual] of this.plots) {
      if (!this.seen.has(bedId)) {
        this.disposePlot(bedId, visual);
        changed = true;
      }
    }
    return changed;
  }

  /** Per-frame writes only: the idle sway. No per-plot allocation (the one
   *  Map iterator per frame is the family idiom shared with the sibling
   *  visuals). */
  update(dt: number): void {
    for (const visual of this.plots.values()) {
      if (visual.sway === 0) continue;
      visual.phase = (visual.phase + dt * SWAY_SPEED) % (Math.PI * 2);
      // Composed ONTO the seat tilt, never written as an Euler angle: the crop
      // has to keep standing normal to the ground it grows in.
      swayQuat.setFromAxisAngle(SWAY_AXIS, Math.sin(visual.phase) * visual.sway);
      visual.group.quaternion.copy(visual.seatQuat).multiply(swayQuat);
    }
  }

  /**
   * The plant, harvest and wither flourishes.
   *
   * Routing already scopes these events to their owner, so the viewerPid check
   * below is insurance: it makes the one-viewer invariant LOCAL to this module
   * instead of inherited from the event channel, so a future broadcast of a
   * farm event cannot start puffing soil on other players' beds.
   *
   * A flourish also marks the plot set dirty, so the throttled read happens on
   * the very next frame: the bed must go bare the instant it is harvested.
   *
   * Purely cosmetic, and emitted through the shared Vfx emitters, so the
   * adaptive budget's scaledCount is the whole of the tier shed here.
   */
  onFarmEvent(ev: SimEvent, viewerPid: number): void {
    if (ev.type !== 'farmPlanted' && ev.type !== 'farmHarvested' && ev.type !== 'farmWithered') {
      return;
    }
    if (ev.pid !== viewerPid) return;
    this.dirty = true;
    this.dirtyForS = 0;
    const seat = this.seats.get(ev.bedId);
    if (!seat) return;
    const at = new THREE.Vector3(seat.x, seat.y + this.socketY, seat.z);
    if (ev.type === 'farmPlanted') {
      // Turned soil, then a hint of green: the seed is in the ground.
      this.vfx.groundPuff(at, 0.7, 0x6b4f34);
      this.vfx.burst(at, 'nature', 10, 0.6);
      return;
    }
    if (ev.type === 'farmHarvested') {
      this.vfx.burst(at, 'nature', 20, 1, 0xd8c25a);
      return;
    }
    // A wither is a failure, so it reads as grey dust and nothing else.
    this.vfx.groundPuff(at, 0.5, 0x8f8b80);
  }

  dispose(): void {
    for (const [bedId, visual] of this.plots) this.disposePlot(bedId, visual);
  }

  private create(
    bedId: string,
    seat: FarmBedSeat,
    visual: FarmPlotVisual,
    plot: FarmPlotView,
  ): void {
    // Resolved on plot creates (never per frame) until a REAL bed GLB has
    // answered once: the socket offset needs the loaded bed, which may only
    // arrive after the static half was built, and once it has resolved there
    // is nothing left to re-measure (a 23-plot resync would otherwise walk
    // the bed's Box3 23 times for the same number).
    if (!this.socketYResolved) {
      this.socketY = soilSocketOffset();
      this.socketYResolved = loadedFarmGltf.has(FARM_BED_MODEL_URL);
    }
    const group = new THREE.Group();
    group.name = `farmPlot:${bedId}`;
    group.position.set(seat.x, seat.y + this.socketY, seat.z);
    group.quaternion.copy(seat.quat);

    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const url = farmStageModelUrl(visual.family, visual.stageMesh);
    const parts = templateParts(url, STAGE_HEIGHT[visual.stageMesh], stageFallbackColor(visual));
    const damp = WET_SOIL_DARKEN[visual.wetBand];
    for (const part of parts) {
      const mat = this.plotMaterial(part, visual, damp, ownedMaterials);
      const mesh = new THREE.Mesh(part.geo, mat);
      mesh.applyMatrix4(part.local);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!loadedFarmGltf.has(url)) ownedGeometries.push(part.geo);
      group.add(mesh);
    }
    // Same bucket as the beds they stand in, so the ?perf overlay counts them
    // with the rest of the world props rather than leaving them unattributed.
    setRenderCategory(group, 'props');
    this.scene.add(group);
    this.plots.set(bedId, {
      group,
      ownedMaterials,
      ownedGeometries,
      // The rebuild key, stored as fields so the next sync compares in place.
      cropId: plot.cropId,
      status: plot.status,
      stageMesh: visual.stageMesh,
      wetBand: visual.wetBand,
      seatQuat: seat.quat,
      // Phase seeded off the bed id, not a clock or an rng: two beds sway out
      // of step, and the same bed sways the same way on every host.
      phase: (bedIdPhase(bedId) * Math.PI * 2) % (Math.PI * 2),
      sway: SWAY_AMPLITUDE[visual.stageMesh],
    });
  }

  /**
   * The per-plot material: a clone of the template's, tinted by the crop
   * accent on the accent part and darkened by the plot's wet band elsewhere.
   * Cloning is affordable because there are at most 23 plots, one per bed.
   */
  private plotMaterial(
    part: GlbTemplatePart,
    visual: FarmPlotVisual,
    damp: number,
    owned: THREE.Material[],
  ): THREE.Material | THREE.Material[] {
    if (Array.isArray(part.mat)) {
      return part.mat.map((m) => this.tintOne(m, part.accent, visual, damp, owned));
    }
    return this.tintOne(part.mat, part.accent, visual, damp, owned);
  }

  private tintOne(
    src: THREE.Material,
    accent: boolean,
    visual: FarmPlotVisual,
    damp: number,
    owned: THREE.Material[],
  ): THREE.Material {
    const colored = src as THREE.MeshStandardMaterial;
    if (!colored.color) return src;
    // The hook-preserving clone, never a bare Material.clone(): clone() drops
    // onBeforeCompile, so a bare clone of the fallback surfaceMat would lose
    // the zone-haze layer AND link a fresh program (material_clone_hooks.ts
    // has the whole story; castle_features.ts is the precedent).
    const clone = cloneMaterialWithHooks(src) as THREE.MeshStandardMaterial;
    if (accent) clone.color.setHex(visual.accent);
    else clone.color.multiplyScalar(damp);
    owned.push(clone);
    return clone;
  }

  private disposePlot(bedId: string, visual: PlotVisual): void {
    this.scene.remove(visual.group);
    for (const mat of visual.ownedMaterials) mat.dispose();
    for (const geo of visual.ownedGeometries) geo.dispose();
    this.plots.delete(bedId);
  }
}

/** The slice of IWorld this module reads, narrowed to the two farming members
 *  it needs. Taken as a WORLD rather than an array so the throttle can decide
 *  before touching myFarmPlots, which projects and sorts on every access. */
export interface FarmPlotSource {
  readonly myFarmPlots: readonly FarmPlotView[];
  farmNowMs(): number;
}

/** The Vfx surface this module uses, narrowed to the two emitters it calls so
 *  a test can drive it without a renderer. Both go through vfx.ts, whose
 *  scaledCount IS the graphics tier shed. */
export interface FarmVfxSink {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number, color?: number): void;
  groundPuff(at: THREE.Vector3, power: number, color: number): void;
}

const STAGE_FALLBACK_COLORS: Readonly<Record<FarmCropFamily, number>> = Object.freeze({
  grain: 0xbfae64,
  rootleaf: 0x4f8a44,
  gourd: 0x6f9a52,
});

function stageFallbackColor(visual: FarmPlotVisual): number {
  if (visual.stageMesh === 'withered') return 0x8a8272;
  return STAGE_FALLBACK_COLORS[visual.family];
}

/** A stable 0..1 from a bed id, so sway phases differ per bed without a clock
 *  or an rng (the ids are fixed content, so this is the same everywhere). */
function bedIdPhase(bedId: string): number {
  let h = 2166136261;
  for (let i = 0; i < bedId.length; i++) {
    h ^= bedId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
