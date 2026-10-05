// Equipment-dependent WOC far silhouettes use the existing posed static bake.
// Geometry is shared by class/gender, selected nodes, the armor files they are
// drawn from (a set's tier is its materials) and the modular head's frozen face
// (its morph influences on the far grid, woc_far_head_core.ts), never by item
// id, tint or atlas: the head's colours are tint uniforms on each character's
// own far materials (woc_far_tint.ts), resolved per baked group by the near
// dressing's rule (`tints`). The head is ONE group: every piece the merged
// material can draw is folded into it (woc_far_head.ts), so a far character is
// its body, its head, its armor's materials and nothing per face piece. Live
// visuals retain their entry; only idle entries age out. A LIVE entry holds its
// armor files resident (woc_armor_packs.ts), because its materials ARE those
// files' materials; an idle one lets go of them (so a set seen once at distance
// is still freed on time) and is re-used only while the very parse it was baked
// from is still resident. (Head files are never freed, woc_head_packs.ts.)
//
// The bake is main-thread work (a throwaway model, an idle sample, a transform
// of every vertex it draws), so a body behind a renderer never runs it in a
// frame of its own: queueWocFarBake cuts it into units of the renderer's
// background work queue (the throwaway and its pose, the vertices a band at a
// time, the merge), one bake per cache key however many bodies ask, each unit
// under a label kind the frame budget learns a cost for and a span in the CPU
// build ledger. ONE bake at a time per queue: a crowd crossing the band
// together is a line of asks, never a throwaway model each, and each body
// mounts as its own bake ends. A bake nobody waits for any more never starts,
// or stops between two units; a finished one is held live for its askers
// until they have mounted it (an idle bake is the first thing the next one
// trims). The steps are one list (WocFarBakeRun): retainWocFarBake runs them
// back to back for a body with no queue behind it (a direct build, a test),
// so both paths bake the same mesh.
import * as THREE from 'three';
import { isGpuQueueShutdown } from '../background_gpu_queue';
import { recordBuildSpan } from '../build_spans';
import { GFX } from '../gfx';
import { assembleModel, composedFarMeshes, prepareVisual } from './assets';
import { compactDrawnVertices, FAR_BAKE_READS } from './far_bake_compact';
import { characterMeshCastsShadow } from './shadow_policy';
import { bakeStaticPose, farBakeGroupKey, StaticPoseBaker } from './static_pose_bake';
import type { WocArmorFile } from './woc_armor_dressing';
import {
  releaseWocArmorOf,
  releaseWocArmorPack,
  retainWocArmorPack,
  wocArmorPackGeneration,
} from './woc_armor_packs';
import {
  foldWocHeadForBake,
  setWocFarHeadSlots,
  type WocFarHeadFold,
  WocHeadBakePose,
} from './woc_far_head';
import { WOC_FAR_HEAD_GROUP_KEY, type WocFarHeadPose, wocFarTintKey } from './woc_far_head_core';
import type { WocFarGroupTint } from './woc_far_tint';
import { wocHeadTypeForGender } from './woc_head_catalog';
import { applyWocHeadBakeVisibility, wocHeadTintTarget } from './woc_head_dressing';
import type { WocHeadTintRef } from './woc_head_look_core';
import { wocIdleCacheCaps } from './woc_idle_cache_core';
import { WOC_FAR_BAKE_LOD } from './woc_lod_core';
import { applyWocPartVisibility, resolveWocPartNodes } from './woc_parts';

export interface WocFarBake {
  geo: THREE.BufferGeometry;
  shadowGeo: THREE.BufferGeometry | null;
  /** The far set's SOURCE materials: one per GROUP, then one per slot of the merged
   *  head. A slot's own material is never drawn at distance; it rides here so the
   *  one tier derivation (and the one claim set) that serves the groups serves it
   *  too, and the head's tint reads its surface off the result (woc_far_tint.ts). */
  mats: THREE.Material[];
  /** Aligned with `mats`: the body flag gating the skin/emissive override. */
  isBody: boolean[];
  /** One entry per GROUP (so its length is the group count): how that group's
   *  material is tinted. The tint its material takes on the near body
   *  (woc_head_dressing.ts wocHeadTintTarget), the merged head's slot table for
   *  the head group, or null for an untinted one. */
  tints: WocFarGroupTint[];
}

