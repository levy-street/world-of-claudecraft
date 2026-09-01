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
//    only and allocates nothing. Phase 12 adds the placed harvest feast to the
//    same sync: a REAL snapshot entity everyone sees, drawn here because its
//    GLB, ground idiom and flourish all live in this module already (a
//    dedicated feast module would need renderer.ts wiring).
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
//
// A PREPARED GPU PRODUCER (src/render/CLAUDE.md, "GPU work: every new producer
// is a client of the scheduler"): every plot and feast group attaches through
// the renderer's compile gate (gated_scene_attach.ts), hidden until its
// programs link, with the label kinds `farm-plot` and `farm-feast` the budget
// learns per family. The static bed drawn at boot is the stand-in for a plot's
// first appearance and the outgoing stage mesh stands in for a rebuild (it
// keeps drawing until the replacement links); the feast ENTITY's own view and
// nameplate stand in for its table (ENTITY_GATE_STAND_INS,
// entity_gate_stand_in_core.ts). The gate alone does not close the REBUILD
// class: a plot's materials are per-plot clones disposed with it, and three
// releases a program with its last material. The repo's three patch parks a
// released program linked in a bounded FIFO (RETAINED_PROGRAM_LIMIT, pinned by
// tests/three_compile_async_patch.test.ts) instead of destroying it, so a
// stage advance usually re-acquires warm, but the farm's rebuilds are minutes
// apart and any interest churn past the bound in between (a streamed town, a
// crowd) evicts the parked program and the next rebuild links it cold again.
// The FARM PROGRAM ANCHORS close that class outright: one hidden mesh per
// distinct (material signature x geometry attribute set) of the stage and
// feast GLBs, wearing the source materials, staged at construction under the
// same gate and retained for the visuals' life, so every farm program keeps a
// live use, never enters the retention FIFO, and cannot be evicted by it.
// `?farmPrep=0` (farm_patches_core.ts farmPrewarmDisabled) restores the bare
// attach with no anchors, the control leg of scripts/farm_gpu_tour.mjs.
import * as THREE from 'three';
import { isFeastTemplateId } from '../sim/professions/feast';
import type { Entity, SimEvent } from '../sim/types';
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
  farmFeastModelUrl,
  farmFeastModelUrls,
  farmModelUrls,
  farmPlotKeyMatches,
  farmPrewarmDisabled,
  farmStageModelUrl,
  resolveFarmPlotVisual,
} from './farm_patches_core';
import { attachSceneGroupGated, GatedSceneAttachCancelledError } from './gated_scene_attach';
import { surfaceMat } from './gfx';
import { addInstancedParts, type GlbTemplatePart, glbTemplateParts } from './glb_instanced_props';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { materialProgramSignature } from './prewarm_policy';
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
// The placed feast table's normalized height. Both feast GLBs are authored to
// the SAME contract height (farm_feast and farm_feast_apex), so the party and
// apex tables share this one number and the pick proxy that matches it.
const FEAST_HEIGHT = 0.9;
// Where the feast's placement flourish centers, above its ground seat.
const FEAST_VFX_LIFT = 0.45;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** The host's compile step for a farm group (the renderer's compile gate):
 *  link `target`'s programs off the frame before it shows, queued under
 *  `label` (a `kind:instance` the budget learns per kind, gpuPrepKindOfLabel). */
export type FarmCompileGate = (target: THREE.Object3D, label: string) => Promise<unknown>;

/** The hidden root of the farm program anchors (see the module header). */
export const FARM_PROGRAM_ANCHORS_NAME = 'farmProgramAnchors';
/** The anchors' gate label: one unit family, one instance. */
export const FARM_PROGRAM_ANCHORS_LABEL = 'farm-prewarm:programs';

/** A gated attach whose group was retired (its record replaced or removed)
 *  before the gate settled resolves nothing further; anything else is a bug. */
function ignoreRetiredAttach(error: unknown): void {
  if (!(error instanceof GatedSceneAttachCancelledError)) throw error;
}

// RESIDENCY, stated on purpose (the Phase 7 QA deferral): these 17 scenes are
// retained for the whole session, never released. The templates serve every
// later plot create and the soil-socket resolve, so releasing them buys
// nothing back; the loader's own gltfCache redundantly retains the 17 gltf
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

/** One placed harvest feast's table meshes (Phase 12, the shared feast). A
 *  feast never changes appearance while it stands, so its whole rebuild key is
 *  the entity id it is stored under. */
