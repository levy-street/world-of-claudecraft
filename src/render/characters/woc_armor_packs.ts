// The renderer's WOC armor store (the 2026-09-25 character size gameplan, steps
// 5 and 6): each armor set is its own pack per body fit and texture tier
// (woc_armor_core.ts), fetched the first time a character wears it, prepared
// once against its fit's base rig (woc_armor_bind.ts) and drawn by every
// wearer over one shared copy of its geometry and textures. A set nobody has
// worn for WOC_ARMOR_IDLE_EVICT_MS is freed: its GPU textures and geometry are
// disposed and its parse dropped, and the next wearer fetches it again.
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
// own black suit (or a resident tier of the same set) and attaches the set on
// the frame it lands (woc_armor_dressing.ts), through the host's compile gate.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { applyGeometryLod, type GeometryLodLevel } from '../assets/geometry_lod';
import { classifyGltfKtx2Textures } from '../assets/ktx2_mip_release';
import { loadGltf, releaseGltf } from '../assets/loader';
import { applyTextureAnisotropy } from '../texture_anisotropy';
import { logAssetMissOnce } from './asset_miss_log';
import {
  hangWocRigidArmor,
  instantiateWocArmor,
  type PreparedWocArmor,
  prepareWocArmor,
  wocRigBindOf,
  wocRigSkeletonOf,
} from './woc_armor_bind';
import {
  parseWocArmorPackUrl,
  WocArmorResidency,
  type WocArmorTier,
  wocArmorPackBaseUrl,
  wocArmorPackUrl,
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

interface PackEntry {
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
}

const packs = new Map<string, PackEntry>();
const residency = new WocArmorResidency();
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

/** Whether an armor pack is parsed (a high pack: assembled) and ready to attach. */
export function wocArmorPackResident(url: string): boolean {
  return packs.get(url)?.scene != null;
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

/** Kick the fetch of an armor pack (idempotent; a failed fetch re-arms after a cooldown). A
 *  high pack fetches its top file and its medium file together. */
export function ensureWocArmorPack(url: string): void {
  let entry = packs.get(url);
  if (entry?.scene || entry?.loading) return;
  const now = clock();
  if (entry && now - entry.failedAt < PACK_RETRY_MS) return;
  if (!entry) {
    entry = {
      scene: null,
      loading: false,
      failedAt: -Infinity,
      prepared: null,
      bindMatrix: null,
      generation: 0,
      assembled: null,
    };
    packs.set(url, entry);
  }
  const base = wocArmorPackBaseUrl(url);
  if (base) loadAssembled(url, entry, base);
  else loadFile(url, entry);
}

function loadFile(url: string, record: PackEntry): void {
  record.loading = true;
  loadGltf(url).then(
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

/** A pack became resident: a new generation, its idle window, and everyone told. */
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
}

/** Ask for a high pack: its medium pack referenced (and fetched, when it is not resident) and
 *  its top file fetched; it assembles once both are in hand. */
function loadAssembled(url: string, record: PackEntry, base: string): void {
  record.loading = true;
  const own: AssembledPack = { base, attempt: ++attempts, top: null, made: null };
  record.assembled = own;
  residency.acquire(base);
  ensureWocArmorPack(base);
  // a medium file in its retry cooldown cannot carry the top levels: never fetch (and
  // transcode) the largest file for nothing, ask again with it after the cooldown
  const medium = packs.get(base);
  if (!medium?.scene && !medium?.loading) {
    giveUp(url, record, new Error(`its medium file is waiting to be asked again: ${base}`));
    return;
  }
  loadGltf(url).then(
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
 * shows it. Null when the file is not resident or the model has no rig. Takes a residency
 * reference, which releaseWocArmorContainer gives back. `lod`: the geometry level the
 * character draws (woc_lod_core.ts), each part over its shared variant of that level.
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
  if (!entry.prepared) {
    const rig = wocRigBindOf(model);
    if (!rig) return null;
    entry.prepared = prepareWocArmor(cloneSkinned(entry.scene), rig, (mesh) =>
      wocMergePartition(manifest, mesh.name),
    );
    entry.bindMatrix = rig.bindMatrix;
    if (entry.prepared.refused.length > 0) {
      logAssetMissOnce(
        `woc-armor-refused:${url}`,
        `WOC armor ${url}: parts whose bind pose differs from the base rig were left off: ${entry.prepared.refused.join(', ')}`,
      );
    }
  }
  const container = new THREE.Group();
  container.name = `woc_armor_${set}`;
  container.userData[WOC_ARMOR_CONTAINER] = url;
  container.userData.wocArmorSet = set;
  for (const mesh of instantiateWocArmor(
    entry.prepared.templates,
    skeleton,
    entry.bindMatrix ?? new THREE.Matrix4(),
  )) {
    mesh.visible = false;
    noteFileMaterial(mesh);
    container.add(mesh);
  }
  model.add(container);
  const rigid = hangWocRigidArmor(entry.prepared.rigid, model);
  for (const wrapper of rigid) {
    for (const part of wrapper.children) part.visible = false;
    wrapper.traverse(noteFileMaterial);
  }
  container.userData.wocArmorRigid = rigid;
  if (lod !== 'lod0') for (const piece of [container, ...rigid]) applyGeometryLod(piece, lod);
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

/** Detach a container (if still attached) and give its residency reference back. */
export function releaseWocArmorContainer(container: THREE.Object3D): void {
  const url = container.userData[WOC_ARMOR_CONTAINER];
  if (typeof url !== 'string') return;
  delete container.userData[WOC_ARMOR_CONTAINER];
  for (const piece of wocArmorPieces(container)) piece.removeFromParent();
  container.userData.wocArmorRigid = [];
  residency.release(url, clock());
  sweepWocArmorPacks();
}

/** Give back every container a model carries (CharacterVisual.dispose, a throwaway bake). */
export function releaseWocArmorOf(model: THREE.Object3D): void {
  for (const container of wocArmorContainers(model)) releaseWocArmorContainer(container);
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
    for (const g of geometries) g.dispose();
    for (const m of own.made?.materials ?? []) m.dispose();
    for (const t of own.made?.textures ?? []) t.dispose();
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
    for (const m of materials) {
      disposeMaterialTextures(m, textures);
      m.dispose();
    }
    for (const t of textures) t.dispose();
  }
  for (const g of geometries) g.dispose();
  releaseGltf(url);
}

/** Free every file nobody has worn for the idle window (called on every release; cheap). */
export function sweepWocArmorPacks(now = clock()): string[] {
  lastSweep = now;
  const expired = residency.takeExpired(now);
  for (const url of expired) {
    if (residency.refs(url) > 0) continue;
    freePack(url);
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
 * tier's file of every set in memory (worn now, or within the idle window: the rebuild has
 * already released the old visuals), so the rebuilt characters attach it at once instead of
 * drawing the old tier in its place. The caller passes the tier every character of the new
 * profile draws first (assets.ts: low, or the medium file, which the local player's own high
 * pack is then laid over through the normal stand-in path). Resolves once they land (or after
 * a bounded wait).
 */
export async function prepareWocArmorTier(tier: WocArmorTier): Promise<void> {
  const wanted = new Set<string>();
  for (const [url, entry] of packs) {
    const parsed = entry.scene ? parseWocArmorPackUrl(url) : null;
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
