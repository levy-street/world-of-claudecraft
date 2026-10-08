// Keeps the world map canvas's backing store in step with its displayed box,
// so a resized map window draws crisp at its new size instead of stretching
// the shipped 560 px store. The window itself is resized by the shared corner
// grip (src/ui/window_resize.ts); the CSS face rule in src/styles/components.css
// sizes the canvas display box to the largest square the stage fits.
//
// Event-driven: one ResizeObserver on the canvas, so there is no per-frame
// work and no forced layout read (the observer hands over the laid-out content
// box, in author px). A backing write clears and reallocates the canvas, so
// every write is followed by the injected repaint, and none happens while a
// resize drag is live: CSS stretches the current store meanwhile, and the
// last box is applied once when the drag ends. The size decision is
// map_canvas_size_core.ts.
import { MAP_CANVAS_DEFAULT_SIDE, mapCanvasBackingSide } from './map_canvas_size_core';

export interface MapCanvasSizeDeps {
  canvas: HTMLCanvasElement;
  /**
   * True while the map window carries a player-chosen size (desktop, after the
   * corner grip engaged). Otherwise the shipped backing stays: the touch sheet
   * CSS-scales the 560 store on purpose (its compact marker profile is tuned
   * for that), and an unsized desktop window displays it 1:1 already.
   */
  sized(): boolean;
  /** True while a corner-grip drag is live (the grip's `window-resizing`). */
  resizing(): boolean;
  /**
   * Called before each size decision: drops a desktop size left on the window
   * once the HUD has switched to the touch layout (an inline width would
   * otherwise override the touch sheet's own size).
   */
  releaseStaleSize(): void;
  /** Repaint the map right after the backing store changed (it is now blank). */
  repaint(): void;
}

export class MapCanvasSizeController {
  private observer: ResizeObserver | null = null;
  private pending: { width: number; height: number } | null = null;

  constructor(private readonly deps: MapCanvasSizeDeps) {}

  /** Start observing. A host without ResizeObserver keeps the shipped size. */
  install(): void {
    if (this.observer || typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentBoxSize?.[0];
      if (box) this.apply(box.inlineSize, box.blockSize);
    });
    this.observer.observe(this.deps.canvas);
  }

  /** Match the backing store to a displayed content box of `width` x `height`. */
  apply(width: number, height: number): void {
    this.deps.releaseStaleSize();
    if (this.deps.resizing()) {
      this.pending = { width, height };
      return;
    }
    this.pending = null;
    const side = this.deps.sized() ? mapCanvasBackingSide(width, height) : MAP_CANVAS_DEFAULT_SIDE;
    const canvas = this.deps.canvas;
    if (side === null || (canvas.width === side && canvas.height === side)) return;
    canvas.width = side;
    canvas.height = side;
    this.deps.repaint();
  }

  /** Apply the box a live drag deferred, once the drag has ended. */
  flush(): void {
    if (!this.pending || this.deps.resizing()) return;
    const { width, height } = this.pending;
    this.apply(width, height);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

/** The window state installMapCanvasSize reads, as plain flags. */
export interface MapWindowSizeFlags {
  /** The shared grip's permanent `window-sized` stamp is on the window. */
  windowSized: boolean;
  /** The HUD is in the touch layout (body.mobile-touch). */
  touch: boolean;
}

/** A player-sized map: a sized window on the desktop layout. */
export function mapWindowPlayerSized(flags: MapWindowSizeFlags): boolean {
  return flags.windowSized && !flags.touch;
}

/** A desktop size left behind after a switch to the touch layout. */
export function mapWindowSizeIsStale(flags: MapWindowSizeFlags): boolean {
  return flags.windowSized && flags.touch;
}

/**
 * Hud's wiring: a player-sized map window is a desktop #map-window carrying
 * the shared grip's permanent `window-sized` stamp. A class observer on the
 * window applies the box a drag deferred once `window-resizing` drops.
 */
export function installMapCanvasSize(
  canvas: HTMLCanvasElement,
  repaint: () => void,
): MapCanvasSizeController {
  const win = canvas.closest<HTMLElement>('#map-window');
  const flags = (): MapWindowSizeFlags => ({
    windowSized: !!win?.classList.contains('window-sized'),
    touch: !!canvas.ownerDocument?.body?.classList.contains('mobile-touch'),
  });
  const controller = new MapCanvasSizeController({
    canvas,
    sized: () => mapWindowPlayerSized(flags()),
    resizing: () => !!win?.classList.contains('window-resizing'),
    releaseStaleSize: () => {
      if (!win || !mapWindowSizeIsStale(flags())) return;
      win.style.removeProperty('width');
      win.style.removeProperty('height');
      win.classList.remove('window-sized');
    },
    repaint,
  });
  controller.install();
  if (win && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => controller.flush()).observe(win, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  return controller;
}
