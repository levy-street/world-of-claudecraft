// The Guide's standalone turntable. Owns one WebGL canvas, scene, camera, lights, and
// render loop, and shows a single BuiltModel that the reader can drag to rotate. Modeled
// on the in-game character-creation preview (src/render/characters/preview.ts) but kept
// independent of the renderer's scene graph and asset preload, so it costs nothing until
// a reader opens a viewer. Reached only via the lazy viewer chunk (mount.ts imports it
// dynamically), so three.js never lands in the main Guide bundle.

import * as THREE from 'three';
import { buildModel } from './model';
import type { GuideModelSpec } from '../content.generated';

const AUTO_SPIN = 0.3; // rad/sec, paused while dragging or for reduced-motion readers

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
  private raf: number | null = null;
  private dragging = false;
  private lastX = 0;
  private onscreen = true;
  private contextLost = false;
  private onLostCb: (() => void) | null = null;

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

  private bindContextLoss(): void {
    // preventDefault keeps the context restorable; we stop the loop, mark not-ready, and
    // surface a failure so the figure falls back to its poster exactly like a load error.
    const onLost = (e: Event): void => {
      e.preventDefault();
      this.contextLost = true;
      if (this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null; }
      const cb = this.onLostCb;
      this.onLostCb = null;
      if (cb) cb();
    };
    const onRestored = (): void => { this.contextLost = false; };
    this.canvas.addEventListener('webglcontextlost', onLost as EventListener, false);
    this.canvas.addEventListener('webglcontextrestored', onRestored as EventListener, false);
    this.teardown.push(
      () => this.canvas.removeEventListener('webglcontextlost', onLost as EventListener, false),
      () => this.canvas.removeEventListener('webglcontextrestored', onRestored as EventListener, false),
    );
  }

  /** Load (or replace) the displayed model. Awaits the GLB fetch + assembly. */
  async load(spec: GuideModelSpec, tint: number | null): Promise<void> {
    if (this.built) {
      this.turntable.remove(this.built.root);
      this.built.dispose();
      this.built = null;
    }
    this.turntable.rotation.y = 0;
    this.built = await buildModel(spec, tint);
    this.turntable.add(this.built.root);
    this.frameCamera();
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

  private frameCamera(): void {
    if (!this.built) return;
    const { radius, height } = this.built;
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.15;
    this.camera.position.set(0, height * 0.55, dist);
    this.camera.lookAt(0, height * 0.5, 0);
    this.camera.near = Math.max(0.05, dist / 50);
    this.camera.far = dist * 12;
    this.camera.updateProjectionMatrix();
  }

  private rotateBy(delta: number): void {
    this.turntable.rotation.y += delta;
  }

  private bindControls(): void {
    const down = (x: number) => { this.dragging = true; this.lastX = x; };
    const move = (x: number) => {
      if (!this.dragging) return;
      this.rotateBy((x - this.lastX) * 0.01);
      this.lastX = x;
    };
    const up = () => { this.dragging = false; };

    const onMouseDown = (e: MouseEvent) => down(e.clientX);
    const onMouseMove = (e: MouseEvent) => move(e.clientX);
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 1) down(e.touches[0].clientX); };
    const onTouchMove = (e: TouchEvent) => { if (this.dragging && e.touches.length === 1) move(e.touches[0].clientX); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { this.rotateBy(-0.2); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { this.rotateBy(0.2); e.preventDefault(); }
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
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (this.contextLost) { this.raf = null; return; }
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.reduceMotion.matches && !this.dragging) this.rotateBy(AUTO_SPIN * dt);
    this.built?.mixer?.update(dt);
    if (this.onscreen) this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    this.onLostCb = null;
    if (this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null; }
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    if (this.built) {
      this.turntable.remove(this.built.root);
      this.built.dispose();
      this.built = null;
    }
    this.renderer.dispose();
    this.canvas.remove();
  }
}
