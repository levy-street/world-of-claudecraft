import * as THREE from 'three';
import { CLASSES } from '../../sim/data';
import type { PlayerClass } from '../../sim/types';
import { trackWebGLContext } from '../context_release';
import { mechAssetsReady, preloadMechAssets } from './assets';
import { modularVisualKey, VISUALS, type WeaponLayoutOverride } from './manifest';
import {
  type ArmorLoadout,
  type ModularAppearance,
  type ModularLook,
  modularBuildSignature,
} from './modular';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from './preview_appearance';
import { PREVIEW_FRAMING, type PreviewFramingName } from './preview_framing';
import { characterPreviewFrameVisible, resolveCharacterPreviewPolicy } from './preview_policy';
import { CharacterVisual } from './visual';

export type { PreviewAppearance } from './preview_appearance';

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
  private clock = new THREE.Clock();
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
  private destroyed = false;

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

    // 8. Start loop
    this.animate();
  }

  /** Set the active character model by player class. Pass explicit hand ids for a
   *  character sheet; omit them to show the class starter equipment in creation. */
  setClass(cls: PlayerClass, weaponItemId?: string | null, offhandItemId?: string | null): void {
    if (this.destroyed) return;
    // A class-driven selection (create/offline picker, or a panel switch) supersedes
    // any pending async mech re-apply, so invalidate the tracked appearance.
    this.appearanceSig = null;
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
    this.currentSkin = a.skin;
    this.currentWeaponSkinId = a.weaponSkinId ?? null;
    const sig = appearanceSignature(a);
    this.appearanceSig = sig;
    if (a.skinCatalog === 'mech' && !mechAssetsReady()) {
      this.setVisualKey(`player_${a.cls}`, a.mainhandItemId ?? null, null, a.offhandItemId ?? null);
      this.currentVisual?.setSkin(a.skin);
      void preloadMechAssets().then(() => {
        if (!this.destroyed && this.appearanceSig === sig) this.setAppearance(a);
      });
      return;
    }
    const v = previewAppearanceVisual(a);
    this.setVisualKey(v.visualKey, v.weaponItemId, v.weaponOverride, v.offhandItemId);
    // setVisualKey is intentionally idempotent. If only the skin changed, keep
    // the warm rig and update its shared material bindings in place.
    this.currentVisual?.setSkin(a.skin);
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
    this.appearanceSig = null;
    this.pendingLook = { app, worn };
    const weapon = weaponItemId !== undefined ? weaponItemId : (CLASSES[cls].startWeapon ?? null);
    const offhand =
      offhandItemId !== undefined ? offhandItemId : (CLASSES[cls].startOffhand ?? null);
    this.setVisualKey(modularVisualKey(cls), weapon, null, offhand);
    // The face/body sliders ride the live body rather than the rebuild
    // signature (see modularBuildSignature): the creator emits on every `input`
    // event, so a drag would otherwise dispose and recompose the character per
    // 5% step. Harmless after a rebuild, which composed with these already.
    this.currentVisual?.applyModularSliders(app);
  }

  setVisualKey(
    visualKey: string,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
    offhandItemId: string | null = null,
  ): void {
    if (this.destroyed) return;
    const look = VISUALS[visualKey]?.modular ? this.pendingLook : null;
    const nextSig = JSON.stringify([
      visualKey,
      weaponItemId,
      weaponOverride,
      offhandItemId,
      look ? modularBuildSignature(look.app, look.worn) : null,
    ]);
    if (this.currentVisual && this.currentVisualSig === nextSig) return;
    this.closeupCache.clear();
    if (this.currentVisual) {
      // CharacterVisual keeps shared geometry/material caches but owns its
      // mixer and cloned skeleton bone textures, so a genuine replacement must
      // release those resources.
      this.characterGroup.remove(this.currentVisual.root);
      this.currentVisual.dispose();
      this.currentVisual = null;
    }
    this.currentVisualSig = null;

    try {
      this.currentVisual = new CharacterVisual(
        visualKey,
        0xffffff,
        this.currentSkin,
        weaponItemId,
        weaponOverride,
        offhandItemId,
        look,
      );
      this.currentVisualSig = nextSig;
      this.characterGroup.add(this.currentVisual.root);
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
    this.applyFraming(PREVIEW_FRAMING[name]);
  }

  private applyFraming(f: { y: number; z: number; lookY: number }): void {
    this.camera.position.set(LIVE_PREVIEW_X, f.y, f.z);
    this.camera.lookAt(new THREE.Vector3(LIVE_PREVIEW_X, f.lookY, 0));
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
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    }
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
    this.renderActive = false;
    this.prewarming = true;
    this.pendingActive = null;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(320, 400, false);
      this.camera.aspect = 320 / 400;
      this.camera.updateProjectionMatrix();
      this.currentVisual.update(0, PREVIEW_ANIM_STATE, true);
      await this.renderer.compileAsync(this.scene, this.camera);
      // A chroma swap rebinds body textures. Upload every class variant now so
      // clicking a skin swatch cannot turn the preview's next rAF into a first-
      // use texture upload.
      for (const skin of new Set(skinIndices)) {
        this.currentVisual.setSkin(skin);
        this.renderer.render(this.scene, this.camera);
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
      this.clock.getDelta();
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
    if (this.destroyed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    if (
      !characterPreviewFrameVisible(
        this.canvas.isConnected,
        this.container.clientWidth,
        this.container.clientHeight,
      )
    ) {
      // Drain the clock while hidden so reopening cannot produce a large animation step.
      this.clock.getDelta();
      return;
    }

    const dt = Math.min(this.clock.getDelta(), 0.1); // cap dt to prevent huge jumps
    if (!this.renderActive) return;

    // No idle auto-rotation: the character holds its face-on pose (the classic
    // character-screen behavior) and only the player's drag spins the turntable.

    // Update animations inside visual
    if (this.currentVisual) {
      this.currentVisual.update(dt, PREVIEW_ANIM_STATE, true);
    }

    this.renderer.render(this.scene, this.camera);
  };

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
      this.camera.lookAt(new THREE.Vector3(LIVE_PREVIEW_X, 1.3, 0));
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
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      this.currentVisual.dispose();
      this.currentVisual = null;
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
