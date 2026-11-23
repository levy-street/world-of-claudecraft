// The resizable world map, driven through the REAL resize and drag controllers,
// the REAL canvas size controller, and the REAL stylesheet in a real browser.
// What only computed geometry can show: the resized canvas really is the
// largest square the stage fits, its backing store follows it 1:1, the overlay
// controls stay on the map face instead of the stage corners, a corner press
// resizes rather than drags the headerless map (whose drag handle is the
// padding band the corner overlaps), and the touch sheet never takes the grip.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { installMapWindowSizing } from '../../src/ui/hud/map';
import { installWindowDrag, type WindowDragController } from '../../src/ui/window_drag';
import { isWindowDragHandle } from '../../src/ui/window_drag_handle';
import { installWindowResize } from '../../src/ui/window_resize';
import { RESIZE_ENGAGE_SLOP } from '../../src/ui/window_resize_core';
import { cleanup } from './_harness';

const VIEWPORT = { width: 1600, height: 1100 };

let teardownResize: (() => void) | null = null;
let drag: WindowDragController | null = null;
let repaints = 0;
let storedRailWidth: number | null = null;

beforeEach(async () => {
  await browserPage.viewport(VIEWPORT.width, VIEWPORT.height);
  document.documentElement.style.setProperty('--app-vw', `${VIEWPORT.width}px`);
  document.documentElement.style.setProperty('--app-vh', `${VIEWPORT.height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  repaints = 0;
  storedRailWidth = null;
});

afterEach(() => {
  teardownResize?.();
  teardownResize = null;
  drag?.destroy();
  drag = null;
  document.body.classList.remove('mobile-touch');
  cleanup();
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

const pin = (target: HTMLElement, rect: DOMRect): void => {
  target.style.left = `${rect.left}px`;
  target.style.top = `${rect.top}px`;
  target.style.transform = 'none';
};

// The shipped markup (index.html / play.html), with a fed atlas rail.
function openMap(): HTMLElement {
  const win = document.createElement('div');
  win.id = 'map-window';
  win.className = 'window panel ui-window';
  win.innerHTML = `
    <aside id="map-sidebar" class="map-atlas-sidebar ui-panel-strong"><div>Rail</div></aside>
    <div class="map-atlas-splitter" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Map sidebar width"></div>
    <div class="map-atlas-stage">
      <button type="button" class="x-btn ui-x-btn" id="map-close" aria-label="Close map"></button>
      <button type="button" class="ui-btn" id="map-level-toggle">World map</button>
      <div id="map-zoom">
        <button type="button" class="map-zoom-btn ui-disc" id="map-zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="map-zoom-btn ui-disc" id="map-zoom-out" aria-label="Zoom out">-</button>
      </div>
      <div class="map-atlas-compass" aria-hidden="true"></div>
      <canvas id="map-canvas" width="560" height="560" aria-label="Map"></canvas>
    </div>`;
  win.style.display = 'block';
  document.body.appendChild(win);
  // The same installs Hud makes, in the same order.
  drag = installWindowDrag({
    getScale: () => 1,
    isDragHandle: isWindowDragHandle,
    bringToFront: () => undefined,
    hideTooltip: () => undefined,
    pinWindow: pin,
    commitWindow: (el, left, top) => {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
  });
  teardownResize = installWindowResize({
    getScale: () => 1,
    pinWindow: pin,
    isCoarsePointer: () => false,
  });
  installMapWindowSizing(
    canvasOf(win),
    () => {
      repaints += 1;
    },
    () => ({
      settings: {
        get: () => storedRailWidth ?? 300,
        set: (_key, value) => {
          storedRailWidth = value;
        },
      },
    }),
  );
  return win;
}

function canvasOf(win: HTMLElement): HTMLCanvasElement {
  const canvas = win.querySelector<HTMLCanvasElement>('#map-canvas');
  if (!canvas) throw new Error('no map canvas');
  return canvas;
}

// The press lands on the window itself (the padding band), exactly where a
// player grabs the corner: the map's drag handle and the resize corner overlap.
function dragCorner(win: HTMLElement, dx: number, dy: number): void {
  const rect = win.getBoundingClientRect();
  const x = rect.left + win.clientLeft + win.clientWidth - 4;
  const y = rect.top + win.clientTop + win.clientHeight - 4;
  const fire = (type: string, cx: number, cy: number, buttons: number): void => {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
    });
    (type === 'pointerdown' ? win : document).dispatchEvent(ev);
  };
  fire('pointerdown', x, y, 1);
  fire('pointermove', x + RESIZE_ENGAGE_SLOP, y + RESIZE_ENGAGE_SLOP, 1);
  fire('pointermove', x + dx, y + dy, 1);
  fire('pointerup', x + dx, y + dy, 0);
}

// Two frames: layout, then the ResizeObserver delivery that follows it.
const settle = (): Promise<void> =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

function inside(inner: DOMRect, outer: DOMRect): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

describe('resizable world map', () => {
  it('keeps the shipped 560 px canvas until the player resizes it', async () => {
    const win = openMap();
    await settle();
    const canvas = canvasOf(win);
    expect(win.classList.contains('window-resizable')).toBe(true);
    expect(canvas.width).toBe(560);
    expect(canvas.clientWidth).toBe(560);
    expect(repaints).toBe(0);
  });

  it('a corner drag grows the window, and the map fills the stage as a crisp square', async () => {
    const win = openMap();
    await settle();
    const before = win.getBoundingClientRect();
    dragCorner(win, 360, 260);
    await settle();
    const after = win.getBoundingClientRect();

    // Resized from its own top-left, not dragged across the screen.
    expect(win.classList.contains('window-sized')).toBe(true);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.width).toBeGreaterThan(before.width + 300);
    expect(after.height).toBeGreaterThan(before.height + 200);

    const canvas = canvasOf(win);
    const stage = win.querySelector<HTMLElement>('.map-atlas-stage')!;
    const face = Math.min(stage.clientWidth, stage.clientHeight);
    // Square, filling the stage's shorter axis (the 2px border sits outside).
    expect(canvas.clientWidth).toBe(canvas.clientHeight);
    expect(canvas.clientWidth).toBe(face - 4);
    expect(canvas.clientWidth).toBeGreaterThan(560);
    // The backing store follows the display box 1:1, and the map was repainted.
    expect(canvas.width).toBe(canvas.clientWidth);
    expect(canvas.height).toBe(canvas.clientHeight);
    expect(repaints).toBeGreaterThan(0);

    // The overlay controls ride the map face, not the stage corners.
    const faceRect = canvas.getBoundingClientRect();
    for (const sel of ['#map-close', '#map-level-toggle', '#map-zoom', '.map-atlas-compass']) {
      const el = win.querySelector<HTMLElement>(sel)!;
      expect(inside(el.getBoundingClientRect(), faceRect), sel).toBe(true);
    }
  });

  it('cannot shrink the map below a usable face beside the rail', async () => {
    const win = openMap();
    await settle();
    dragCorner(win, -2000, -2000);
    await settle();
    const rect = win.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(640);
    expect(rect.height).toBeGreaterThanOrEqual(360);
    const canvas = canvasOf(win);
    expect(canvas.width).toBe(canvas.clientWidth);
    // 640 wide minus the 300 px rail, its gutter and the padding leaves a face
    // just under 300 px: still a readable map.
    expect(canvas.clientWidth).toBeGreaterThanOrEqual(280);
  });

  it('the touch sheet never takes the grip, and keeps the shipped backing', async () => {
    document.body.classList.add('mobile-touch');
    const win = openMap();
    await settle();
    dragCorner(win, 300, 200);
    await settle();
    expect(win.classList.contains('window-sized')).toBe(false);
    expect(win.style.width).toBe('');
    expect(canvasOf(win).width).toBe(560);
  });

  it('dropping to the touch layout releases a desktop size so the sheet sizes itself', async () => {
    const win = openMap();
    await settle();
    dragCorner(win, 300, 200);
    await settle();
    expect(win.classList.contains('window-sized')).toBe(true);
    document.body.classList.add('mobile-touch');
    await settle();
    await settle();
    expect(win.classList.contains('window-sized')).toBe(false);
    expect(win.style.width).toBe('');
    expect(win.style.height).toBe('');
    expect(canvasOf(win).width).toBe(560);
  });
});

describe('atlas rail divider', () => {
  function dragDivider(win: HTMLElement, dx: number): void {
    const divider = win.querySelector<HTMLElement>('.map-atlas-splitter')!;
    const r = divider.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const fire = (type: string, cx: number, buttons: number): void => {
      divider.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: y,
          pointerId: 2,
          pointerType: 'mouse',
          button: 0,
          buttons,
        }),
      );
    };
    fire('pointerdown', x, 1);
    fire('pointermove', x + dx, 1);
    fire('pointerup', x + dx, 0);
  }

  it('sits in the gutter between the rail and the stage', async () => {
    const win = openMap();
    await settle();
    const rail = win.querySelector<HTMLElement>('.map-atlas-sidebar')!.getBoundingClientRect();
    const stage = win.querySelector<HTMLElement>('.map-atlas-stage')!.getBoundingClientRect();
    const divider = win.querySelector<HTMLElement>('.map-atlas-splitter')!.getBoundingClientRect();
    expect(rail.width).toBe(300);
    expect(divider.left).toBeCloseTo(rail.right, 0);
    expect(divider.right).toBeCloseTo(stage.left, 0);
  });

  it('widens the rail and grows an unsized window, so the map keeps its size', async () => {
    const win = openMap();
    await settle();
    const before = win.getBoundingClientRect().width;
    dragDivider(win, 140);
    await settle();
    const rail = win.querySelector<HTMLElement>('.map-atlas-sidebar')!.getBoundingClientRect();
    expect(rail.width).toBe(440);
    expect(win.getBoundingClientRect().width).toBeCloseTo(before + 140, 0);
    expect(canvasOf(win).clientWidth).toBe(560);
    expect(canvasOf(win).width).toBe(560);
    expect(storedRailWidth).toBe(440);
  });

  it('in a player-sized window the map yields to a wider rail and stays crisp', async () => {
    const win = openMap();
    await settle();
    dragCorner(win, 300, 200);
    await settle();
    const sizedWidth = win.getBoundingClientRect().width;
    const faceBefore = canvasOf(win).clientWidth;
    dragDivider(win, 200);
    await settle();
    expect(win.getBoundingClientRect().width).toBeCloseTo(sizedWidth, 0);
    const stage = win.querySelector<HTMLElement>('.map-atlas-stage')!;
    expect(canvasOf(win).clientWidth).toBe(Math.min(stage.clientWidth, stage.clientHeight) - 4);
    expect(canvasOf(win).clientWidth).toBeLessThanOrEqual(faceBefore);
    expect(canvasOf(win).width).toBe(canvasOf(win).clientWidth);
  });

  it('hides while the rail is collapsed', async () => {
    const win = openMap();
    win.querySelector('.map-atlas-sidebar')!.classList.add('is-collapsed');
    await settle();
    const divider = win.querySelector<HTMLElement>('.map-atlas-splitter')!;
    expect(getComputedStyle(divider).display).toBe('none');
  });
});