export interface WocFarBakeLease {
  bake: WocFarBake;
  release(): void;
}

interface Entry {
  bake: WocFarBake;
  refs: number;
  /** The armor files the bake's materials belong to, held resident while it is live. */
  files: readonly string[];
  /** The parse of each file it was baked from (wocArmorPackGeneration). */
  generations: readonly number[];
}
const cache = new Map<string, Entry>();

/** Identity of what a far bake freezes: the drawn nodes, the armor files and the
 *  head's far pose (null: the head pack's own influences). A sort and a stringify:
 *  a caller that asks more than once (a visual, per dressing) keeps the answer and
 *  hands it back as `partsKey` below. */
export function wocFarPartsKey(
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
): string {
  return JSON.stringify([[...parts].sort(), files.map((f) => f.url).sort(), head?.key ?? '']);
}

/** The cache id of one bake. `partsKey`: the wocFarPartsKey of these very inputs, when
 *  the caller already holds it. */
function cacheKey(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[],
  head: WocFarHeadPose | null,
  partsKey?: string,
): string {
  return `${key}:${partsKey ?? wocFarPartsKey(parts, files, head)}`;
}

/** Whether an entry's materials are still the resident parses of its files. */
function current(entry: Entry): boolean {
  return entry.files.every((url, i) => wocArmorPackGeneration(url) === entry.generations[i]);
}

function drop(id: string, entry: Entry): void {
  cache.delete(id);
  entry.bake.geo.dispose();
  if (entry.bake.shadowGeo !== entry.bake.geo) entry.bake.shadowGeo?.dispose();
}

export function peekWocFarBake(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
  partsKey?: string,
): WocFarBake | null {
  const entry = cache.get(cacheKey(key, parts, files, head, partsKey));
  return entry && (entry.refs > 0 || current(entry)) ? entry.bake : null;
}

/** Idle entries hold no files, so trimming one frees only its geometry. */
function trimIdle(): void {
  let idle = 0;
  for (const entry of cache.values()) if (entry.refs === 0) idle++;
  // fewer on a constrained profile (woc_idle_cache_core.ts)
  const cap = wocIdleCacheCaps(GFX.constrainedMemory).farBakes;
  for (const [key, entry] of cache) {
    if (idle <= cap) break;
    if (entry.refs > 0) continue;
    drop(key, entry);
    idle--;
  }
}

/** A finished bake enters the cache idle: whoever asked for it retains it next. */
function store(id: string, bake: WocFarBake, files: readonly WocArmorFile[]): Entry {
  const urls = files.map((f) => f.url);
  const entry = { bake, refs: 0, files: urls, generations: urls.map(wocArmorPackGeneration) };
  cache.set(id, entry);
  return entry;
}

/**
 * Lease the bake of these inputs, baking it on the spot on a miss: the path of a body with
 * no work queue behind it (a direct build, a test), which pays takeFarBakeBudget first, and
 * of a queued body's mount, which finds the bake its units just finished. The caller
 * compiles the new mesh through gateFarMint before it replaces its articulated stand-in.
 */
export function retainWocFarBake(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
  partsKey?: string,
): WocFarBakeLease | null {
  const id = cacheKey(key, parts, files, head, partsKey);
  let entry = cache.get(id);
  // an idle entry whose files were freed (or refetched) since draws disposed materials
  if (entry && entry.refs === 0 && !current(entry)) {
    drop(id, entry);
    entry = undefined;
  }
  if (!entry) {
    const bake = bakeWocParts(key, parts, files, head);
    if (!bake) return null;
    entry = store(id, bake, files);
  }
  return leaseOf(id, entry);
}

