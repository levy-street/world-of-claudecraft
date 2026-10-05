// Which armor files one WOC character draws, and the attach/detach that follows
// (the 2026-09-25 character size gameplan, steps 5 and 6). CharacterVisual owns
// one per WOC body and hands it the sets its worn equipment needs; this keeps
// that set of files attached as the files arrive, the tier changes, or an item
// from another set comes and goes, and the visual owns the per-mesh setup
// (materials, effect snapshot, shadow casters, the compile gate) through the
// host seam, exactly as it does for a late face decal or a swapped weapon.
//
// A set is drawn at the tier this character draws (woc_armor_core.ts
// wocArmorTierFor: the graphics setting decides low against not low, and the
// character's DETAIL the rest: full, the default, for the local player's own
// character and every body built directly; crowd, which the world view asks
// for every other character, draws medium). Until that pack lands the nearest
// resident tier of the same set stands in, else nothing (the body's own suit).
//
// WHEN a resident file attaches is the host's to say. A body with the
// renderer's work queue behind it (every world view) attaches each file as ONE
// unit of that queue, asked for from the per-frame poll and placed by the
// queue's frame budget, and only once the store has prepared the file, a unit
// of its own (woc_armor_packs.ts): a set landing for a crowd of wearers is one
// prepare and then a few attaches a frame, never every wearer inside the frame
// the file arrived in. The suit keeps standing in meanwhile, as it does while a
// file streams, and the unit looks again when it runs (the kit, the tier and
// the files may all have changed since). A body with no queue behind it (a
// preview, a portrait, any body still under construction) attaches on the spot.
// A CROWD character leaves a file's prepare to the store's unit even then, and
// is born in its suit when its build finds the file not prepared yet: only a
// build under an arrival cover, a speculative one and a full-detail body (the
// local player's own, a preview) pay a prepare where they stand, because those
// must come out whole.
//
// A file that REPLACES another of the same set (a tier landing over its
// stand-in: the medium file under the local player's high pack is the normal
// case) attaches hidden behind the host's compile gate while the file it
// replaces keeps drawing, and the swap happens in one step once every piece of
// the new file is revealed: the old file leaves only then, so the set never
// vanishes for the length of a link and an upload. A replacement the gate
// cannot prepare never takes over: the file it was to replace is the same
// armor at another sharpness, so it keeps drawing and the replacement is
// refused under that gate. Only a set's FIRST file attaches straight (the
// body's suit is its stand-in), and is shown whatever the gate answers.
//
// One draw per material for the whole kit: a world view asks (setMerged) for
// the drawn parts that share a file material to be folded into one skinned mesh
// (woc_armor_merge.ts). The parts stay the source of truth here, attached,
// shown and hidden exactly as before; the stand-in is reconciled when the
// visual's part pass ends (redressed: a kit change drops it at once, so the
// parts draw again on that frame), taken down before a file it folds detaches,
// parked while an effect overlay blends on the body (effectsChanged), and
// mounted from the per-frame poll as one unit of the host's work queue, whose
// frame budget spreads a crowd arriving at once.
import type * as THREE from 'three';
import { arrivalCoverActive } from '../arrival_cover';
import type { GeometryLodLevel } from '../assets/geometry_lod';
import { recordBuildSpan } from '../build_spans';
import { GFX } from '../gfx';
import { logAssetMissOnce } from './asset_miss_log';
import {
  WOC_ARMOR_TIERS,
  type WocArmorDetail,
  type WocArmorTier,
  type WocFit,
  wocArmorPackUrl,
  wocArmorTierFor,
  wocStandInTier,
} from './woc_armor_core';
import { WocArmorMergeRig } from './woc_armor_merge';
import {
  attachWocArmorPack,
  ensureWocArmorPack,
  noteWocArmorRig,
  releaseWocArmorContainer,
  tickWocArmorPacks,
  WOC_ARMOR_CONTAINER,
  wocArmorContainers,
  wocArmorPackAwaitsPrepare,
  wocArmorPackResident,
  wocArmorPieces,
} from './woc_armor_packs';
import type { WocCharacterManifest } from './woc_character_manifest';
import { wocManifestSets } from './woc_parts_core';

/** One attached armor file: the set it draws and the file (tier) it draws it from. */
export interface WocArmorFile {
  readonly set: string;
  readonly url: string;
}

/** The character-visual side of an attach: everything the constructor gives a mesh. Called
 *  once per node an attached file hangs on the model (its Group of skinned parts, and the
 *  wrapper of each rigid part on its bone: woc_armor_packs.ts wocArmorPieces). */