interface FeastVisual {
  group: THREE.Group;
  ownedMaterials: THREE.Material[];
  ownedGeometries: THREE.BufferGeometry[];
  /** The table's meshes, kept for the shadow-budget pass below. */
  shadowMeshes: THREE.Mesh[];
  /** Whether this table currently casts shadows (the budget's memo, so the
   *  steady-state pass writes nothing when membership has not changed). */
  castsShadow: boolean;
  /** Detached and its owned resources disposed (release is idempotent: a
   *  retired gated attach and the despawn path can both reach it). */
  released: boolean;
}

/** How many feast tables may CAST shadows at once (insertion order, oldest
 *  first; the budget refills as feasts despawn). Presence is deliberately
 *  never capped: a feast is actionable (you can eat it), so every table in
 *  interest scope draws, and the natural bound is one feast per online
 *  placer crossed with the ~120 yd interest scope. Shadow casting is the
 *  expensive cosmetic half (a shadow-map draw per caster), so it is the
 *  half that sheds in a packed hub. Applied identically at every graphics
 *  tier: this is a universal budget, never a preset knob. */
export const FEAST_SHADOW_CAP = 8;

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
  /** The stage mesh this one replaced, still drawing as the stand-in until
   *  this one's gate settles; null once released or when nothing preceded it. */
  outgoing: PlotVisual | null;
  /** Detached and its owned resources disposed (idempotent, see FeastVisual). */
  released: boolean;
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
  // The placed feasts (Phase 12): keyed by feast ENTITY id, mirrored from the
  // world's entity map on the same throttled read as the plots. Everyone sees
  // every feast (it is a real snapshot entity), unlike the per-viewer plots.
  private readonly feasts = new Map<number, FeastVisual>();
  private readonly feastsSeen = new Set<number>();
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
  // False until the first applyFeasts pass has run: standing feasts register
  // WITHOUT the placement flourish on that pass (see applyFeasts).
  private feastFlourishArmed = false;
  // The host's compile gate, or null where programs cannot link off-thread (no
  // KHR_parallel_shader_compile, a headless suite) and under ?farmPrep=0: then
  // every attach is the bare, immediate one and no anchors are staged.
  private readonly compileGate: FarmCompileGate | null;
  // The hidden program anchors (module header), staged once at construction.
  private readonly anchors: THREE.Group | null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly seats: ReadonlyMap<string, FarmBedSeat>,
    private readonly vfx: FarmVfxSink,
    compileGate: FarmCompileGate | null = null,
  ) {
    const disabled = farmPrewarmDisabled(typeof location === 'undefined' ? '' : location.search);
    this.compileGate = disabled ? null : compileGate;
    this.anchors = this.compileGate ? buildFarmProgramAnchors() : null;
    if (this.anchors && this.compileGate) {
      // Added hidden and never revealed: the anchors exist to be compiled, so
      // this is the one bare scene.add here, and the gate runs over it at
      // once. Shutdown rejects queued GPU work on purpose; nothing to recover.
      this.scene.add(this.anchors);
      void this.compileGate(this.anchors, FARM_PROGRAM_ANCHORS_LABEL).catch(() => undefined);
    }
  }

  /**
   * The renderer's one per-frame entry, shared by the prewarm frame and the
   * live frame: the throttled plot and feast read (when `worldReady`), then
   * the per-frame sway. `worldReady` is the prewarm frame's guard, the entry
   * watch's own readiness predicate (the world holds its player entity), so a
   * prewarm over a snapshot-less online mirror cannot consume the silent first
   * feast pass (the carry-16 rationale in applyFeasts); the live frame passes
   * nothing and always reads.
   */
  drive(world: FarmPlotSource, dt: number, worldReady = true): void {
    if (worldReady) this.sync(world, dt);
    this.update(dt);
  }

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
    // The feast scan rides the same throttled read. It never touches the
    // dirty flag: the arming exists for the viewer's own plot rows, and a
    // feast appearing within the normal half-second cadence is fine.
    this.applyFeasts(world.entities, world.cfg.seed);
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
      // A rebuild hands the outgoing stage to the replacement, which keeps it
      // drawing as the stand-in until its own gate settles (create).
      this.create(plot.bedId, seat, resolveFarmPlotVisual(plot, nowMs), plot, existing ?? null);
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

  /** Mirrors the placed feast entities (kind 'object', any templateId
   *  `isFeastTemplateId` admits) into the scene: create on first appearance,
   *  remove on despawn. Steady state is one entity-map walk plus set
   *  membership, no
   *  allocation (the reused seen-set idiom of applyPlots). The placement
   *  flourish fires once per feast appearing on any pass AFTER the first:
   *  the first pass after construction registers standing tables silently,
   *  because a graphics-settings rebuild (a fresh visuals instance) and a
   *  login both replay it for every feast in view at once, and the burst
   *  would read as "someone just placed this" for a table set out minutes
   *  ago. A feast appearing on a later pass is genuinely new to this mirror
   *  (which also covers feasts other players set out: their entity arrives
   *  by snapshot with no event on this viewer's channel). The one residual
   *  ambiguity, an old feast re-entering interest scope after the viewer
   *  walked far away, is indistinguishable client-side without wire age and
   *  is accepted (Phase 12 QA ledger). A SECOND accepted residual, recorded
   *  by the 11c design call (Masterwrought carry item 16): a renderer
   *  prewarm pass that ran BEFORE the online mirror held its first snapshot
   *  would consume the silent first pass over an empty entity map (that
   *  baseline is deliberately pinned by tests/farm_patches_adapter.test.ts),
   *  so every feast already standing in interest scope would puff on the
   *  first live read. CLOSED at the renderer call site (Masterwrought
   *  phase 14, 2026-08-28): prewarmWorldFrame holds this sync until the
   *  world holds its own player entity (the entry watch's readiness
   *  predicate), a guard that is inert in every reachable sequence today
   *  (offline Sims populate synchronously; online entry waits for the first
   *  snapshot before the renderer exists) and exists against a future
   *  entry-sequence change. The fix stays at the RENDERER call site by
   *  design, never as a non-empty-map guard here, which would flip the
   *  pinned rebuild/login silence into a burst. Cosmetic either way: both
   *  emitters ride vfx.ts's scaled budget. What that close did NOT cover
   *  (recorded by the phase 14 render review) was this module as an
   *  unprepared GPU producer: createFeast and create scene-added cloned
   *  materials from the LIVE frame call site with no prewarm home, compile
   *  gate or stand-in, so the first plot stage-advance or in-scope feast of a
   *  session paid a cold program link mid-frame, and every rebuild relinked.
   *  CLOSED at Masterwrought phase 18 (2026-08-31) by the gated attach plus
   *  the retained program anchors described in the module header, measured
   *  by scripts/farm_gpu_tour.mjs. */
  private applyFeasts(entities: ReadonlyMap<number, Entity>, seed: number): void {
    this.feastsSeen.clear();
    const flourish = this.feastFlourishArmed;
    for (const e of entities.values()) {
      if (e.kind !== 'object' || !isFeastTemplateId(e.templateId)) continue;
      this.feastsSeen.add(e.id);
      if (!this.feasts.has(e.id)) this.createFeast(e, seed, flourish);
    }
    for (const [id, visual] of this.feasts) {
      if (!this.feastsSeen.has(id)) this.disposeFeast(id, visual);
    }
    this.feastFlourishArmed = true;
    this.applyFeastShadowBudget();
  }

  /** Re-derives which tables cast shadows (the first FEAST_SHADOW_CAP in
   *  insertion order). Runs on the throttled read only; writes nothing when
   *  membership has not changed (the castsShadow memo). */
  private applyFeastShadowBudget(): void {
    let budget = FEAST_SHADOW_CAP;
    for (const visual of this.feasts.values()) {
      const cast = budget > 0;
      if (cast) budget--;
      if (visual.castsShadow === cast) continue;
      visual.castsShadow = cast;
      for (const mesh of visual.shadowMeshes) mesh.castShadow = cast;
    }
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
    for (const [id, visual] of this.feasts) this.disposeFeast(id, visual);
    // The anchors wear the GLB cache's own materials (shared with the
    // instanced beds and every later template read) and the deduped gfx
    // surface materials, so they are detached, never disposed.
    if (this.anchors) this.scene.remove(this.anchors);
  }

  /**
   * Attach a freshly built farm group through the host's compile gate
   * (gated_scene_attach.ts): hidden until its programs link, then shown; a
   * plot's outgoing stage mesh keeps drawing meanwhile and is released on the
   * settle. A group retired before its gate settles (its record replaced or
   * removed, `retired`) is never shown, and whatever it was replacing is
   * released the same way. Without a gate the swap is immediate, exactly the
   * pre-gate behaviour (and the pinned synchronous shape the adapter suite
   * drives).
   */
  private attachGated(
    group: THREE.Group,
    label: string,
    retired: () => boolean,
    releaseOutgoing: (() => void) | null,
  ): void {
    const gate = this.compileGate;
    if (!gate) {
      releaseOutgoing?.();
      this.scene.add(group);
      return;
    }
    void attachSceneGroupGated(this.scene, group, (target) => gate(target, label), retired)
      .catch(ignoreRetiredAttach)
      .finally(() => releaseOutgoing?.());
  }

  /** Builds one feast table at the entity's ground seat (the bed idiom:
   *  terrainHeight for y, tilted to the local ground normal), plus the
   *  placement flourish when `flourish` is armed (every pass after the
   *  first; see applyFeasts). Cosmetic only, so both emitters go through
   *  vfx.ts, whose scaledCount path is the graphics-tier shed. */
  private createFeast(e: Entity, seed: number, flourish: boolean): void {
    const group = new THREE.Group();
    group.name = `farmFeast:${e.id}`;
    const y = terrainHeight(e.pos.x, e.pos.z, seed);
    group.position.set(e.pos.x, y, e.pos.z);
    // Seat tilt plus a stable per-entity yaw (the ground-object (id % 7)
    // idiom), composed in that order so the table still stands normal to the
    // slope it was set out on.
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, (e.id % 7) * 0.45);
    group.quaternion
      .setFromUnitVectors(WORLD_UP, groundNormal(e.pos.x, e.pos.z, seed))
      .multiply(yawQuat);

    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const shadowMeshes: THREE.Mesh[] = [];
    // Which table this rung shows is the core's pure call (farmFeastModelUrl):
    // the party feast keeps the trestle table, the three apex role feasts get
    // the pedestal banquet. Both envelopes are identical, so the seat, the
    // shadow budget and the pick proxy are unchanged either way.
    const modelUrl = farmFeastModelUrl(e.templateId);
    const parts = templateParts(modelUrl, FEAST_HEIGHT, 0x8a6a4a);
    for (const part of parts) {
      // Owned hook-preserving clones, untinted: the feast ships its authored
      // colors, and per-feast clones keep disposal symmetric with the plots.
      const mat = Array.isArray(part.mat)
        ? part.mat.map((m) => this.cloneOwned(m, ownedMaterials))
        : this.cloneOwned(part.mat, ownedMaterials);
      const mesh = new THREE.Mesh(part.geo, mat);
      mesh.applyMatrix4(part.local);
      // Casting starts OFF; the shadow-budget pass right after this create
      // (applyFeasts tail) turns on the first FEAST_SHADOW_CAP tables.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      shadowMeshes.push(mesh);
      if (!loadedFarmGltf.has(modelUrl)) ownedGeometries.push(part.geo);
      group.add(mesh);
    }
    setRenderCategory(group, 'props');
    const record: FeastVisual = {
      group,
      ownedMaterials,
      ownedGeometries,
      shadowMeshes,
      castsShadow: false,
      released: false,
    };
    this.feasts.set(e.id, record);
    // Hidden until its programs link; the feast entity's own view and plate
    // stand in (module header). A despawn before the settle retires it.
    this.attachGated(group, `farm-feast:${e.id}`, () => this.feasts.get(e.id) !== record, null);

    if (flourish) {
      // The placement flourish: turned earth under the table, then a warm
      // nature burst over the spread. Armed passes only (see applyFeasts).
      const at = new THREE.Vector3(e.pos.x, y + FEAST_VFX_LIFT, e.pos.z);
      this.vfx.groundPuff(at, 0.7, 0x6b4f34);
      this.vfx.burst(at, 'nature', 12, 0.8);
    }
  }

  private cloneOwned(src: THREE.Material, owned: THREE.Material[]): THREE.Material {
    const clone = cloneMaterialWithHooks(src);
    owned.push(clone);
    return clone;
  }

  private disposeFeast(id: number, visual: FeastVisual): void {
    this.feasts.delete(id);
    this.releaseFeast(visual);
  }

  private releaseFeast(visual: FeastVisual): void {
    if (visual.released) return;
    visual.released = true;
    this.scene.remove(visual.group);
    for (const mat of visual.ownedMaterials) mat.dispose();
    for (const geo of visual.ownedGeometries) geo.dispose();
  }

  private create(
    bedId: string,
    seat: FarmBedSeat,
    visual: FarmPlotVisual,
    plot: FarmPlotView,
    outgoing: PlotVisual | null,
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
    const record: PlotVisual = {
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
      outgoing,
      released: false,
    };
    this.plots.set(bedId, record);
    // Hidden until its programs link. The bed (drawn at boot, never gated)
    // stands in for a first plant; on a rebuild the outgoing stage mesh keeps
    // drawing until this one settles, then goes. A plot removed before the
    // settle (disposePlot) retires this attach and releases both itself.
    this.attachGated(
      group,
      `farm-plot:${bedId}`,
      () => this.plots.get(bedId) !== record,
      () => this.releaseOutgoing(record),
    );
  }

  /** Release the stage mesh `record` replaced, once (the settle, a retire and
   *  a removal can each reach here). */
  private releaseOutgoing(record: PlotVisual): void {
    const outgoing = record.outgoing;
    if (!outgoing) return;
    record.outgoing = null;
    this.releasePlot(outgoing);
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

  /** The plot is gone (harvested, withered away, the viewer's rows changed):
   *  drop the record and release it AND any stage mesh it was still replacing,
   *  so a harvest during a pending rebuild still bares the bed at once. */
  private disposePlot(bedId: string, visual: PlotVisual): void {
    this.plots.delete(bedId);
    this.releaseOutgoing(visual);
    this.releasePlot(visual);
  }

  private releasePlot(visual: PlotVisual): void {
    if (visual.released) return;
    visual.released = true;
    this.scene.remove(visual.group);
    for (const mat of visual.ownedMaterials) mat.dispose();
    for (const geo of visual.ownedGeometries) geo.dispose();
  }
}

