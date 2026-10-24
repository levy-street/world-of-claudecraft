// The three.js half of the WOC head builder, one per WOC CharacterVisual: hang
// the pieces its look draws on the `head` bone (woc_head_packs.ts), and keep the
// drawn pieces, the face morphs and the four tints in step with a look
// (woc_head_look_core.ts). The head files ARE the head: a base file ends at the
// neck. A look change is visibility flags, morph influences and uniform writes
// on the live model, plus a piece hung for what it adds and one taken off for
// what it no longer draws: nothing is rebuilt, so the face builder's clicks and
// colour drags land with no flicker.
//
// A body carries only what its head draws (S2 of the PR 4360 review: a body used
// to hang every resident file of its type, some eighty meshes of which a dozen
// drew, and paid for them in every matrix update and material pass). The pieces
// of the look are hung at build (they ride the body's own first draw); a piece
// the look wants later (a file landing, a pick in the builder) is hung as one
// unit of the host's work queue (its frame budget paces a crowd that waited for
// the same file; on the spot with no queue), one wrapper through the host's
// compile gate; and a piece neither drawn nor wanted any more leaves the scene
// graph, its tint clone with it (`apply`, which every pass ends on). A hairstyle
// a worn helm hides stays hung, hidden: the helm coming off is a flag.
//
// The head library ships SPLIT (the core, one file per hairstyle, the beard
// files), so a head streams (woc_head_stream_core.ts owns the rules). Going live
// has two modes. WHOLE LOOK, the default (a preview, a portrait, the face
// builder): until EVERY piece of the current look is hung and revealed the head
// draws nothing, and its host keeps the whole body undrawn (`awaited`: never a
// headless or bald body popping its hair later). BARE STAND-IN, the world view's
// opt-in (setBareStandIn): a body in the world never waits on a hairstyle or a
// beard, so its head goes live as soon as its core pieces are there, drawing
// whichever of its hairstyle and beard are there too; one still on the wire, or
// one whose fetch failed, joins later through the same hidden-until-linked
// reveal, and until then the bare head stands in. In both modes a later look
// change whose piece is not ready keeps the previous one drawn until the new one
// is hung and revealed, then swaps (no bald flash in the face builder). A NEW
// subject on a reused body (a roster pick, an inspected player: WocHeadHold
// 'look') keeps the previous head whole instead, face and colours too, until
// every piece of the new look is shown, so no character is ever drawn in
// another's hair.
//
// Going live happens when the look is set (setLook / setAppearance), on the
// per-frame poll, or when a reveal settles: never in the constructor, because a
// host builds the body first and hands it its look a moment later
// (createCharacterVisual, the preview), and a head born live on the type's
// DEFAULT look would then hold that default hairstyle while the player's own
// streamed in.
//
// Tints: every head material and the body's own material are cloned once per
// visual and wrapped with their tint layer (woc_head_tint.ts) before the body's
// first draw (a late piece's, inside its adoption); after that a colour is a
// uniform write. The wrap happens again after the host re-derives materials (a
// skin or atlas swap: `retint`), reusing the clone of an unchanged source. Which
// mesh takes which tint, and how strongly, is woc_skin_tint_core.ts: skin colour
// changes only skin, so the body's layer is switched off (strength 0, the same
// program) while the body draws a class under-armor atlas.
//
// One draw for the whole head: a world view asks (setMerged) for the drawn
// pieces to be folded into ONE mesh on one material (woc_head_merge.ts) once the
// head is whole, at rest, opaque and actually drawn. The pieces stay the source
// of truth here, shown, posed and tinted exactly as before. `apply` only
// reconciles: it drops a stand-in the drawn head no longer matches (a hairstyle,
// the helm, a slider), so the pieces draw again on that frame, and leaves the
// new head waiting. The mount is main-thread work (a build, the visual's
// per-mesh setup), so it runs as units of the host's work queue (the build a
// band of the fold a unit, then the mount), asked for from the per-frame poll;
// never inside `apply`, which runs within the host's own material passes. The
// stand-in's material is wrapped with the merged tint
// layer, its slot rows read off the pieces' own materials.
import type * as THREE from 'three';
import type { GeometryLodLevel } from '../assets/geometry_lod';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import { logAssetMissOnce } from './asset_miss_log';
import { SURFACE_RESPONSE_PROGRAM } from './surface_response';
import {
  type WocHeadLook,
  type WocHeadType,
  wocHeadBaseNode,
  wocHeadCoreUrl,
  wocHeadVisibleNodes,
} from './woc_head_catalog';
import {
  type WocHeadAppearanceInput,
  type WocHeadLookState,
  type WocHeadTintedRole,
  type WocHeadTintRef,
  type WocLinearRgb,
  wocHeadLookFromAppearance,
} from './woc_head_look_core';
import {
  WOC_HEAD_MERGED_KEY,
  type WocHeadMergeCandidate,
  type WocHeadMergeHost,
  WocHeadMergeRig,
  wocHeadMergeSurfaceOf,
} from './woc_head_merge';
import {
  dropWocMergedProof,
  recordWocMergedProof,
  wocMergedProgramProven,
} from './woc_head_merge_proof_core';
import {
  ensureWocHeadFile,
  hangWocHeadNamed,
  hangWocHeadPieces,
  unhangWocHeadPieces,
  WOC_HEAD_TINT_REF_KEY,
  WOC_HEAD_TINT_ROLE_KEY,
  type WocHeadRig,
  wocHeadFileMaterial,
  wocHeadFilePieceNames,
  wocHeadFileResident,
  wocHeadFileState,
  wocHeadRigOf,
} from './woc_head_packs';
import {
  type WocHeadFileState,
  wocHeadAwaited,
  wocHeadDrawnLook,
  wocHeadDrawnMorphs,
  wocHeadFileJoining,
  wocHeadFileSettled,
  wocHeadLiveLook,
  wocHeadLookPieces,
} from './woc_head_stream_core';
import {
  attachWocHeadMergedTint,
  attachWocHeadTint,
  setWocHeadMergedColors,
  setWocHeadMergedSlots,
  setWocHeadTint,
  type WocHeadMergedTintUniforms,
  type WocHeadTintUniforms,
  wocHeadMergedTintOf,
  wocHeadMergeOneSided,
  wocHeadTintOf,
} from './woc_head_tint';
import { type WocBodyAtlas, wocMeshTint, wocTintStrength } from './woc_skin_tint_core';

