// The renderer's WOC armor store (the 2026-09-25 character size gameplan, steps
// 5 and 6): each armor set is its own pack per body fit and texture tier
// (woc_armor_core.ts), fetched the first time a character wears it, prepared
// once against its fit's base rig (woc_armor_bind.ts) and drawn by every
// wearer over one shared copy of its geometry and textures. How long a pack
// nobody draws stays is the idle rule's (woc_armor_core.ts
// wocArmorIdleEvictMs, read off the static graphics profile): the tier a crowd
// draws stays for the session on a desktop, the top levels of a high pack go
// after seconds, a phone frees everything soon. A freed pack's GPU textures
// and geometry are disposed and its parse dropped, and the next wearer fetches
// it again.
//
// The prepare (a merge, a rebake of every skinned vertex, a joint remap: the
// milliseconds of a file's first use) is ONE unit of the renderer's work queue
// per pack, asked for the moment the file lands (setWocArmorWorkQueue, and the
// fit's rig remembered from the first body built on it), so the frame budget
// places it and no wearer pays it inside a frame: a wearer with a queue behind
// it attaches only once the pack is prepared (woc_armor_dressing.ts). A pack a
// character waits on rides ahead of one only fetched ahead of need
// (prefetchWocArmorPack). A body built whole (a view under a curtain, a
// preview, a portrait) still prepares on the spot what no unit has yet.
//
// The low and medium packs are a file each. The HIGH pack is assembled here
// (2026-10-03): the medium file with the top mip level of every map laid over
// it, from the set's top file (woc_armor_top_levels.ts). Asking for it fetches
// the top file and the medium file together, and from that ask for as long as
// it is resident it holds a residency reference on its medium pack (its rigid
// parts draw the medium parse's own geometry, and its maps the medium
// textures' own lower levels), so a medium pack is never freed under a high
// one. Freeing a high pack disposes only what it made: its material clones,
// its combined textures and its prepared geometry. Its top parse is let go
// the moment the assembly holds its level 0 data. A failed top fetch leaves
// the medium pack drawing (it is the stand-in, woc_armor_core.ts
// wocStandInTier) and is retried no sooner than PACK_RETRY_MS later, like any
// failed file.
//
// Nothing here blocks. A character whose set has not arrived draws its body's
// own black suit (or a resident tier of the same set) and attaches the set once
// it has landed (woc_armor_dressing.ts: on the spot, or as a unit of the work
// queue behind a world view), through the host's compile gate.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { applyGeometryLod, type GeometryLodLevel } from '../assets/geometry_lod';
import { classifyGltfKtx2Textures } from '../assets/ktx2_mip_release';
import { loadGltf, releaseGltf } from '../assets/loader';
import { GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { recordBuildSpan, timeBuildSpan } from '../build_spans';
import { GFX } from '../gfx';
import { applyTextureAnisotropy } from '../texture_anisotropy';
import { logAssetMissOnce } from './asset_miss_log';
import {
  hangWocRigidArmor,
  instantiateWocArmor,
  type PreparedWocArmor,
  prepareWocArmor,
  type WocRigBind,
  wocRigBindOf,
  wocRigSkeletonOf,
} from './woc_armor_bind';
import {
  parseWocArmorPackUrl,
  WOC_ARMOR_IDLE_EVICT_MS,
  WocArmorResidency,
  type WocArmorTier,
  type WocFit,
  wocArmorIdleEvictMs,
  wocArmorPackBaseUrl,
  wocArmorPackUrl,
  wocArmorTierFor,
} from './woc_armor_core';
import {
  assembleWocArmorTop,
  disposeWocArmorTopParse,
  type WocArmorTopAssembly,
} from './woc_armor_top_levels';
import type { WocCharacterManifest } from './woc_character_manifest';
import { wocMergePartition } from './woc_parts_core';

/** A failed fetch is retried no sooner than this after the failure. */
const PACK_RETRY_MS = 8000;

/** A high pack's own state (null on a file pack). */
interface AssembledPack {
  /** The medium pack it is laid over, referenced from the ask on. */
  readonly base: string;
  /** Which ask this is: a settle of an earlier one is dropped. */
  readonly attempt: number;
  /** The top parse, held from its landing until the medium pack settles. */
  top: GLTF | null;
  /** What the assembly made (and the pack frees): the material clones, the combined textures. */
  made: WocArmorTopAssembly | null;
}

/** One prepare unit handed to a work queue. */
interface PrepareTicket {
  readonly queue: WocArmorWorkQueue;
  readonly priority: number;
}

interface PackEntry {
  /** The pack's fit and tier, read off its url once (null for a url that names no pack). */
  readonly fit: WocFit | null;
  readonly tier: WocArmorTier | null;
  /** What names the pack in a work-queue label: `<fit>:<set>:<tier>`. */
  readonly label: string;
  /** What the parts are prepared from: the file's own parse, or a high pack's assembled scene.
   *  Null until the pack is resident. */
  scene: THREE.Object3D | null;
  loading: boolean;
  failedAt: number;
  prepared: PreparedWocArmor | null;
  /** The bind matrix the templates were rebaked against (instances bind with it). */
  bindMatrix: THREE.Matrix4 | null;
  /** Which parse this is (a freed and refetched file is a new one, with new materials). */
  generation: number;
  assembled: AssembledPack | null;
  /** A character asked for it (ensureWocArmorPack), where a prefetch only fetched it: its
   *  prepare rides ahead of the background's. */
  wanted: boolean;
  /** Its prepare unit sitting in a work queue (which queue, at which priority); null with
   *  none asked for. */
  prepareQueued: PrepareTicket | null;
  /** Its prepare threw: this parse attaches nowhere (a refetch is another parse). */
  broken: boolean;
}

const packs = new Map<string, PackEntry>();
// A ledger row with no pack behind it (a holder let go of a pack already freed) goes at
// the next sweep; a pack whose url names no tier keeps the default window.
const residency = new WocArmorResidency((url) => {
  const entry = packs.get(url);
  if (!entry) return 0;
  return entry.tier ? wocArmorIdleEvictMs(entry.tier, GFX) : WOC_ARMOR_IDLE_EVICT_MS;
});
const readyListeners = new Set<(url: string) => void>();
/** Fired when a fetch settles either way (a bounded wait stops waiting on a failure too). */
const settleListeners = new Set<() => void>();
let generations = 0;
let attempts = 0;

/** Frame clock for the idle window: performance.now where it exists (tests pass their own). */
let clock: () => number = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Test seam: drive the idle window from a fake clock. */
export function setWocArmorClockForTest(next: (() => number) | null): void {
  clock = next ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
}

/** The slice of the renderer's background work queue the store rides
 *  (background_gpu_queue.ts: synchronous main-thread work is a valid unit there). */
export interface WocArmorWorkQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** The work-queue label kind of a pack's prepare (the budget learns a cost per kind:
 *  gpu_prep_budget_core.ts gpuPrepKindOfLabel); the pack's fit, set and tier follow it, so a
 *  slow unit names the file it prepared. */
