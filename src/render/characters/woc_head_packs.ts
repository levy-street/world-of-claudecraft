// The WOC head library store: the modular head every WOC character hangs on its
// `head` bone, shipped SPLIT (woc_head_catalog.ts wocHeadCoreUrl / wocHeadPieceUrl)
// so a character downloads only what it wears: its type's CORE file (the base
// head and every small face piece), its hairstyle's file and its facial hair's
// file. Unlike the armor sets (woc_armor_packs.ts) the files are small and shared
// by many characters, so each is fetched once, on first need, and never freed:
//   - the core with the first WOC body of its type (ensureWocHeadCoreForFit, from
//     the base file's request path, exactly as the whole pack used to be);
//   - a hairstyle or beard file when a look first wants it (the dressing, the
//     world view before it builds a player, a portrait's wait), or when the face
//     builder opens that slot's category (prefetchWocHeadSlot).
// A failed fetch re-arms after a cooldown.
//
// Every file is the rig's bone hierarchy with its pieces RIGID children of the
// `head` bone (the shape an armor file's rigid parts take), so each is prepared
// once through the armor binder (woc_armor_bind.ts prepareWocArmor) and every
// character hangs clones over the shared geometry and materials. One file's
// pieces ride ONE wrapper group per bone (all on `head`: one wrapper per file),
// so a file attached late is one compile-gate call.
//
// Nothing here blocks a frame, but a body waits for its head (a base file ends at
// the neck): the world view builds a character only once its look's files are
// resident (wocHeadAppearanceAwaited), and a body built before them (a preview)
// attaches each file the frame it arrives (woc_head_dressing.ts poll), through
// the host's compile gate, and draws nothing until its whole look is hung and
// the head goes live.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { type GeometryLodLevel, geometryLodVariant } from '../assets/geometry_lod';
import { loadGltf } from '../assets/loader';
import { logAssetMissOnce } from './asset_miss_log';
import { prepareWocArmor, type WocRigidTemplate, wocRigBindOf } from './woc_armor_bind';
import {
  type WocHeadLook,
  type WocHeadSlot,
  type WocHeadType,
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadLookUrls,
  wocHeadTypeForGender,
} from './woc_head_catalog';
import { type WocHeadAppearanceInput, wocHeadTintRef } from './woc_head_look_core';
import {
  type WocHeadFileState,
  wocHeadAppearanceUrls,
  wocHeadAwaited,
  wocHeadSlotUrls,
} from './woc_head_stream_core';

/** userData keys a hung piece's meshes carry: their tint role and measured reference,
 *  read from the FILE material's name at hang time (a host's material pass may rebuild
 *  the material without its name: the low tier's Lambert). */
export const WOC_HEAD_TINT_ROLE_KEY = 'wocHeadTintRole';
export const WOC_HEAD_TINT_REF_KEY = 'wocHeadTintRef';

/** A failed fetch is retried no sooner than this after the failure. */
const FILE_RETRY_MS = 8000;

interface FileEntry {
  gltf: GLTF | null;
  loading: boolean;
  failedAt: number;
  /** The file's pieces prepared against its fit's rig (on the first hang). */
  rigid: readonly WocRigidTemplate[] | null;
}

const files = new Map<string, FileEntry>();
const readyListeners = new Set<(url: string) => void>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Whether one head file is parsed and ready to hang. */
export function wocHeadFileResident(url: string): boolean {
  return files.get(url)?.gltf != null;
}

/** Whether every one of `urls` is resident (fetching none). */
export function wocHeadFilesResident(urls: readonly string[]): boolean {
  for (const url of urls) if (!wocHeadFileResident(url)) return false;
  return true;
}

/** One head file's state for a body waiting on it (woc_head_stream_core.ts
 *  WocHeadFileState): a failed fetch reads `failed` until its retry cooldown ends. */
export function wocHeadFileState(url: string): WocHeadFileState {
  const entry = files.get(url);
  if (!entry) return 'idle';
  if (entry.gltf) return 'resident';
  if (entry.loading) return 'loading';
  return now() - entry.failedAt < FILE_RETRY_MS ? 'failed' : 'idle';
}

/** Observe a head file becoming resident (hosts with no per-frame poll: previews'
 *  wake-ups, portraits, the Guide viewer's wait). */
