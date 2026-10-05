// The three.js half of the WOC head builder, one per WOC CharacterVisual: hang
// the body type's head files on the `head` bone (woc_head_packs.ts), and keep
// the drawn pieces, the face morphs and the four tints in step with a look
// (woc_head_look_core.ts). The head files ARE the head: a base file ends at the
// neck. A look change is visibility flags, morph influences and uniform writes
// on the live model: nothing is rebuilt, so the face builder's clicks and
// colour drags land on the next frame with no flicker.
//
// The head library ships SPLIT (the core, one file per hairstyle, the beard
// files), so a head streams file by file (woc_head_stream_core.ts owns the
// rules): the files hung at build ride the body's own first draw, and every
// other file the look wants attaches the frame it lands (poll), one wrapper
// through the host's compile gate. Until EVERY file of the current look is hung
// and revealed the head draws nothing, and its host keeps the whole body
// undrawn (`awaited`: never a headless or bald body popping its hair later);
// only then does the head go live. A later look change whose hairstyle or beard
// file is not ready keeps the previous one drawn until the new file is hung and
// revealed, then swaps (no bald flash in the face builder). A NEW subject on a
// reused body (a roster pick, an inspected player: WocHeadHold 'look') keeps
// the previous head whole instead, face and colours too, until every file of
// the new look is shown, so no character is ever drawn in another's hair.
//
// Going live happens when the look is set (setLook / setAppearance), on the
// per-frame poll, or when the last file's reveal settles: never in the
// constructor, because a host builds the body first and hands it its look a
// moment later (createCharacterVisual, the preview), and a head born live on
// the type's DEFAULT look would then hold that default hairstyle while the
// player's own streamed in.
//
// Tints: every head material and the body's own material are cloned once per
// visual and wrapped with their tint layer (woc_head_tint.ts) before the body's
// first draw (a late file's, inside its adoption); after that a colour is a
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
// per-mesh setup), so it runs as one unit of the host's work queue, asked for
// from the per-frame poll; never inside `apply`, which runs within the host's
// own material passes. The stand-in's material is wrapped with the merged tint
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
  wocHeadLookUrls,
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
  ensureWocHeadFile,
  hangWocHeadFile,
  WOC_HEAD_TINT_REF_KEY,
  WOC_HEAD_TINT_ROLE_KEY,
  type WocHeadRig,
  wocHeadFileMaterial,
  wocHeadFileResident,
  wocHeadFileState,
  wocHeadRigOf,
} from './woc_head_packs';
import {
  type WocHeadFileState,
  wocHeadAwaited,
  wocHeadDrawnLook,
  wocHeadDrawnMorphs,
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
   *  the same: a head file has nothing to stand in for it). */
  reveal(node: THREE.Object3D, live: (prepared: boolean) => void): void;
  /** The drawn head changed from a reveal (it went live, or a held hairstyle or beard
   *  swapped): re-dress on the next frame (never inside the gate callback), so the far
   *  bake keys on it. */
  relive(): void;
  /** The material a mesh draws with before any effect overlay: the tier material the
   *  host derived for it, with this dressing's wrap. */
  baseMaterial(mesh: THREE.Mesh): THREE.Material | THREE.Material[];
  /** Whether the articulated rig is what draws right now (not its far mesh, not a
   *  hidden body): a stand-in nobody would see is not built. */
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

/** The work-queue label kinds of a merged head's mount (the budget learns a cost per
 *  kind: gpu_prep_budget_core.ts gpuPrepKindOfLabel): a new head, which builds its
 *  geometry, and one somebody already built, which only mounts. */
export const WOC_HEAD_MERGE_LABEL = 'woc-head-merge';
export const WOC_HEAD_MOUNT_LABEL = 'woc-head-mount';

/**
 * Merged-head programs known linked, by the tier material a stand-in was wrapped from:
 * bit 1 the one sided variant, bit 2 the two sided one. Every wrap of one tier material
 * and variant shares one program (the wrap's key is its source's plus the layer), so
 * once the first head's reveal settled, the rest draw without a link. Weak: a profile
 * rebuild mints new tier materials, whose programs link again.
 */