/** One more holder of a cached bake. */
function leaseOf(id: string, entry: Entry): WocFarBakeLease {
  // live again: hold its files resident while it draws
  if (entry.refs === 0) for (const url of entry.files) retainWocArmorPack(url);
  entry.refs++;
  let released = false;
  return {
    bake: entry.bake,
    release() {
      if (released) return;
      released = true;
      entry.refs--;
      // Release order is the LRU order, as in the modular variant cache.
      if (entry.refs === 0) {
        cache.delete(id);
        cache.set(id, entry);
        for (const url of entry.files) releaseWocArmorPack(url);
      }
      trimIdle();
    },
  };
}

// ---------------------------------------------------------------------------
// The bake, a step at a time
// ---------------------------------------------------------------------------

/** The work-queue label kinds of a far LOD's units (`kind:<fit>`; the frame budget learns
 *  a cost per kind: gpu_prep_budget_core.ts gpuPrepKindOfLabel): the throwaway model, its
 *  pose and its cut down to the far level's vertices, a band of vertices (the head's
 *  morphs, then the static bake), the merge with the head's slots, and each body's own
 *  mount of the finished bake (its far materials, its far mesh, its compile gate:
 *  CharacterVisual, one unit per body). */
export const WOC_FAR_ASSEMBLE_LABEL = 'woc-far-assemble';
export const WOC_FAR_SKIN_LABEL = 'woc-far-skin';
export const WOC_FAR_FOLD_LABEL = 'woc-far-fold';
export const WOC_FAR_MOUNT_LABEL = 'woc-far-mount';

/** Vertices one skin unit poses or bakes: a structural band (a full-kit far body is a few
 *  of these), small enough that the frame budget decides how many a frame takes instead of
 *  one unit deciding for it. Not tuned to a machine: the budget prices the kind from what
 *  the units really cost. */
export const WOC_FAR_BAKE_BAND = 2048;
let band = WOC_FAR_BAKE_BAND;

/** Test seam: another band (null: the shipped one), so a fixture's few vertices span
 *  several units the way a shipped body's thousands do. */
export function setWocFarBakeBandForTest(vertices: number | null): void {
  band = vertices ?? WOC_FAR_BAKE_BAND;
}

/** The CPU build ledger kinds (build_ledger_core.ts: view-lane kinds, so the frame a unit
 *  lands in owns its milliseconds): every unit of a bake, and a body's mount. */
export const WOC_FAR_BAKE_SPAN = 'view:woc-far-bake';
export const WOC_FAR_MOUNT_SPAN = 'view:woc-far-mount';

type Stage = typeof WOC_FAR_ASSEMBLE_LABEL | typeof WOC_FAR_SKIN_LABEL | typeof WOC_FAR_FOLD_LABEL;

/**
 * One far bake as resumable steps over a throwaway model. Held items have a separate
 * lifetime and are absent from the part-set key, exactly like composedFarMeshes' policy
 * for the existing modular bake. The armor is exactly the files the live body draws
 * (resident: it draws them, and the throwaway holds them for as long as it lives). Every
 * piece draws its FAR level (woc_lod_core.ts), whatever the detail of the characters
 * sharing the bake, so the key needs no level of its own.
 */
class WocFarBakeRun {
  /** The next step's label kind; null once the bake is over (finished or come to nothing). */
  next: Stage | null = WOC_FAR_ASSEMBLE_LABEL;
  /** The finished bake; null until the last step, and for a look that bakes to nothing. */
  bake: WocFarBake | null = null;
  private temp: THREE.Object3D | null = null;
  /** The idle sample, kept bound until the throwaway goes: the steps read the pose off
   *  the world matrices across several frames, and with the clip still driving the rig a
   *  world update anywhere in between recomputes that same pose, never the rest pose. */
  private mixer: THREE.AnimationMixer | null = null;
  private readonly skeletons = new Set<THREE.Skeleton>();
  private pose: WocHeadBakePose | null = null;
  /** The walk's compact geometries (far_bake_compact.ts): scratch, as the two below. */
  private readonly compacted: THREE.BufferGeometry[] = [];
  /** Flat-coloured head pieces' scratch geometries (the pose keeps its own). */
  private readonly foldScratch: THREE.BufferGeometry[] = [];
  private readonly norm = new THREE.Matrix4();
  private meshes: THREE.Mesh[] = [];
  private fold: WocFarHeadFold | null = null;
  private tintOf = new Map<THREE.Mesh, WocHeadTintRef | null>();
  private baker: StaticPoseBaker | null = null;

