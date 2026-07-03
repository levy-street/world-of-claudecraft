import * as THREE from 'three';
import { CLASSES } from '../../sim/data';
import type { PlayerClass } from '../../sim/types';
import { trackWebGLContext } from '../context_release';
import { skinCount, type WeaponLayoutOverride } from './manifest';
import { playerPortraitDataUrl } from './portrait';
import { CharacterVisual } from './visual';

const PREVIEW_ANIM_STATE = {
  speed: 0,
  moving: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
  retreatFlip: 0,
};

export class CharacterPreview {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private characterGroup: THREE.Group;
  private currentVisual: CharacterVisual | null = null;
  private currentVisualKey = '';
  private fallbackImg: HTMLImageElement | null = null;
  private currentSkin = 0;
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
    this.camera.position.set(-0.15, 1.45, 5.1);
    this.camera.lookAt(new THREE.Vector3(-0.15, 1.3, 0));

    // 4. Initialize Character Group
    this.characterGroup = new THREE.Group();
    this.scene.add(this.characterGroup);

    // 5. Add Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x6d5a3a, 2.0);
    this.scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight1.position.set(3, 5, 4);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xd7ecff, 1.2);
    dirLight2.position.set(-3, 3, -4);
    this.scene.add(dirLight2);

    // 6. Setup Drag Controls
    this.setupDragControls();

    // 7. Setup Resize Observer
    this.setupResizeObserver();

    // 8. Start loop
    this.animate();
  }

  /** Set the active character model by player class. Pass `weaponItemId` to hold a
   *  specific weapon (e.g. the character sheet shows the equipped mainhand); omit it
   *  to default to the class start weapon (so the creation turntable matches the
   *  freshly created character in-world). */
  setClass(cls: PlayerClass, weaponItemId?: string | null): void {
    if (this.destroyed) return;
    const weapon = weaponItemId !== undefined ? weaponItemId : (CLASSES[cls].startWeapon ?? null);
    this.setVisualKey(`player_${cls}`, weapon);
  }

  /** Set the active model by raw visual key (e.g. `player_mech` for the cosmetic
   *  turntable). The asset must already be loaded — callers preload first.
   *  `weaponOverride` lets a cosmetic body adopt a class hand layout (rogue mech
   *  dual-wields), matching the in-world render. */
  setVisualKey(
    visualKey: string,
    weaponItemId: string | null = null,
    weaponOverride: WeaponLayoutOverride | null = null,
  ): void {
    if (this.destroyed) return;
    const availableSkins = skinCount(visualKey);
    if (this.currentSkin < 0 || this.currentSkin >= availableSkins) this.currentSkin = 0;
    // Clean up current visual if it exists
    if (this.currentVisual) {
      this.characterGroup.remove(this.currentVisual.root);
      // CharacterVisual dispose only releases mixer listeners
      this.currentVisual = null;
    }

    try {
      this.currentVisualKey = visualKey;
      this.currentVisual = new CharacterVisual(
        visualKey,
        0xffffff,
        this.currentSkin,
        weaponItemId,
        weaponOverride,
      );
      this.characterGroup.add(this.currentVisual.root);

      // Reset rotation of group so new character faces forward but holds any user offset if preferred.
      // Resetting Y rotation is cleanest for transitions.
      this.characterGroup.rotation.y = 0;
      this.updateFallbackImage();
      this.frameCurrentVisual();
    } catch (err) {
      console.error(`Failed to load preview character visual for ${visualKey}:`, err);
    }
  }

  /** Swap the previewed skin (alternate body texture); persists across setClass. */
  setSkin(skinIndex: number): void {
    if (this.destroyed) return;
    this.currentSkin = skinIndex;
    this.currentVisual?.setSkin(skinIndex);
    this.updateFallbackImage();
    requestAnimationFrame(() => this.frameCurrentVisual());
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

  private frameCurrentVisual(): void {
    const visual = this.currentVisual;
    if (!visual) return;
    visual.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(visual.root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (!Number.isFinite(size.y) || size.y <= 0.01) {
      center.set(0, 1.25, 0);
      size.set(1.8, 2.4, 1.2);
    }

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const verticalFit = size.y / (2 * Math.tan(fov / 2));
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect);
    const horizontalFit = Math.max(size.x, size.z * 0.65) / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(3.2, verticalFit, horizontalFit) * 1.45;
    const lookAt = new THREE.Vector3(center.x, center.y + size.y * 0.06, center.z);
    this.camera.position.set(center.x - size.x * 0.08, lookAt.y + size.y * 0.02, center.z + distance);
    this.camera.lookAt(lookAt);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.updateFallbackVisibility();
  }

  private updateFallbackImage(): void {
    const cls = this.currentVisualKey.startsWith('player_')
      ? (this.currentVisualKey.slice('player_'.length) as PlayerClass)
      : null;
    const url = cls && CLASSES[cls] ? playerPortraitDataUrl(cls, this.currentSkin) : '';
    if (!url) {
      if (this.fallbackImg) this.fallbackImg.hidden = true;
      return;
    }
    if (!this.fallbackImg) {
      this.fallbackImg = document.createElement('img');
      this.fallbackImg.className = 'char-preview-fallback';
      this.fallbackImg.alt = '';
      this.container.insertBefore(this.fallbackImg, this.canvas);
    }
    if (this.fallbackImg.src !== url) this.fallbackImg.src = url;
    this.fallbackImg.hidden = false;
  }

  private updateFallbackVisibility(): void {
    const img = this.fallbackImg;
    if (!img) return;
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w <= 0 || h <= 0) {
      img.hidden = false;
      return;
    }
    const pixels = new Uint8Array(4);
    const xs = [0.32, 0.5, 0.68];
    const ys = [0.28, 0.5, 0.72];
    for (const x of xs) {
      for (const y of ys) {
        gl.readPixels(Math.floor(w * x), Math.floor(h * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (pixels[3] > 8) {
          img.hidden = true;
          return;
        }
      }
    }
    img.hidden = false;
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

    // Auto-rotation if prefers-reduced-motion is false and not dragging
    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!isReducedMotion && !this.isDragging) {
      this.characterGroup.rotation.y += 0.35 * dt; // Slow rotation: ~0.35 rad per sec
    }

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
    this.camera.lookAt(new THREE.Vector3(-0.15, 1.3, 0));
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
    this.fallbackImg?.remove();
    this.fallbackImg = null;
    this.canvas.remove();
  }
}
