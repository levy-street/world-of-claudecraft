import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { InspectWindow } from '../../src/ui/inspect_window';
import { cleanup, host, stubDeps } from './_harness';

// The Profile (inspect) stage must not take its height from the preview canvas.
// CharacterPreview sizes its drawing buffer from the stage's client box
// (renderer.setSize(w, h, false) writes width/height attributes of w*dpr x h*dpr)
// and re-syncs on every ResizeObserver tick. On the desktop inspect window the
// stage height is only floored (min-height), so an in-flow canvas lets that
// buffer feed back into the stage: under the #ui zoom (the UI Scale setting)
// Firefox grew the stage a little on every sync, without bound, until the
// paperdoll sockets sat hundreds of pixels apart around a giant model.
//
// This suite runs Chromium only (vitest.browser.config.ts), which reproduces the
// sync-loop growth at one fractional scale; every floored case also fails on the
// tall-buffer and fill checks with the canvas in flow. The unbounded Firefox
// growth itself is evidenced by the Firefox before/after captures on the PR.

afterEach(() => {
  cleanup();
  document.body.className = '';
  for (const prop of ['--ui-scale', '--app-vw', '--app-vh']) {
    document.documentElement.style.removeProperty(prop);
  }
});

function mountInspect(onStage: (stage: HTMLElement) => void, uiScale: number): HTMLElement {
  // Inside the zoomed #ui, exactly where the HUD mounts it (index.html).
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const style = document.documentElement.style;
  style.setProperty('--ui-scale', String(uiScale));
  style.setProperty('--app-vw', `${window.innerWidth}px`);
  style.setProperty('--app-vh', `${window.innerHeight}px`);
  const root = host('inspect-window', 'window panel ui-window');
  ui.appendChild(root);
  new InspectWindow(
    stubDeps({
      root: () => root,
      slotName: (slot) => slot,
      captureFocus: () => null,
      showDevBadges: () => false,
      mountPreview: (stage: HTMLElement) => onStage(stage),
    }),
  ).openInspect(
    {
      templateId: 'paladin',
      name: 'Aurelia',
      level: 20,
      equippedItems: {},
      equippedInstances: {},
    },
    0,
  );
  return root;
}

// What CharacterPreview.syncSize does to the canvas at a given dpr.
function syncBuffer(stage: HTMLElement, canvas: HTMLCanvasElement, dpr: number): void {
  canvas.width = Math.floor(stage.clientWidth * dpr);
  canvas.height = Math.floor(stage.clientHeight * dpr);
}

describe('inspect model stage sizing', () => {
  it.each([
    { uiScale: 1, dpr: 1, mobile: false, width: 1022, height: 1100 },
    { uiScale: 1.25, dpr: 1, mobile: false, width: 1022, height: 1100 },
    { uiScale: 1.1, dpr: 2, mobile: false, width: 1022, height: 1100 },
    { uiScale: 0.8, dpr: 1.25, mobile: false, width: 1022, height: 1100 },
    // Touch: the floored landscape stage, and the fixed-height narrow stage
    // (never grew; kept to pin that the canvas still fills a fixed stage).
    { uiScale: 1.25, dpr: 2, mobile: true, width: 844, height: 390 },
    { uiScale: 1.25, dpr: 2, mobile: true, width: 390, height: 844 },
  ])(
    'keeps the stage size fixed at ui scale $uiScale, dpr $dpr, $width x $height',
    async ({ uiScale, dpr, mobile, width, height }) => {
      await page.viewport(width, height);
      if (mobile) document.body.className = 'mobile-touch game-active';
      let stage: HTMLElement | null = null;
      const canvas = document.createElement('canvas');
      mountInspect((el) => {
        stage = el;
        el.appendChild(canvas);
      }, uiScale);
      const container = stage as HTMLElement | null;
      if (!container) throw new Error('inspect stage was not mounted');
      const initial = { w: container.clientWidth, h: container.clientHeight };
      expect(initial.h).toBeGreaterThan(0);

      // Many sync rounds, as the ResizeObserver would drive them.
      for (let i = 0; i < 40; i++) syncBuffer(container, canvas, dpr);
      expect({ w: container.clientWidth, h: container.clientHeight }).toEqual(initial);

      // A buffer far taller than the stage still never moves it (a square one
      // would sit under the desktop min-height floor and prove nothing).
      canvas.width = Math.floor(initial.w * dpr);
      canvas.height = Math.floor(initial.h * dpr) * 20;
      expect({ w: container.clientWidth, h: container.clientHeight }).toEqual(initial);

      // The canvas paints the stage box exactly, whatever its buffer size.
      const stageRect = container.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      expect(canvasRect.width).toBeCloseTo(stageRect.width, 0);
      expect(canvasRect.height).toBeCloseTo(stageRect.height, 0);
    },
  );

  it('keeps the cold-open stand-in over the canvas whatever the mount order', async () => {
    await page.viewport(1022, 1100);
    let stage: HTMLElement | null = null;
    mountInspect((el) => {
      stage = el;
    }, 1);
    const container = stage as HTMLElement | null;
    if (!container) throw new Error('inspect stage was not mounted');
    // setContainer re-appends the canvas on a remount, so it can land AFTER a
    // live stand-in. pointer-events is re-enabled only so elementFromPoint can
    // see the stand-in; the stylesheet keeps it click-through in the game.
    const standIn = document.createElement('div');
    standIn.className = 'preview-stand-in';
    standIn.style.pointerEvents = 'auto';
    container.appendChild(standIn);
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const rect = container.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit).toBe(standIn);
  });
});