  constructor(
    private readonly key: string,
    private readonly parts: ReadonlySet<string>,
    private readonly files: readonly WocArmorFile[],
    private readonly head: WocFarHeadPose | null,
  ) {}

  /** The body fit the bake is of (its units' label instance). */
  get fit(): string {
    return prepareVisual(this.key).def.wocCharacter?.fit ?? 'none';
  }

  /** Run the next step, under its span in the CPU build ledger (`record` off for a bake
   *  on the spot, whose caller's own span already covers it). */
  step(record = true): void {
    const stage = this.next;
    if (!stage) return;
    const started = performance.now();
    try {
      if (stage === WOC_FAR_ASSEMBLE_LABEL) this.assemble();
      else if (stage === WOC_FAR_SKIN_LABEL) this.skin();
      else this.finish();
    } catch (err) {
      // a throw leaves nothing to resume: the caller disposes the throwaway
      this.next = null;
      throw err;
    } finally {
      if (record) recordBuildSpan(WOC_FAR_BAKE_SPAN, performance.now() - started, started);
    }
  }

  /** The throwaway model, dressed as the body draws, posed mid-idle, and cut down to the
   *  vertices its far level draws. */
  private assemble(): void {
    const prep = prepareVisual(this.key);
    const def = prep.def;
    const manifest = def.wocCharacter;
    if (!manifest) {
      this.next = null;
      return;
    }
    const temp = assembleModel({ ...def, attach: [] }, null, null, null, {
      skipDecals: true,
      wocArmor: this.files,
      wocLod: WOC_FAR_BAKE_LOD,
    });
    this.temp = temp;
    temp.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        this.skeletons.add((o as THREE.SkinnedMesh).skeleton);
      }
    });
    applyWocPartVisibility(resolveWocPartNodes(temp, manifest), manifest, this.parts);
    // the modular head's drawn pieces ride the part set too (woc_head_dressing.ts),
    // posed with the character's frozen face a band at a time below (woc_far_head.ts)
    applyWocHeadBakeVisibility(temp, this.parts);
    // What the bake walks is first cut down to what it draws: each piece draws its far
    // level, an index over a fraction of its own vertices, so every later step (the head's
    // morphs, the skinning) transforms only those (far_bake_compact.ts). A raw copy of four
    // attributes: a small part of this unit, and the bands below are all of one cost.
    for (const mesh of composedFarMeshes(temp)) {
      const compact = compactDrawnVertices(mesh.geometry, FAR_BAKE_READS);
      if (compact === mesh.geometry) continue;
      mesh.geometry = compact;
      this.compacted.push(compact);
    }
    const idle = prep.clips.get(def.clips.idle);
    if (idle) {
      this.mixer = new THREE.AnimationMixer(temp);
      this.mixer.clipAction(idle).play();
      this.mixer.update(Math.min(0.5, idle.duration * 0.5));
    }
    temp.updateMatrixWorld(true);
    for (const skeleton of this.skeletons) skeleton.update();
    this.norm
      .makeTranslation(0, prep.yOffset, 0)
      .multiply(new THREE.Matrix4().makeRotationY(def.yaw ?? 0))
      .multiply(new THREE.Matrix4().makeScale(prep.normScale, prep.normScale, prep.normScale));
    this.next = WOC_FAR_SKIN_LABEL;
  }

  /**
   * One band of vertices: the head's morphs first, then the static bake of what they left.
   * The head's fold and the bake's own walk are taken once the head is posed.
   */
  private skin(): void {
    const temp = this.temp;
    if (!temp) {
      this.next = null;
      return;
    }
    let left = band;
    // the influences are written when the pose is built, the morphs baked a band at a time
    this.pose ??= new WocHeadBakePose(temp, this.head);
    const pose = this.pose;
    if (!this.baker) {
      const before = pose.remaining;
      if (!pose.advance(left)) return;
      left -= before;
      const manifest = prepareVisual(this.key).def.wocCharacter;
      const meshes = composedFarMeshes(temp);
      // the head pieces one material can draw share ONE group (woc_far_head.ts)
      this.fold = foldWocHeadForBake(temp, meshes, this.foldScratch);
      // every other group's head tint, by the near dressing's rule, partitioning the groups
      const type = wocHeadTypeForGender(manifest?.fit ?? 'male');
      this.tintOf = new Map(meshes.map((m) => [m, wocHeadTintTarget(m, type)]));
      this.meshes = meshes;
      this.baker = new StaticPoseBaker(this.norm, meshes);
    }
    // (a band the head's last morphs filled bakes nothing more: the next unit starts it)
    if (this.baker.advance(left)) this.next = WOC_FAR_FOLD_LABEL;
  }

  /** The merge, the head group's slots, and the far set's source materials. */
  private finish(): void {
    this.next = null;
    const baker = this.baker;
    const meshes = this.meshes;
    const fold = this.fold;
    const tintOf = this.tintOf;
    if (!baker) return;
    const baked = baker.finish((m) =>
      fold?.slotOf.has(m)
        ? WOC_FAR_HEAD_GROUP_KEY
        : `${farBakeGroupKey(m)}|${wocFarTintKey(tintOf.get(m) ?? null)}`,
    );
    if (!baked.geo) return;
    // (no shipped WOC mesh opts out of casting; a body that had one bakes its casters a
    // second time here, whole)
    const casters = meshes.filter(characterMeshCastsShadow);
    const shadowGeo =
      casters.length === meshes.length ? baked.geo : bakeStaticPose(this.norm, casters).geo;
    const { mats, isBody } = baked;
    const tints: WocFarGroupTint[] = baked.slots.map((slot) => tintOf.get(meshes[slot]) ?? null);
    const headAt = fold ? baked.slots.findIndex((slot) => fold.slotOf.has(meshes[slot])) : -1;
    if (fold && headAt >= 0) {
      setWocFarHeadSlots(baked.geo, meshes, baked.order, fold.slotOf);
      // the head group draws the merged source; its slots' own materials follow the
      // groups', for the far tier to derive beside them
      const groups = mats.length;
      mats[headAt] = fold.source;
      tints[headAt] = {
        slots: fold.slots,
        sources: fold.slotSources.map((_, slot) => groups + slot),
        hairMap: fold.hairMap,
        beardMap: fold.beardMap,
        scalpMap: fold.scalpMap,
      };
      for (const material of fold.slotSources) {
        mats.push(material);
        isBody.push(false);
      }
    }
    this.bake = { geo: baked.geo, shadowGeo, mats, isBody, tints };
  }

  /** Let go of the throwaway: a finished bake, a failed one, or one nobody waits for. */
  dispose(): void {
    this.next = null;
    // never drawn, so three holds nothing for them; they share the pieces' attributes and a
    // level's index list, which a drawn scratch's dispose would free under every wearer
    for (const geometry of this.pose?.scratch ?? []) geometry.dispose();
    for (const geometry of this.foldScratch) geometry.dispose();
    for (const geometry of this.compacted) geometry.dispose();
    this.pose = null;
    this.foldScratch.length = 0;
    this.compacted.length = 0;
    this.baker = null;
    const temp = this.temp;
    this.temp = null;
    try {
      for (const skeleton of this.skeletons) skeleton.dispose();
      this.skeletons.clear();
      if (temp) {
        this.mixer?.stopAllAction();
        this.mixer?.uncacheRoot(temp);
      }
      this.mixer = null;
    } finally {
      // whatever else fails, the armor files the throwaway held are given back
      if (temp) releaseWocArmorOf(temp);
    }
  }
}

