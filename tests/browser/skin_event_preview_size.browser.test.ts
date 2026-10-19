import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { FocusTrapHandle } from '../../src/ui/focus_manager';
import { SkinEventController } from '../../src/ui/hud/cosmetics/skin_event_controller';
import { createPreviewStandIn } from '../../src/ui/preview_stand_in';
import type { IWorld } from '../../src/world_api';
import { cleanup } from './_harness';

// The skin-event preview host (.se-preview) must not take its size from the
// shared CharacterPreview canvas the HUD moves into it. CharacterPreview sizes
// its drawing buffer from the host's client box (renderer.setSize(w, h, false)
// writes width/height attributes of w*dpr x h*dpr) and re-syncs on every
// ResizeObserver tick. The host is `flex: 1` over only a min-height floor in an
// auto grid row, so an in-flow canvas lets that buffer feed back into the row
// on any pixel ratio above 1. The overlay mounts on <body>, outside the #ui
// zoom, so the UI Scale must not matter either.

vi.mock('../../src/render/characters/portrait', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/render/characters/portrait')>()),
  playerPortraitDataUrl: () => null,
  visualPortraitDataUrl: () => null,
}));

afterEach(() => {
  cleanup();
  for (const prop of ['--ui-scale', '--app-vw', '--app-vh']) {
    document.documentElement.style.removeProperty(prop);
  }
});

// Open the real controller and run its reveal, handing the preview host to
// `onStage` exactly where the HUD mounts the shared turntable.
function openSkinEvent(onStage: (stage: HTMLElement) => void, uiScale: number): void {
  const style = document.documentElement.style;
  style.setProperty('--ui-scale', String(uiScale));
  style.setProperty('--app-vw', `${window.innerWidth}px`);
  style.setProperty('--app-vh', `${window.innerHeight}px`);
  let reveal: (() => void) | null = null;
  const timers = {
    matchMedia: () => ({ matches: true }),
    setTimeout: (callback: () => void) => {
      reveal = callback;
      return 1;
    },
    clearTimeout: () => undefined,
  } as unknown as Window;
  const trap: FocusTrapHandle = {
    focusFirst: () => undefined,
    release: () => undefined,
    opener: () => null,
  };
  const noop = () => undefined;
  new SkinEventController({
    document,
    window: timers,
    world: () =>
      ({ cfg: { playerClass: 'warrior' }, claimEventSkin: noop }) as unknown as Pick<
        IWorld,
        'cfg' | 'claimEventSkin'
      >,
    closeTop: () => false,
    hideTooltip: noop,
    onPortraitsReady: noop,
    onPortraitUpdate: noop,
    preloadMechAssets: () => Promise.resolve(),
    preview: { mount: (container) => onStage(container), setSkin: noop },
    openFocusTrap: () => trap,
    attachTooltip: noop,
    showBanner: noop,
    renderBagsIfOpen: noop,
    random: () => 0.5,
    audio: { bagOpen: noop, bagClose: noop, click: noop, cosmeticUnlock: noop },
  }).open('rare');
  (reveal as (() => void) | null)?.();
}

// What CharacterPreview.syncSize does to the canvas at a given dpr.
function syncBuffer(stage: HTMLElement, canvas: HTMLCanvasElement, dpr: number): void {
  canvas.width = Math.floor(stage.clientWidth * dpr);
  canvas.height = Math.floor(stage.clientHeight * dpr);
}

function mountStage(uiScale: number): { stage: HTMLElement; canvas: HTMLCanvasElement } {
  let stage: HTMLElement | null = null;
  const canvas = document.createElement('canvas');
  openSkinEvent((el) => {
    stage = el;
    el.appendChild(canvas);
  }, uiScale);
  const container = stage as HTMLElement | null;
  if (!container) throw new Error('skin event preview host was not mounted');
  return { stage: container, canvas };
}

describe('skin event preview host sizing', () => {
  it.each([
    // Desktop two-column layout.
    { width: 1280, height: 900, uiScale: 1, dpr: 1 },
    { width: 1280, height: 900, uiScale: 1.25, dpr: 1.25 },
    { width: 1280, height: 900, uiScale: 1, dpr: 2 },
    // Short desktop (the max-height: 700px floor).
    { width: 1280, height: 660, uiScale: 0.8, dpr: 1.5 },
    // Narrow stacked layout (the max-width: 860px column with a scrolling body).
    { width: 820, height: 900, uiScale: 1.1, dpr: 2 },
  ])(
    'keeps the host size fixed at $width x $height, ui scale $uiScale, dpr $dpr',
    async ({ width, height, uiScale, dpr }) => {
      await page.viewport(width, height);
      const { stage, canvas } = mountStage(uiScale);
      const initial = { w: stage.clientWidth, h: stage.clientHeight };
      expect(initial.h).toBeGreaterThan(0);

      // Many sync rounds, as the ResizeObserver would drive them.
      for (let i = 0; i < 40; i++) syncBuffer(stage, canvas, dpr);
      expect({ w: stage.clientWidth, h: stage.clientHeight }).toEqual(initial);

      // A buffer far larger than the host still never moves it.
      canvas.width = 4000;
      canvas.height = 4000;
      expect({ w: stage.clientWidth, h: stage.clientHeight }).toEqual(initial);

      // The canvas paints the host box exactly, whatever its buffer size.
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      expect(canvasRect.width).toBeCloseTo(stageRect.width, 0);
      expect(canvasRect.height).toBeCloseTo(stageRect.height, 0);
    },
  );

  it('covers the host with the cold-open stand-in, above the canvas', async () => {
    await page.viewport(1280, 900);
    const { stage, canvas } = mountStage(1);
    syncBuffer(stage, canvas, 1);
    // What armPreviewOpen shows while the shared context links its programs.
    createPreviewStandIn(stage, { cls: 'warrior' }).show();
    const layer = stage.querySelector<HTMLElement>('.preview-stand-in');
    if (!layer) throw new Error('stand-in layer was not built');

    const stageRect = stage.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    expect(layerRect.top).toBeCloseTo(stageRect.top, 0);
    expect(layerRect.left).toBeCloseTo(stageRect.left, 0);
    expect(layerRect.width).toBeCloseTo(stageRect.width, 0);
    expect(layerRect.height).toBeCloseTo(stageRect.height, 0);
    // Stacked over the (positioned) canvas, so the crest is what shows.
    expect(Number(getComputedStyle(layer).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(canvas).zIndex) || 0,
    );
    // The drag hint stays over both the canvas and the stand-in.
    const hint = stage.querySelector<HTMLElement>('.se-preview-hint');
    expect(Number(hint ? getComputedStyle(hint).zIndex : Number.NaN)).toBeGreaterThan(
      Number(getComputedStyle(layer).zIndex),
    );
    // The crest is centred in the host, not clipped below the canvas.
    const img = layer.querySelector('img');
    const imgRect = img?.getBoundingClientRect();
    expect(imgRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(stageRect.bottom + 1);
    expect(imgRect?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(stageRect.width);
  });
});