export interface WocArmorDressingHost {
  readonly model: THREE.Object3D;
  /** Give a freshly attached node's meshes the visual's per-mesh setup. */
  adopt(node: THREE.Object3D): void;
  /** Take a detached node's meshes out of that bookkeeping. */
  forget(node: THREE.Object3D): void;
  /** Reveal a freshly attached node once its programs link, then call `live`. `prepared`
   *  is false when what the node wears as the gate settles is not known linked (the gate
   *  gave up, or an effect put other materials on while it linked): a set's first file is
   *  shown all the same (all that stands in for it is the bare suit, which is no armor),
   *  while a file that replaces another and a merged stand-in stay behind what draws in
   *  their place and are asked for again (revealIncoming below, woc_armor_merge.ts). */
  reveal(node: THREE.Object3D, live?: (prepared: boolean) => void): void;
  /** Whether the articulated rig is what draws right now (not its far mesh, not a hidden
   *  body): a merged stand-in nobody would see is not mounted. */
  rigDrawn(): boolean;
  /** Run `work` as one unit of the renderer's background work queue (its frame budget
   *  decides when), under a `kind:instance` label. Absent on a body with no renderer
   *  behind it (a test, a direct build, a body still under construction), where the work
   *  runs on the spot: read each time it is needed, since a body's queue arrives after it
   *  is built. */
  schedule?(work: () => void, label: string): void;
}

/** The work-queue label kinds of a merged kit's mount (the budget learns a cost per
 *  kind: gpu_prep_budget_core.ts gpuPrepKindOfLabel): a new kit, which folds its
 *  geometry, and one somebody already built, which only mounts. */
export const WOC_ARMOR_MERGE_LABEL = 'woc-armor-merge';
export const WOC_ARMOR_MOUNT_LABEL = 'woc-armor-mount';
/** ...and of one file's attach to one body (its parts bound to the body's skeleton, the
 *  host's per-mesh setup, the compile gate asked): a prepared file, so never a rebake. The
 *  body's fit and the set follow the kind in the label. */
export const WOC_ARMOR_ATTACH_LABEL = 'woc-armor-attach';

interface Attached {
  url: string;
  container: THREE.Object3D;
}

/** A file attached to replace the one a set draws: hidden until every piece is revealed. */
interface Incoming extends Attached {
  /** The pieces whose reveal has not settled yet. */
  readonly pending: Set<THREE.Object3D>;
  /** Which round of reveals counts: a replaced gate starts another (gateChanged). */
  round: number;
  /** Per piece, the reveals that came back unprepared on the very materials the gate was
   *  asked with. */
  readonly unprepared: Map<THREE.Object3D, number>;
}

/** How many times one piece of a replacement may come back unprepared on the very materials
 *  the gate was asked with (the gate gave up on them) and be asked again, the file it
 *  replaces drawing meanwhile. Once more than that and the replacement is refused: it comes
 *  off unseen and the old file keeps drawing. The merged stand-in's rule in kind
 *  (woc_armor_merge.ts MAX_UNPREPARED_LINKS: drawing it now could link or upload on a live
 *  frame, and what stands in is the same armor), with one more try than a stand-in gets: a
 *  refusal here costs a character its sharper armor, where a stand-in's costs only draws. A
 *  reveal an effect edge spoiled (the host mounted other materials while the gate linked)
 *  is no verdict and never counts. */
const MAX_UNPREPARED_REVEALS = 2;

type Worn = THREE.Material | THREE.Material[];

/** What the meshes under a node wear right now, in traversal order. */
function wornBy(node: THREE.Object3D): Worn[] {
  const out: Worn[] = [];
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) out.push(mesh.material);
  });
  return out;
}

/** Whether the meshes under a node wear exactly `worn` (the same material objects). */
function wearing(node: THREE.Object3D, worn: readonly Worn[]): boolean {
  let at = 0;
  let same = true;
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material !== worn[at++]) same = false;
  });
  return same && at === worn.length;
}

/** Whether two lists name the same sets, in any order. */
function sameSets(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (const set of a) if (!b.includes(set)) return false;
  return true;
}

/** What one step of one set did (WocArmorDressing.step): the files or nodes on the model
 *  changed, and the set still waits on something (a fetch, a prepare, its attach unit). */
const CHANGED = 1;
const WAITING = 2;

/** The tier a character of this detail draws now (the live graphics profile). */
export function currentWocArmorTier(detail: WocArmorDetail = 'full'): WocArmorTier {
  return wocArmorTierFor(GFX, detail);
}

/**
 * The file a set draws from right now: the wanted tier when resident, else the nearest
 * resident tier, else null. Kicks the wanted tier's fetch when it is not resident (unless
 * `fetch` is false: a speculative build only uses what is here).
 */