const linkedMergedPrograms = new WeakMap<THREE.Material, number>();

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

export class WocHeadDressing {
  /** The model's hung head (every file hung on it); null until one is. */
  private rig: WocHeadRig | null = null;
  /** Hung files whose programs are linked: hung at build (they ride the body's own first
   *  draw) or revealed through the gate. */
  private readonly shown = new Set<string>();
  /** Files hung late whose reveal is in flight: url -> wrappers still linking. */
  private readonly revealing = new Map<string, number>();
  /** Resident files that cannot hang on this model (no rig, no piece on a bone of it). */
  private readonly refused = new Set<string>();
  /** The head draws. */
  private live = false;
  /** The look wanted (the last one handed in; the type's default until then). */
  private state: WocHeadLookState;
  /** The files the wanted look draws (wocHeadLookUrls). */
  private wantUrls: readonly string[];
  /** The look drawn while live: the wanted one, or its held hairstyle or beard while the
   *  newly picked file streams. Null until live. */
  private drawnHead: WocHeadLook | null = null;
  /** The previous subject's head, drawn whole while a new subject's files stream (a
   *  'look' hold); null otherwise. */
  private held: { readonly state: WocHeadLookState; readonly look: WocHeadLook } | null = null;
  /** Live with every wanted file shown: the per-frame poll has nothing to do. */
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
  private readonly isShown = (url: string): boolean => this.shown.has(url);
  /** The one-draw stand-in for the drawn pieces (woc_head_merge.ts); null until a world
   *  view asks for it (setMerged). */
  private merge: WocHeadMergeRig | null = null;
  /** `${source uuid}|${sidedness variant}` -> this visual's clone wrapped with the merged
   *  tint layer. */
  private readonly wrappedMerged = new Map<string, THREE.Material>();
  /** The merged material's uniforms as of its last wrap (a colour is a uniform write). */
  private mergedUniforms: WocHeadMergedTintUniforms | null = null;
  /** The tier material and program variant the mounted stand-in was wrapped from, and
   *  the wrap itself: what its reveal records as linked (linkedMergedPrograms). */
  private mergedProgram: {
    readonly source: THREE.Material;
    readonly wrapped: THREE.Material;
    readonly bit: number;
  } | null = null;
  /** A mount is on the host's work queue (one unit per head at a time). */
  private mergeQueued = false;
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
   *  (woc_lod_core.ts), fixed for the body's life. */
  constructor(
    private readonly host: WocHeadDressingHost,
    readonly type: WocHeadType,
    private readonly lod: GeometryLodLevel = 'lod0',
  ) {
    this.state = wocHeadLookFromAppearance(null, type);
    this.wantUrls = wocHeadLookUrls(type, this.state.look);
    // assembleModel hung every file that was resident at build: those draw with the body
    const hung = wocHeadRigOf(host.model);
    if (hung && hung.type === type) {
      this.rig = hung;
      for (const url of hung.files.keys()) this.shown.add(url);
    }
    // the core every look wears; the look's own files are kicked when it is set (or polled)
    ensureWocHeadFile(wocHeadCoreUrl(type));
  }

  /** Whether the new head draws (its look's files hung and revealed). */
  get isLive(): boolean {
    return this.live;
  }

  /**
   * Whether the body should stay undrawn for its head (woc_head_stream_core.ts
   * wocHeadAwaited): the head is not live and every file its look still lacks is on its
   * way. False once live, and false when a file failed to load or cannot hang on this
   * body: that body draws without its head rather than hide behind a dead request.
   */
  get awaited(): boolean {
    if (this.live) return false;
    const states = this.wantUrls.map((url): WocHeadFileState => {
      if (this.shown.has(url)) return 'resident';
      if (this.refused.has(url)) return 'failed';
      if (this.revealing.has(url)) return 'loading';
      const state = wocHeadFileState(url);
      // parsed but not hung yet: the next poll hangs it
      return state === 'resident' ? 'loading' : state;
    });
    // every file shown, the head a poll away from live: still nothing to draw
    return states.every((state) => state === 'resident') || wocHeadAwaited(states);
  }