/** The character-visual side of a late attach (woc_armor_dressing.ts's host shape). */
export interface WocHeadDressingHost extends WocHeadMergeHost {
  readonly model: THREE.Object3D;
  /** Reveal a freshly hung wrapper once its programs link, then call `live`. `prepared`
   *  is false when the host's gate gave up before they linked (the wrapper is shown all
   *  the same: a head piece has nothing to stand in for it). `proof` is the gate's own
   *  readiness proof for that node, when it has one: it can be asked again later, and
   *  answers for the host's context as it is then (woc_head_merge_proof_core.ts). */
  reveal(node: THREE.Object3D, live: (prepared: boolean, proof?: () => boolean) => void): void;
  /** The drawn head changed from a reveal (it went live, or a held piece swapped, or a
   *  hairstyle joined a head that stood in bare): re-dress on the next frame (never inside
   *  the gate callback), so the far bake keys on it. */
  relive(): void;
  /** The material a mesh draws with before any effect overlay: the tier material the
   *  host derived for it, with this dressing's wrap. */
  baseMaterial(mesh: THREE.Mesh): THREE.Material | THREE.Material[];
  /** Whether the articulated rig is what draws right now (not its far mesh, not a
   *  hidden body): a stand-in nobody would see is not built. A body the renderer never
   *  gated (a prewarm or speculative build) answers false too: its stand-in would be
   *  revealed with nothing proving its programs, and would mark them linked for the
   *  bodies that are gated. */
  rigDrawn(): boolean;
  /** Run `work` as one unit of the renderer's background work queue (its frame budget
   *  decides when), under a `kind:instance` label. Absent on a body with no renderer
   *  behind it (a test, a direct build), where the work runs on the spot. */
  schedule?(work: () => void, label: string): void;
}

/**
 * The tint one model mesh takes, by the rule every WOC body is dressed with
 * (woc_skin_tint_core.ts wocMeshTint, read off the mesh here): a hung head piece's
 * own role and measured reference (stamped at hang time, woc_head_packs.ts), else
 * the body's skin key on the skin-bearing body nodes (never an armor part), else
 * none. The far bake resolves its baked groups through this same rule
 * (woc_far_bake.ts), so the far LOD tints exactly what the near body tints.
 */
export function wocHeadTintTarget(mesh: THREE.Object3D, type: WocHeadType): WocHeadTintRef | null {
  return wocMeshTint(
    {
      name: mesh.name,
      role: mesh.userData[WOC_HEAD_TINT_ROLE_KEY] as WocHeadTintedRole | undefined,
      ref: mesh.userData[WOC_HEAD_TINT_REF_KEY] as WocLinearRgb | undefined,
      armorPart: !!mesh.userData.wocArmorPart,
    },
    type,
  );
}

const NOTHING: ReadonlySet<string> = new Set();

/** The work-queue label kinds of a merged head's units (the budget learns a cost per
 *  kind: gpu_prep_budget_core.ts gpuPrepKindOfLabel): a band of a head's fold, and the
 *  mount of a head that is whole (a new head's own, or one somebody already built). */
export const WOC_HEAD_MERGE_LABEL = 'woc-head-merge';
export const WOC_HEAD_MOUNT_LABEL = 'woc-head-mount';
/** The label kind of a late hang: pieces put on a body already built, when their file
 *  lands or a look starts to draw them. */
export const WOC_HEAD_HANG_LABEL = 'woc-head-hang';

const single = (material: THREE.Material | THREE.Material[]): THREE.Material | null =>
  (Array.isArray(material) ? material[0] : material) ?? null;

/** What three keys a material's program on, as far as two materials of one head can
 *  differ: the hook chain and whether it blends. */
const programKey = (material: THREE.Material): string =>
  `${material.customProgramCacheKey()}|${material.transparent ? 1 : 0}`;

/** Whether the host links this material's program before it mounts it (visual.ts
 *  collectUnlinkedEffectMaterials stages exactly these: a blending overlay, and the
 *  marked hit response). */
const stagedByHost = (material: THREE.Material): boolean =>
  material.transparent || material.userData[SURFACE_RESPONSE_PROGRAM] === true;

/** Whether the first mesh under `node` draws through a transparent material right now
 *  (an effect overlay the host mounted over it). */
function mountedTranslucent(node: THREE.Object3D): boolean {
  let found: THREE.Material | null = null;
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (found || !mesh.isMesh) return;
    found = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) ?? null;
  });
  return (found as THREE.Material | null)?.transparent === true;
}

/**
 * How a look change whose files still stream is drawn until they are shown:
 * 'slot' (the default: one character's own edit, the face builder or a live
 * redesign) keeps just the previous hairstyle or beard; 'look' (a NEW subject on
 * a reused body, a roster pick or an inspected player) keeps the previous head
 * whole, every piece, morph and colour, then swaps to the new one at once.
 */
export type WocHeadHold = 'slot' | 'look';

/** Pieces hung together after the body was built, their reveal still in flight. */
interface PendingHang {
  /** Piece node name -> the node this hang put on the body for it. */
  readonly pieces: ReadonlyMap<string, THREE.Object3D>;
  readonly wrappers: readonly THREE.Object3D[];
  /** Wrappers of the hang still linking. */
  left: number;
  /** Which ask of the host's gate its reveal rides. A gate that was replaced may never
   *  settle, so the hang is asked again of the new one (gateChanged), and a settle that
   *  belongs to an earlier ask is ignored. */
  ask: number;
}

/** Every piece node of a look's files (wocHeadLookPieces), as one set. */
function nodesOf(pieces: ReadonlyMap<string, readonly string[]>): Set<string> {
  const out = new Set<string>();
  for (const names of pieces.values()) for (const name of names) out.add(name);
  return out;
}

