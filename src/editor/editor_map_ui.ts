// The editor's minimap overlay (corner of the viewport) and the Map window
// (current zone, with a button to zoom out to the full world). Both render via
// the self-contained top-down sampler in editor_map.ts, driven by camera data
// the app injects, with no game HUD/Sim coupling.

import {
  canvasToWorld,
  drawCameraMarker,
  drawMapArt,
  drawMapPin,
  drawZoneBoxes,
  type MapRect,
  type MapSceneOverlay,
  renderTopDownMap,
  sameMapRect,
  worldToCanvas,
  type ZoneBox,
} from './editor_map_core';

export interface EditorMapDeps {
  /** Physical editor camera position in world coords (not its orbit pivot). */
  cameraPosition(): { x: number; z: number };
  /** Camera orbit yaw (radians); the marker points along it. */
  cameraYaw(): number;
  seed(): number;
  revision(): number;
  /** The full map rect (worldHalfX-wide, full zone z-span). */
  worldRect(): MapRect;
  /** The rect of the zone the camera is over (for the zone map / minimap frame). */
  currentZoneRect(): MapRect;
  /** Every zone rect + label, for the full-world overlay. */
  zoneBoxes(): ZoneBox[];
  sceneOverlay(): MapSceneOverlay;
  currentZone(): { id: string; name: string };
  artImage(mode: 'zone' | 'world'): Promise<HTMLImageElement | null>;
  teleportCamera(point: { x: number; z: number }): void;
}

const MINIMAP_SIZE = 168;
const MINIMAP_RADIUS = 130; // yards shown around the camera