/** The whole bake in one call (a body with no queue behind it). */
function bakeWocParts(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[],
  head: WocFarHeadPose | null,
): WocFarBake | null {
  const run = new WocFarBakeRun(key, parts, files, head);
  try {
    while (run.next) run.step(false);
    return run.bake;
  } finally {
    run.dispose();
  }
}

// ---------------------------------------------------------------------------
// The bake as units of the renderer's work queue
// ---------------------------------------------------------------------------

/** The slice of the renderer's background work queue a far bake rides
 *  (background_gpu_queue.ts: synchronous main-thread work is a valid unit there). */
export interface WocFarBakeQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** One body's ask for a queued bake. */
export interface WocFarBakeRequest {
  /** Settles once the bake is over, and never rejects. True: it is in the cache, HELD
   *  there for this asker (a finished bake is otherwise idle, and an idle bake is the
   *  first thing the next one trims) to retain from a unit of its own. False: there is
   *  none to mount (the look bakes to nothing, a unit threw and was reported, the queue
   *  shut down, or nobody waited any more), and the asker keeps its rig. */
  readonly ready: Promise<boolean>;
  /** This body is done with the ask: it has retained the bake itself (its mount), or no
   *  longer wants it (re-dressed, handed another gate, disposed). A bake nobody waits for
   *  never starts, or stops before its next unit; a finished one nobody holds goes idle.
   *  Idempotent. */
  release(): void;
}