export function wocSetFileNow(
  fit: WocFit,
  set: string,
  tier: WocArmorTier,
  fetch = true,
): string | null {
  const wanted = wocArmorPackUrl(fit, set, tier);
  if (fetch && !wocArmorPackResident(wanted)) ensureWocArmorPack(wanted);
  const shown = wocStandInTier(tier, (t) => wocArmorPackResident(wocArmorPackUrl(fit, set, t)));
  return shown ? wocArmorPackUrl(fit, set, shown) : null;
}

/** Whether a manifest's default kit is resident at the tier a character of `detail` draws (a
 *  body built directly: full), kicking the fetch of any pack that is not (`fetch: false` only
 *  asks; a caller that builds a body directly waits for the whole kit, never a stand-in
 *  tier). */
export function wocKitResident(
  manifest: WocCharacterManifest,
  fetch = true,
  detail: WocArmorDetail = 'full',
): boolean {
  const tier = currentWocArmorTier(detail);
  let resident = true;
  for (const set of wocManifestSets(manifest)) {
    const url = wocArmorPackUrl(manifest.fit, set, tier);
    if (wocArmorPackResident(url)) continue;
    if (fetch) ensureWocArmorPack(url);
    resident = false;
  }
  return resident;
}

/**
 * A portrait's kit: per set, the best tier already resident (a wearer's), else the LOW tier
 * fetched (a 128 px capture never needs more, and the store's class row would otherwise pull
 * every class's live-tier set). Null until every set has a file; `fetch: false` only asks.
 */
export function wocPortraitKit(
  manifest: WocCharacterManifest,
  fetch = true,
): WocArmorFile[] | null {
  const files: WocArmorFile[] = [];
  let missing = false;
  for (const set of wocManifestSets(manifest)) {
    const tier = [...WOC_ARMOR_TIERS]
      .reverse()
      .find((t) => wocArmorPackResident(wocArmorPackUrl(manifest.fit, set, t)));
    if (tier) {
      files.push({ set, url: wocArmorPackUrl(manifest.fit, set, tier) });
      continue;
    }
    missing = true;
    if (fetch) ensureWocArmorPack(wocArmorPackUrl(manifest.fit, set, 'low'));
  }
  return missing ? null : files;
}

/**
 * Whether a body of this detail leaves a file's prepare to the store's queue unit instead of
 * paying it where it stands: a crowd character of the live world. Under an arrival cover
 * there is no frame to protect and the view must come out whole, and a full-detail body (the
 * local player's own character, a preview, a portrait) always attaches what is resident.
 */
function leavesPrepareToQueue(detail: WocArmorDetail): boolean {
  return detail === 'crowd' && !arrivalCoverActive();
}

/**
 * Attach the resident files of `files` (or, omitted, the manifest's own sets at the tier a
 * character of `detail` draws, kicking any missing pack's fetch) to a freshly cloned base:
 * assembleModel's step, before the visual's per-mesh passes, so a character whose kit is
 * resident is born whole. On the spot: a file no unit has prepared yet is prepared here,
 * inside the build that needs it whole (a view under a curtain, the zone prewarm, a
 * portrait, the local player). The ONE exception is a crowd character built in a live
 * frame: it is born in its suit when its file still waits on a prepare the store can run
 * as a queue unit (the prepare is the very hitch the unit exists to move off the frame),
 * and its dressing attaches the file once it is prepared. `lod`: the geometry level the
 * character draws (woc_lod_core.ts).
 */
export function attachWocArmorAtBuild(
  model: THREE.Object3D,
  manifest: WocCharacterManifest,
  files?: readonly WocArmorFile[],
  fetch = true,
  detail: WocArmorDetail = 'full',
  lod: GeometryLodLevel = 'lod0',
): void {
  if (files) {
    for (const file of files) attachWocArmorPack(model, file.url, file.set, manifest, lod);
  } else {
    // (a speculative build fetches nothing and waits for nothing: it wears what is here)
    const patient = fetch && leavesPrepareToQueue(detail);
    // the store prepares against the fit's rig: known before the ask for a build that waits
    if (patient) noteWocArmorRig(model, manifest);
    const tier = currentWocArmorTier(detail);
    for (const set of wocManifestSets(manifest)) {
      const url = wocSetFileNow(manifest.fit, set, tier, fetch);
      if (!url || (patient && wocArmorPackAwaitsPrepare(url))) continue;
      attachWocArmorPack(model, url, set, manifest, lod);
    }
  }
  // every WOC build passes here, a bare one too: the store learns the fit's rig from the
  // first, and prepares every pack that lands afterwards off the frame (after the attaches
  // above, so a file this build just prepared is not asked for again)
  noteWocArmorRig(model, manifest);
}