export class EditorMinimap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly marker: HTMLCanvasElement;
  private on = false;
  private raf = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastPaint = 0;

  constructor(
    parent: HTMLElement,
    private readonly deps: EditorMapDeps,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ed-minimap';
    this.root.style.display = 'none';
    this.canvas = document.createElement('canvas');
    this.canvas.width = MINIMAP_SIZE;
    this.canvas.height = MINIMAP_SIZE;
    this.marker = document.createElement('canvas');
    this.marker.width = MINIMAP_SIZE;
    this.marker.height = MINIMAP_SIZE;
    this.marker.className = 'ed-minimap-marker';
    this.root.append(this.canvas, this.marker);
    parent.appendChild(this.root);
  }

  isOn(): boolean {
    return this.on;
  }

  toggle(): boolean {
    this.setVisible(!this.on);
    return this.on;
  }

  setVisible(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.style.display = on ? '' : 'none';
    if (on) {
      this.lastX = Number.NaN; // force a repaint
      this.loop();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private loop = (): void => {
    if (!this.on) return;
    this.raf = requestAnimationFrame(this.loop);
    const f = this.deps.cameraPosition();
    const now = performance.now();
    // Repaint the terrain only when the camera moved enough or after a beat
    // (sampling is the cost); the facing marker is redrawn every frame (cheap).
    const moved = !(Math.abs(f.x - this.lastX) < 6 && Math.abs(f.z - this.lastZ) < 6);
    if (moved || now - this.lastPaint > 500) {
      this.lastX = f.x;
      this.lastZ = f.z;
      this.lastPaint = now;
      const rect: MapRect = {
        minX: f.x - MINIMAP_RADIUS,
        maxX: f.x + MINIMAP_RADIUS,
        minZ: f.z - MINIMAP_RADIUS,
        maxZ: f.z + MINIMAP_RADIUS,
      };
      renderTopDownMap(this.canvas, rect, this.deps.seed(), 2, this.deps.sceneOverlay());
    }
    const mctx = this.marker.getContext('2d');
    if (mctx) {
      mctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      drawCameraMarker(mctx, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, this.deps.cameraYaw(), 1);
    }
  };

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}

const MAP_WINDOW_SIZE = 460;

export class EditorMapWindow {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly marker: HTMLCanvasElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly artBtn: HTMLButtonElement;
  private readonly teleportBtn: HTMLButtonElement;
  private readonly pinHint: HTMLElement;
  private readonly title: HTMLElement;
  private mode: 'zone' | 'world' = 'zone';
  private painted = true;
  private open = false;
  private rect: MapRect | null = null;
  private raf = 0;
  private renderGeneration = 0;
  private lastRevision = Number.NaN;
  private pin: { x: number; z: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly deps: EditorMapDeps,
    private readonly labels: {
      zoneMap: string;
      worldMap: string;
      showWorld: string;
      showZone: string;
      close: string;
      usePainted: string;
      useLiveTerrain: string;
      pinHint: string;
      teleportToPin: string;
    },
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'ed-mapwin-overlay';
    this.overlay.style.display = 'none';
    this.overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.overlay) this.close();
    });
    const panel = document.createElement('div');
    panel.className = 'ed-mapwin';
    const bar = document.createElement('div');
    bar.className = 'ed-mapwin-bar';
    this.title = document.createElement('span');
    this.title.className = 'ed-mapwin-title';
    this.modeBtn = document.createElement('button');
    this.modeBtn.className = 'ed-mapwin-btn';
    this.modeBtn.addEventListener('click', () => this.toggleMode());
    this.artBtn = document.createElement('button');
    this.artBtn.className = 'ed-mapwin-btn ed-mapwin-ai';
    this.artBtn.addEventListener('click', () => {
      this.painted = !this.painted;
      this.render();
    });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ed-mapwin-btn';
    closeBtn.textContent = labels.close;
    closeBtn.addEventListener('click', () => this.close());
    bar.append(this.title, this.artBtn, this.modeBtn, closeBtn);
    const wrap = document.createElement('div');
    wrap.className = 'ed-mapwin-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_WINDOW_SIZE;
    this.canvas.height = MAP_WINDOW_SIZE;
    this.marker = document.createElement('canvas');
    this.marker.width = MAP_WINDOW_SIZE;
    this.marker.height = MAP_WINDOW_SIZE;
    this.marker.className = 'ed-mapwin-marker';
    this.marker.title = labels.pinHint;
    this.marker.addEventListener('pointerdown', this.pickPin);
    wrap.append(this.canvas, this.marker);
    const footer = document.createElement('div');
    footer.className = 'ed-mapwin-footer';
    this.pinHint = document.createElement('span');
    this.pinHint.className = 'ed-mapwin-pin-hint';
    this.pinHint.textContent = labels.pinHint;
    this.teleportBtn = document.createElement('button');
    this.teleportBtn.className = 'ed-mapwin-btn ed-mapwin-teleport';
    this.teleportBtn.textContent = labels.teleportToPin;
    this.teleportBtn.disabled = true;
    this.teleportBtn.addEventListener('click', () => {
      if (!this.pin) return;
      this.deps.teleportCamera(this.pin);
      this.close();
    });
    footer.append(this.pinHint, this.teleportBtn);
    panel.append(bar, wrap, footer);
    this.overlay.appendChild(panel);
    parent.appendChild(this.overlay);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.overlay.style.display = '';
    this.setPin(null);
    this.render();
    this.markerLoop();
  }

  close(): void {
    this.open = false;
    this.overlay.style.display = 'none';
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private toggleMode(): void {
    this.mode = this.mode === 'zone' ? 'world' : 'zone';
    this.setPin(null);
    this.render();
  }

  private pickPin = (ev: PointerEvent): void => {
    if (ev.button !== 0 || !this.rect) return;
    const bounds = this.marker.getBoundingClientRect();
    const px = ((ev.clientX - bounds.left) / Math.max(1, bounds.width)) * MAP_WINDOW_SIZE;
    const py = ((ev.clientY - bounds.top) / Math.max(1, bounds.height)) * MAP_WINDOW_SIZE;
    this.setPin(canvasToWorld(px, py, this.rect, MAP_WINDOW_SIZE));
  };

  private setPin(pin: { x: number; z: number } | null): void {
    this.pin = pin;
    this.teleportBtn.disabled = pin === null;
  }

  private render(): void {
    const generation = ++this.renderGeneration;
    this.lastRevision = this.deps.revision();
    this.rect = this.mode === 'world' ? this.deps.worldRect() : this.deps.currentZoneRect();
    const r = this.rect;
    // Full-world sampling is much larger: coarsen the step so it stays snappy.
    const spanMax = Math.max(r.maxX - r.minX, r.maxZ - r.minZ);
    const step = spanMax > 900 ? 3 : 2;
    renderTopDownMap(this.canvas, r, this.deps.seed(), step, this.deps.sceneOverlay());
    const finishOverlay = (): void => {
      if (generation !== this.renderGeneration) return;
      if (this.mode === 'world') {
        const ctx = this.canvas.getContext('2d');
        if (ctx) drawZoneBoxes(ctx, this.deps.zoneBoxes(), r, MAP_WINDOW_SIZE);
      }
    };
    finishOverlay();
    if (this.painted) {
      void this.deps.artImage(this.mode).then((img) => {
        if (!img || generation !== this.renderGeneration) return;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        drawMapArt(ctx, img, r, MAP_WINDOW_SIZE);
        finishOverlay();
      });
    }
    this.title.textContent = this.mode === 'world' ? this.labels.worldMap : this.labels.zoneMap;
    this.modeBtn.textContent = this.mode === 'world' ? this.labels.showZone : this.labels.showWorld;
    this.artBtn.textContent = this.painted ? this.labels.useLiveTerrain : this.labels.usePainted;
  }

  private markerLoop = (): void => {
    if (!this.open || !this.rect) return;
    this.raf = requestAnimationFrame(this.markerLoop);
    if (this.deps.revision() !== this.lastRevision) this.render();
    if (this.mode === 'zone') {
      const nextRect = this.deps.currentZoneRect();
      if (!sameMapRect(nextRect, this.rect)) {
        this.render();
        return;
      }
    }
    const mctx = this.marker.getContext('2d');
    if (!mctx) return;
    mctx.clearRect(0, 0, MAP_WINDOW_SIZE, MAP_WINDOW_SIZE);
    const f = this.deps.cameraPosition();
    const { px, py } = worldToCanvas(f.x, f.z, this.rect, MAP_WINDOW_SIZE);
    if (px >= 0 && px <= MAP_WINDOW_SIZE && py >= 0 && py <= MAP_WINDOW_SIZE) {
      drawCameraMarker(mctx, px, py, this.deps.cameraYaw(), 1.4);
    }
    if (this.pin) {
      const pin = worldToCanvas(this.pin.x, this.pin.z, this.rect, MAP_WINDOW_SIZE);
      if (pin.px >= 0 && pin.px <= MAP_WINDOW_SIZE && pin.py >= 0 && pin.py <= MAP_WINDOW_SIZE) {
        drawMapPin(mctx, pin.px, pin.py, 1.2);
      }
    }
  };

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.overlay.remove();
  }
}