export const WOC_ARMOR_PREPARE_LABEL = 'woc-armor-prepare';

let workQueue: WocArmorWorkQueue | null = null;

/** What a pack is prepared against: its fit's base rig, and a manifest of that fit (the merge
 *  partition reads the fit's whole catalog through it, so any class's answers alike). */
interface FitRig {
  readonly rig: WocRigBind;
  readonly manifest: WocCharacterManifest;
}
const rigs = new Map<WocFit, FitRig>();

/**
 * Hand the store the renderer's background work queue (null: none). Every character the
 * world view builds passes its own on (CharacterVisual.setFarBakeGate), so the store has it
 * from the first view of a session; a host that fetches ahead of any view calls this itself.
 * With a queue, a pack that lands is prepared as one unit of it; without one, the first body
 * to attach the pack prepares it on the spot. ONE queue at a time, the last one handed in:
 * a page runs one world renderer, and a rebuilt one hands in its own.
 */
export function setWocArmorWorkQueue(queue: WocArmorWorkQueue | null): void {
  if (queue === workQueue) return;
  workQueue = queue;
  if (queue) queueWaitingPrepares();
}

/**
 * Remember a fit's base rig from a body built on it (every WOC build calls this:
 * woc_armor_dressing.ts attachWocArmorAtBuild), so a pack that lands with nobody wearing it
 * can be prepared against it. Free after the first body of a fit.
 */