/**
 * The farm program anchors: one hidden mesh per distinct program the stage and
 * feast GLBs can ask for, wearing the SOURCE materials (never clones: a clone
 * would be one more object to keep alive, and the source is what every plot
 * clone shares its program key with through cloneMaterialWithHooks) on the
 * real geometries, so the rigid variant three keys off the attribute set is
 * the exact variant a plot or table draws. The bed and bin are left out: they
 * draw instanced at boot, a different variant, and their rigid one is never
 * drawn. Deduped by the prewarm signature plus the attribute set, so a set of
 * GLBs that share one material recipe stages one anchor, not fourteen; an
 * imperfect signature is fail-soft (the plot's own gate still covers a variant
 * the anchors missed). Never visible: the root and every mesh are hidden, and
 * compile traverses hidden objects (scene.traverse, not traverseVisible).
 */
function buildFarmProgramAnchors(): THREE.Group {
  const root = new THREE.Group();
  root.name = FARM_PROGRAM_ANCHORS_NAME;
  root.visible = false;
  setRenderCategory(root, 'prewarm');
  const seen = new Set<string>();
  const anchor = (url: string, height: number, fallbackColor: number): void => {
    for (const part of templateParts(url, height, fallbackColor)) {
      const materials = Array.isArray(part.mat) ? part.mat : [part.mat];
      const key = `${materials.map((m) => materialProgramSignature(m)).join('+')}|${Object.keys(
        part.geo.attributes,
      )
        .sort()
        .join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mesh = new THREE.Mesh(part.geo, part.mat);
      mesh.name = `farmProgramAnchor:${url}`;
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  };
  const families: FarmCropFamily[] = ['grain', 'rootleaf', 'gourd'];
  const stages: FarmStageMesh[] = ['sprout', 'stage2', 'stage3', 'stage4', 'withered'];
  for (const family of families) {
    for (const stage of stages) {
      anchor(
        farmStageModelUrl(family, stage),
        STAGE_HEIGHT[stage],
        stageAnchorColor(family, stage),
      );
    }
  }
  // Both feast tables, so the apex rung's first placement is a program-cache
  // hit like the party table's (they share one material recipe today, so the
  // dedupe below stages one anchor for the pair; an apex-only recipe would
  // stage its own).
  for (const url of farmFeastModelUrls()) anchor(url, FEAST_HEIGHT, 0x8a6a4a);
  return root;
}

/** The fallback colour a stage anchor takes (the same surfaceMat a plot's
 *  fallback box would clone from, so the anchor holds that program too). */
function stageAnchorColor(family: FarmCropFamily, stage: FarmStageMesh): number {
  return stage === 'withered' ? 0x8a8272 : STAGE_FALLBACK_COLORS[family];
}

/** The slice of IWorld this module reads. Taken as a WORLD rather than an
 *  array so the throttle can decide before touching myFarmPlots, which
 *  projects and sorts on every access. The entity map and the world seed
 *  joined at Phase 12 for the placed-feast scan; both worlds already expose
 *  them, so the renderer's `sync(this.sim, dt)` call sites stand unchanged
 *  (the widening is structural, never a renderer edit). */
export interface FarmPlotSource {
  readonly myFarmPlots: readonly FarmPlotView[];
  farmNowMs(): number;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly cfg: { readonly seed: number };
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