export class WocHeadDressing {
  /** The model's hung head (every piece hung on it); null until one is. */
  private rig: WocHeadRig | null = null;
  /** Piece nodes ready to draw: hung at build (they ride the body's own first draw) or
   *  hung later and revealed through the gate. A piece its resident file does not carry
   *  counts too: nothing will ever draw it, so nothing waits for it. */
  private readonly shown = new Set<string>();
  /** Hangs made after the build whose reveal is in flight. */
  private readonly revealing = new Set<PendingHang>();
  /** Resident files that cannot hang on this model (no rig, no piece on a bone of it). */
  private readonly refused = new Set<string>();
  /** The head draws. */
  private live = false;
  /** A body in the world: the head goes live on its core alone, the bare head standing
   *  in for a hairstyle or a beard still on the wire (setBareStandIn). */
  private bare = false;
  /** The look wanted (the last one handed in; the one the body was born with until then). */
  private state: WocHeadLookState;
  /** The files the wanted look draws, and the piece nodes it draws out of each
   *  (woc_head_stream_core.ts wocHeadLookPieces): all this body hangs once at rest. */
  private wantPieces: ReadonlyMap<string, readonly string[]>;
  private wantUrls: readonly string[];
  private wantNodes: ReadonlySet<string>;
  /** The look drawn while live: the wanted one, or its held piece while a newly picked
   *  one is not ready (a head standing in bare holds "no hairstyle" this way). Null until
   *  live. */
  private drawnHead: WocHeadLook | null = null;
  /** The previous subject's head, drawn whole while a new subject's files stream (a
   *  'look' hold); null otherwise. */
  private held: { readonly state: WocHeadLookState; readonly look: WocHeadLook } | null = null;
  /** Live with every wanted piece shown: the per-frame poll has nothing to do. */
  private settled = false;
  private helm = false;
  /** `${source uuid}|${role}|${surface}|${reference}` -> this visual's wrapped clone. */
  private readonly wrapped = new Map<string, THREE.Material>();
  /** Every wrapped clone's uniforms, with the strength its colour writes carry
   *  (woc_skin_tint_core.ts wocTintStrength, as of its last wrap). */
  private readonly uniforms = new Map<WocHeadTintUniforms, number>();
  /** What the body mesh draws (its own suit, or a class under-armor atlas): the host's
   *  call, handed in with each `retint`. */
  private bodyAtlas: WocBodyAtlas = 'suit';
  private readonly drawn = new Set<string>();
  private readonly isShown = (node: string): boolean => this.shown.has(node);
  /** A piece neither shown nor hung on this body (one hung and still linking is not). */
  private readonly isLacking = (node: string): boolean =>
    !this.shown.has(node) && this.rig?.pieces.has(node) !== true;
  /** The one-draw stand-in for the drawn pieces (woc_head_merge.ts); null until a world
   *  view asks for it (setMerged). */
  private merge: WocHeadMergeRig | null = null;
  /** `${source uuid}|${sidedness variant}` -> this visual's clone wrapped with the merged
   *  tint layer. */
  private readonly wrappedMerged = new Map<string, THREE.Material>();
  /** The merged material's uniforms as of its last wrap (a colour is a uniform write). */
  private mergedUniforms: WocHeadMergedTintUniforms | null = null;
  /** The tier material and program variant the mounted stand-in was wrapped from, and
   *  the wrap itself: the program its reveal proves (woc_head_merge_proof_core.ts). */
  private mergedProgram: {
    readonly source: THREE.Material;
    readonly wrapped: THREE.Material;
    readonly bit: number;
  } | null = null;
  /** The merged programs a reveal of this body's stand-in became the witness of
   *  (woc_head_merge_proof_core.ts), by `${source uuid}|${variant}`: let go of at dispose. */
  private readonly witnessed = new Map<
    string,
    { readonly source: THREE.Material; readonly wrapped: THREE.Material; readonly bit: number }
  >();
  /** The stream of units the waiting stand-in holds on the host's work queue (one unit at
   *  a time), by identity: a unit left behind by an earlier ask (its gate replaced under
   *  it) stops where it stands, and never clears a later stream's. */
  private mergeQueued: object | null = null;
  /** The late hang on the host's work queue (one unit per head at a time); null: none. */
  private hangQueued: object | null = null;
  /** The head drew through a translucent effect at the last look (effectsChanged). */
  private translucent = false;
  /** A mount was taken straight down again: the body is about to turn translucent (the
   *  effect's swap still links, so the pieces had not shown it). No head is planned
   *  until the host's next effect commit, whichever way the effect goes. */
  private effectHeld = false;
  /** Inside the host's full material sweep every mesh wears its fresh pre-effect
   *  material, and the host's record of them is stale (retint `fresh`). */
  private fresh = false;

  /** `lod`: the geometry level the hung pieces and their merged stand-in draw
   *  (woc_lod_core.ts), fixed for the body's life. `born`: the appearance whose head the
   *  body was built with (AssembleOptions.wocHead; nothing: the type's default look), the
   *  look this head wants until its host hands it another. */
  constructor(
    private readonly host: WocHeadDressingHost,
    readonly type: WocHeadType,
    private readonly lod: GeometryLodLevel = 'lod0',
    born: WocHeadAppearanceInput = null,
  ) {
    this.state = wocHeadLookFromAppearance(born, type);
    this.wantPieces = wocHeadLookPieces(type, this.state.look);
    this.wantUrls = [...this.wantPieces.keys()];
    this.wantNodes = nodesOf(this.wantPieces);
    // the pieces assembleModel hung at build draw with the body
    const hung = wocHeadRigOf(host.model);
    if (hung && hung.type === type) {
      this.rig = hung;
      for (const name of hung.pieces.keys()) this.shown.add(name);
    }
    // the core every look wears; the look's own files are kicked when it is set (or polled)
    ensureWocHeadFile(wocHeadCoreUrl(type));
  }

  /** Whether the new head draws. */
  get isLive(): boolean {
    return this.live;
  }

  /**
   * A body in the world: let the head go live on its core alone, the bare head standing
   * in for a hairstyle or a beard whose file is still on the wire, or failed
   * (woc_head_stream_core.ts wocHeadLiveLook). The missing piece joins through the same
   * hidden-until-linked reveal a later pick uses, and the body never waits (`awaited`).
   * Off by default: a preview, a portrait and the face builder draw a head only whole.
   * The world view opts in (createCharacterVisual), before it hands the look in.
   */
  setBareStandIn(on: boolean): void {
    if (on === this.bare) return;
    this.bare = on;
    this.settled = false;
  }

  /**
   * Whether the body should stay undrawn for its head (woc_head_stream_core.ts
   * wocHeadAwaited): the head is not live and every file its look still lacks is on its
   * way. False once live, and false when a file failed to load or cannot hang on this
   * body: that body draws without its head rather than hide behind a dead request.
   * Always false for a body in the world (setBareStandIn): it never waits on a head file.
   */
  get awaited(): boolean {
    if (this.live || this.bare) return false;
    const states = this.wantUrls.map((url) => this.fileState(url));
    // every piece shown, the head a poll away from live: still nothing to draw
    return states.every((state) => state === 'resident') || wocHeadAwaited(states);
  }

  /**
   * Whether a piece is on its way to the drawn head right now: a previous subject still
   * stands in, a hang is linking, the head is not live yet but about to be, or a file of
   * the wanted look is on the wire or landed and a poll away from hanging
   * (woc_head_stream_core.ts wocHeadFileJoining). A file that failed or cannot hang is
   * not, and neither is one nobody asked for. The host holds its far bake while this is
   * true, so neither a head going live on its first frame nor a hairstyle joining one
   * that stands in bare costs the body a second bake.
   */
  get joining(): boolean {
    if (this.held !== null || this.revealing.size > 0) return true;
    // not live yet but about to be (its pieces are there and a poll away, or its core is
    // on the wire): what this body draws of its head now is not what it will keep
    if (!this.live) {
      const coming = this.bare
        ? this.fileState(wocHeadCoreUrl(this.type)) !== 'failed'
        : this.awaited;
      if (coming) return true;
    }
    for (const url of this.wantUrls) if (wocHeadFileJoining(this.fileState(url))) return true;
    return false;
  }