export function noteWocArmorRig(model: THREE.Object3D, manifest: WocCharacterManifest): void {
  if (rigs.has(manifest.fit)) return;
  const rig = wocRigBindOf(model);
  if (!rig) return;
  // its own copy of the inverses: the body they were read off shares that array with every
  // clone of its base, and this one outlives them all
  const boneInverses = rig.boneInverses.map((inverse) => inverse.clone());
  rigs.set(manifest.fit, { rig: { ...rig, boneInverses }, manifest });
  queueWaitingPrepares();
}

/** A queue or a rig just arrived: every resident pack that landed without them gets its
 *  unit now (ahead of the background's for one a character asked for), so the next body
 *  that wears it finds it prepared instead of paying for it inside its own build. */
function queueWaitingPrepares(): void {
  for (const [url, entry] of packs) queuePrepare(url, entry, entry.wanted);
}

/**
 * Put a resident pack's prepare on the work queue: at the visible-prewarm priority for a
 * pack a character waits on (`urgent`), in the background for one only fetched ahead of
 * need (and only while it is the tier a crowd draws). Returns whether a unit of the CURRENT
 * queue is pending for it afterwards: false for a pack already prepared (or broken), and
 * when there is no queue or no rig of its fit to prepare it with. A unit already there at a lower priority, or left in a queue since
 * replaced, is overtaken by a new one and runs to nothing.
 */
function queuePrepare(url: string, entry: PackEntry, urgent: boolean): boolean {
  if (!entry.scene || entry.prepared || entry.broken) return false;
  // ahead of need only for the tier a crowd draws NOW: after a preset change the packs the
  // prefetch asked for at the old tier still land, and nobody may ever wear them
  if (!urgent && entry.tier !== wocArmorTierFor(GFX, 'crowd')) return false;
  const priority = urgent ? GPU_WORK_PRIORITY.VISIBLE_PREWARM : GPU_WORK_PRIORITY.BACKGROUND;
  const queue = workQueue;
  const pending = entry.prepareQueued;
  if (pending && pending.queue === queue && pending.priority >= priority) return true;
  const fit = entry.fit ? rigs.get(entry.fit) : undefined;
  if (!queue || !fit) return false;
  const ticket: PrepareTicket = { queue, priority };
  entry.prepareQueued = ticket;
  const settled = (): void => {
    if (entry.prepareQueued === ticket) entry.prepareQueued = null;
  };
  queue
    .run(
      () => {
        // freed (or refetched) while the unit waited: that parse is gone
        if (packs.get(url) !== entry || entry.prepared) return;
        const started = performance.now();
        preparePack(url, entry, fit);
        // its own view-lane kind: it runs from the queue, never inside a view build
        recordBuildSpan('view:woc-armor-prepare', performance.now() - started, started);
      },
      priority,
      `${WOC_ARMOR_PREPARE_LABEL}:${entry.label}`,
    )
    .then(settled, () => {
      // refused: the queue was shut down under it (a renderer rebuild). The next view
      // hands the next queue in; until then a body that needs the pack prepares it itself
      settled();
      if (workQueue === queue) workQueue = null;
    });
  // (a queue that ran the unit inside the ask left nothing to wait for)
  return !entry.prepared && !entry.broken;
}

/** Prepare a resident pack against its fit's rig (once per parse). Null when it cannot be:
 *  a file whose prepare throws is left off for good, named once, and never tried again
 *  from a frame. */
function preparePack(url: string, entry: PackEntry, fit: FitRig): PreparedWocArmor | null {
  if (entry.prepared) return entry.prepared;
  if (!entry.scene || entry.broken) return null;
  let prepared: PreparedWocArmor;
  try {
    prepared = prepareWocArmor(cloneSkinned(entry.scene), fit.rig, (mesh) =>
      wocMergePartition(fit.manifest, mesh.name),
    );
  } catch (err) {
    entry.broken = true;
    logAssetMissOnce(
      `woc-armor-prepare:${url}`,
      `WOC armor ${url} could not be prepared, its wearers keep their suit:`,
      err,
    );
    return null;
  }
  entry.prepared = prepared;
  entry.bindMatrix = fit.rig.bindMatrix;
  if (prepared.refused.length > 0) {
    logAssetMissOnce(
      `woc-armor-refused:${url}`,
      `WOC armor ${url}: parts whose bind pose differs from the base rig were left off: ${prepared.refused.join(', ')}`,
    );
  }
  return prepared;
}

