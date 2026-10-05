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
// resident tier of the same set stands in, else nothing (the body's own suit),
// and the wanted pack attaches on the first frame it is resident (poll, from
// the visual's update).
//
// A file that REPLACES another of the same set (a tier landing over its
// stand-in: the medium file under the local player's high pack is the normal
// case) attaches hidden behind the host's compile gate while the file it
// replaces keeps drawing, and the swap happens in one step once every piece of
// the new file is revealed: the old file leaves only then, so the set never
// vanishes for the length of a link and an upload. Only a set's FIRST file
// attaches straight (the body's suit is its stand-in).
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
import type { GeometryLodLevel } from '../assets/geometry_lod';
import { GFX } from '../gfx';
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
  releaseWocArmorContainer,
  tickWocArmorPacks,
  WOC_ARMOR_CONTAINER,
  wocArmorContainers,
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
   *  gave up, or an effect put other materials on while it linked): an attached file is
   *  shown all the same (nothing stands in for it), while a merged stand-in stays behind
   *  its parts and is asked for again (woc_armor_merge.ts). */
  reveal(node: THREE.Object3D, live?: (prepared: boolean) => void): void;
  /** Whether the articulated rig is what draws right now (not its far mesh, not a hidden
   *  body): a merged stand-in nobody would see is not mounted. */
  rigDrawn(): boolean;
  /** Run `work` as one unit of the renderer's background work queue (its frame budget
   *  decides when), under a `kind:instance` label. Absent on a body with no renderer
   *  behind it (a test, a direct build), where the work runs on the spot. */
  schedule?(work: () => void, label: string): void;
}

/** The work-queue label kinds of a merged kit's mount (the budget learns a cost per
 *  kind: gpu_prep_budget_core.ts gpuPrepKindOfLabel): a new kit, which folds its
 *  geometry, and one somebody already built, which only mounts. */
export const WOC_ARMOR_MERGE_LABEL = 'woc-armor-merge';
export const WOC_ARMOR_MOUNT_LABEL = 'woc-armor-mount';

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
  /** Reveals that came back unprepared and were asked again. */
  unprepared: number;
}

/** How many reveals of one replacement may come back unprepared (its programs not known
 *  linked: the gate gave up, or an effect landed mid-link) and be asked again, the file it
 *  replaces drawing meanwhile, before it takes over all the same (a gate that keeps giving up
 *  must not keep the old file drawing for good; the merged stand-in's rule,
 *  woc_armor_merge.ts MAX_UNPREPARED_LINKS). */
const MAX_UNPREPARED_REVEALS = 2;

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
 * Attach the resident files of `files` (or, omitted, the manifest's own sets at the tier a
 * character of `detail` draws, kicking any missing pack's fetch) to a freshly cloned base:
 * assembleModel's step, before the visual's per-mesh passes, so a character whose kit is
 * resident is born whole. `lod`: the geometry level the character draws (woc_lod_core.ts).
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
    return;
  }
  const tier = currentWocArmorTier(detail);
  for (const set of wocManifestSets(manifest)) {
    const url = wocSetFileNow(manifest.fit, set, tier, fetch);
    if (url) attachWocArmorPack(model, url, set, manifest, lod);
  }
}

export class WocArmorDressing {
  /** The file each set draws now. */
  private readonly attached = new Map<string, Attached>();
  /** The file replacing a set's drawn one, hidden until every piece of it is revealed. */
  private readonly incoming = new Map<string, Incoming>();
  /** A replacement took over since the caller last heard: the drawn files changed. */
  private swapped = false;
  private wanted: readonly string[] = [];
  /** A wanted file (or a better tier of one) has not arrived yet: poll keeps checking. */
  private waiting = false;
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
   *  draw (woc_lod_core.ts). Both fixed for the body's life. */
  constructor(
    private readonly host: WocArmorDressingHost,
    private readonly manifest: WocCharacterManifest,
    private readonly detail: WocArmorDetail = 'full',
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

  /** The files drawn right now, in set order (a far bake is keyed and built on these). */
  get attachedFiles(): WocArmorFile[] {
    return [...this.attached.entries()]
      .map(([set, a]) => ({ set, url: a.url }))
      .sort((a, b) => (a.set < b.set ? -1 : a.set > b.set ? 1 : 0));
  }

  /** Whether a wanted file has not landed yet. */
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
   *  generation): a reveal or a mount unit still in flight belongs to the old one and
   *  may never come back, so both are asked for again: a replacement's pieces still
   *  linking at once (or the file it replaces would draw in its place for good), the
   *  stand-in from the next poll. */
  gateChanged(): void {
    for (const [set, entry] of this.incoming) {
      // every piece again, the ones the old gate settled too: what it linked and uploaded
      // belongs to the old renderer generation
      entry.round++;
      const pieces = wocArmorPieces(entry.container);
      for (const piece of pieces) entry.pending.add(piece);
      for (const piece of pieces) this.revealIncoming(set, entry, piece);
    }
    if (!this.merge) return;
    this.merge.gateChanged();
    this.mergeQueued = null;
    this.mergeStale = true;
  }