export function onWocHeadFileReady(listener: (url: string) => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/** Kick one head file's fetch (idempotent; a failed fetch re-arms after a cooldown). */
export function ensureWocHeadFile(url: string): void {
  let entry = files.get(url);
  if (entry?.gltf || entry?.loading) return;
  if (entry && now() - entry.failedAt < FILE_RETRY_MS) return;
  if (!entry) {
    entry = { gltf: null, loading: false, failedAt: -Infinity, rigid: null };
    files.set(url, entry);
  }
  const record = entry;
  record.loading = true;
  loadGltf(url).then(
    (gltf) => {
      record.loading = false;
      // reset under a test while in flight: drop the late parse
      if (files.get(url) !== record) return;
      record.gltf = gltf;
      for (const listener of readyListeners) {
        try {
          listener(url);
        } catch (err) {
          console.warn('WOC head ready listener failed', err);
        }
      }
    },
    (err: unknown) => {
      record.loading = false;
      record.failedAt = now();
      logAssetMissOnce(`woc-head:${url}`, `WOC head file failed to load: ${url}`, err);
    },
  );
}

/** Kick every one of `urls` that is not resident. True when all of them already are. */
export function ensureWocHeadFiles(urls: readonly string[]): boolean {
  let resident = true;
  for (const url of urls) {
    if (wocHeadFileResident(url)) continue;
    resident = false;
    ensureWocHeadFile(url);
  }
  return resident;
}

/** Kick the core file a body fit wears (the base file's request path fetches it beside the
 *  base, as it fetched the whole pack: every WOC character wears its type's core). */
export function ensureWocHeadCoreForFit(fit: 'male' | 'female'): void {
  ensureWocHeadFile(wocHeadCoreUrl(wocHeadTypeForGender(fit)));
}

/** Kick every file of one slot for a type (woc_head_stream_core.ts wocHeadSlotUrls): the
 *  face builder's prefetch when its Hairstyle or Facial Hair category opens, so each option
 *  it browses is resident by the time it is clicked. */
export function prefetchWocHeadSlot(type: WocHeadType, slot: WocHeadSlot): void {
  for (const url of wocHeadSlotUrls(type, slot)) ensureWocHeadFile(url);
}

/** Kick every file a look draws (the core, its hairstyle's and its facial hair's; null: the
 *  type's default look), the creator's boot prefetch. True when all are resident. */
export function prefetchWocHeadLook(
  type: WocHeadType,
  look: Partial<WocHeadLook> | null = null,
): boolean {
  return ensureWocHeadFiles(wocHeadLookUrls(type, look));
}

/** The files a stored appearance's head draws on a fit's body (woc_head_stream_core.ts
 *  wocHeadAppearanceUrls), memoized by the appearance record: a world view retries its
 *  build every frame while its body streams, and a portrait consumer re-asks per frame. */
const appearanceUrls = new WeakMap<object, { type: WocHeadType; urls: readonly string[] }>();
const defaultUrls = new Map<WocHeadType, readonly string[]>();

function appearanceUrlsOf(fit: 'male' | 'female', app: WocHeadAppearanceInput): readonly string[] {
  const type = wocHeadTypeForGender(fit);
  if (!app || typeof app !== 'object') {
    let urls = defaultUrls.get(type);
    if (!urls) {
      urls = wocHeadAppearanceUrls(null, type);
      defaultUrls.set(type, urls);
    }
    return urls;
  }
  const hit = appearanceUrls.get(app);
  if (hit?.type === type) return hit.urls;
  const urls = wocHeadAppearanceUrls(app, type);
  appearanceUrls.set(app, { type, urls });
  return urls;
}

/** Kick every file the head of a stored appearance draws on a fit's body (null: the type's
 *  default look): the world view fetches a player's own head beside its base, so the head
 *  is ready with the body. True when all are resident. */
export function ensureWocHeadForAppearance(
  fit: 'male' | 'female',
  app: WocHeadAppearanceInput,
): boolean {
  return ensureWocHeadFiles(appearanceUrlsOf(fit, app));
}

/** Whether every file the head of a stored appearance draws on a fit's body is resident
 *  (fetching none). */
export function wocHeadAppearanceResident(
  fit: 'male' | 'female',
  app: WocHeadAppearanceInput,
): boolean {
  return wocHeadFilesResident(appearanceUrlsOf(fit, app));
}

/** Whether a body of this fit still waits for the head of a stored appearance (null: the
 *  type's default look): some file of the look is not resident yet and none has failed
 *  (wocHeadAwaited). Fetches none; a caller kicks the look first
 *  (ensureWocHeadForAppearance), so a file nobody asked for never holds a body back. */
export function wocHeadAppearanceAwaited(
  fit: 'male' | 'female',
  app: WocHeadAppearanceInput,
): boolean {
  return wocHeadAwaited(appearanceUrlsOf(fit, app).map(wocHeadFileState));
}

/** Test seam: install a parsed head file directly (no loader), or drop it (null). */
export function setWocHeadFileForTest(url: string, gltf: GLTF | null): void {
  if (!gltf) {
    files.delete(url);
    return;
  }
  files.set(url, { gltf, loading: false, failedAt: -Infinity, rigid: null });
}

/** Test seam: mark a head file's fetch as failed just now (no loader), the state a body
 *  stops waiting on (woc_head_stream_core.ts wocHeadAwaited). */
export function failWocHeadFileForTest(url: string): void {
  files.set(url, { gltf: null, loading: false, failedAt: now(), rigid: null });
}

/** Test seam: forget every head file (resident, in flight or failed). */
export function resetWocHeadFilesForTest(): void {
  files.clear();
}

/** Tag on the wrapper groups a hung head rides (dispose and bakes find them by this): the
 *  head type. */
export const WOC_HEAD_WRAPPER = 'wocHeadPack';

/** One head file hung on a model: its wrapper groups (one per bone) and its pieces. */
export interface WocHeadHungFile {
  readonly url: string;
  readonly wrappers: readonly THREE.Object3D[];
  /** Piece node name (`WocHead_A_hair_swept`) -> the node drawn for it. */
  readonly pieces: ReadonlyMap<string, THREE.Object3D>;
  /** Every mesh the file's pieces draw. */
  readonly meshes: readonly THREE.Mesh[];
}

/** A head hung on one model: every file hung on it, and their pieces and meshes together. */
export interface WocHeadRig {
  readonly type: WocHeadType;
  /** Every file hung on the model, by url, in hang order. */
  readonly files: ReadonlyMap<string, WocHeadHungFile>;
  /** Every wrapper group across the hung files. */
  readonly wrappers: readonly THREE.Object3D[];
  /** Piece node name -> the node drawn for it, across the hung files. */
  readonly pieces: ReadonlyMap<string, THREE.Object3D>;
  /** Every mesh the pieces draw (morphs and tints are set on these). */
  readonly meshes: readonly THREE.Mesh[];
}

interface MutableHeadRig {
  readonly type: WocHeadType;
  readonly files: Map<string, WocHeadHungFile>;
  readonly wrappers: THREE.Object3D[];
  readonly pieces: Map<string, THREE.Object3D>;
  readonly meshes: THREE.Mesh[];
}

/** Hung heads by model (a WeakMap, never userData: Object3D.copy JSON-clones userData). */
const hungOn = new WeakMap<THREE.Object3D, MutableHeadRig>();

/** The FILE material each hung piece mesh was cloned with, kept because a host's material
 *  pass replaces `mesh.material` with its own derivation: the merged head (woc_head_merge.ts)
 *  keys its slots on the file material, whose name is the tint row. */
const fileMaterials = new WeakMap<THREE.Object3D, THREE.Material>();

/** The pack material a hung piece mesh draws (null for a mesh this store did not hang). */
export function wocHeadFileMaterial(mesh: THREE.Object3D): THREE.Material | null {
  return fileMaterials.get(mesh) ?? null;
}

/** A file's pieces prepared against a model's rig (once per file: every model of a fit
 *  shares the rig's bind), or null when the model has no rig. */
function rigidOf(
  entry: FileEntry,
  url: string,
  model: THREE.Object3D,
): readonly WocRigidTemplate[] | null {
  if (entry.rigid) return entry.rigid;
  const gltf = entry.gltf;
  const rig = gltf ? wocRigBindOf(model) : null;
  if (!gltf || !rig) return null;
  const prepared = prepareWocArmor(cloneSkinned(gltf.scene), rig);
  entry.rigid = prepared.rigid;
  if (prepared.templates.length > 0 || prepared.refused.length > 0) {
    logAssetMissOnce(
      `woc-head-skinned:${url}`,
      `WOC head file ${url}: skinned pieces are not drawn (the contract is rigid pieces on the head bone)`,
    );
  }
  return entry.rigid;
}

/** Whether a geometry carries morph targets (a face piece the sliders move). */
function hasMorphTargets(geometry: THREE.BufferGeometry): boolean {
  for (const list of Object.values(geometry.morphAttributes)) if (list.length > 0) return true;
  return false;
}

/**
 * Hang ONE resident head file on a character model (a base clone): each of its pieces
 * cloned over the shared geometry and material onto the model's own bone of the same
 * name, HIDDEN (the dressing decides what shows), inside one wrapper group per bone.
 * Null when the file is not resident, is already hung on this model, the model has no
 * rig, or none of its pieces finds its bone. `lod`: the geometry level the character
 * draws (woc_lod_core.ts), each piece over its shared variant of that level, EXCEPT that a
 * DRAWN piece carrying morph targets (the face sliders) keeps its own geometry: three builds a
 * morph texture per geometry at its first draw, so a variant would cost a second texture,
 * built on a live frame. The merged head (woc_head_merge.ts), which bakes the morphs on the
 * CPU and so has none, draws the character's level of those pieces instead, and the far
 * bake's throwaway pieces take the far level as before.
 */
export function hangWocHeadFile(
  model: THREE.Object3D,
  type: WocHeadType,
  url: string,
  lod: GeometryLodLevel = 'lod0',
): WocHeadHungFile | null {
  const entry = files.get(url);
  if (!entry?.gltf) return null;
  const existing = hungOn.get(model);
  if (existing?.files.has(url)) return null;
  const rigid = rigidOf(entry, url, model);
  if (!rigid) return null;
  const stem = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
  const byBone = new Map<string, THREE.Group>();
  const pieces = new Map<string, THREE.Object3D>();
  const meshes: THREE.Mesh[] = [];
  for (const part of rigid) {
    let wrapper = byBone.get(part.bone);
    if (!wrapper) {
      const bone = model.getObjectByName(part.bone);
      if (!bone) continue;
      wrapper = new THREE.Group();
      wrapper.name = `woc_head_${stem}_${part.bone}`;
      wrapper.userData[WOC_HEAD_WRAPPER] = type;
      bone.add(wrapper);
      byBone.set(part.bone, wrapper);
    }
    const clone = part.node.clone(true);
    clone.visible = false;
    clone.traverse((o) => {
      o.userData = { ...o.userData, wocHeadPart: true, wocArmorPart: true };
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // the far bake's throwaway pieces are never drawn: they take the far level whatever
      // they carry (the bake reads their posed vertices on the CPU)
      if (lod === 'far' || (lod !== 'lod0' && !hasMorphTargets(mesh.geometry))) {
        mesh.geometry = geometryLodVariant(mesh.geometry, lod);
      }
      meshes.push(mesh);
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat) fileMaterials.set(mesh, mat);
      const tint = mat ? wocHeadTintRef(type, mat.name) : null;
      if (tint) {
        mesh.userData[WOC_HEAD_TINT_ROLE_KEY] = tint.role;
        mesh.userData[WOC_HEAD_TINT_REF_KEY] = [...tint.ref];
      }
    });
    wrapper.add(clone);
    pieces.set(clone.name, clone);
  }
  if (pieces.size === 0) {
    for (const w of byBone.values()) w.removeFromParent();
    return null;
  }
  const hung: WocHeadHungFile = { url, wrappers: [...byBone.values()], pieces, meshes };
  let rig = existing;
  if (!rig) {
    rig = { type, files: new Map(), wrappers: [], pieces: new Map(), meshes: [] };
    hungOn.set(model, rig);
  }
  rig.files.set(url, hung);
  rig.wrappers.push(...hung.wrappers);
  for (const [name, node] of pieces) rig.pieces.set(name, node);
  rig.meshes.push(...meshes);
  return hung;
}