  /** One file of the wanted look as this head sees it (WocHeadFileState). */
  private fileState(url: string): WocHeadFileState {
    if ((this.wantPieces.get(url) ?? []).every(this.isShown)) return 'resident';
    if (this.refused.has(url)) return 'failed';
    const state = wocHeadFileState(url);
    // parsed but not all of it hung and revealed yet: a poll hangs it, the gate links it
    return state === 'resident' ? 'loading' : state;
  }

  /** The look wanted now (drawn once its pieces are ready). */
  get look(): WocHeadLookState {
    return this.state;
  }

  /** The look drawn right now: the wanted look, or its held piece (or a previous
   *  subject's whole head) while the new one is not ready; a head standing in bare draws
   *  it bald or clean shaven. Null until live. */
  get drawnLook(): WocHeadLook | null {
    return this.drawnHead;
  }

  /** The head nodes drawn right now (empty until live): the far bake keys on them. */
  get drawnNames(): ReadonlySet<string> {
    return this.drawn;
  }

  /** The files the wanted look draws. */
  get lookUrls(): readonly string[] {
    return this.wantUrls;
  }

  /** How many per-visual tint clones this head and its body hold right now (tests, dev
   *  overlays): one per material that draws, never one per piece of the library. */
  get tintClones(): number {
    return this.wrapped.size;
  }

  /** Whether the head draws as its one merged mesh right now (dev overlays, tests). */
  get isMerged(): boolean {
    return this.merge?.standing ?? false;
  }

  /**
   * Draw the head as ONE mesh while it is whole and at rest (woc_head_merge.ts). Off by
   * default: a preview, a portrait and a test body keep drawing piece by piece, and the
   * world view opts in (createCharacterVisual), where a crowd's draw calls are the cost.
   */
  setMerged(on: boolean): void {
    if (on === (this.merge !== null)) return;
    if (on) {
      this.merge = new WocHeadMergeRig(
        this.host,
        this.type,
        () => this.retintMerged(),
        (node, live) => this.revealMerged(node, live),
        this.lod,
      );
      this.syncMerged();
      return;
    }
    this.merge?.dispose();
    this.merge = null;
    this.mergedUniforms = null;
    this.forgetMergedProof();
  }

  /** This body stops being the witness of any merged program (woc_head_merge_proof_core.ts):
   *  its stand-in is gone for good, and a witness kept past that pins what it holds. */
  private forgetMergedProof(): void {
    this.mergedProgram = null;
    for (const p of this.witnessed.values()) dropWocMergedProof(p.source, p.bit, p.wrapped);
    this.witnessed.clear();
  }

  /**
   * Per frame: ask for the hang of each piece the wanted look needs once its file has
   * landed (a unit of the host's work queue, gated: hangWanted), and go live once it can.
   * True when a piece was hung or the head went live within this call (the caller
   * re-dresses; a unit the queue runs later asks for that itself). Free once settled, a
   * few set lookups while a file streams (a head standing in bare for a file that failed
   * keeps asking: that is how its retry lands).
   */
  poll(): boolean {
    if (this.settled) return false;
    let changed = this.hangWanted();
    if (this.goLive()) changed = true;
    const shown = this.live && this.held === null && this.lookShown();
    // the one-draw stand-in: asked for here, only for a head at rest that somebody sees
    const merge = this.merge;
    if (merge?.isWaiting && this.atRest() && this.host.rigDrawn()) this.requestMount(merge);
    // a head whose stand-in still waits (its turn, a far body, a file that never came)
    // keeps polling: a few flag reads a frame
    this.settled = shown && !merge?.isWaiting;
    return changed;
  }

  /**
   * Whether the drawn head is the one it will stay: live, no previous subject held, no
   * hang linking, and settled in every file of the look (woc_head_stream_core.ts
   * wocHeadFileSettled: a streaming pick or a hairstyle still to come is about to change
   * the head; a file that failed or cannot hang never will).
   */
  private atRest(): boolean {
    if (!this.live || this.held !== null || this.revealing.size > 0) return false;
    for (const url of this.wantUrls) if (!wocHeadFileSettled(this.fileState(url))) return false;
    return true;
  }

  /**
   * Ask for the waiting stand-in: a stream of units of the host's work queue, one at a
   * time, whose frame budget decides when each runs (so a crowd arriving at once mounts
   * a few heads a frame, never forty), or on the spot with no renderer behind this body.
   * A head nobody built is folded first, ONE band a unit (woc_head_merge.ts foldPending:
   * every body in one face drives the same fold, and a unit folds a band of the head
   * that has waited longest, so a crowd's heads finish one after another), and a head
   * that is whole is mounted by a unit of its own. Two kinds of unit, then, each under
   * its label, so the budget learns a band and a mount apart: a unit that finds the
   * other kind's work waiting asks for a unit of that kind instead of doing it. Every
   * unit looks again when it runs: the head may have changed, gone far or been disposed
   * since.
   */
  private requestMount(merge: WocHeadMergeRig): void {
    // one stream a head: a frame that only waits on it builds nothing
    if (this.mergeQueued) return;
    const wanted = (): boolean =>
      this.merge === merge && merge.isWaiting && this.atRest() && this.host.rigDrawn();
    const mount = (): void => {
      if (!wanted()) return;
      merge.mountPending();
      if (!merge.mesh) this.mergedUniforms = null;
      // taken straight down again: an effect still linking is about to turn the body
      // translucent. Held until the host's next effect commit, which plans the head
      // again whichever way the effect went: mounted, or called off before it showed.
      if (merge.heldByEffect) this.effectHeld = true;
    };
    const schedule = this.host.schedule;
    if (!schedule) {
      mount();
      return;
    }
    const stream = {};
    /** The kind of the unit asked for: a band of the fold, or the mount. */
    let band = !merge.pendingBuilt;
    // A host with no queue behind it runs the unit inside the ask: the head is then
    // mounted whole on the spot, as with no schedule at all (bands buy nothing where
    // nothing runs between them, and such a body must not fold the heads of the others).
    let onTheSpot = true;
    const ask = (): void => {
      this.mergeQueued = stream;
      schedule(unit, `${band ? WOC_HEAD_MERGE_LABEL : WOC_HEAD_MOUNT_LABEL}:${this.type}`);
    };
    const unit = (): void => {
      // (a stream the gate was replaced under: the head has asked again since)
      if (this.mergeQueued !== stream) return;
      // over unless this unit asks for another; a throw ends it too, and the head asks again
      this.mergeQueued = null;
      if (onTheSpot) {
        mount();
        return;
      }
      if (!wanted()) {
        // changed, gone far, hidden or switched off since: its fold is let go
        merge.foldPending(false);
        return;
      }
      if (band) {
        if (!merge.pendingBuilt) merge.foldPending();
        // (a plan gone stale, a fold that threw: nothing waits any more)
        if (!merge.isWaiting) return;
        band = !merge.pendingBuilt;
        ask();
        return;
      }
      if (!merge.pendingBuilt) {
        // not whole after all: its geometry was dropped while this unit waited
        band = true;
        ask();
        return;
      }
      mount();
    };
    ask();
    onTheSpot = false;
  }