/** Whether an armor pack is parsed (a high pack: assembled) and ready to attach. */
export function wocArmorPackResident(url: string): boolean {
  return packs.get(url)?.scene != null;
}

/** Whether a resident pack is prepared: attaching it costs no merge and no rebake. */
export function wocArmorPackPrepared(url: string): boolean {
  return packs.get(url)?.prepared != null;
}

/**
 * A character with a work queue behind it is about to attach a resident pack: whether the
 * pack still waits on its prepare unit, which this asks for (ahead of the background's, when
 * a prefetch left one there). False for a prepared pack, and when nothing can prepare it off
 * the frame (no queue, no rig of its fit yet): the attach then prepares it itself.
 */
export function wocArmorPackAwaitsPrepare(url: string): boolean {
  const entry = packs.get(url);
  if (!entry) return false;
  entry.wanted = true;
  return queuePrepare(url, entry, true);
}

/** Which parse of a pack is resident (0 when none): a holder of its materials that let go
 *  of it (an idle far bake) checks this before drawing those materials again. */
export function wocArmorPackGeneration(url: string): number {
  const entry = packs.get(url);
  return entry?.scene ? entry.generation : 0;
}

/** Observe an armor pack becoming resident (the dressing polls instead; hosts that have no
 *  per-frame poll, and tests, listen). */