/**
 * Hang resident head files on a model, hidden: each of `urls` (default: every file of
 * the type's library that is resident) not hung on it yet. Returns the model's head (every
 * file hung on it so far), or null when none is.
 */
export function hangWocHead(
  model: THREE.Object3D,
  type: WocHeadType,
  urls: readonly string[] = wocHeadAllUrls(type),
  lod: GeometryLodLevel = 'lod0',
): WocHeadRig | null {
  for (const url of urls) hangWocHeadFile(model, type, url, lod);
  return wocHeadRigOf(model);
}

/** The head a model carries (every file hung on it), or null. */
export function wocHeadRigOf(model: THREE.Object3D): WocHeadRig | null {
  return hungOn.get(model) ?? null;
}

/** Take every hung head file off its model (a failed build, a throwaway bake). The shared
 *  geometry and materials stay with the files. */
export function unhangWocHead(model: THREE.Object3D): void {
  const rig = hungOn.get(model);
  if (!rig) return;
  for (const w of rig.wrappers) w.removeFromParent();
  hungOn.delete(model);
}

/** assembleModel's step for a WOC body: kick the fit's core and hang every file of its type
 *  that is resident (hidden), so a character built after its look's files landed is born
 *  with its head (the dressing shows the look's pieces). A file that lands later is attached
 *  by the dressing when its look wants it. `lod`: the level the character draws. */
export function hangWocHeadAtBuild(
  model: THREE.Object3D,
  fit: 'male' | 'female',
  lod: GeometryLodLevel = 'lod0',
): void {
  const type = wocHeadTypeForGender(fit);
  ensureWocHeadFile(wocHeadCoreUrl(type));
  hangWocHead(model, type, wocHeadAllUrls(type), lod);
}
