import * as THREE from 'three';
import { CLASSES } from '../../sim/data';
import type { EquipSlot, PlayerClass } from '../../sim/types';
import { GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { trackWebGLContext } from '../context_release';
import { GFX } from '../gfx';
import { gpuPrepNow, recordGpuPrepEvent } from '../gpu_prep_events';
import {
  type LinkedProgramTouchQueue,
  PREVIEW_LINKED_PROGRAM_TOUCH_LABEL,
  runLinkedProgramTouchLane,
} from '../linked_program_touch_lane';
import { shaderDebugRequested } from '../shader_debug_flag';
import {
  collectPrewarmTextures,
  uploadTexturesInSlices,
  yieldToMainThread,
} from '../texture_prewarm';
import {
  mechAssetsReady,
  onCharacterAssetReady,
  preloadMechAssets,
  visualAssetsResident,
} from './assets';
import { modularVisualKey, playerVisualKey, VISUALS, type WeaponLayoutOverride } from './manifest';
import {
  type ArmorLoadout,
  type ModularAppearance,
  type ModularLook,
  modularBuildSignature,
  wocBodyScaleOf,
} from './modular';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from './preview_appearance';
import {
  type PreviewArmorSurface,
  previewArmorBuildOptions,
  previewArmorDetail,
  previewChosenBody,
} from './preview_armor_detail_core';
import {
  CREATION_HEAD_AIM,
  CREATION_HEAD_Y,
  creationFocusPose,
  easeCamPose,
  FOCUS_EASE_SECONDS,
  PREVIEW_FRAMING,
  type PreviewCamPose,
  type PreviewFocus,
  type PreviewFramingName,
} from './preview_framing';
import { previewMaterialGate } from './preview_material_gate';
import { createPreviewOpenGate, type PreviewOpenGate } from './preview_open_gate_core';
import { characterPreviewFrameVisible, resolveCharacterPreviewPolicy } from './preview_policy';
import { CharacterVisual } from './visual';
import type { WocArmorDetail } from './woc_armor_core';
import { wocHeadBaseNode } from './woc_head_catalog';
import type { WocHeadHold } from './woc_head_dressing';
import type { WocHeadAppearanceInput } from './woc_head_look_core';
import { classBodyComposes } from './woc_parts_core';

/** The modular head packs' base heads (woc_head_catalog wocHeadBaseNode): what the
 *  face close-up measures once a pack hangs. */
const FOCUS_PACK_HEADS: readonly string[] = [wocHeadBaseNode('a'), wocHeadBaseNode('b')];

export type { PreviewAppearance } from './preview_appearance';

/** The 2D layer the HUD paints over the empty canvas while the open gate
 *  holds. Structural on purpose: the DOM lives in src/ui/preview_stand_in.ts,
 *  so nothing here reaches into the UI layer. */
export interface PreviewOpenStandIn {
  show(): void;
  hide(): void;
}

/** The gpu-prep key the bounded escape records under. The existing
 *  `gate-timeout` KIND is reused rather than minting a preview-specific one:
 *  it already means "a compile gate's bounded fail-soft escape fired", which
 *  is exactly this, and every capture reader, perf-overlay row and test that
 *  enumerates GpuPrepEventKind keeps working with the union at four members. */
export const PREVIEW_OPEN_ESCAPE_EVENT_KEY = 'preview-open';

export interface CharacterPreviewPose {
  clips: readonly string[];
  fraction: number;
}

export interface CharacterPreviewOptions {
  constrainedMemory?: boolean;
}

const PREVIEW_ANIM_STATE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

const LIVE_PREVIEW_X = 0;

export class CharacterPreview {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private characterGroup: THREE.Group;
  private currentVisual: CharacterVisual | null = null;
  private currentVisualSig: string | null = null;
  private currentSkin = 0;
  // The active Armory weapon-skin cosmetic, persisted across visual rebuilds
  // exactly like currentSkin so a class/appearance swap keeps the skinned
  // weapon (the in-world renderer and the store preview both apply it; the
  // paperdoll must match or a purchased skin reads as missing).
  private currentWeaponSkinId: string | null = null;
  // Identity of the appearance last requested via setAppearance, so an async mech
  // re-apply can bail out if a newer selection superseded it.
  private appearanceSig: string | null = null;
  /** Look handed to the next modular rebuild (setVisualKey reads it back). */
  private pendingLook: ModularLook | null = null;
  // THREE.Timer, not the r183-deprecated Clock: update() advances it once per
  // frame, reset() re-anchors it after a non-animating span (Clock's
  // discard-getDelta drain pattern).
  private timer = new THREE.Timer();
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unregisterContext: (() => void) | null = null;
  private cleanupDragControls: (() => void) | null = null;
  // Player-card shots render into a fixed offscreen target. Resizing the live
  // WebGL canvas forced a synchronous framebuffer reallocation (up to ~85 ms on
  // mobile GPUs) on every pose change. The target and readback buffer are kept
  // warm instead, and captures are serialized so concurrent pose clicks cannot
  // overwrite a readback that is still in flight.
  private captureTarget: THREE.WebGLRenderTarget | null = null;
  private capturePixels: Uint8Array | null = null;
  private captureQueue: Promise<void> = Promise.resolve();
  private closeupCache = new Map<string, HTMLCanvasElement>();
  // ResizeObserver owns this flag: a preview moved below a display:none window
  // keeps one cheap rAF subscription but performs no animation or WebGL work.
  private renderActive = false;
  // Set while prewarm() owns the renderer's buffer size for a warmup pass.
  private prewarming = false;
  // The latest activation request (from setContainer/the resize observer,
  // via syncSize) that arrived while prewarming; applied by prewarm's finally
  // instead of the renderActive it captured at entry, so a window opened or
  // closed mid-warmup is never clobbered back to a stale snapshot.
  private pendingActive: boolean | null = null;
  // The cold-open gate: while it is armed, both live draw sites (syncSize and
  // the animate loop) withhold their render and the HUD's stand-in covers the
  // empty canvas. It also carries the linked signature prewarm() shares.
  private openGate: PreviewOpenGate = createPreviewOpenGate();
  private standIn: PreviewOpenStandIn | null = null;
  // The WORLD renderer's background GPU queue, injected by the HUD. Right on a
  // foreign context because the queue arbitrates MAIN-THREAD time, not
  // programs: a getUniforms/getAttributes round trip blocks the same thread
  // and the same frame whichever context owns the program.
  private touchQueue: LinkedProgramTouchQueue | null = null;
  private yieldToMain: () => Promise<void> = yieldToMainThread;
  private destroyed = false;
  /** The creation focus (setFocus), null while a fixed framing (setFraming)
   *  owns the camera. The pose eases from camFrom toward the focus target
   *  over FOCUS_EASE_SECONDS; camEase is the elapsed fraction (1 = landed). */
  private focus: PreviewFocus | null = null;
  private camPose: PreviewCamPose = {
    x: LIVE_PREVIEW_X,
    y: PREVIEW_FRAMING.sheet.y,
    z: PREVIEW_FRAMING.sheet.z,
    lookY: PREVIEW_FRAMING.sheet.lookY,
  };
  private camFrom: PreviewCamPose = this.camPose;
  private camEase = 1;
  /** The body the face close-up last measured its head on, and that height:
   *  a rebuilt body (a body-type switch) re-aims the landed close-up. */
  private focusHeadFor: object | null = null;
  private focusHead: { y: number; h: number | undefined } = { y: CREATION_HEAD_Y, h: undefined };
  /** The measure came off the modular head pack (final); a fallback measure (the
   *  head bone, while a head pack still streams) is re-taken once the pack hangs. */
  private focusHeadFinal = false;
  /** A build waiting on a body file still streaming (a WOC base or animation
   *  library, fetched on demand): retried the moment a character file lands. */
  private pendingBuild: Parameters<CharacterPreview['setVisualKey']> | null = null;
  /** The WOC dressing asked of the current character (replayed onto a build
   *  that lands late): the worn slots, or the default kit. */
  private wocDress:
    | {
        equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined;
        helmHidden: boolean;
      }
    | { helmHidden: boolean }
    | null = null;
  private unsubscribeAssetReady: (() => void) | null = null;
  /** What this stage shows, for the armor detail its body draws
   *  (preview_armor_detail_core.ts): the viewer's own character until a host says
   *  otherwise (setArmorSurface, setCreationClass). */
  private armorSurface: PreviewArmorSurface = 'own';
  /** The body on the stage (its visual key: one class and one body fit), built or
   *  still waiting on its files; null before the first. */
  private stagedBody: string | null = null;
  /** The body the creator's player chose (markChosen); null until one is, and again
   *  once the creator is left. */
  private chosenBody: string | null = null;
  /** The armor detail the built body draws: what it was built at, or changed to since. */
  private armorDetail: WocArmorDetail = 'full';

  // Drag controls
  private isDragging = false;
  private previousMouseX = 0;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    options: CharacterPreviewOptions = {},
  ) {
    this.container = container;
    this.canvas = canvas;
    const policy = resolveCharacterPreviewPolicy(options.constrainedMemory === true);

    // 1. Initialize WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: policy.antialias,
      preserveDrawingBuffer: policy.preserveDrawingBuffer,
    });
    this.renderer.debug.checkShaderErrors = shaderDebugRequested();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, policy.pixelRatioCap));
    const initialWidth = this.container.clientWidth;
    const initialHeight = this.container.clientHeight;
    this.renderer.setSize(initialWidth, initialHeight, false);
    this.renderActive = initialWidth > 0 && initialHeight > 0;
    this.renderer.shadowMap.enabled = false; // Preview doesn't need heavy shadows
    // Hand this context back on page teardown (see context_release.ts).
    this.unregisterContext = trackWebGLContext(this.renderer);

    // 2. Initialize Scene
    this.scene = new THREE.Scene();

    // 3. Initialize Camera
    const aspect =
      this.container.clientHeight > 0
        ? this.container.clientWidth / this.container.clientHeight
        : 1;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    // Default to the self character-sheet framing; the inspect window switches to
    // its pulled-back framing via setFraming('inspect') on mount.
    this.applyFraming(PREVIEW_FRAMING.sheet);

    // 4. Initialize Character Group
    this.characterGroup = new THREE.Group();
    this.scene.add(this.characterGroup);

    // 5. Add Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
    this.scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight1.position.set(3, 5, 4);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight2.position.set(-3, 3, -4);
    this.scene.add(dirLight2);

    // 6. Setup Drag Controls
    this.setupDragControls();

    // 7. Setup Resize Observer
    this.setupResizeObserver();

    // 8. Retry a build whose body file was still streaming when it was asked for.
    this.unsubscribeAssetReady = onCharacterAssetReady(() => this.retryPendingBuild());

    // 9. Start loop
    this.animate();
  }

  /** The appearance a WOC body's modular head draws (setModular / setAppearance; null
   *  = the body type's defaults): re-applied to every rebuilt visual. */
  private wocHeadApp: WocHeadAppearanceInput = null;

  /** Draw the WOC look last handed in on the current body, IN PLACE: the head
   *  (CharacterVisual.setWocHeadLook) and the body size (setBodyScale), so a
   *  size drag rescales the turntable and never rebuilds it. A size change moves
   *  the head, so the face close-up re-measures it (a landed close-up re-eases,
   *  exactly as for a rebuilt body) and the cached player-card shots go. `hold` is
   *  'look' when the look belongs to a different character than the one on the
   *  stage (a roster pick, an inspected player): a head whose files still stream
   *  then keeps the previous character's whole head, never its hair on this face. */
  private applyWocLook(hold: WocHeadHold = 'slot'): void {
    const visual = this.currentVisual;
    if (!visual) return;
    visual.setWocHeadLook(this.wocHeadApp, hold);
    if (visual.setBodyScale(wocBodyScaleOf(this.wocHeadApp))) {
      this.focusHeadFor = null;
      this.closeupCache.clear();
    }
  }

  private retryPendingBuild(): void {
    const args = this.pendingBuild;
    if (!args || this.destroyed) return;
    this.pendingBuild = null;
    this.setVisualKey(...args);
    if (!this.currentVisual) return;
    // setVisualKey re-applies the skin and the weapon skin; replay the dressing.
    this.currentVisual.setSkin(this.currentSkin);
    const dress = this.wocDress;
    if (dress && 'equipped' in dress)
      this.currentVisual.setWocEquipment(dress.equipped, dress.helmHidden);
    else if (dress) this.currentVisual.setWocDefaultEquipment(dress.helmHidden);
  }

  /** Hand a WOC body the look its modular head (and body size) draws, for a
   *  stage mounted by visual key (the character sheet, the inspect stage): kept
   *  for every rebuilt body and applied in place to the current one. */
  setWocAppearance(app: WocHeadAppearanceInput): void {
    if (this.destroyed) return;
    this.wocHeadApp = app;
    this.applyWocLook('look');
  }

  /** Dress a WOC body in its default kit (the roster has no equipment snapshot). */
  private dressWocDefault(helmHidden: boolean): void {
    this.wocDress = { helmHidden };
    this.currentVisual?.setWocDefaultEquipment(helmHidden);
  }

  /** Say what this stage shows from here on (preview_armor_detail_core.ts): the viewer's
   *  own character, or someone else's (the Inspect stage, whose body draws the crowd's
   *  armor detail and never a top file). It takes effect with the subject mounted next:
   *  every mount hands the stage what it shows, then its subject
   *  (src/ui/preview_subject.ts), so a rebuilt body is born at that detail and a body kept
   *  across the mount changes in place. The creator is entered by setCreationClass alone. */
  setArmorSurface(surface: Exclude<PreviewArmorSurface, 'creator'>): void {
    if (this.destroyed) return;
    this.armorSurface = surface;
  }

  /** A subject that is not the creator's takes the stage (the roster's pick, a redesign
   *  draft): the creator's rule ends with it, and so does the choice made there (a
   *  choice lasts one visit to the creator: coming back starts at the crowd's detail). A
   *  stage its host declared (setArmorSurface) stays as it said. */
  private leaveCreator(): void {
    if (this.armorSurface !== 'creator') return;
    this.armorSurface = 'own';
    this.chosenBody = null;
  }

  /**
   * Character creation's turntable: the class body being browsed, in the look being
   * built, holding the class starters (setModular's creation form). A class nobody has
   * made yet draws the crowd's armor detail until the player chooses it (markChosen), so
   * flipping through classes and bodies fetches and holds only the small files
   * (preview_armor_detail_core.ts).
   */
  setCreationClass(app: ModularAppearance, worn: ArmorLoadout, cls: PlayerClass): void {
    if (this.destroyed) return;
    this.armorSurface = 'creator';
    this.showModular(app, worn, cls);
  }

  /**
   * The player acted on the appearance of the character on the stage (the face builder,
   * src/ui/appearance_editor_mount.ts): it is the one being made. In the creator that
   * class and body draws full armor detail from here on, on the body already built: its
   * medium file stands in until the top file lands and links
   * (CharacterVisual.setWocArmorDetail). Flipping to another class or body draws that one
   * small again and lets this one's files go with its body (a top file still on its way
   * is not stopped: it lands with nobody holding it, the store's to free); coming back
   * asks for them again. Every other stage draws what it draws already.
   */
  markChosen(): void {
    if (this.destroyed) return;
    this.chosenBody = previewChosenBody(this.armorSurface, this.stagedBody, this.chosenBody);
    this.syncArmorDetail();
  }

  /** The armor detail the body on this stage draws now. */
  private stagedArmorDetail(): WocArmorDetail {
    return previewArmorDetail(this.armorSurface, this.stagedBody, this.chosenBody);
  }

  /** Draw the built body at the armor detail its stage asks for now, in place (a body
   *  that is rebuilt is born at it: setVisualKey). The body takes it with its next
   *  dressing, which a mount hands it right after with the sets of what it shows now,
   *  else on its next frame. The cached player-card shots show the detail it leaves. */
  private syncArmorDetail(): void {
    const detail = this.stagedArmorDetail();
    if (!this.currentVisual || detail === this.armorDetail) return;
    this.armorDetail = detail;
    this.closeupCache.clear();
    this.currentVisual.setWocArmorDetail(detail);
  }

  /** Set the active character model by player class. Pass explicit hand ids for a
   *  character sheet; omit them to show the class starter equipment (the creator's own
   *  turntable goes through setCreationClass). */
  setClass(cls: PlayerClass, weaponItemId?: string | null, offhandItemId?: string | null): void {
    if (this.destroyed) return;
    this.leaveCreator();
    // A class-driven selection (create/offline picker, or a panel switch) supersedes
    // any pending async mech re-apply, so invalidate the tracked appearance.
    this.appearanceSig = null;
    this.wocDress = null;
    this.wocHeadApp = null;
    const weapon = weaponItemId !== undefined ? weaponItemId : (CLASSES[cls].startWeapon ?? null);
    const offhand =
      offhandItemId !== undefined ? offhandItemId : (CLASSES[cls].startOffhand ?? null);
    this.setVisualKey(`player_${cls}`, weapon, null, offhand);
  }

  /** Show a character's real, in-world appearance: the class rig or the Combat Mech
   *  cosmetic body, its appearance skin, and the actually-equipped hands. Mirrors
   *  createCharacterVisual so the char-select roster and character sheet match the
   *  world. The mech's cosmetic assets load
   *  lazily; while they are not ready this shows the class body and re-applies once
   *  loaded, unless a newer selection has superseded this one. */
  setAppearance(a: PreviewAppearance): void {
    if (this.destroyed) return;
    this.leaveCreator();
    this.currentSkin = a.skin;
    this.currentWeaponSkinId = a.weaponSkinId ?? null;
    const sig = appearanceSignature(a);
    this.appearanceSig = sig;
    if (a.skinCatalog === 'mech' && !mechAssetsReady()) {
      this.setVisualKey(
        playerVisualKey(a.cls, a.appearance),
        a.mainhandItemId ?? null,
        null,
        a.offhandItemId ?? null,
      );
      this.currentVisual?.setSkin(a.skin);
      this.dressWocDefault(a.helmHidden ?? false);
      void preloadMechAssets().then(() => {
        if (!this.destroyed && this.appearanceSig === sig) this.setAppearance(a);
      });
      return;
    }
    const v = previewAppearanceVisual(a);
    this.wocHeadApp = a.appearance ?? null;
    this.setVisualKey(v.visualKey, v.weaponItemId, v.weaponOverride, v.offhandItemId);
    this.applyWocLook('look');
    // setVisualKey is intentionally idempotent. If only the skin changed, keep
    // the warm rig and update its shared material bindings in place.
    this.currentVisual?.setSkin(a.skin);
    this.dressWocDefault(a.helmHidden ?? false);
  }

  /** Set the active model by raw visual key (e.g. `player_mech` for the cosmetic
   *  turntable). The asset must already be loaded — callers preload first.
   *  `weaponOverride` lets a cosmetic body adopt a class hand layout (including
   *  shields and dual wield), matching the in-world render. */
  /** Show the composed modular body (character creation's live turntable) for
   *  a class: its modular def carries the class clips and hand layout, and the
   *  starter weapons default from the class. Any change to gender/hair/brows/
   *  colour is a geometry or material change on a shared cached variant, so
   *  this just rebuilds, the variant cache makes a repeat selection nearly
   *  free. */
  setModular(
    app: ModularAppearance,
    worn: ArmorLoadout = {},
    cls: PlayerClass = 'warrior',
    weaponItemId?: string | null,
    // Both hands default to the class starters (creation, where nothing is
    // equipped yet). The character sheet passes what is ACTUALLY worn, so the
    // composed turntable holds the same shield / dual wield the world draws.
    offhandItemId?: string | null,
  ): void {
    if (this.destroyed) return;
    this.leaveCreator();
    this.showModular(app, worn, cls, weaponItemId, offhandItemId);
  }

  /** setModular's body, shared with the creator's entry (setCreationClass), which stages
   *  the same look on its own terms. */
  private showModular(
    app: ModularAppearance,
    worn: ArmorLoadout,
    cls: PlayerClass,
    weaponItemId?: string | null,
    offhandItemId?: string | null,
  ): void {
    this.appearanceSig = null;
    this.pendingLook = { app, worn };
    const weapon = weaponItemId !== undefined ? weaponItemId : (CLASSES[cls].startWeapon ?? null);
    const offhand =
      offhandItemId !== undefined ? offhandItemId : (CLASSES[cls].startOffhand ?? null);
    // A class on a WOC modular body never composes the KayKit library: the
    // turntable shows its own rig (the default kit, or what setWocEquipment
    // dresses it in), so creation, the sheet and the world agree.
    if (!classBodyComposes(cls)) {
      this.pendingLook = null;
      // The Body tab's male/female pick selects the body file (playerVisualKey);
      // every head pick, face control, colour and the body size lands IN PLACE on
      // the built body (applyWocLook), so the face builder never rebuilds it.
      this.wocHeadApp = app;
      this.setVisualKey(playerVisualKey(cls, app), weapon, null, offhand);
      this.applyWocLook();
      // A loadout that drops the head (the creator, the Redesign draft) shows
      // the WOC default kit bare-headed, so the face being built is visible.
      if (worn.head === null) this.dressWocDefault(true);
      return;
    }
    this.setVisualKey(modularVisualKey(cls), weapon, null, offhand);
    // The face/body sliders ride the live body rather than the rebuild
    // signature (see modularBuildSignature): the creator emits on every `input`
    // event, so a drag would otherwise dispose and recompose the character per
    // 5% step. Harmless after a rebuild, which composed with these already.
    this.currentVisual?.applyModularSliders(app);
  }

  /** Dress a WOC body on the turntable from worn equipment (the paperdoll
   *  passes the sheet's own slots); a no-op for every other rig. */
  /** Dress a WOC body in its default kit with the helm shown or hidden (the
   *  creator and the Redesign editor hide it so the face being built shows). */
  setWocDefaultDress(helmHidden: boolean): void {
    if (this.destroyed) return;
    this.dressWocDefault(helmHidden);
  }

  setWocEquipment(
    equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined,
    helmHidden: boolean,
  ): void {
    if (this.destroyed) return;
    this.wocDress = { equipped, helmHidden };
    this.currentVisual?.setWocEquipment(equipped, helmHidden);
  }

  setVisualKey(
    visualKey: string,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
    offhandItemId: string | null = null,
  ): void {
    if (this.destroyed) return;
    this.stagedBody = visualKey;
    const look = VISUALS[visualKey]?.modular ? this.pendingLook : null;
    const nextSig = JSON.stringify([
      visualKey,
      weaponItemId,
      weaponOverride,
      offhandItemId,
      look ? modularBuildSignature(look.app, look.worn) : null,
    ]);
    if (this.currentVisual && this.currentVisualSig === nextSig) {
      // the same body on a stage that shows it differently now (the player's own
      // character, then a peer of its class inspected): only its armor detail changes
      this.syncArmorDetail();
      return;
    }
    this.closeupCache.clear();
    if (this.currentVisual) {
      // CharacterVisual keeps shared geometry/material caches but owns its
      // mixer and cloned skeleton bone textures, so a genuine replacement must
      // release those resources.
      this.characterGroup.remove(this.currentVisual.root);
      this.currentVisual.dispose();
      this.currentVisual = null;
      // three releases a program with the last material holding it, so a
      // signature linked before this rebuild can be cold again afterwards:
      // the gate must not skip the warm on a return to an old look.
      this.openGate.forgetLinked();
    }
    this.currentVisualSig = null;
    // A body file still streaming (a WOC base or animation library): show nothing
    // rather than throw, and build the moment it lands (retryPendingBuild).
    this.pendingBuild = null;
    if (!visualAssetsResident(visualKey)) {
      this.pendingBuild = [visualKey, weaponItemId, weaponOverride, offhandItemId];
      return;
    }

    try {
      // born at the armor detail this stage draws, so a class being browsed or a peer
      // inspected never asks for a top file it will not draw; its geometry level is a
      // preview's own whatever that detail (preview_armor_detail_core.ts)
      const detail = this.stagedArmorDetail();
      this.currentVisual = new CharacterVisual(
        visualKey,
        0xffffff,
        this.currentSkin,
        weaponItemId,
        weaponOverride,
        offhandItemId,
        look,
        previewArmorBuildOptions(GFX, detail),
      );
      this.armorDetail = detail;
      this.currentVisualSig = nextSig;
      this.characterGroup.add(this.currentVisual.root);
      const visual = this.currentVisual;
      // a WOC body is born wearing the head look and size last handed in (no-op
      // elsewhere)
      this.applyWocLook();
      visual.setFarBakeGate(
        previewMaterialGate({
          renderer: this.renderer,
          scene: this.scene,
          camera: this.camera,
          touchQueue: () => this.touchQueue,
          yieldToMain: this.yieldToMain,
          isCurrent: () => !this.destroyed && this.currentVisual === visual,
        }),
      );
      // Re-apply the persisted weapon-skin cosmetic to the rebuilt visual (the
      // constructor attaches the equipped item's own model).
      if (this.currentWeaponSkinId) this.currentVisual.setWeaponSkin(this.currentWeaponSkinId);

      // Reset rotation on a class swap so every new character greets the player
      // FACE-ON (the classic character-screen pose); dragging still spins freely.
      this.characterGroup.rotation.y = 0;
    } catch (err) {
      console.error(`Failed to load preview character visual for ${visualKey}:`, err);
    }
  }

  /** Apply or clear the Armory weapon-skin cosmetic; persists across
   *  setClass/setVisualKey rebuilds like the body skin. */
  setWeaponSkin(weaponSkinId: string | null): void {
    if (this.destroyed) return;
    this.currentWeaponSkinId = weaponSkinId;
    this.currentVisual?.setWeaponSkin(weaponSkinId);
  }

  /** Swap the previewed skin (alternate body texture); persists across setClass. */
  setSkin(skinIndex: number): void {
    if (this.destroyed) return;
    // Same invalidation as setClass: a standalone skin change (dataset fallback,
    // char-create skin hover) is not the appearance a pending mech re-apply targets.
    this.appearanceSig = null;
    if (this.currentSkin === skinIndex) return;
    this.currentSkin = skinIndex;
    this.closeupCache.clear();
    this.currentVisual?.setSkin(skinIndex);
  }

  /** Dynamically shift the canvas to a new container */
  setContainer(container: HTMLElement): void {
    if (this.destroyed) return;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    // A new stage (char-select, creation, the sheet) starts on the full body;
    // the face builder re-asks for its close-up when it is showing.
    if (container !== this.container && this.focus !== null) {
      this.focus = null;
      this.camEase = 1;
      this.applyFraming(PREVIEW_FRAMING.sheet);
    }
    this.container = container;
    this.container.appendChild(this.canvas);

    this.syncSize();

    // Re-observe the new container
    this.setupResizeObserver();
  }

  /** Switch the camera framing (see preview_framing.ts). The self character sheet
   *  uses 'sheet' (close, face-on); the inspect window uses 'inspect' (pulled back
   *  so a tall silhouette stays framed). Re-asserted on every mount so reopening
   *  the character sheet after inspecting restores the close framing. */
  setFraming(name: PreviewFramingName): void {
    if (this.destroyed) return;
    this.focus = null;
    this.camEase = 1;
    this.applyFraming(PREVIEW_FRAMING[name]);
  }

  /** Ease the camera to a creation focus: 'face' is the appearance editor's
   *  head-and-shoulders close-up, 'body' the full sheet framing (see
   *  creationFocusPose). Frame-rate independent (the animate loop advances the
   *  ease by dt); a repeat call for the focus already held is a no-op. */
  setFocus(focus: PreviewFocus): void {
    if (this.destroyed || this.focus === focus) return;
    this.focus = focus;
    this.camFrom = { ...this.camPose };
    this.camEase = 0;
    this.wakeLoop();
  }

  /** Advance the focus ease one frame (a no-op once landed, unless the body
   *  under a landed close-up was rebuilt: then it eases to the new head). */
  private stepFocus(dt: number): void {
    if (!this.focus) return;
    if (this.camEase >= 1) {
      if (this.focus !== 'face' || this.focusHeadCurrent()) return;
      this.camFrom = { ...this.camPose };
      this.camEase = 0;
    }
    this.camEase = Math.min(1, this.camEase + dt / FOCUS_EASE_SECONDS);
    const head = this.focusHeadOf();
    const target = creationFocusPose(
      this.focus,
      this.camera.aspect,
      head.y,
      head.h,
      this.stageSize(),
    );
    this.applyPose(easeCamPose(this.camFrom, target, this.camEase));
  }

  /** The face close-up's aim: the drawn head's bounds (the modular head pack's
   *  base) at CREATION_HEAD_AIM plus its height, else the head bone while the
   *  head still streams, so every body type and class scale frames its own face. */
  private focusHeadOf(): { y: number; h: number | undefined } {
    const visual = this.currentVisual;
    if (!visual) {
      this.focusHeadFor = null;
      return { y: CREATION_HEAD_Y, h: undefined };
    }
    if (this.focusHeadCurrent()) return this.focusHead;
    const root = visual.root;
    root.updateWorldMatrix(true, true);
    let head: { y: number; h: number | undefined } | null = null;
    let final = false;
    for (const name of FOCUS_PACK_HEADS) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      const h = box.max.y - box.min.y;
      head = { y: box.min.y + h * CREATION_HEAD_AIM, h };
      final = true;
      break;
    }
    if (head === null) {
      const bone = root.getObjectByName('head');
      if (!bone) return { y: CREATION_HEAD_Y, h: undefined };
      head = { y: bone.getWorldPosition(new THREE.Vector3()).y, h: undefined };
    }
    this.focusHeadFor = visual;
    this.focusHead = head;
    this.focusHeadFinal = final;
    return head;
  }

  /** The stage's CSS size (the face close-up frames a phone's small stage tighter). */
  private stageSize(): { w: number; h: number } {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  /** Whether the held head measure is still good: same body, and either final or
   *  still no pack head to measure (a streaming pack keeps the fallback cheap). */
  private focusHeadCurrent(): boolean {
    const visual = this.currentVisual;
    if (!visual || this.focusHeadFor !== visual) return false;
    if (this.focusHeadFinal) return true;
    return !FOCUS_PACK_HEADS.some((name) => visual.root.getObjectByName(name));
  }

  private applyFraming(f: { y: number; z: number; lookY: number }): void {
    this.applyPose({ x: LIVE_PREVIEW_X, y: f.y, z: f.z, lookY: f.lookY });
  }

  private applyPose(p: PreviewCamPose): void {
    this.camPose = p;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(new THREE.Vector3(p.x, p.lookY, 0));
    this.camera.updateProjectionMatrix();
  }

  /** Force the renderer to match the current visible container size. */
  syncSize(): void {
    if (this.destroyed) return;
    if (this.prewarming) {
      // prewarm() owns the renderer's buffer size until it finishes; record
      // the request instead of resizing out from under it, and let prewarm's
      // finally apply it once the buffer is the live preview's own again.
      this.pendingActive = this.container.clientWidth > 0 && this.container.clientHeight > 0;
      return;
    }
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderActive = width > 0 && height > 0;
    if (width > 0 && height > 0) {
      // The buffer, camera and aspect still follow the container while the
      // open gate holds: only the DRAW waits, so the reveal needs no resize.
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      // a landed focus re-fits the new aspect (the face close-up's width fit
      // and sideways slide both depend on it)
      if (this.focus !== null && this.camEase >= 1) {
        const head = this.focusHeadOf();
        this.applyPose(
          creationFocusPose(this.focus, this.camera.aspect, head.y, head.h, this.stageSize()),
        );
      }
      if (this.gateAllowsDraw()) this.renderer.render(this.scene, this.camera);
      this.wakeLoop();
    } else {
      this.standDownOpenGate();
    }
  }

  /** Requests the next animation frame unless one is already pending: the
   *  parked loop's only way back (see animate). */
  private wakeLoop(): void {
    if (this.destroyed || this.animationFrameId !== null) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  /** Inject the world renderer's background GPU queue, the one arbiter that
   *  paces main-thread preparation work. Without it the open gate still links
   *  and uploads; only its touch tail is skipped. */
  setTouchQueue(queue: LinkedProgramTouchQueue | null): void {
    this.touchQueue = queue;
  }

  /** The visual signature whose programs are linked on this context, written
   *  by BOTH prewarm() and the open gate so neither compiles what the other
   *  already did. */
  get linkedVisualSig(): string | null {
    return this.openGate.linkedSig();
  }

  /**
   * Arm the cold-open gate for whatever is mounted right now: hold both draw
   * sites, show `standIn`, then link, upload and touch before the first frame
   * the player sees. A no-op when the mounted signature is already linked (the
   * warm open, and the reason nothing pays twice).
   *
   * Called from every mount (Hud.mountSharedPreview), so the sheet, the skin
   * picker and Inspect all arm on the same rule; Inspect is the case the
   * background lane can never cover, because it mounts a peer's class rig this
   * context may never have linked.
   */
  armOpen(standIn: PreviewOpenStandIn | null = null): void {
    if (this.destroyed) return;
    const sig = this.currentVisualSig;
    if (!this.openGate.arm(sig, gpuPrepNow())) return;
    this.hideStandIn();
    // Always, even for a rebuild in the SAME container: setContainer and the
    // resize observer both run syncSize first, and setSize reassigns
    // canvas.width, which CLEARS the drawing buffer. There is no retained
    // frame left to stand in for the armed window, only a black panel.
    this.standIn = standIn;
    standIn?.show();
    const token = this.openGate.beginWarm();
    if (token === null) return;
    void this.prepareOpen(token, sig);
  }

  /** LINK, then UPLOAD, then TOUCH, then reveal. compileAsync in three r185
   *  both submits and polls COMPLETION_STATUS_KHR, so its resolution IS the
   *  settle and no separate wait step exists; the touch tail is what removes
   *  the first-use uniform-table query the reveal draw would otherwise pay. */
  private async prepareOpen(token: number, sig: string | null): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      if (this.destroyed) return;
      const textures = new Set<THREE.Texture>();
      collectPrewarmTextures(this.scene, textures);
      await uploadTexturesInSlices(this.renderer, textures, {
        yieldToMain: this.yieldToMain,
        isCancelled: () => this.destroyed,
      });
      if (this.destroyed) return;
      // ACTIONABLE_VIEW because a player CLICKED: the actionable floor is what
      // guarantees the open is never starved behind background preparation,
      // and one budgeted piece per program is what keeps a 15 to 17 ms driver
      // round trip out of the frame that carries the click.
      if (this.touchQueue) {
        await runLinkedProgramTouchLane(
          this.touchQueue,
          this.renderer.properties,
          this.characterGroup,
          GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
          // settled: the compileAsync above was awaited to completion, which is
          // what proves this context's programs linked.
          { label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL, settled: true },
        );
      }
    } catch (err) {
      // Fail-soft, like every other gate here: a refused context or a rejected
      // compile must reveal the character, never strand the panel empty.
      console.warn('[preview] cold-open warm failed', err);
    } finally {
      if (!this.destroyed && this.openGate.finishWarm(token, sig)) this.revealOpen();
    }
  }

  /** Whether a live draw site may draw, and the one place the bounded escape
   *  fires: past the soft deadline the gate releases, the escape is recorded
   *  once, and the frame draws whatever is ready. */
  private gateAllowsDraw(): boolean {
    const now = gpuPrepNow();
    const escapedAgeMs = this.openGate.takeEscape(now);
    if (escapedAgeMs !== null) {
      recordGpuPrepEvent({
        kind: 'gate-timeout',
        key: PREVIEW_OPEN_ESCAPE_EVENT_KEY,
        ageMs: escapedAgeMs,
      });
      this.hideStandIn();
    }
    return this.openGate.shouldRender(now);
  }

  private revealOpen(): void {
    this.hideStandIn();
    if (!this.renderActive) return;
    this.renderer.render(this.scene, this.camera);
  }

  private hideStandIn(): void {
    this.standIn?.hide();
    this.standIn = null;
  }

  /** The preview stopped drawing: its window closed, or its container was
   *  unmounted. Both draw sites are unreachable now, so the bounded escape can
   *  never fire and an armed gate would strand the stand-in layer and its
   *  aria-busy on a hidden container until the next mount. Drop the hold with
   *  it; the next mount arms again, and a warm still in flight records nothing
   *  because cancel() supersedes its arm. */
  private standDownOpenGate(): void {
    if (!this.openGate.isArmed() && !this.standIn) return;
    this.openGate.cancel();
    this.hideStandIn();
  }

  /** Compile and upload the current preview while a loading screen is visible.
   *  The hidden character window has no layout size, so use a temporary small
   *  drawing buffer and restore it without ever exposing the warmup frame. */
  async prewarm(skinIndices: readonly number[] = [this.currentSkin]): Promise<void> {
    if (this.destroyed || !this.currentVisual) return;
    const previousSize = new THREE.Vector2();
    this.renderer.getSize(previousSize);
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousAspect = this.camera.aspect;
    const previousSkin = this.currentSkin;
    const wasActive = this.renderActive;
    // What this pass linked, if anything: its touch tail runs after the
    // warmup buffer is handed back (see below).
    let compiledSig: string | null = null;
    this.renderActive = false;
    this.prewarming = true;
    this.pendingActive = null;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(320, 400, false);
      this.camera.aspect = 320 / 400;
      this.camera.updateProjectionMatrix();
      this.currentVisual.update(0, PREVIEW_ANIM_STATE, true);
      // One linked signature, shared with the open gate: a scheduled warm and
      // a player's open never compile the same visual twice, and the per-skin
      // units after the first still do their texture work while skipping a
      // compile that would link nothing new.
      const warmSig = this.currentVisualSig;
      if (!this.openGate.isLinked(warmSig)) {
        await this.renderer.compileAsync(this.scene, this.camera);
        compiledSig = warmSig;
      }
      // A chroma swap rebinds body textures. Upload every class variant now so
      // clicking a skin swatch cannot turn the preview's next rAF into a first-
      // use texture upload. The uploads themselves are prepaid in bounded
      // slices before each draw: a cold skin's render otherwise pays them all
      // in one synchronous block (128 to 155 ms per paced unit in production).
      const textures = new Set<THREE.Texture>();
      for (const skin of new Set(skinIndices)) {
        if (this.destroyed) break;
        this.currentVisual.setSkin(skin);
        textures.clear();
        collectPrewarmTextures(this.scene, textures);
        await uploadTexturesInSlices(this.renderer, textures, {
          yieldToMain: yieldToMainThread,
          isCancelled: () => this.destroyed,
        });
        if (this.destroyed) break;
        this.renderer.render(this.scene, this.camera);
        await yieldToMainThread();
      }
    } finally {
      this.currentSkin = previousSkin;
      this.currentVisual?.setSkin(previousSkin);
      this.renderer.setPixelRatio(previousPixelRatio);
      this.renderer.setSize(Math.max(1, previousSize.x), Math.max(1, previousSize.y), false);
      this.camera.aspect = previousAspect;
      this.camera.updateProjectionMatrix();
      this.prewarming = false;
      // setContainer/the resize observer may have arrived mid-prewarm (the
      // window opened or closed while this buffer was repurposed for
      // warmup); apply that request instead of the wasActive snapshot
      // captured at entry, and resync to the real container size rather than
      // the stale pre-warmup size just restored above.
      const requestedActive = this.pendingActive;
      this.pendingActive = null;
      this.renderActive = requestedActive ?? wasActive;
      if (requestedActive !== null) this.syncSize();
      this.timer.reset();
    }
    // The tail, OUTSIDE the warmup window: it only walks programs that are
    // already linked, and holding the live preview inactive across a paced
    // per-program lane would keep the panel dark if the player opened the
    // sheet mid-warm.
    //
    // The signature counts as linked only once that tail has run, because the
    // skip it grants makes a later open bypass armOpen entirely, tail
    // included, and an open with no tail pays the first-use uniform-table
    // query per program (15 to 17 ms each on the Intel iGPU) inside the frame
    // that carries the click. With no queue injected there is no tail here, so
    // nothing is recorded and the open gate still touches.
    if (compiledSig === null || !this.touchQueue || this.destroyed) return;
    await runLinkedProgramTouchLane(
      this.touchQueue,
      this.renderer.properties,
      this.characterGroup,
      GPU_WORK_PRIORITY.BACKGROUND,
      // settled: reached only with a compiledSig, i.e. after the awaited
      // compileAsync above resolved for this signature.
      { label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL, settled: true },
    );
    // A rebuild in between released those programs (forgetLinked): what this
    // pass warmed is no longer what is mounted, so it records nothing.
    if (!this.destroyed && this.currentVisualSig === compiledSig) {
      this.openGate.noteLinked(compiledSig);
    }
  }

  /** Warm the exact offscreen player-card path while the loading screen is up. */
  async prewarmCloseupPoses(poses: readonly CharacterPreviewPose[]): Promise<void> {
    if (this.destroyed || !this.currentVisual) return;
    for (const pose of poses) {
      await this.captureCloseup({
        poseClips: pose.clips,
        poseFraction: pose.fraction,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  private setupDragControls(): void {
    const onMouseDown = (e: MouseEvent) => {
      this.isDragging = true;
      this.previousMouseX = e.clientX;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMouseX;
      this.characterGroup.rotation.y += deltaX * 0.01;
      this.previousMouseX = e.clientX;
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    // Touch support
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMouseX = e.touches[0].clientX;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.previousMouseX;
      this.characterGroup.rotation.y += deltaX * 0.01;
      this.previousMouseX = e.touches[0].clientX;
    };

    const onTouchEnd = () => {
      this.isDragging = false;
    };

    this.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    this.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    this.cleanupDragControls = () => {
      this.canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      this.canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
    });
    this.resizeObserver.observe(this.container);
  }

  private animate = (): void => {
    this.animateFrame();
  };

  /** One frame of the live loop; parks or re-requests itself (see below). */
  private animateFrame(): void {
    if (this.destroyed) return;
    this.animationFrameId = null;
    if (
      !characterPreviewFrameVisible(
        this.canvas.isConnected,
        this.container.clientWidth,
        this.container.clientHeight,
      )
    ) {
      // Hidden or unmounted: the loop PARKS (no next frame is requested) so
      // a closed character sheet costs the world nothing per frame. It wakes
      // from syncSize, which every mount and every container size change
      // (the resize observer) runs. Re-anchor the timer meanwhile so
      // reopening cannot produce a large animation step.
      this.timer.reset();
      this.standDownOpenGate();
      return;
    }
    this.wakeLoop();

    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1); // cap dt to prevent huge jumps
    if (!this.renderActive) return;
    this.stepFocus(dt);
    // The second live draw site: a gate covering only syncSize is not a gate,
    // because the loop draws the same cold scene on the very next frame.
    if (!this.gateAllowsDraw()) return;

    // No idle auto-rotation: the character holds its face-on pose (the classic
    // character-screen behavior) and only the player's drag spins the turntable.

    // Update animations inside visual
    if (this.currentVisual) {
      this.currentVisual.update(dt, PREVIEW_ANIM_STATE, true);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Render a single crisp, deterministic close-up of the current character and
   * return it as an unencoded 2D canvas. Used to stamp the player's avatar onto
   * the shareable player card without an intermediate PNG encode/decode cycle.
   *
   * The scene is rendered into a persistent offscreen target, then copied back
   * asynchronously through a pixel-pack buffer. The live preview canvas is never
   * resized or repainted with the card pose, avoiding both framebuffer stalls and
   * visible intermediate frames.
   */
  captureCloseup(
    opts: {
      width?: number;
      height?: number;
      angle?: number;
      poseClips?: readonly string[];
      poseFraction?: number;
    } = {},
  ): Promise<HTMLCanvasElement> {
    const request = {
      ...opts,
      poseClips: opts.poseClips ? [...opts.poseClips] : undefined,
    };
    const capture = this.captureQueue.then(() => this.captureCloseupNow(request));
    this.captureQueue = capture.then(
      () => undefined,
      () => undefined,
    );
    return capture;
  }

  private async captureCloseupNow(
    opts: {
      width?: number;
      height?: number;
      angle?: number;
      poseClips?: readonly string[];
      poseFraction?: number;
    } = {},
  ): Promise<HTMLCanvasElement> {
    if (this.destroyed) throw new Error('character-preview: capture after destroy');
    const width = Math.max(1, Math.round(opts.width ?? 540));
    const height = Math.max(1, Math.round(opts.height ?? 720));
    const angle = opts.angle ?? -0.42; // gentle 3/4 turn for a heroic stance
    const cacheKey =
      opts.poseClips && opts.poseClips.length > 0
        ? JSON.stringify([width, height, angle, opts.poseClips, opts.poseFraction ?? 0.5])
        : null;
    const cached = cacheKey ? this.closeupCache.get(cacheKey) : null;
    if (cached) return cached;

    const prevAspect = this.camera.aspect;
    const prevPos = this.camera.position.clone();
    const prevRotY = this.characterGroup.rotation.y;
    const prevTarget = this.renderer.getRenderTarget();
    const prevCubeFace = this.renderer.getActiveCubeFace();
    const prevMipmapLevel = this.renderer.getActiveMipmapLevel();

    // Optionally lock a deliberate pose for the shot (e.g. a hero/cast/cheer
    // stance) instead of whatever idle frame is up. Restored via clearPose below.
    const posed =
      opts.poseClips && opts.poseClips.length > 0
        ? (this.currentVisual?.poseFreeze(opts.poseClips, opts.poseFraction ?? 0.5) ?? null)
        : null;

    let target = this.captureTarget;
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
      target.texture.colorSpace = this.renderer.outputColorSpace;
      target.texture.generateMipmaps = false;
      this.captureTarget = target;
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
    const byteLength = width * height * 4;
    if (!this.capturePixels || this.capturePixels.byteLength !== byteLength) {
      this.capturePixels = new Uint8Array(byteLength);
    }

    let readback: Promise<THREE.TypedArray> | null = null;
    try {
      this.camera.aspect = width / height;
      // Pulled back to z=4.6, aimed at y=1.55 (eye 1.62) so the 45 degree,
      // 0.75-aspect frustum spans roughly y in [-0.3, 3.5] at the figure plane:
      // enough headroom above the 2.6 head-top to clear raised weapons and arms.
      this.camera.position.set(-0.1, 1.62, 4.6);
      this.camera.lookAt(new THREE.Vector3(-0.1, 1.55, 0));
      this.camera.updateProjectionMatrix();
      this.characterGroup.rotation.y = angle;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, this.camera);
      readback = this.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        width,
        height,
        this.capturePixels,
      );
    } finally {
      this.renderer.setRenderTarget(prevTarget, prevCubeFace, prevMipmapLevel);
      if (posed) this.currentVisual?.clearPose();
      this.camera.aspect = prevAspect;
      this.camera.position.copy(prevPos);
      this.camera.lookAt(new THREE.Vector3(this.camPose.x, this.camPose.lookY, 0));
      this.camera.updateProjectionMatrix();
      this.characterGroup.rotation.y = prevRotY;
      if (this.renderActive) this.renderer.render(this.scene, this.camera);
    }

    if (!readback) throw new Error('character-preview: capture readback unavailable');
    await readback;
    if (this.destroyed) throw new Error('character-preview: destroyed during capture');

    // WebGL readback starts at the bottom-left; Canvas ImageData starts at the
    // top-left. Flip one scanline at a time into the returned canvas.
    const stride = width * 4;
    const topDown = new Uint8ClampedArray(byteLength);
    for (let y = 0; y < height; y++) {
      const source = (height - 1 - y) * stride;
      topDown.set(this.capturePixels.subarray(source, source + stride), y * stride);
    }
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const context = captureCanvas.getContext('2d');
    if (!context) throw new Error('character-preview: could not create capture canvas');
    context.putImageData(new ImageData(topDown, width, height), 0, 0);
    if (cacheKey) this.closeupCache.set(cacheKey, captureCanvas);
    return captureCanvas;
  }

  /** Cleanup resources */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeAssetReady?.();
    this.unsubscribeAssetReady = null;
    this.pendingBuild = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.cleanupDragControls?.();
    this.cleanupDragControls = null;
    this.openGate.cancel();
    this.hideStandIn();
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      this.currentVisual.dispose();
      this.currentVisual = null;
      // three releases a program with the last material holding it, so a
      // signature linked before this rebuild can be cold again afterwards:
      // the gate must not skip the warm on a return to an old look.
      this.openGate.forgetLinked();
    }
    this.currentVisualSig = null;
    this.closeupCache.clear();
    this.captureTarget?.dispose();
    this.captureTarget = null;
    this.capturePixels = null;

    this.unregisterContext?.();
    this.unregisterContext = null;
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* context may already be lost */
    }
    this.renderer.dispose();
    this.canvas.remove();
  }
}