export function onWocArmorPackReady(listener: (url: string) => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/** Kick the fetch of an armor pack a character is about to draw (idempotent; a failed fetch
 *  re-arms after a cooldown). A high pack fetches its top file and its medium file together. */
export function ensureWocArmorPack(url: string): void {
  requestPack(url, true);
}

/**
 * Fetch an armor pack ahead of need, with nobody waiting on it (the crowd prefetch after
 * first paint, woc_crowd_prefetch.ts): background work end to end. Its download waits in the
 * loader's background class, behind every file somebody needs now
 * (assets/load_queue_core.ts), and its prepare rides the BACKGROUND lane of the work queue
 * (setWocArmorWorkQueue), behind everything a frame is waiting for, so the first wearer
 * finds it prepared. A character that asks for it meanwhile moves both ahead.
 */
export function prefetchWocArmorPack(url: string): void {
  requestPack(url, false);
}

/** How the loader is asked for a pack's file: as a demand for one a character waits on, as
 *  background work for one only fetched ahead of need. */
function fetchOptions(entry: PackEntry): { priority: 'background' } | undefined {
  return entry.wanted ? undefined : { priority: 'background' };
}

function requestPack(url: string, wanted: boolean): void {
  let entry = packs.get(url);
  if (entry && wanted) {
    if (!entry.wanted) {
      // a character now waits on a pack a prefetch asked for: the fetch still waiting in the
      // loader's background class joins its demand line (the same fetch, never a second one)
      if (entry.loading) void loadGltf(url).catch(() => undefined);
      // ...and a prefetch that failed is not this character's failure: its first ask goes
      // out now, not after the cooldown of a download nobody was waiting for
      else entry.failedAt = -Infinity;
    }
    entry.wanted = true;
  }
  if (entry?.scene || entry?.loading) return;
  const now = clock();
  if (entry && now - entry.failedAt < PACK_RETRY_MS) return;
  if (!entry) {
    const parsed = parseWocArmorPackUrl(url);
    entry = {
      fit: parsed?.fit ?? null,
      tier: parsed?.tier ?? null,
      label: parsed ? `${parsed.fit}:${parsed.set}:${parsed.tier}` : 'file',
      scene: null,
      loading: false,
      failedAt: -Infinity,
      prepared: null,
      bindMatrix: null,
      generation: 0,
      assembled: null,
      wanted,
      prepareQueued: null,
      broken: false,
    };
    packs.set(url, entry);
  }
  const base = wocArmorPackBaseUrl(url);
  if (base) loadAssembled(url, entry, base);
  else loadFile(url, entry);
}

function loadFile(url: string, record: PackEntry): void {
  record.loading = true;
  loadGltf(url, fetchOptions(record)).then(
    (gltf) => {
      record.loading = false;
      // freed (or superseded) while in flight: drop the late parse
      if (packs.get(url) !== record) return;
      record.scene = gltf.scene;
      landed(url, record);
      // a high pack waiting on this file assembles now
      settleAssemblies(url);
    },
    (err: unknown) => {
      record.loading = false;
      record.failedAt = clock();
      logAssetMissOnce(`woc-armor:${url}`, `WOC armor set failed to load: ${url}`, err);
      // ...or gives up with it
      settleAssemblies(url);
      for (const settle of settleListeners) settle();
    },
  );
}

/** A pack became resident: a new generation, its idle window, everyone told, and its prepare
 *  put on the work queue (after the listeners: one that builds a body on the spot, a
 *  portrait, prepares the pack itself and leaves the queue nothing to do). */
function landed(url: string, record: PackEntry): void {
  record.generation = ++generations;
  residency.noteResident(url, clock());
  for (const listener of readyListeners) {
    try {
      listener(url);
    } catch (err) {
      console.warn('WOC armor ready listener failed', err);
    }
  }
  for (const settle of settleListeners) settle();
  queuePrepare(url, record, record.wanted);
}

/** Ask for a high pack: its medium pack referenced (and fetched, when it is not resident) and
 *  its top file fetched; it assembles once both are in hand. */
function loadAssembled(url: string, record: PackEntry, base: string): void {
  record.loading = true;
  const own: AssembledPack = { base, attempt: ++attempts, top: null, made: null };
  record.assembled = own;
  residency.acquire(base);
  requestPack(base, record.wanted);
  // a medium file in its retry cooldown cannot carry the top levels: never fetch (and
  // transcode) the largest file for nothing, ask again with it after the cooldown
  const medium = packs.get(base);
  if (!medium?.scene && !medium?.loading) {
    giveUp(url, record, new Error(`its medium file is waiting to be asked again: ${base}`));
    return;
  }
  loadGltf(url, fetchOptions(record)).then(
    (top) => {
      if (packs.get(url) !== record || record.assembled !== own) return;
      own.top = top;
      assemble(url, record);
    },
    (err: unknown) => {
      if (packs.get(url) !== record || record.assembled !== own) return;
      giveUp(url, record, err);
    },
  );
}

/** A file pack settled, landed or failed: every high pack waiting on it with its top parse in
 *  hand moves on. */
function settleAssemblies(base: string): void {
  for (const [url, entry] of packs) {
    if (entry.loading && entry.assembled?.base === base && entry.assembled.top) {
      assemble(url, entry);
    }
  }
}

/** Assemble a high pack whose top parse is in hand, once its medium pack has settled (a medium
 *  file that failed fails it too: both are asked again after the cooldown). */
function assemble(url: string, record: PackEntry): void {
  const own = record.assembled;
  const top = own?.top;
  if (!own || !top || !record.loading) return;
  const base = packs.get(own.base);
  // the medium file still streams: its landing comes back here
  if (base?.loading) return;
  if (!base?.scene) {
    giveUp(url, record, new Error(`its medium file did not load: ${own.base}`));
    return;
  }
  let made: WocArmorTopAssembly;
  try {
    made = assembleWocArmorTop(base.scene, top.scene);
    // what the loader gives every texture of a character url (loader.ts): CPU levels kept
    // resident (a preview renderer uploads these textures on its own context too), and the
    // tier's anisotropy on the colour and normal maps
    classifyGltfKtx2Textures({ scene: made.scene }, url);
    polishAssembled(made);
  } catch (err) {
    // a throw out of a fetch's settle would leave the pack loading for good
    giveUp(url, record, err);
    return;
  }
  own.top = null;
  own.made = made;
  record.scene = made.scene;
  record.loading = false;
  // the top parse is spent: its level 0 data lives on in the combined textures
  releaseGltf(url);
  disposeWocArmorTopParse(top.scene);
  if (made.unpaired.length > 0) {
    logAssetMissOnce(
      `woc-armor-top:${url}`,
      `WOC armor ${url}: no top level fits ${made.unpaired.join(', ')}; those maps draw at medium`,
    );
  }
  landed(url, record);
}

/** The loader's anisotropy stamp (loader.ts polishGltfTextures) on the combined textures, which
 *  it never saw, registered so a budget resolved later lands before the world's first upload. */
function polishAssembled(made: WocArmorTopAssembly): void {
  const own = new Set<THREE.Texture>(made.textures);
  const seen = new Set<THREE.Texture>();
  for (const material of made.materials) {
    const std = material as THREE.MeshStandardMaterial;
    for (const [texture, kind] of [
      [std.map, 'colour'],
      [std.normalMap, 'normal'],
    ] as const) {
      if (!texture || !own.has(texture) || seen.has(texture)) continue;
      seen.add(texture);
      applyTextureAnisotropy(texture, kind);
    }
  }
}

/** A high pack that could not assemble: its top parse let go, its medium pack's reference given
 *  back (the medium pack stays resident for whoever draws it), retried after the cooldown. */
function giveUp(url: string, record: PackEntry, err: unknown): void {
  const own = record.assembled;
  record.loading = false;
  record.failedAt = clock();
  record.assembled = null;
  if (own?.top) {
    releaseGltf(url);
    disposeWocArmorTopParse(own.top.scene);
  }
  if (own) residency.release(own.base, clock());
  logAssetMissOnce(`woc-armor:${url}`, `WOC armor set failed to load: ${url}`, err);
  for (const settle of settleListeners) settle();
}

/** Tag a container of attached armor carries (dispose and the dressing find it by this). */
export const WOC_ARMOR_CONTAINER = 'wocArmorPack';

/** The FILE material each attached armor mesh hangs with, kept because a host's material
 *  pass replaces `mesh.material` with its own derivation: the merged armor
 *  (woc_armor_merge.ts) folds the drawn parts that share a file material into one draw. A
 *  WeakMap, never userData (Object3D.copy JSON-clones userData). */
const fileMaterials = new WeakMap<THREE.Object3D, THREE.Material>();

function noteFileMaterial(o: THREE.Object3D): void {
  const material = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material : null;
  if (material && !Array.isArray(material)) fileMaterials.set(o, material);
}

/** The file material an attached armor mesh hangs with (null for a mesh this store did not
 *  attach, or one drawn with several materials). */
export function wocArmorFileMaterial(mesh: THREE.Object3D): THREE.Material | null {
  return fileMaterials.get(mesh) ?? null;
}

/**
 * Attach a resident armor file's parts to a character model (a base clone): a Group of
 * SkinnedMeshes bound to the model's own skeleton, and the rigid parts hung on the model's
 * own bones (listed on the Group, wocArmorPieces), every part hidden until the dressing
 * shows it. Null when the file is not resident, the model has no rig, or the file could not
 * be prepared. Takes a residency reference, which releaseWocArmorContainer gives back. All
 * of it or none: an attach that throws leaves nothing on the model and takes no reference.
 * `lod`: the geometry level the character draws (woc_lod_core.ts), each part over its shared
 * variant of that level.
 */
export function attachWocArmorPack(
  model: THREE.Object3D,
  url: string,
  set: string,
  manifest: WocCharacterManifest,
  lod: GeometryLodLevel = 'lod0',
): THREE.Group | null {
  const entry = packs.get(url);
  if (!entry?.scene) return null;
  const skeleton = wocRigSkeletonOf(model);
  if (!skeleton) return null;
  let prepared = entry.prepared;
  if (!prepared) {
    // no unit prepared it yet (no queue, or a body built whole ahead of its turn): here
    // and now, against this very body's rig, as every first attach did. Named in the build
    // ledger as a step of whatever build pays for it (a queue unit names its own)
    const rig = wocRigBindOf(model);
    prepared = rig
      ? timeBuildSpan('view-part:woc-armor-prepare', () =>
          preparePack(url, entry, { rig, manifest }),
        )
      : null;
    if (!prepared) return null;
  }
  const container = new THREE.Group();
  container.name = `woc_armor_${set}`;
  container.userData.wocArmorSet = set;
  let rigid: THREE.Object3D[] = [];
  try {
    for (const mesh of instantiateWocArmor(
      prepared.templates,
      skeleton,
      entry.bindMatrix ?? new THREE.Matrix4(),
    )) {
      mesh.visible = false;
      noteFileMaterial(mesh);
      container.add(mesh);
    }
    model.add(container);
    rigid = hangWocRigidArmor(prepared.rigid, model);
    for (const wrapper of rigid) {
      for (const part of wrapper.children) part.visible = false;
      wrapper.traverse(noteFileMaterial);
    }
    if (lod !== 'lod0') for (const piece of [container, ...rigid]) applyGeometryLod(piece, lod);
  } catch (err) {
    // all of it or none: a half-hung file would sit on the model with no reference behind it
    container.removeFromParent();
    for (const wrapper of rigid) wrapper.removeFromParent();
    throw err;
  }
  // tagged and referenced in one step, after nothing can throw: a tag is a reference owed
  container.userData[WOC_ARMOR_CONTAINER] = url;
  container.userData.wocArmorRigid = rigid;
  residency.acquire(url);
  return container;
}

/** Every node an attached file hangs on a model: its Group of skinned parts and the wrapper
 *  of each rigid part on its bone (what a host sets up, gates and forgets together). */
export function wocArmorPieces(container: THREE.Object3D): THREE.Object3D[] {
  const rigid = container.userData.wocArmorRigid;
  return [container, ...(Array.isArray(rigid) ? (rigid as THREE.Object3D[]) : [])];
}

/** Every attached armor container under a model. */
export function wocArmorContainers(model: THREE.Object3D): THREE.Group[] {
  const out: THREE.Group[] = [];
  for (const child of model.children) {
    if (typeof child.userData[WOC_ARMOR_CONTAINER] === 'string') out.push(child as THREE.Group);
  }
  return out;
}

/** Detach a container (if still attached) and give its residency reference back: the
 *  reference goes back whatever the detach throws. */
export function releaseWocArmorContainer(container: THREE.Object3D): void {
  const url = container.userData[WOC_ARMOR_CONTAINER];
  if (typeof url !== 'string') return;
  delete container.userData[WOC_ARMOR_CONTAINER];
  try {
    for (const piece of wocArmorPieces(container)) piece.removeFromParent();
    container.userData.wocArmorRigid = [];
  } finally {
    residency.release(url, clock());
    sweepWocArmorPacks();
  }
}

/** Give back every container a model carries (CharacterVisual.dispose, a throwaway bake):
 *  the backstop of every teardown, so one container that cannot detach never keeps the
 *  others' references. */
export function releaseWocArmorOf(model: THREE.Object3D): void {
  for (const container of wocArmorContainers(model)) {
    try {
      releaseWocArmorContainer(container);
    } catch (err) {
      reportFreeFailure(`${container.name}`, err);
    }
  }
}

/** A teardown step that threw: named once per message on the dev channel, never rethrown
 *  (the rest of the teardown, and every other holder's, must still run). */
function reportFreeFailure(what: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  logAssetMissOnce(
    `woc-armor-free:${detail}`,
    `WOC armor ${what} threw while it was freed (the rest was freed all the same):`,
    err,
  );
}

/** Hold an armor file resident without drawing it (a far-LOD bake taken off its materials). */
export function retainWocArmorPack(url: string): void {
  residency.acquire(url);
}

/** Give back a retainWocArmorPack reference. */
export function releaseWocArmorPack(url: string): void {
  residency.release(url, clock());
  sweepWocArmorPacks();
}

function disposeMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
  }
}