  /**
   * Reveal a freshly mounted stand-in. The first head of a program (the tier material it
   * was wrapped from, and its sidedness variant) links behind the host's compile gate;
   * a later one whose mesh wears that very program draws without a link, so it shows at
   * once instead of queueing a gate of its own behind every other reveal of a crowd,
   * but ONLY while a head that took the gate still proves the program in the host's
   * context: the gate's own readiness proof, asked again here, never a remembered bit
   * (woc_head_merge_proof_core.ts: a restored context, a rebuilt renderer or a released
   * program all answer no, and this head takes the gate). A head mounted under an
   * effect with a program of its own (the hit response) always takes the gate.
   *
   * The gate proves the materials the mesh wears WHEN IT SETTLES, and an effect edge
   * during the link swaps them, which reads as unprepared although nothing would link:
   * the new material either shares the program the gate just linked, or was linked by
   * the effect's own staging before the host mounted it. Only a material that is
   * neither (the plain wrap coming back after a gate that linked an effect's program)
   * leaves the head in its pieces for another try.
   */
  private revealMerged(node: THREE.Object3D, live: (prepared: boolean) => void): void {
    const merge = this.merge;
    const mesh = merge?.mesh ?? null;
    const program = this.mergedProgram;
    const worn = mesh ? single(mesh.material) : null;
    const plain = program ? programKey(program.wrapped) : null;
    const proven = (): boolean =>
      program !== null && wocMergedProgramProven(program.source, program.bit);
    if (worn && plain !== null && programKey(worn) === plain && proven()) {
      live(true);
      return;
    }
    const gated = worn ? programKey(worn) : null;
    this.host.reveal(node, (prepared, proof) => {
      const now = mesh ? single(mesh.material) : null;
      let ok = prepared;
      if (!ok && now && now !== worn) {
        const key = programKey(now);
        ok = key === gated || stagedByHost(now) || (key === plain && proven());
      }
      // The witness of the plain program: the gate settled prepared on the very material
      // it started with (an overruled miss proves nothing about that program), that
      // material is the plain wrap itself (an effect's clone over it may differ in a key
      // input this file cannot see), and the gate handed the proof it settled on. A host
      // with no proof to hand leaves no witness.
      if (prepared && proof && mesh && program && now === worn && now === program.wrapped) {
        recordWocMergedProof(program.source, program.bit, {
          holder: mesh,
          material: now,
          ready: proof,
        });
        this.witnessed.set(`${program.source.uuid}|${program.bit}`, program);
      }
      live(ok);
      // left in its pieces: plan it again (the rig stops after a second miss)
      if (!ok && this.merge === merge) this.syncMerged();
    });
  }

  /** Draw a look (an appearance record, normalized or raw). False when nothing changed. */
  setAppearance(app: WocHeadAppearanceInput, hold: WocHeadHold = 'slot'): boolean {
    return this.setLook(wocHeadLookFromAppearance(app, this.type), hold);
  }

  /**
   * Draw a look. Its pieces whose files are resident are hung here and now (behind the
   * host's gate on a body already drawn), the rest fetched and hung the frame they land.
   * A look whose pieces are all shown draws at once (and a head not live yet goes live on
   * it); until then the previous head is held as `hold` says (WocHeadHold). False when
   * nothing changed, including a repeat of the look a body was born with, unless the head
   * went live on it.
   */
  setLook(state: WocHeadLookState, hold: WocHeadHold = 'slot'): boolean {
    if (state.key === this.state.key) {
      if (this.live) return false;
      this.hangWanted();
      return this.goLive();
    }
    // a new subject: the head drawn now is kept whole until the new one can draw (an
    // earlier hold still in place keeps ITS head, the one on screen)
    if (hold === 'look' && this.live && this.held === null) {
      this.held = { state: this.state, look: this.drawnHead ?? this.state.look };
    }
    this.state = state;
    this.wantPieces = wocHeadLookPieces(this.type, state.look);
    this.wantUrls = [...this.wantPieces.keys()];
    this.wantNodes = nodesOf(this.wantPieces);
    this.settled = false;
    this.hangWanted();
    if (this.held && this.lookShown()) this.held = null;
    if (!this.goLive()) this.apply();
    return true;
  }

  /** A worn helm (or hood) hides the hair. False when nothing changed. */
  setHelm(helm: boolean): boolean {
    if (helm === this.helm) return false;
    this.helm = helm;
    this.apply();
    return true;
  }