/** One bake asked of a queue, from its first ask until it is over. */
interface Flight {
  readonly id: string;
  /** Settles when the bake is over (or was never started): whether the cache holds it. */
  readonly done: Promise<boolean>;
  /** Bodies still waiting on it: for the bake, then for their own mount of it. */
  waiters: number;
  /** The finished bake, held live for the bodies that have yet to mount it. */
  pin: WocFarBakeLease | null;
  /** Its turn has come: bake it. */
  readonly start: () => Promise<boolean>;
  readonly settle: (outcome: boolean | Promise<boolean>) => void;
}

/** One queue's bakes. ONE runs at a time: every bake in progress is a throwaway model
 *  kept alive across frames, and bakes sharing the queue's slots would all end together,
 *  late, with a crowd's worth of throwaways alive at once. In line, a bake costs a record. */
interface Flights {
  /** In line or in progress, by cache id: a crowd in one look shares one. */
  readonly byId: Map<string, Flight>;
  /** Asked for and not started, in the order they were asked. */
  readonly line: Flight[];
  busy: boolean;
}

/** Per queue, because a bake is only as alive as the queue its next unit waits in: a body
 *  handed another renderer's queue starts its own there. */
const flightsOf = new WeakMap<WocFarBakeQueue, Flights>();

const warned = new Set<string>();
const MAX_WARNED = 64;

/** Report a far bake or mount that stopped, once per `what` (dev channel). A queue shut
 *  down with its renderer rejects every unit at once, and is no failure. */
export function warnWocFarStopped(what: string, err: unknown): void {
  if (isGpuQueueShutdown(err) || warned.has(what)) return;
  if (warned.size >= MAX_WARNED) warned.clear();
  warned.add(what);
  console.warn(`[woc-far-bake] a far bake stopped (${what}), the body keeps its rig:`, err);
}

/** Start the next bake in line, unless one is in progress. One nobody waits for any more
 *  never starts: no throwaway, no unit. */
function startNext(flights: Flights): void {
  while (!flights.busy) {
    const flight = flights.line.shift();
    if (!flight) return;
    if (flight.waiters === 0) {
      if (flights.byId.get(flight.id) === flight) flights.byId.delete(flight.id);
      flight.settle(false);
      continue;
    }
    // baked by somebody else while it waited in line (a body with no queue): theirs
    // stands, held for the bodies that waited here
    const cached = cache.get(flight.id);
    if (cached && (cached.refs > 0 || current(cached))) {
      if (flights.byId.get(flight.id) === flight) flights.byId.delete(flight.id);
      flight.pin = leaseOf(flight.id, cached);
      flight.settle(true);
      continue;
    }
    flights.busy = true;
    flight.settle(flight.start());
  }
}