export class WocArmorDressing {
  /** The file each set draws now. */
  private readonly attached = new Map<string, Attached>();
  /** The file replacing a set's drawn one, hidden until every piece of it is revealed. */
  private readonly incoming = new Map<string, Incoming>();
  /** The files or nodes on the model changed outside a call that returns it (a queued
   *  attach ran, a replacement took over or was refused): the next poll says so. */
  private swapped = false;
  private wanted: readonly string[] = [];
  /** A wanted file (or a better tier of one) has not arrived, is not prepared, or waits on
   *  its attach unit: poll keeps checking. */
  private waiting = false;
  /** The attach unit of each set sitting in the host's work queue (one a set at a time), by
   *  identity: a unit left behind by an earlier ask attaches nothing. */
  private readonly attachQueued = new Map<string, object>();
  /** Per set, the files that could not take over from the file it draws: the gate could
   *  not prepare them, try after try, so the old file keeps drawing and they are not
   *  attached (or fetched) again until the kit or the gate changes. Without the latch the
   *  next poll would attach the refused file again, and ask, for ever. */
  private readonly refused = new Map<string, Set<string>>();
  /** Resident files this model cannot take (no rig of its own to bind them to, a file
   *  whose prepare failed, an attach that threw): not asked for again until the kit or the
   *  gate changes, never once a frame. */
  private readonly unattachable = new Set<string>();
  /** The one-draw-per-material stand-in for the drawn parts (woc_armor_merge.ts); null
   *  until a world view asks for it (setMerged). */
  private merge: WocArmorMergeRig | null = null;
  /** The drawn parts may have changed with nobody reconciling the stand-in since (a file
   *  attached or detached, a file's reveal settled): the poll reads them again. */
  private mergeStale = false;
  private readonly staleMerged = (): void => {
    this.mergeStale = true;
  };
  /** The mount unit sitting in the host's work queue (one at a time), by identity: a
   *  unit left behind by an earlier ask must not clear a later one's. */
  private mergeQueued: object | null = null;

  /** `detail`: full (the default: the local player's own character, and every body built
   *  directly) or crowd (every other character in the world: the world view's opt-down,
   *  createCharacterVisual). `lod`: the geometry level its files and their merged stand-in
   *  draw (woc_lod_core.ts), fixed for the body's life. The detail is fixed too for every
   *  body of the world; a preview changes its own on the live body (setDetail). */
  constructor(
    private readonly host: WocArmorDressingHost,
    private readonly manifest: WocCharacterManifest,
    private detail: WocArmorDetail = 'full',
    private readonly lod: GeometryLodLevel = 'lod0',
  ) {
    // The files assembleModel attached at build time (the default kit): already set up by
    // the constructor's own passes, so they are adopted as-is.
    for (const container of wocArmorContainers(host.model)) {
      const set = container.userData.wocArmorSet;
      const url = container.userData[WOC_ARMOR_CONTAINER];
      if (typeof set === 'string' && typeof url === 'string')
        this.attached.set(set, { url, container });
    }
  }

  /**
   * Draw at another detail from here on, on the LIVE body (CharacterVisual.setWocArmorDetail:
   * a preview whose character was just chosen, or whose stage changed hands,
   * preview_armor_detail_core.ts). Nothing is asked for here: the sets wanted until now may
   * be another character's (a stage that changes hands dresses its body right after), and
   * asking them at the new detail would fetch a top file nobody is about to draw. The change
   * takes effect with the body's next want, or failing one with its next poll, and from
   * there every rule of a tier change holds: the file a set draws keeps drawing until its
   * replacement's reveal settles, the medium file stands in while a top file streams, and a
   * step DOWN stops waiting on a file still streaming, takes off a replacement that never
   * drew and gives the higher file back once the lower one draws. A body nobody dressed
   * through want (a speculative build) keeps what it was born with.
   */
  setDetail(detail: WocArmorDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    // a detail that really changed is a new ask, as a changed kit is (want): the file the
    // gate refused at the old one (a high pack it could not prepare) gets another try
    this.refused.clear();
    if (this.wanted.length > 0) this.waiting = true;
  }

  /** The files drawn right now, in set order (a far bake is keyed and built on these). */
  get attachedFiles(): WocArmorFile[] {
    return [...this.attached.entries()]
      .map(([set, a]) => ({ set, url: a.url }))
      .sort((a, b) => (a.set < b.set ? -1 : a.set > b.set ? 1 : 0));
  }

  /** Whether a wanted file has not landed (or been attached) yet. */
  get isWaiting(): boolean {
    return this.waiting;
  }