  /** Draw exactly these sets: attach what is resident, stream the rest, detach the rest.
   *  Returns whether the attached files changed. */
  want(sets: readonly string[]): boolean {
    this.wanted = sets;
    const changed = this.sync();
    return this.takeSwapped() || changed;
  }

  /** Per frame: attach a file that just arrived (and let the store free idle sets on
   *  time), and keep the merged stand-in a world view asked for in step with the parts.
   *  Returns whether the attached FILES changed (the caller re-dresses: a file attached, or
   *  a replacement took over since the last frame); free while nothing waits. */
  poll(): boolean {
    tickWocArmorPacks();
    const synced = this.waiting ? this.sync() : false;
    const changed = this.takeSwapped() || synced;
    // a file change is re-dressed by the caller first (redressed reconciles): the
    // stand-in is mounted from a later frame's poll, for the parts as they then draw
    if (!changed) this.pollMerged();
    return changed;
  }

  /** Whether a replacement took over since the caller last heard (and now it has). */
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
      const url = wocSetFileNow(this.manifest.fit, set, tier);
      if (url !== wocArmorPackUrl(this.manifest.fit, set, tier)) waiting = true;
      const current = this.attached.get(set);
      const next = this.incoming.get(set);
      if ((next ?? current)?.url === url) continue;
      // a replacement overtaken while it linked (a better tier landed meanwhile) never drew
      if (next) {
        this.discard(set, next);
        changed = true;
        if (current?.url === url) continue;
      }
      if (!url) {
        if (current) {
          this.detach(set, current);
          changed = true;
        }
        continue;
      }
      const container = attachWocArmorPack(this.host.model, url, set, this.manifest, this.lod);
      if (!container) {
        waiting = true;
        continue;
      }
      changed = true;
      const pieces = wocArmorPieces(container);
      if (current) {
        // the file this one replaces keeps drawing until every piece of it is revealed
        const entry: Incoming = {
          url,
          container,
          pending: new Set(pieces),
          round: 0,
          unprepared: 0,
        };
        this.incoming.set(set, entry);
        for (const piece of pieces) {
          this.host.adopt(piece);
          this.revealIncoming(set, entry, piece);
        }
        continue;
      }
      this.attached.set(set, { url, container });
      for (const piece of pieces) {
        this.host.adopt(piece);
        // its parts draw from the moment the reveal settles: the stand-in follows
        this.host.reveal(piece, this.staleMerged);
      }
      this.mergeStale = true;
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

  /** Reveal one piece of a replacement through the host's gate. A piece revealed while
   *  others still link is hidden again (the swap is one step, never a frame of both files'
   *  parts over each other); the last one hands the set over. One whose programs are not known
   *  linked is asked again while the file it replaces can still stand in (twice at most). */
  private revealIncoming(set: string, entry: Incoming, piece: THREE.Object3D): void {
    const round = entry.round;
    this.host.reveal(piece, (prepared) => {
      // overtaken, detached or disposed while it linked: nothing of it is drawn
      if (this.incoming.get(set) !== entry) return;
      // a settle of a replaced gate (the host shows what it settles): the piece waits on
      // the new gate's
      if (entry.round !== round) {
        if (entry.pending.has(piece)) piece.visible = false;
        return;
      }
      if (prepared === false && entry.unprepared < MAX_UNPREPARED_REVEALS) {
        entry.unprepared++;
        piece.visible = false;
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

  /** Give every file back (CharacterVisual.dispose). */
  dispose(): void {
    this.merge?.dispose();
    this.merge = null;
    this.mergeQueued = null;
    for (const current of this.attached.values()) releaseWocArmorContainer(current.container);
    for (const next of this.incoming.values()) releaseWocArmorContainer(next.container);
    this.attached.clear();
    this.incoming.clear();
    this.swapped = false;
    this.waiting = false;
  }
}