async function driveWocFarBake(
  flight: Flight,
  run: WocFarBakeRun,
  files: readonly WocArmorFile[],
  flights: Flights,
  queue: WocFarBakeQueue,
  priority: number,
): Promise<boolean> {
  const id = flight.id;
  try {
    const fit = run.fit;
    // The next unit is enqueued from this one's completion, never all at once: a bake in
    // progress holds one slot in the queue, and a bake nobody waits for stops here (a
    // body that asks again before it has stopped simply picks it up where it was).
    while (run.next && flight.waiters > 0) {
      await queue.run(
        () => {
          if (flight.waiters > 0) run.step();
        },
        priority,
        `${run.next}:${fit}`,
      );
    }
    const bake = run.bake;
    if (!bake) return false;
    // an idle entry whose files were freed since is what this bake replaces
    const old = cache.get(id);
    if (old && old.refs === 0 && !current(old)) drop(id, old);
    let entry = cache.get(id);
    if (entry) {
      // somebody baked it on the spot meanwhile (a body with no queue): theirs stands
      bake.geo.dispose();
      if (bake.shadowGeo !== bake.geo) bake.shadowGeo?.dispose();
    } else {
      entry = store(id, bake, files);
    }
    // held for the bodies that asked, until each has mounted it or let go
    if (flight.waiters > 0) flight.pin = leaseOf(id, entry);
    trimIdle();
    return true;
  } catch (err) {
    warnWocFarStopped(id, err);
    return false;
  } finally {
    if (flights.byId.get(id) === flight) flights.byId.delete(id);
    // The next bake in line starts once this one's askers have been told: their mounts
    // are queued ahead of its first unit. Whatever happens below, the line moves on.
    const next = (): void => {
      flights.busy = false;
      startNext(flights);
    };
    void flight.done.then(next, next);
    try {
      run.dispose();
    } catch (err) {
      // the bake itself stands (it is stored by now): only the throwaway's teardown failed
      warnWocFarStopped(`${id} (teardown)`, err);
    }
  }
}

/**
 * Ask for the bake of these inputs as units of `queue` at `priority` (the bodies it is for
 * are drawn whole by their rig meanwhile). Already cached: ready at once. Already asked
 * for: this body waits on the same bake. Otherwise it joins the queue's line. The asker
 * retains the bake once `ready` settles true (retainWocFarBake), from a unit of its own,
 * and then releases the ask.
 */
export function queueWocFarBake(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[],
  head: WocFarHeadPose | null,
  queue: WocFarBakeQueue,
  priority: number,
  partsKey?: string,
): WocFarBakeRequest {
  const id = cacheKey(key, parts, files, head, partsKey);
  const cached = cache.get(id);
  if (cached && (cached.refs > 0 || current(cached))) {
    const pin = leaseOf(id, cached);
    return { ready: Promise.resolve(true), release: () => pin.release() };
  }
  let flights = flightsOf.get(queue);
  if (!flights) {
    flights = { byId: new Map(), line: [], busy: false };
    flightsOf.set(queue, flights);
  }
  const all = flights;
  let flight = all.byId.get(id);
  if (flight) {
    flight.waiters++;
  } else {
    let settle: Flight['settle'] = () => undefined;
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const asked: Flight = {
      id,
      done,
      waiters: 1,
      pin: null,
      settle,
      start: () =>
        driveWocFarBake(
          asked,
          new WocFarBakeRun(key, parts, files, head),
          files,
          all,
          queue,
          priority,
        ),
    };
    all.byId.set(id, asked);
    all.line.push(asked);
    // first in line: its first unit is asked for before this returns
    startNext(all);
    flight = asked;
  }
  const joined = flight;
  let released = false;
  return {
    ready: joined.done,
    release() {
      if (released) return;
      released = true;
      joined.waiters--;
      if (joined.waiters > 0) return;
      joined.pin?.release();
      joined.pin = null;
    },
  };
}