  /** Whether the kit draws as its merged meshes right now (dev overlays, tests). */
  get isMerged(): boolean {
    return this.merge?.standing ?? false;
  }

  /**
   * Draw the kit as ONE mesh per material while it stands still (woc_armor_merge.ts).
   * Off by default: a preview, a portrait and a test body keep drawing part by part, and
   * the world view opts in (createCharacterVisual), where a crowd's draw calls are the
   * cost. Never a mount here: the stand-in is mounted from the poll.
   */
  setMerged(on: boolean): void {
    if (on === (this.merge !== null)) return;
    if (on) {
      this.merge = new WocArmorMergeRig(this.host, this.host.model, this.lod);
      this.mergeStale = true;
      return;
    }
    this.merge?.dispose();
    this.merge = null;
    this.mergeQueued = null;
  }

  /**
   * The host's part-visibility pass just ended (CharacterVisual.dressWoc): reconcile the
   * stand-in with the parts as they draw now. One still standing for exactly these parts
   * is kept; any other is dropped at once (its parts draw again on this frame) and the new
   * kit waits for the poll. Never a mount: the pass runs inside the host's own sweeps.
   */
  redressed(): void {
    if (!this.merge) return;
    this.mergeStale = false;
    this.merge.sync(false);
  }

  /** The host mounted another effect state's materials on the body
   *  (CharacterVisual.commitVisualMaterials, after its mounts): a kit that turned blended
   *  goes back to its parts inside this call (three sorts blended meshes by depth, which
   *  one merged mesh cannot, so it is never drawn that way), and one that turned opaque
   *  again stands from the next poll. The host MUST call it: nothing here reads
   *  materials per frame. */
  effectsChanged(): void {
    this.merge?.effectsChanged();
  }

  /** The host's compile gate (and the work queue that rides in with it) was replaced
   *  (CharacterVisual.setFarBakeGate: a pooled body handed to another renderer
   *  generation): a reveal, an attach unit or a mount unit still in flight belongs to the
   *  old one and may never come back, so all are asked for again: a replacement's pieces
   *  still linking at once (or the file it replaces would draw in its place for good), an
   *  attach and the stand-in from the next poll. What the old gate refused gets another
   *  try under the new one. */
  gateChanged(): void {
    if (this.attachQueued.size + this.refused.size + this.unattachable.size > 0) {
      this.attachQueued.clear();
      this.refused.clear();
      this.unattachable.clear();
      this.waiting = true;
    }
    for (const [set, entry] of this.incoming) {
      // every piece again, the ones the old gate settled too: what it linked and uploaded
      // belongs to the old renderer generation
      entry.round++;
      entry.unprepared.clear();
      const pieces = wocArmorPieces(entry.container);
      for (const piece of pieces) entry.pending.add(piece);
      this.revealAll(set, entry, pieces);
    }
    if (!this.merge) return;
    this.merge.gateChanged();
    this.mergeQueued = null;
    this.mergeStale = true;
  }

  /** Draw exactly these sets: attach what is resident (on the spot with no work queue
   *  behind the body, else as a unit of it), stream the rest, detach the rest. Returns
   *  whether the attached files changed inside the call. */
  want(sets: readonly string[]): boolean {
    // a kit that really changed gives every file another try: a refusal was that kit's
    if (!sameSets(this.wanted, sets)) {
      this.refused.clear();
      this.unattachable.clear();
      // ...and a unit asked for a set that came off attaches nothing
      for (const set of this.attachQueued.keys()) {
        if (!sets.includes(set)) this.attachQueued.delete(set);
      }
    }
    this.wanted = sets;
    const changed = this.sync();
    return this.takeSwapped() || changed;
  }

  /** Per frame: bring a file that just arrived onto the body (attached here with no work
   *  queue behind it, else asked for as a unit of the queue once the file is prepared),
   *  let the store free idle sets on time, and keep the merged stand-in a world view asked
   *  for in step with the parts. Returns whether the attached FILES changed (the caller
   *  re-dresses: a file attached, or a replacement took over or came off since the last
   *  frame); free while nothing waits. */
  poll(): boolean {
    tickWocArmorPacks();
    const synced = this.waiting ? this.sync() : false;
    const changed = this.takeSwapped() || synced;
    // a file change is re-dressed by the caller first (redressed reconciles): the
    // stand-in is mounted from a later frame's poll, for the parts as they then draw
    if (!changed) this.pollMerged();
    return changed;
  }

  /** Whether the files changed since the caller last heard (and now it has). */
  private takeSwapped(): boolean {
    const swapped = this.swapped;
    this.swapped = false;
    return swapped;
  }