/** Dispose every one of `resources`, whatever one of them throws: a pack is already off the
 *  books when its resources go, so one that threw would strand all the rest on the GPU. */
function disposeEach(url: string, resources: Iterable<{ dispose(): void }>): void {
  for (const resource of resources) {
    try {
      resource.dispose();
    } catch (err) {
      reportFreeFailure(url, err);
    }
  }
}

/** Free one pack. A file: its prepared geometry, its materials and their textures, and its
 *  parse. A high pack: only what it made (its prepared geometry, its material clones, its
 *  combined textures), then its medium pack's reference, which starts that pack's own idle
 *  window: its rigid parts and its scene draw the medium parse's geometry, and a map with no
 *  top level the medium texture itself. */
function freePack(url: string): void {
  const entry = packs.get(url);
  packs.delete(url);
  residency.forget(url);
  if (!entry) return;
  const geometries = new Set<THREE.BufferGeometry>();
  for (const t of entry.prepared?.templates ?? []) geometries.add(t.geometry);
  const own = entry.assembled;
  if (own) {
    disposeEach(url, geometries);
    disposeEach(url, own.made?.materials ?? []);
    disposeEach(url, own.made?.textures ?? []);
    residency.release(own.base, clock());
    return;
  }
  // rigid parts draw the parse's own geometry (hangWocRigidArmor clones share it)
  for (const part of entry.prepared?.rigid ?? []) {
    part.node.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) geometries.add((o as THREE.Mesh).geometry);
    });
  }
  if (entry.scene) {
    const materials = new Set<THREE.Material>();
    entry.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(m);
      }
    });
    const textures = new Set<THREE.Texture>();
    for (const m of materials) disposeMaterialTextures(m, textures);
    disposeEach(url, materials);
    disposeEach(url, textures);
  }
  disposeEach(url, geometries);
  releaseGltf(url);
}

