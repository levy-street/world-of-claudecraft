import * as THREE from 'three';
import { CLASSES } from '../../sim/data';
import type { PlayerClass } from '../../sim/types';
import { trackWebGLContext } from '../context_release';
import { mechAssetsReady, preloadMechAssets } from './assets';
import type { WeaponLayoutOverride } from './manifest';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from './preview_appearance';
import { CharacterVisual } from './visual';

export type { PreviewAppearance } from './preview_appearance';

const PREVIEW_ANIM_STATE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
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
  private currentSkin = 0;
  // Identity of the appearance last requested via setAppearance, so an async mech
  // re-apply can bail out if a newer selection superseded it.
  private appearanceSig: string | null = null;
  private clock = new THREE.Clock();
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unregisterContext: (() => void) | null = null;
  private cleanupDragControls: (() => void) | null = null;
  private destroyed = false;

  // Drag controls
  private isDragging = false;
  private previousMouseX = 0;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement) {
    this.container = container;
    this.canvas = canvas;

    // 1. Initialize WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
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
    this.camera.position.set(LIVE_PREVIEW_X, 1.45, 5.1);
    this.camera.lookAt(new THREE.Vector3(LIVE_PREVIEW_X, 1.3, 0));

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
    const sig = appearanceSignature(a);
    this.appearanceSig = sig;
    if (a.skinCatalog === 'mech' && !mechAssetsReady()) {
      this.setVisualKey(`player_${a.cls}`, a.mainhandItemId ?? null, null, a.offhandItemId ?? null);
      void preloadMechAssets().then(() => {
        if (!this.destroyed && this.appearanceSig === sig) this.setAppearance(a);
      });
      return;
    }
    const v = previewAppearanceVisual(a);
    this.setVisualKey(v.visualKey, v.weaponItemId, v.weaponOverride, v.offhandItemId);
  }

  /** Set the active model by raw visual key (e.g. `player_mech` for the cosmetic
   *  turntable). The asset must already be loaded — callers preload first.
   *  `weaponOverride` lets a cosmetic body adopt a class hand layout (including
   *  shields and dual wield), matching the in-world render. */
  setVisualKey(
    visualKey: string,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
    offhandItemId: string | null = null,
  ): void {
    if (this.destroyed) return;
    // Clean up current visual if it exists
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      // CharacterVisual dispose only releases mixer listeners
      this.currentVisual = null;
    }

    try {
      this.currentVisual = new CharacterVisual(
        visualKey,
        0xffffff,
        this.currentSkin,
        weaponItemId,
        weaponOverride,
        offhandItemId,
      );
      this.characterGroup.add(this.currentVisual.root);

      // Reset rotation on a class swap so every new character greets the player
      // FACE-ON (the classic character-screen pose); dragging still spins freely.
      this.characterGroup.rotation.y = 0;
    } catch (err) {
      console.error(`Failed to load preview character visual for ${visualKey}:`, err);
    }
  }

  /** Swap the previewed skin (alternate body texture); persists across setClass. */
  setSkin(skinIndex: number): void {
    if (this.destroyed) return;
    // Same invalidation as setClass: a standalone skin change (dataset fallback,
    // char-create skin hover) is not the appearance a pending mech re-apply targets.
    this.appearanceSig = null;
    this.currentSkin = skinIndex;
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

  /** Force the renderer to match the current visible container size. */
  syncSize(): void {
    if (this.destroyed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width > 0 && height > 0) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
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

    const dt = Math.min(this.clock.getDelta(), 0.1); // cap dt to prevent huge jumps

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
   * return it as a PNG data URL. Used to stamp the player's avatar onto the
   * shareable player card.
   *
   * The live preview canvas is borrowed for one synchronous render: we save the
   * renderer size, camera, and group rotation; frame a tighter portrait at the
   * requested pixel size; read the pixels (preserveDrawingBuffer makes this
   * reliable); then restore everything and re-render so the visible preview is
   * untouched. Because nothing awaits between the off-pose render and the
   * restore, the browser never paints the intermediate frame.
   */
  captureCloseup(
    opts: {
      width?: number;
      height?: number;
      angle?: number;
      poseClips?: readonly string[];
      poseFraction?: number;
    } = {},
  ): string {
    if (this.destroyed) return '';
    const width = Math.max(1, Math.round(opts.width ?? 540));
    const height = Math.max(1, Math.round(opts.height ?? 720));
    const angle = opts.angle ?? -0.42; // gentle 3/4 turn for a heroic stance

    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevAspect = this.camera.aspect;
    const prevPos = this.camera.position.clone();
    const prevRotY = this.characterGroup.rotation.y;

    // Optionally lock a deliberate pose for the shot (e.g. a hero/cast/cheer
    // stance) instead of whatever idle frame is up. Restored via clearPose below.
    const posed =
      opts.poseClips && opts.poseClips.length > 0
        ? (this.currentVisual?.poseFreeze(opts.poseClips, opts.poseFraction ?? 0.5) ?? null)
        : null;

    // Pixel-exact buffer (ratio 1 → drawingBuffer is exactly width×height).
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Pulled back to z=4.6, aimed at y=1.55 (eye 1.62) so the 45°/0.75-aspect
    // frustum spans roughly y in [-0.3, 3.5] at the figure plane: enough headroom
    // above the 2.6 head-top to clear the raised weapon/arms of the hero & victory
    // poses (~3.3u) while the feet stay inside (BUG: card character was out of
    // bounds). The card's drawCharacter() fit math then frames the whole capture.
    this.camera.position.set(-0.1, 1.62, 4.6);
    this.camera.lookAt(new THREE.Vector3(-0.1, 1.55, 0));
    this.camera.updateProjectionMatrix();
    this.characterGroup.rotation.y = angle;
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');

    // Restore the live preview exactly as it was (camera + idle animation).
    if (posed) this.currentVisual?.clearPose();
    this.renderer.setPixelRatio(prevPixelRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.position.copy(prevPos);
    this.camera.lookAt(new THREE.Vector3(LIVE_PREVIEW_X, 1.3, 0));
    this.camera.updateProjectionMatrix();
    this.characterGroup.rotation.y = prevRotY;
    this.renderer.render(this.scene, this.camera);
    return url;
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