  /** The stand-in's per-frame half: read the parts again when they may have changed
   *  unreconciled, let a mounted one follow what the host told it (stand, link, park),
   *  and ask for the mount of one that waits, only for a rig somebody sees. A few flag
   *  reads a frame once it stands. */
  private pollMerged(): void {
    const merge = this.merge;
    if (!merge) return;
    if (this.mergeStale) {
      this.mergeStale = false;
      merge.sync(false);
    }
    merge.poll();
    if (merge.mountable && this.host.rigDrawn()) this.requestMount(merge);
  }

  /**
   * Ask for the waiting stand-in's mount: one unit of the host's work queue, whose frame
   * budget decides when it runs (so a crowd arriving at once mounts a few kits a frame,
   * never forty), or on the spot with no renderer behind this body. A kit somebody
   * already built mounts without a fold, so it rides its own label kind and the budget
   * learns the two costs apart. The unit looks again when it runs: the kit may have
   * changed, gone far or been disposed since.
   */
  private requestMount(merge: WocArmorMergeRig): void {
    const schedule = this.host.schedule;
    if (!schedule) {
      merge.mountPending();
      return;
    }
    // one unit at a time: a frame that only waits on it builds nothing
    if (this.mergeQueued) return;
    const unit = {};
    this.mergeQueued = unit;
    const kind = merge.pendingBuilt ? WOC_ARMOR_MOUNT_LABEL : WOC_ARMOR_MERGE_LABEL;
    schedule(() => {
      if (this.mergeQueued === unit) this.mergeQueued = null;
      // a rig taken down since (the merge turned off, the body disposed) waits for
      // nothing, and one that still waits reads its parts again before it mounts
      if (this.host.rigDrawn()) merge.mountPending();
    }, `${kind}:${this.manifest.fit}`);
  }

  private sync(): boolean {
    const tier = currentWocArmorTier(this.detail);
    let changed = false;
    let waiting = false;
    for (const set of this.wanted) {
      const did = this.step(set, tier, false);
      if (did & CHANGED) changed = true;
      if (did & WAITING) waiting = true;
    }
    for (const [set, current] of this.attached) {
      if (this.wanted.includes(set)) continue;
      this.detach(set, current);
      changed = true;
    }
    for (const [set, next] of this.incoming) {
      if (this.wanted.includes(set)) continue;
      this.discard(set, next);
      changed = true;
    }
    this.waiting = waiting;
    return changed;
  }

  /**
   * Bring one wanted set in step with the store: the file it draws from right now attached
   * (or on its way), anything else of the set off. `attach`: this call may attach a file (it
   * is the queued unit); otherwise a body with a work queue behind it only ASKS for the
   * attach, and a body with none attaches on the spot. Returns CHANGED and WAITING bits.
   */
  private step(set: string, tier: WocArmorTier, attach: boolean): number {
    const fit = this.manifest.fit;
    const wanted = wocArmorPackUrl(fit, set, tier);
    // a file refused under this gate is neither fetched nor waited on: the body draws on
    // without it
    const gaveUp = this.refused.get(set)?.has(wanted) === true;
    const url = wocSetFileNow(fit, set, tier, !gaveUp);
    let did = url !== wanted && !gaveUp ? WAITING : 0;
    const current = this.attached.get(set);
    const next = this.incoming.get(set);
    if ((next ?? current)?.url === url) return did;
    // a replacement overtaken while it linked (a better tier landed meanwhile) never drew
    if (next) {
      this.discard(set, next);
      did |= CHANGED;
      if (current?.url === url) return did;
    }
    if (!url) {
      if (current) {
        this.detach(set, current);
        did |= CHANGED;
      }
      return did;
    }
    if (this.unattachable.has(url)) return did;
    // refused in favour of the file that draws: only while that file is there to draw
    if (current && this.refused.get(set)?.has(url)) return did;
    const schedule = this.host.schedule;
    if (schedule) {
      // prepared first, as a unit of its own (the store's): an attach only binds
      if (wocArmorPackAwaitsPrepare(url)) return did | WAITING;
      if (!attach) {
        this.requestAttach(set, schedule);
        // (a host whose queue ran the unit inside the ask has the file on already)
        return (this.incoming.get(set) ?? this.attached.get(set))?.url === url
          ? did
          : did | WAITING;
      }
    } else if (leavesPrepareToQueue(this.detail) && wocArmorPackAwaitsPrepare(url)) {
      // a crowd character with no queue of its own yet (between its build and its gate):
      // the prepare is the store's unit all the same, never paid where the body stands
      return did | WAITING;
    }
    return did | this.attachFile(set, url, current);
  }