/** Free every pack idle past its window (woc_armor_core.ts wocArmorIdleEvictMs; called on
 *  every release; cheap). A pack that throws while it is freed never keeps the others: they
 *  are off the ledger already, and nothing would come back for them. */
export function sweepWocArmorPacks(now = clock()): string[] {
  lastSweep = now;
  const expired = residency.takeExpired(now);
  for (const url of expired) {
    if (residency.refs(url) > 0) continue;
    try {
      freePack(url);
    } catch (err) {
      reportFreeFailure(url, err);
    }
  }
  return expired;
}

/** How often the per-frame poll sweeps on its own: a quiet area with no releases still
 *  frees an idle set about on time. */
const SWEEP_EVERY_MS = 5000;
let lastSweep = -Infinity;

/** The per-frame tick's sweep (woc_armor_dressing.ts poll): a clock read, and a sweep at
 *  most every SWEEP_EVERY_MS. */
export function tickWocArmorPacks(now = clock()): void {
  if (now - lastSweep >= SWEEP_EVERY_MS) sweepWocArmorPacks(now);
}

/** How long a graphics rebuild waits on the new tier's files before it reveals anyway (the
 *  resident tier stands in meanwhile, so a slow link never holds the curtain). */
const TIER_SWITCH_WAIT_MS = 8000;

