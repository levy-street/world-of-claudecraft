// The Guide's standalone turntable. Owns one WebGL canvas, scene, camera, lights, and
// render loop, and shows a single BuiltModel that the reader can drag to rotate. Modeled
// on the in-game character-creation preview (src/render/characters/preview.ts) but kept
// independent of the renderer's scene graph and asset preload, so it costs nothing until
// a reader opens a viewer. Reached only via the lazy viewer chunk (mount.ts imports it
// dynamically), so three.js never lands in the main Guide bundle.

import * as THREE from 'three';
import { trackWebGLContext } from '../../render/context_release';
import type { GuideModelSpec } from '../content.generated';
import { type Bounds3, frameTurntable } from './framing';
import { buildModel, skinAwareBounds } from './model';

const AUTO_SPIN = 0.3; // rad/sec, paused while dragging or for reduced-motion readers
// Advance the idle clip to this representative pose before measuring, so we frame the POSED
// mesh (not the bind pose) and the live idle resumes from a natural pose. Matches the still
// renderer's POSE_TIME, so a freshly framed model reads the same as its baked thumbnail.
const POSE_TIME = 0.6; // seconds into the idle clip

export class ModelViewer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly turntable = new THREE.Group();
  private readonly clock = new THREE.Clock();
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly teardown: Array<() => void> = [];

  private built: Awaited<ReturnType<typeof buildModel>> | null = null;
  /** Posed bounds of the current model, for re-framing on aspect change without re-measuring. */
  private posedBounds: Bounds3 | null = null;
  private raf: number | null = null;
  private dragging = false;
  private lastX = 0;
  private onscreen = true;
  private contextLost = false;
  /** Set once in destroy(); makes destroy() idempotent and lets an in-flight load() that
   *  resolved after teardown discard its freshly-built model instead of restarting the loop. */
  private destroyed = false;
  private onLostCb: (() => void) | null = null;
  /** Drops this renderer from the page-teardown release set; called once in destroy(). */
  private readonly untrackContext: () => void;

  constructor(container: HTMLElement, canvasLabel: string) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'guide-viewer-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', canvasLabel);
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Each viewer is its own GL context and browsers cap live contexts at ~16, so register for
    // page-teardown release (mirrors the in-game preview, src/render/characters/preview.ts);
    // destroy() also force-loses it up front so an LRU eviction frees the context at once
    // instead of waiting for GC (the guide's prior "models not loading" exhaustion).
    this.untrackContext = trackWebGLContext(this.renderer);

    this.scene.add(this.turntable);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

    // Soft hemisphere fill plus a warm key and a cool back rim, so armor and scales read
    // without the heavy shadow rig the game uses.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.7);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.8);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    this.bindControls();
    this.bindContextLoss();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.teardown.push(() => ro.disconnect());
    this.resize();
  }

  /** Register a callback fired once if this canvas loses its WebGL context (the browser
   *  dropped it, e.g. too many live contexts). The mount wiring reverts the figure to its
   *  2D poster + re-enables "View in 3D", the same path as a load error. */
  onContextLost(cb: () => void): void {
    this.onLostCb = cb;
  }

  /** True once the WebGL context has been lost (the loop is stopped and nothing renders).
   *  The gallery uses this to keep its 2D still up instead of hiding it over a dead canvas. */
  isContextLost(): boolean {
    return this.contextLost;
  }

  private bindContextLoss(): void {
    // preventDefault keeps the context restorable; we stop the loop, mark not-ready, and
    // surface a failure so the figure falls back to its poster exactly like a load error.
    const onLost = (e: Event): void => {
      e.preventDefault();
      this.contextLost = true;
      if (this.raf !== null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      const cb = this.onLostCb;
      this.onLostCb = null;
      if (cb) cb();
    };
    const onRestored = (): void => {
      this.contextLost = false;
    };
    this.canvas.addEventListener('webglcontextlost', onLost as EventListener, false);
    this.canvas.addEventListener('webglcontextrestored', onRestored as EventListener, false);
    this.teardown.push(
      () => this.canvas.removeEventListener('webglcontextlost', onLost as EventListener, false),
      () =>
        this.canvas.removeEventListener('webglcontextrestored', onRestored as EventListener, false),
    );
  }

  /** Load (or replace) the displayed model. Awaits the GLB fetch + assembly. */
  async load(spec: GuideModelSpec, tint: number | null): Promise<void> {
    if (this.built) {
      this.turntable.remove(this.built.root);
      this.built.dispose();
      this.built = null;
      this.posedBounds = null;
    }
    this.turntable.rotation.y = 0;
    const built = await buildModel(spec, tint);
    // Evicted/destroyed while the GLB was in flight: drop the just-built model (its tint
    // material clones + bone DataTexture) instead of attaching it and restarting a render loop
    // that destroy() can no longer cancel (it already cleared raf/teardown). Without this the
    // ModelViewer + scene graph stay GC-pinned by the animate closure and wake the CPU forever.
    if (this.destroyed) {
      built.dispose();
      return;
    }
    this.built = built;
    this.turntable.add(this.built.root);
    this.frameToPosedBounds();
    if (this.raf === null) this.animate();
  }

  /** Pause rendering while the viewer is scrolled offscreen (saves battery/GPU). */
  setOnscreen(value: boolean): void {
    this.onscreen = value;
  }

  /** Update the canvas accessible name (the gallery swaps models in one viewer). */
  setLabel(canvasLabel: string): void {
    this.canvas.setAttribute('aria-label', canvasLabel);
  }

  /** Frame the camera to the model's POSED, skin-aware bounds (not the bind pose) and
   *  re-center it on the Y spin axis, so even rigs whose idle clip flings the mesh far from
   *  the bind box render centered and on-frame for every turntable angle. Mirrors the still
   *  renderer (scripts/wiki/stills_render_entry.js); see framing.ts for the camera math. */
  private frameToPosedBounds(): void {
    if (!this.built) return;
    const built = this.built;

    // Disable frustum culling: three culls a SkinnedMesh by its BIND-pose bounding sphere,
    // which for a flung rig sits off the posed mesh and would blank it even when framed.
    built.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.frustumCulled = false;
    });

    // Advance the idle clip to a representative pose, then measure the POSED bounds. The idle
    // clips barely move the mesh over their loop (measured center drift <= ~10% of the
    // radius), so this single pose frames the whole animation; the camera margin absorbs the
    // rest. turntable.rotation.y is 0 here (reset in load), so model-local x/z equals world
    // x/z and the re-center lands the bounds center on the spin axis.
    //
    // CRITICAL: drive the skeleton with mixer.update + scene.updateMatrixWorld, NOT
    // root.updateWorldMatrix. After the mixer poses the bones, only a top-down
    // scene.updateMatrixWorld recomputes the bone WORLD matrices that skinAwareBounds reads;
    // a mid-tree root.updateWorldMatrix leaves several creature rigs measuring posed bounds
    // tens of thousands of units off (and then framing empty space). buildModel's bind-pose
    // measurement is unaffected because no clip has been applied there.
    built.mixer?.update(POSE_TIME);
    this.scene.updateMatrixWorld(true);
    const posed = skinAwareBounds(built.root);

    // Degenerate bound (no drawable vertices): fall back to the bind sphere at the origin.
    const bounds = posed.isEmpty()
      ? {
          min: { x: -built.radius, y: 0, z: -built.radius },
          max: { x: built.radius, y: built.height, z: built.radius },
        }
      : {
          min: { x: posed.min.x, y: posed.min.y, z: posed.min.z },
          max: { x: posed.max.x, y: posed.max.y, z: posed.max.z },
        };

    // Re-center the model on the spin axis once (independent of viewport aspect), then aim the
    // camera. The camera framing is split into applyCameraFraming so resize() can re-fit it to
    // a new aspect without re-posing or re-measuring the rig.
    this.posedBounds = bounds;
    const f = frameTurntable(bounds, this.camera.fov, this.camera.aspect);
    built.root.position.x = f.offset.x;
    built.root.position.z = f.offset.z;
    this.applyCameraFraming();
  }

  /** Aim the camera at the stored posed bounds for the current viewport aspect. Cheap (no
   *  re-measure, no mixer advance), so resize() can call it to keep a wide rig on-frame when
   *  the stage aspect changes (mobile rotation, responsive layout, or a deferred 0x0 mount). */
  private applyCameraFraming(): void {
    if (!this.posedBounds) return;
    const f = frameTurntable(this.posedBounds, this.camera.fov, this.camera.aspect);
    this.camera.position.set(f.cameraPos.x, f.cameraPos.y, f.cameraPos.z);
    this.camera.lookAt(f.target.x, f.target.y, f.target.z);
    this.camera.near = f.near;
    this.camera.far = f.far;
    this.camera.updateProjectionMatrix();
  }

  private rotateBy(delta: number): void {
    this.turntable.rotation.y += delta;
  }

  private bindControls(): void {
    const down = (x: number) => {
      this.dragging = true;
      this.lastX = x;
    };
    const move = (x: number) => {
      if (!this.dragging) return;
      this.rotateBy((x - this.lastX) * 0.01);
      this.lastX = x;
    };
    const up = () => {
      this.dragging = false;
    };

    const onMouseDown = (e: MouseEvent) => down(e.clientX);
    const onMouseMove = (e: MouseEvent) => move(e.clientX);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) down(e.touches[0].clientX);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (this.dragging && e.touches.length === 1) move(e.touches[0].clientX);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        this.rotateBy(-0.2);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.rotateBy(0.2);
        e.preventDefault();
      }
    };

    this.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', up);
    this.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', up);
    this.canvas.addEventListener('keydown', onKey);

    this.teardown.push(
      () => this.canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', up),
      () => this.canvas.removeEventListener('touchstart', onTouchStart),
      () => window.removeEventListener('touchmove', onTouchMove),
      () => window.removeEventListener('touchend', up),
      () => this.canvas.removeEventListener('keydown', onKey),
    );
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Re-fit the framing to the new aspect (no re-measure); falls back to a bare projection
    // update before any model is loaded.
    if (this.posedBounds) this.applyCameraFraming();
    else this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (this.contextLost || this.destroyed) {
      this.raf = null;
      return;
    }
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.reduceMotion.matches && !this.dragging) this.rotateBy(AUTO_SPIN * dt);
    this.built?.mixer?.update(dt);
    if (this.onscreen) this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    // Idempotent: the gallery defensively re-destroys after an in-flight load() resolves, and
    // a double forceContextLoss/dispose on three internals is fragile, so bail on re-entry.
    if (this.destroyed) return;
    this.destroyed = true;
    this.onLostCb = null;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    if (this.built) {
      this.turntable.remove(this.built.root);
      this.built.dispose();
      this.built = null;
    }
    // forceContextLoss() hands the GL context back immediately; dispose() alone only frees
    // programs and waits for GC to reclaim the context, so without this an evicted viewer's
    // context lingers and the live count can still approach the browser cap.
    this.untrackContext();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