  /**
   * Attach `url` as the set's file, now: straight for a set's first file, hidden behind the
   * gate for one that replaces `current`. Returns CHANGED, or 0 for a file this model cannot
   * take. Never throws: an attach that throws (a host step, a file that will not bind) is
   * taken off again whole, named once, and latched like a file the model cannot take, so
   * the body keeps drawing what it drew and no frame, and no queue unit, tries it again.
   */
  private attachFile(set: string, url: string, current: Attached | undefined): number {
    let container: THREE.Object3D | null = null;
    try {
      container = attachWocArmorPack(this.host.model, url, set, this.manifest, this.lod);
      if (!container) {
        this.unattachable.add(url);
        return 0;
      }
      const pieces = wocArmorPieces(container);
      if (current) {
        // the file this one replaces keeps drawing until every piece of it is revealed
        const entry: Incoming = {
          url,
          container,
          pending: new Set(pieces),
          round: 0,
          unprepared: new Map(),
        };
        this.incoming.set(set, entry);
        for (const piece of pieces) this.host.adopt(piece);
        this.revealAll(set, entry, pieces);
        return CHANGED;
      }
      this.attached.set(set, { url, container });
      for (const piece of pieces) {
        this.host.adopt(piece);
        // its parts draw from the moment the reveal settles: the stand-in follows
        this.host.reveal(piece, this.staleMerged);
      }
      this.mergeStale = true;
      return CHANGED;
    } catch (err) {
      this.unattachable.add(url);
      if (container) this.takeOff(set, container);
      logAssetMissOnce(
        `woc-armor-attach:${url}:${err instanceof Error ? err.message : String(err)}`,
        `WOC armor ${url} could not attach, its wearer keeps what it draws:`,
        err,
      );
      // whatever of it reached the model is off again: the host reads its parts afresh
      return CHANGED;
    }
  }

  /** Undo a half-made attach: the file leaves the books and the model, and its reference
   *  goes back, whatever a step of that throws in its turn. */
  private takeOff(set: string, container: THREE.Object3D): void {
    if (this.attached.get(set)?.container === container) this.attached.delete(set);
    if (this.incoming.get(set)?.container === container) this.incoming.delete(set);
    try {
      for (const piece of wocArmorPieces(container)) this.host.forget(piece);
    } catch {
      // the host's bookkeeping of a node that never drew: nothing to keep it for
    }
    try {
      releaseWocArmorContainer(container);
    } catch {
      // its reference is back either way (releaseWocArmorContainer)
    }
  }

  /**
   * Ask for one set's attach: one unit of the host's work queue, whose frame budget decides
   * when it runs (so a set landing for a crowd of wearers attaches a few of them a frame,
   * never all of them in the frame it landed). The unit looks again when it runs: the set
   * may have come off, the tier changed or a better file landed since, and it attaches the
   * file the set draws from THEN. The host hears of it from the next poll, where the
   * re-dress belongs (the per-frame path, never inside a queue unit).
   */
  private requestAttach(
    set: string,
    schedule: NonNullable<WocArmorDressingHost['schedule']>,
  ): void {
    // one unit a set at a time: a frame that only waits on it asks for nothing
    if (this.attachQueued.has(set)) return;
    const unit = {};
    this.attachQueued.set(set, unit);
    schedule(() => {
      // left behind: the set came off, the gate was replaced, or the body was disposed
      if (this.attachQueued.get(set) !== unit) return;
      this.attachQueued.delete(set);
      const started = performance.now();
      const did = this.step(set, currentWocArmorTier(this.detail), true);
      // (it found something to wait for after all: the poll keeps asking)
      if (did & WAITING) this.waiting = true;
      if (!(did & CHANGED)) return;
      this.swapped = true;
      // its own view-lane kind: it runs from the queue, never inside a view build
      recordBuildSpan('view:woc-armor-attach', performance.now() - started, started);
    }, `${WOC_ARMOR_ATTACH_LABEL}:${this.manifest.fit}:${set}`);
  }

  /** Ask the gate for every piece of a replacement (a gate that answers inside the ask can
   *  hand the set over, or refuse the file, before the last piece is asked for). */
  private revealAll(set: string, entry: Incoming, pieces: readonly THREE.Object3D[]): void {
    for (const piece of pieces) {
      if (this.incoming.get(set) !== entry) return;
      this.revealIncoming(set, entry, piece);
    }
  }