/**
 * A graphics setting change (graphics_profile.ts, the characters' preparer): fetch the new
 * tier's file of every set drawn now or within the last WOC_ARMOR_IDLE_EVICT_MS (the rebuild
 * has already released the old visuals, and anything still holding a set counts as drawing
 * it), so the rebuilt characters attach it at once instead of drawing the old tier in its
 * place. Never of every set in memory: a desktop keeps a session's sets
 * (woc_armor_core.ts wocArmorIdleEvictMs), and the rebuild's curtain must not wait on the
 * files of characters long gone. The caller passes the tier every character of the new
 * profile draws first (assets.ts: low, or the medium file, which the local player's own high
 * pack is then laid over through the normal stand-in path). Resolves once they land (or after
 * a bounded wait).
 */
export async function prepareWocArmorTier(tier: WocArmorTier): Promise<void> {
  const wanted = new Set<string>();
  const now = clock();
  for (const [url, entry] of packs) {
    if (!entry.scene || !residency.drawnWithin(url, now, WOC_ARMOR_IDLE_EVICT_MS)) continue;
    const parsed = parseWocArmorPackUrl(url);
    if (parsed) wanted.add(wocArmorPackUrl(parsed.fit, parsed.set, tier));
  }
  const pending = [...wanted].filter((url) => !wocArmorPackResident(url));
  if (pending.length === 0) return;
  for (const url of pending) ensureWocArmorPack(url);
  // settled: every file landed or failed (a failed one stops the wait, never holds it)
  const settled = (): boolean => pending.every((url) => !packs.get(url)?.loading);
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      settleListeners.delete(check);
      resolve();
    };
    const check = (): void => {
      if (settled()) finish();
    };
    const timer = setTimeout(finish, TIER_SWITCH_WAIT_MS);
    settleListeners.add(check);
    check();
  });
}

/** Live references to a file (tests, dev overlays). */
export function wocArmorPackRefs(url: string): number {
  return residency.refs(url);
}

/** Every resident armor parse, and every assembled high scene over its medium parse (dev
 *  residency accounting, assets/residency_budget.ts). */
export function wocArmorResidentScenes(): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const entry of packs.values()) if (entry.scene) out.push(entry.scene);
  return out;
}