  /** Re-assert the head over a manifest part pass, and take off the body every hung piece
   *  the head neither draws nor wants any more. */
  apply(): void {
    // what draws: the wanted look, or the previous subject's head while a 'look' hold stands
    const draw = this.held?.state ?? this.state;
    // colours first: the body's skin wears the chosen tone even while the head streams
    for (const [u, strength] of this.uniforms) setWocHeadTint(u, draw.colors[u.role], strength);
    if (this.mergedUniforms) setWocHeadMergedColors(this.mergedUniforms, draw.colors);
    const rig = this.rig;
    if (!rig) return;
    if (this.live) {
      this.drawnHead =
        this.held?.look ??
        wocHeadDrawnLook(
          this.type,
          this.state.look,
          this.drawnHead ?? this.state.look,
          this.isShown,
        );
    }
    const look = this.live ? this.drawnHead : null;
    const want = look
      ? new Set(wocHeadVisibleNodes(this.type, look, { helm: this.helm }))
      : NOTHING;
    this.drawn.clear();
    for (const [name, node] of rig.pieces) {
      const on = want.has(name);
      node.visible = on;
      if (on) this.drawn.add(name);
    }
    // the look's morphs by name, the crown and scalp tucks following the DRAWN hairstyle
    // (and a hair-hiding helm raising the crown), on every hung piece carrying each
    const morphs = wocHeadDrawnMorphs(draw, look ?? draw.look, this.helm);
    for (const mesh of rig.meshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const name in morphs) {
        const at = dict[name];
        if (at !== undefined) influences[at] = morphs[name];
      }
    }
    // the stand-in first: one the drawn head no longer matches drops here and hands its
    // pieces their layers back, before any of them leaves
    this.syncMerged();
    this.prune(look);
  }

  /**
   * Take every hung piece the head neither draws nor wants off the body: out of the
   * scene graph (no matrix update, no material pass ever visits it again), out of the
   * host's per-mesh record, its tint clone freed. Kept: the pieces of the wanted look
   * (one a helm hides too, and one still linking behind the gate) and the pieces of the
   * look drawn right now (a held hairstyle, a previous subject's whole head). A piece
   * taken off is hung again the moment a look wants it: the file stays resident.
   */
  private prune(drawn: WocHeadLook | null): void {
    const rig = this.rig;
    if (!rig) return;
    let held: Set<string> | null = null;
    const gone: string[] = [];
    for (const name of rig.pieces.keys()) {
      if (this.wantNodes.has(name)) continue;
      if (drawn) {
        held ??= new Set(wocHeadVisibleNodes(this.type, drawn, { helm: false }));
        if (held.has(name)) continue;
      }
      gone.push(name);
    }
    if (gone.length === 0) return;
    // the tint clones the leaving meshes draw with, read while the host still knows them
    const wraps = new Set<THREE.Material>();
    for (const name of gone) {
      rig.pieces.get(name)?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const base = this.baseOf(mesh);
        for (const material of Array.isArray(base) ? base : [base]) wraps.add(material);
      });
    }
    for (const node of unhangWocHeadPieces(this.host.model, gone)) this.host.forget(node);
    this.rig = wocHeadRigOf(this.host.model);
    for (const name of gone) this.shown.delete(name);
    // a hang whose every piece left: its settle belongs to nothing
    for (const pending of this.revealing) {
      let any = false;
      for (const [name, node] of pending.pieces) {
        if (this.rig?.pieces.get(name) === node) any = true;
      }
      if (!any) this.revealing.delete(pending);
    }
    this.freeWraps(wraps);
  }

  /** Free the wrapped clones among `candidates` that no piece left on the body draws
   *  with (two pieces can share one file material, so one clone). Anything else in the
   *  set (an untinted piece's shared tier material) is not this visual's to free. */
  private freeWraps(candidates: Set<THREE.Material>): void {
    for (const mesh of this.rig?.meshes ?? []) {
      const base = this.baseOf(mesh);
      for (const material of Array.isArray(base) ? base : [base]) candidates.delete(material);
    }
    if (candidates.size === 0) return;
    for (const [key, material] of this.wrapped) {
      if (!candidates.has(material)) continue;
      this.wrapped.delete(key);
      const u = wocHeadTintOf(material);
      if (u) this.uniforms.delete(u);
      material.dispose();
    }
  }

  /** The host mounted another effect state's materials: a head that turned translucent
   *  goes back to its pieces, one that turned solid again is merged from a later poll.
   *  Any other effect edge (a buff glow, a tint) changes nothing here. */
  effectsChanged(): void {
    if (!this.merge) return;
    const base = this.rig?.pieces.get(wocHeadBaseNode(this.type));
    const translucent = base ? mountedTranslucent(base) : false;
    const held = this.effectHeld;
    this.effectHeld = false;
    if (translucent === this.translucent && !held) return;
    this.syncMerged();
  }

  /** The host's compile gate was replaced (a pooled body handed to another renderer
   *  generation): a reveal still in flight would wait on a settle that never comes. A
   *  stand-in is planned again, and a piece hung late (a hairstyle joining a head that
   *  stands in bare) is asked of the new gate, or it would stay hidden for good. */
  gateChanged(): void {
    // a unit the previous queue dropped never ran: the head may ask again (and one still
    // queued there does nothing when it runs). A fold it was driving is let go with it:
    // nothing would ask for its next band until the head asks again, if it ever does.
    this.mergeQueued = null;
    this.hangQueued = null;
    for (const pending of [...this.revealing]) {
      if (this.revealing.has(pending)) this.askReveal(pending);
    }
    const merge = this.merge;
    merge?.foldPending(false);
    if (!merge || merge.standing || !merge.mesh) return;
    merge.drop();
    this.syncMerged();
  }

  /**
   * Reconcile the one-draw stand-in with the head as it draws now: one still standing
   * for exactly these pieces and this face is kept, any other is dropped at once (its
   * pieces draw again), and the new head waits for the poll. Never a mount: `apply`
   * runs inside the host's own material passes.
   */
  private syncMerged(): void {
    const merge = this.merge;
    if (!merge) return;
    const rig = this.live ? this.rig : null;
    const base = rig?.pieces.get(wocHeadBaseNode(this.type));
    // the bone the pieces ride: the base head's wrapper hangs on it
    const bone = base?.parent?.parent ?? null;
    let drawn: WocHeadMergeCandidate[] | null = null;
    // A translucent effect (the ghost run, stealth, Shadowform, any overlay whose material
    // is transparent) blends the head's overlapping pieces one by one, each on its own
    // sidedness: one two sided mesh blends them differently, so a head drawn through one
    // keeps its pieces for as long as the effect lasts (effectsChanged).
    this.translucent = base ? mountedTranslucent(base) : false;
    if (rig && bone && base && !this.translucent && !this.effectHeld) {
      drawn = [];
      for (const [name, node] of rig.pieces) {
        if (!this.drawn.has(name)) continue;
        node.traverse((o) => {
          const mesh = o as THREE.Mesh;
          const material = mesh.isMesh ? wocHeadFileMaterial(mesh) : null;
          if (!material) return;
          drawn?.push({
            mesh,
            piece: name,
            material,
            role: (mesh.userData[WOC_HEAD_TINT_ROLE_KEY] as WocHeadTintedRole | undefined) ?? null,
            ref: (mesh.userData[WOC_HEAD_TINT_REF_KEY] as WocLinearRgb | undefined) ?? null,
          });
        });
      }
    }
    // by name, so two characters in the same look fold their pieces in the same order
    // whatever order their files landed in, and share one merged buffer
    drawn?.sort((a, b) => (a.piece < b.piece ? -1 : a.piece > b.piece ? 1 : 0));
    const standing = merge.mesh;
    merge.sync(bone, drawn);
    // A stand-in taken down is left wearing whatever the host last mounted on it, an
    // effect's clone as often as not (a translucent effect is what takes most of them
    // down). It may be the witness of its plain program (woc_head_merge_proof_core.ts),
    // and the gate's proof walks what it WEARS: put the plain wrap back on it, so the
    // proof keeps answering for the material the gate proved. It is never drawn again.
    if (standing && merge.mesh !== standing && this.mergedProgram) {
      standing.material = this.mergedProgram.wrapped;
    }
    if (!merge.mesh) this.mergedUniforms = null;
    if (merge.isWaiting) this.settled = false;
  }

  /**
   * Wrap every head material and the body's own material with its tint layer (a
   * per-visual clone, reused while its source is unchanged). Call after any pass
   * that re-derives the model's materials, before the host snapshots them.
   * `bodyAtlas` is what the body mesh draws from now on (kept until the next call
   * that names one): under a class under-armor atlas the body's layer is off.
   * `fresh` says the host just re-derived EVERY material (its full sweep): each mesh
   * then wears its pre-effect material, and the host's own record of them is stale.
   */
  retint(bodyAtlas: WocBodyAtlas = this.bodyAtlas, fresh = false): void {
    this.bodyAtlas = bodyAtlas;
    this.fresh = fresh;
    this.host.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // the merged head takes its own layer, after the pieces its slot rows read
      if (!mesh.isMesh || mesh.userData[WOC_HEAD_MERGED_KEY]) return;
      const tint = wocHeadTintTarget(mesh, this.type);
      if (!tint) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => this.wrap(m, tint))
        : this.wrap(mesh.material, tint);
    });
    this.retintMerged();
    this.fresh = false;
    this.apply();
  }

  /**
   * Wrap the meshes under `root` exactly as `retint` wraps the model's own. They are twins
   * of model meshes (their names and tint facts ride the clone) staged off the model for a
   * swap the host commits later (woc_atlas_swap.ts), and each takes this visual's clone of
   * its material: the one the model's mesh mounts when that swap lands. What links behind
   * the host's gate is then the program the body draws, on the material it draws with.
   * Their strength is written for the atlas drawn NOW; the commit's `retint` names the new.
   */
  wrapTwins(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const tint = mesh.isMesh ? wocHeadTintTarget(mesh, this.type) : null;
      if (!tint) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => this.wrap(m, tint))
        : this.wrap(mesh.material, tint);
    });
  }

  /** The material `mesh` draws with before any effect overlay. */
  private baseOf(mesh: THREE.Mesh): THREE.Material | THREE.Material[] {
    return this.fresh ? mesh.material : this.host.baseMaterial(mesh);
  }

  /**
   * Wrap the merged head's material with the merged tint layer (a per-visual clone,
   * reused while its source is unchanged) and write its slot rows: each slot's tint
   * role and the surface its own piece draws with. Read off the materials BEFORE any
   * effect overlay, so a stand-in mounted mid-effect, or a file landing during one,
   * still measures the plain surfaces.
   */
  private retintMerged(): void {
    const merge = this.merge;
    const mesh = merge?.mesh;
    const table = merge?.table;
    if (!mesh || !table) return;
    const mounted = this.baseOf(mesh);
    const source = Array.isArray(mounted) ? mounted[0] : mounted;
    if (!source) return;
    let out = source;
    if (!wocHeadMergedTintOf(source)) {
      // the program variant follows the head (a one sided slot compiles the back-face
      // drop), so a wrap is kept per source and variant
      const oneSided = wocHeadMergeOneSided(table.slots);
      const key = `${source.uuid}|${oneSided ? 1 : 2}`;
      const hit = this.wrappedMerged.get(key);
      out = hit ?? cloneMaterialWithHooks(source);
      if (!hit) {
        attachWocHeadMergedTint(out, oneSided);
        this.wrappedMerged.set(key, out);
      }
      mesh.material = out;
      this.mergedProgram = { source, wrapped: out, bit: oneSided ? 1 : 2 };
    }
    const u = wocHeadMergedTintOf(out);
    if (!u) return;
    this.mergedUniforms = u;
    setWocHeadMergedSlots(
      u,
      table.slots,
      table.slotSources.map((piece) => wocHeadMergeSurfaceOf(this.baseOf(piece))),
      wocHeadMergeSurfaceOf(out),
    );
    u.hair.value = table.hairMap;
    u.beard.value = table.beardMap;
    u.scalp.value = table.scalpMap;
    setWocHeadMergedColors(u, (this.held?.state ?? this.state).colors);
  }

  /** Whether every piece of the wanted look is hung and revealed on this model. */
  private lookShown(): boolean {
    for (const name of this.wantNodes) if (!this.shown.has(name)) return false;
    return true;
  }

  /** Go live (and draw) once the wanted look can (woc_head_stream_core.ts
   *  wocHeadLiveLook: whole, or its core alone for a head standing in bare). True when
   *  the head went live just now; a head already live, or still streaming, is left
   *  untouched. */
  private goLive(): boolean {
    if (this.live) return false;
    // the per-frame answer of a head that still streams, before anything is built: a
    // bare stand-in needs the base head at least, a whole look every piece it wants
    if (this.bare ? !this.shown.has(wocHeadBaseNode(this.type)) : !this.lookShown()) return false;
    const born = wocHeadLiveLook(this.type, this.state.look, this.isShown, this.bare);
    if (!born) return false;
    this.live = true;
    // what it draws from its first frame: a hairstyle or a beard a bare stand-in left off
    // is held as none from here, and joins the moment its piece is revealed (`apply`)
    this.drawnHead = born;
    this.apply();
    return true;
  }

  /**
   * Hang every piece the wanted look still lacks on this body out of the files resident
   * right now, and kick the fetch of a file that is not (idempotent: a failed fetch
   * re-arms after its cooldown). The hang is ONE unit of the host's work queue, whose
   * frame budget decides when it runs: a file a crowd was waiting for lands for all of
   * them in one frame, and forty bodies must not all hang it there (the burst S3 of the
   * PR 4360 review names for armor). With no queue behind the host (a preview, a direct
   * build, a body its renderer has not met yet) it runs on the spot. True when a piece
   * was hung within this call.
   */
  private hangWanted(): boolean {
    let ready = false;
    for (const url of this.wantUrls) {
      const names = this.wantPieces.get(url);
      // shown, or hung and still linking: nothing of it left to hang (the per-frame
      // answer while a file streams or sits out a failed fetch, so it allocates nothing)
      if (!names || this.refused.has(url) || !names.some(this.isLacking)) continue;
      if (wocHeadFileResident(url)) ready = true;
      else ensureWocHeadFile(url);
    }
    if (!ready) return false;
    const schedule = this.host.schedule;
    if (!schedule) return this.hangResident();
    // one unit at a time: a frame that only waits on it hangs nothing
    if (this.hangQueued) return false;
    const unit = {};
    this.hangQueued = unit;
    let hung = false;
    let asked = false;
    schedule(() => {
      // dropped with its queue, or the body disposed since: it hangs nothing
      if (this.hangQueued !== unit) return;
      this.hangQueued = null;
      hung = this.hangResident();
      // run later by the queue, outside any poll: the host re-dresses on its next frame
      if (hung && asked) this.host.relive();
    }, `${WOC_HEAD_HANG_LABEL}:${this.type}`);
    asked = true;
    return hung;
  }

  /** Hang what the wanted look lacks out of the files resident now: the unit hangWanted
   *  asks for, which reads the look again when it runs (it may have changed since). True
   *  when a piece was hung. */
  private hangResident(): boolean {
    let changed = false;
    for (const url of this.wantUrls) {
      const names = this.wantPieces.get(url);
      if (!names || this.refused.has(url) || !wocHeadFileResident(url)) continue;
      const lacking = names.filter(this.isLacking);
      if (lacking.length > 0 && this.attach(url, lacking)) changed = true;
    }
    return changed;
  }

  /** Hang pieces of one resident file the look wants, hidden behind the host's compile
   *  gate; they count as shown once every wrapper of the hang is revealed. False when
   *  the file cannot hang on this model (never retried). */
  private attach(url: string, names: readonly string[]): boolean {
    const model = this.host.model;
    const carried = wocHeadFilePieceNames(model, url);
    // a piece the file does not ship will never draw: nothing waits for it
    const wanted = carried ? names.filter((name) => carried.has(name)) : names;
    if (carried) for (const name of names) if (!carried.has(name)) this.shown.add(name);
    if (carried && wanted.length === 0) return true;
    const hang = carried ? hangWocHeadPieces(model, this.type, url, wanted, this.lod) : null;
    if (!hang) {
      this.refused.add(url);
      logAssetMissOnce(
        `woc-head-hang:${url}`,
        `WOC head file ${url} could not hang on this body (no rig, or no piece on a bone of it)`,
      );
      return false;
    }
    this.rig = wocHeadRigOf(model);
    // ...and neither does one with no bone to ride on this body
    for (const name of wanted) if (!hang.pieces.has(name)) this.shown.add(name);
    const pending: PendingHang = {
      pieces: hang.pieces,
      wrappers: hang.wrappers,
      left: 0,
      ask: 0,
    };
    this.revealing.add(pending);
    for (const wrapper of hang.wrappers) this.host.adopt(wrapper, () => this.retint());
    this.apply();
    this.askReveal(pending);
    return true;
  }

  /** Ask the host's gate to reveal a hang's wrappers (hidden until their programs link). */
  private askReveal(pending: PendingHang): void {
    const ask = ++pending.ask;
    pending.left = pending.wrappers.length;
    for (const wrapper of pending.wrappers) {
      this.host.reveal(wrapper, () => {
        if (pending.ask === ask) this.revealed(pending);
      });
    }
  }

  /** One wrapper of a hang was revealed: with its last one, the hang's pieces are shown. */
  private revealed(pending: PendingHang): void {
    // its pieces were taken off again before it linked: the settle belongs to nothing
    if (!this.revealing.has(pending)) return;
    if (--pending.left > 0) return;
    this.revealing.delete(pending);
    // revealed means drawn: a host with no gate left to ask (one taken away while this
    // hang linked) settles without touching the wrapper an earlier ask had hidden
    for (const wrapper of pending.wrappers) wrapper.visible = true;
    const hung = this.rig?.pieces;
    for (const [name, node] of pending.pieces) if (hung?.get(name) === node) this.shown.add(name);
    this.settled = false;
    const was = this.drawnKey();
    // the new subject is whole: its held predecessor gives way
    if (this.held && this.lookShown()) this.held = null;
    // live now, or a live head swapping in what it held for this piece
    if (!this.goLive() && this.live) this.apply();
    if (this.drawnKey() !== was) this.host.relive();
  }

  /** What a reveal can change of the drawn head: whether it draws, the pieces it draws,
   *  and whether a previous subject's head (its morphs with it) still stands in. */
  private drawnKey(): string {
    const d = this.drawnHead;
    if (!this.live || !d) return '';
    const held = this.held ? `held:${this.held.state.key}` : this.state.key;
    return `${held}|${d.hair}|${d.beard}|${d.nose}|${d.mouth}|${d.brows}|${d.ears}|${d.eyes}|${d.piercing}`;
  }

  private wrap(source: THREE.Material, tint: WocHeadTintRef): THREE.Material {
    // the WeakMap, never the userData flag: a bare Material.clone() copies the flag
    // without the hook, and would read as wrapped while drawing untinted
    let out = source;
    if (!wocHeadTintOf(source)) {
      const key = `${source.uuid}|${tint.role}|${tint.surface ?? ''}|${tint.ref.join(',')}`;
      const hit = this.wrapped.get(key);
      out = hit ?? cloneMaterialWithHooks(source);
      if (!hit) {
        attachWocHeadTint(out, tint.role, tint.ref, tint.surface);
        this.wrapped.set(key, out);
      }
    }
    // the strength this material draws at from now on: a re-derived source is one atlas
    // for good, and a material still mounted follows the atlas the host names
    const u = wocHeadTintOf(out);
    if (u) {
      const strength = wocTintStrength(tint, this.bodyAtlas);
      this.uniforms.set(u, strength);
      setWocHeadTint(u, (this.held?.state ?? this.state).colors[tint.role], strength);
    }
    return out;
  }

  /** Free this visual's wrapped materials (their programs are shared and stay linked). */
  dispose(): void {
    // a hang still on the queue belongs to a body that is gone
    this.hangQueued = null;
    this.merge?.dispose();
    this.merge = null;
    this.mergedUniforms = null;
    this.forgetMergedProof();
    for (const m of this.wrapped.values()) m.dispose();
    this.wrapped.clear();
    for (const m of this.wrappedMerged.values()) m.dispose();
    this.wrappedMerged.clear();
    this.uniforms.clear();
  }
}

/**
 * Dress a throwaway model's head for the far bake: hang the head pieces named in `parts`
 * that it does not carry yet (woc_head_packs.ts hangWocHeadNamed: a throwaway is built
 * with no head at all, so it carries exactly what its bake draws), and show those and
 * nothing else.
 */
export function applyWocHeadBakeVisibility(
  model: THREE.Object3D,
  parts: ReadonlySet<string>,
): void {
  hangWocHeadNamed(model, parts);
  const rig = wocHeadRigOf(model);
  if (!rig) return;
  for (const [name, node] of rig.pieces) node.visible = parts.has(name);
}

export type { WocHeadRig };