  /** The look wanted now (drawn once its files are ready). */
  get look(): WocHeadLookState {
    return this.state;
  }

  /** The look drawn right now: the wanted look, or its held hairstyle or beard (or a
   *  previous subject's whole head) while the new one streams. Null until live. */
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
    this.mergedProgram = null;
  }

  /**
   * Per frame: attach each file the wanted look needs the frame it lands (gated), and
   * go live once every one is hung and revealed. True when a file attached or the head
   * went live (the caller re-dresses). Free once settled, a few set lookups while a file
   * streams.
   */
  poll(): boolean {
    if (this.settled) return false;
    let changed = false;
    for (const url of this.wantUrls) {
      if (this.shown.has(url) || this.revealing.has(url) || this.refused.has(url)) continue;
      if (!wocHeadFileResident(url)) {
        ensureWocHeadFile(url);
        continue;
      }
      if (this.attach(url)) changed = true;
    }
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
   * Whether the drawn head is the one it will stay: live, no previous subject held, and
   * no file of the look still on its way (a streaming pick is about to change the head;
   * a file that failed or cannot hang never will).
   */
  private atRest(): boolean {
    if (!this.live || this.held !== null || this.revealing.size > 0) return false;
    return this.wantUrls.every(
      (url) => this.shown.has(url) || this.refused.has(url) || wocHeadFileState(url) === 'failed',
    );
  }

  /**
   * Ask for the waiting stand-in's mount: one unit of the host's work queue, whose
   * frame budget decides when it runs (so a crowd arriving at once mounts a few heads a
   * frame, never forty), or on the spot with no renderer behind this body. A head
   * somebody already built mounts without a build, so it rides its own label kind and
   * the budget learns the two costs apart. The unit looks again when it runs: the head
   * may have changed, gone far or been disposed since.
   */
  private requestMount(merge: WocHeadMergeRig): void {
    const mount = (): void => {
      if (this.merge !== merge || !merge.isWaiting) return;
      if (!this.atRest() || !this.host.rigDrawn()) return;
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
    if (this.mergeQueued) return;
    this.mergeQueued = true;
    const kind = merge.pendingBuilt ? WOC_HEAD_MOUNT_LABEL : WOC_HEAD_MERGE_LABEL;
    schedule(() => {
      this.mergeQueued = false;
      mount();
    }, `${kind}:${this.type}`);
  }

  /**
   * Reveal a freshly mounted stand-in. The first head of a program (the tier material it
   * was wrapped from, and its sidedness variant) links behind the host's compile gate;
   * every later one whose mesh wears that very program draws without a link, so it
   * shows at once instead of queueing a gate of its own behind every other reveal of a
   * crowd. A head mounted under an effect with a program of its own (the hit response)
   * always takes the gate.
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
    const linked = (): boolean =>
      program !== null && ((linkedMergedPrograms.get(program.source) ?? 0) & program.bit) !== 0;
    if (worn && plain !== null && programKey(worn) === plain && linked()) {
      live(true);
      return;
    }
    const gated = worn ? programKey(worn) : null;
    this.host.reveal(node, (prepared) => {
      const now = mesh ? single(mesh.material) : null;
      let ok = prepared;
      if (!ok && now && now !== worn) {
        const key = programKey(now);
        ok = key === gated || stagedByHost(now) || (key === plain && linked());
      }
      // proof that the plain program linked: the gate settled prepared on the very
      // material it started with (an overruled miss proves nothing about that program)
      if (prepared && now === worn && program && gated === plain) {
        linkedMergedPrograms.set(
          program.source,
          (linkedMergedPrograms.get(program.source) ?? 0) | program.bit,
        );
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
   * Draw a look. A look whose files are all shown draws at once (and a head not live yet
   * goes live on it); one still streaming is fetched and drawn when its files are
   * revealed, the previous head held until then as `hold` says (WocHeadHold). False when
   * nothing changed, including a repeat of the look a body was born with, unless the head
   * went live on it.
   */
  setLook(state: WocHeadLookState, hold: WocHeadHold = 'slot'): boolean {
    if (state.key === this.state.key) {
      if (this.live) return false;
      this.kick();
      return this.goLive();
    }
    // a new subject: the head drawn now is kept whole until the new one can draw (an
    // earlier hold still in place keeps ITS head, the one on screen)
    if (hold === 'look' && this.live && this.held === null) {
      this.held = { state: this.state, look: this.drawnHead ?? this.state.look };
    }
    this.state = state;
    this.wantUrls = wocHeadLookUrls(this.type, state.look);
    this.settled = false;
    this.kick();
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

  /** Re-assert the head over a manifest part pass. */
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
    this.syncMerged();
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
   *  generation): a stand-in whose reveal was still in flight would wait on a settle that
   *  never comes, so it is planned again. */
  gateChanged(): void {
    // a unit the previous queue dropped never ran: the head may ask again
    this.mergeQueued = false;
    const merge = this.merge;
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
    merge.sync(bone, drawn);
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

  /** Whether every file of the wanted look is hung and revealed on this model. */
  private lookShown(): boolean {
    return this.rig !== null && this.wantUrls.every(this.isShown);
  }

  /** Go live (and draw) once every file of the wanted look is shown. True when the head
   *  went live just now; a head already live, or still streaming, is left untouched. */
  private goLive(): boolean {
    if (this.live || !this.lookShown()) return false;
    this.live = true;
    this.apply();
    return true;
  }

  /** Kick the fetch of every file the wanted look still lacks (idempotent). */
  private kick(): void {
    for (const url of this.wantUrls) {
      if (this.shown.has(url) || this.revealing.has(url) || this.refused.has(url)) continue;
      ensureWocHeadFile(url);
    }
  }

  /** Hang one resident file the look wants, hidden behind the host's compile gate; it
   *  counts as shown once every wrapper of it is revealed. False when it cannot hang on
   *  this model (never retried). */
  private attach(url: string): boolean {
    const file = hangWocHeadFile(this.host.model, this.type, url, this.lod);
    if (!file) {
      this.refused.add(url);
      logAssetMissOnce(
        `woc-head-hang:${url}`,
        `WOC head file ${url} could not hang on this body (no rig, or no piece on a bone of it)`,
      );
      return false;
    }
    this.rig = wocHeadRigOf(this.host.model);
    this.revealing.set(url, file.wrappers.length);
    for (const wrapper of file.wrappers) this.host.adopt(wrapper, () => this.retint());
    this.apply();
    for (const wrapper of file.wrappers) {
      this.host.reveal(wrapper, () => {
        const left = (this.revealing.get(url) ?? 1) - 1;
        if (left > 0) {
          this.revealing.set(url, left);
          return;
        }
        this.revealing.delete(url);
        this.shown.add(url);
        this.settled = false;
        const was = this.drawnKey();
        // the new subject is whole: its held predecessor gives way
        if (this.held && this.lookShown()) this.held = null;
        // live now, or a live head swapping in what it held for this file
        if (!this.goLive() && this.live) this.apply();
        if (this.drawnKey() !== was) this.host.relive();
      });
    }
    return true;
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
    this.merge?.dispose();
    this.merge = null;
    this.mergedUniforms = null;
    this.mergedProgram = null;
    for (const m of this.wrapped.values()) m.dispose();
    this.wrapped.clear();
    for (const m of this.wrappedMerged.values()) m.dispose();
    this.wrappedMerged.clear();
    this.uniforms.clear();
  }
}

/** Show a hung head's pieces named in `parts` on a throwaway model (the far bake). */
export function applyWocHeadBakeVisibility(
  model: THREE.Object3D,
  parts: ReadonlySet<string>,
): void {
  const rig = wocHeadRigOf(model);
  if (!rig) return;
  for (const [name, node] of rig.pieces) node.visible = parts.has(name);
}

export type { WocHeadRig };