  /** Reveal one piece of a replacement through the host's gate. A piece revealed while
   *  others still link is hidden again (the swap is one step, never a frame of both files'
   *  parts over each other); the last one hands the set over. One whose programs are not
   *  known linked is asked again while the file it replaces stands in: as often as it takes
   *  when an effect edge spoiled the proof (the host mounted other materials while the gate
   *  linked: no verdict on the file), MAX_UNPREPARED_REVEALS times when the gate gave up on
   *  the very materials it was asked with, and then the replacement is refused. */
  private revealIncoming(set: string, entry: Incoming, piece: THREE.Object3D): void {
    const round = entry.round;
    const asked = wornBy(piece);
    this.host.reveal(piece, (prepared) => {
      // overtaken, detached or disposed while it linked: nothing of it is drawn
      if (this.incoming.get(set) !== entry) return;
      // a settle of a replaced gate (the host shows what it settles): the piece waits on
      // the new gate's
      if (entry.round !== round) {
        if (entry.pending.has(piece)) piece.visible = false;
        return;
      }
      // (a piece with no mesh of its own, the Group of a file whose parts are all rigid,
      // has nothing to link: no proof can come back for it, and none is needed)
      if (prepared === false && asked.length > 0) {
        piece.visible = false;
        if (wearing(piece, asked)) {
          const misses = (entry.unprepared.get(piece) ?? 0) + 1;
          entry.unprepared.set(piece, misses);
          if (misses > MAX_UNPREPARED_REVEALS) {
            this.refuse(set, entry);
            return;
          }
        }
        this.revealIncoming(set, entry, piece);
        return;
      }
      entry.pending.delete(piece);
      if (entry.pending.size > 0) {
        piece.visible = false;
        return;
      }
      this.takeOver(set, entry);
    });
  }

  /** A replacement the gate could not prepare, try after try: it comes off unseen, the
   *  file it was to replace keeps drawing (the same armor at another sharpness, a whole
   *  stand-in), and it is latched as refused so no later poll attaches it again. */
  private refuse(set: string, entry: Incoming): void {
    let urls = this.refused.get(set);
    if (!urls) {
      urls = new Set();
      this.refused.set(set, urls);
    }
    urls.add(entry.url);
    this.discard(set, entry);
    // its nodes left the model outside any call that returns it: the next poll says so
    this.swapped = true;
    // never silent: a body kept at the tier below is a cosmetic loss somebody can ask about
    logAssetMissOnce(
      `woc-armor-refused-tier:${entry.url}`,
      `WOC armor ${entry.url}: the compile gate could not prepare it, its wearer keeps the file it replaces`,
    );
  }

  /** Every piece of a replacement is revealed: it draws from here on, in the step that takes
   *  the file it replaced off (and the stand-in folding that file's parts with it). */
  private takeOver(set: string, entry: Incoming): void {
    this.incoming.delete(set);
    for (const piece of wocArmorPieces(entry.container)) piece.visible = true;
    const old = this.attached.get(set);
    if (old) this.detach(set, old);
    this.attached.set(set, { url: entry.url, container: entry.container });
    this.mergeStale = true;
    // the drawn files changed outside any call that returns it: the next poll says so
    this.swapped = true;
  }

  private detach(set: string, current: Attached): void {
    // the stand-in first (one mounted, or one waiting on these very meshes): it draws
    // this file's parts in their place, and the poll plans the next from what is left
    if (this.merge) {
      this.merge.drop();
      this.mergeStale = true;
    }
    this.attached.delete(set);
    for (const piece of wocArmorPieces(current.container)) this.host.forget(piece);
    releaseWocArmorContainer(current.container);
  }

  /** Take off a replacement that never drew (nothing stands in for its parts). */
  private discard(set: string, entry: Incoming): void {
    this.incoming.delete(set);
    for (const piece of wocArmorPieces(entry.container)) this.host.forget(piece);
    releaseWocArmorContainer(entry.container);
  }

  /** Give every file back (CharacterVisual.dispose). Total: each step runs whatever
   *  another throws (a file whose release throws must not keep the others' references, nor
   *  stop the teardown of the visual that called), and a failure is named once on the dev
   *  channel. */
  dispose(): void {
    const each = (step: () => void): void => {
      try {
        step();
      } catch (err) {
        logAssetMissOnce(
          `woc-armor-dispose:${err instanceof Error ? err.message : String(err)}`,
          'WOC armor dressing: a step of its teardown threw (the rest ran all the same):',
          err,
        );
      }
    };
    each(() => this.merge?.dispose());
    this.merge = null;
    this.mergeQueued = null;
    this.attachQueued.clear();
    for (const current of this.attached.values()) {
      each(() => releaseWocArmorContainer(current.container));
    }
    for (const next of this.incoming.values()) {
      each(() => releaseWocArmorContainer(next.container));
    }
    this.attached.clear();
    this.incoming.clear();
    this.refused.clear();
    this.unattachable.clear();
    this.swapped = false;
    this.waiting = false;
  }
}
