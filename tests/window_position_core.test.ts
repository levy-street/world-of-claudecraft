// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { windowPixelPosition } from '../src/ui/window_position_core';

interface WindowPositionHudHarness {
  initWindowManagement(): void;
  placeNewWindow(el: HTMLElement): void;
  setWindowPixelPosition(el: HTMLElement, left: number, top: number, rect?: DOMRect): void;
  syncWindowOpenState(el: HTMLElement): void;
  isWindowVisible(el: HTMLElement): boolean;
  syncAnyWindowOpenState(): void;
  windowObserver: MutationObserver | null;
  windowZ: number;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function windowElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): { el: HTMLElement; readRect: ReturnType<typeof vi.fn> } {
  const el = document.createElement('section');
  el.id = id;
  el.classList.add('window', 'panel');
  const readRect = vi.fn(() => {
    const currentLeft = Number.parseFloat(el.style.left) || left;
    const currentTop = Number.parseFloat(el.style.top) || top;
    return {
      x: currentLeft,
      y: currentTop,
      left: currentLeft,
      top: currentTop,
      right: currentLeft + width,
      bottom: currentTop + height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  });
  el.getBoundingClientRect = readRect;
  return { el, readRect };
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--ui-scale');
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('windowPixelPosition', () => {
  it('clamps a cascaded window back inside a smaller viewport', () => {
    expect(
      windowPixelPosition({
        left: 1_921,
        top: 1_024,
        width: 310,
        height: 408,
        viewportWidth: 1_707,
        viewportHeight: 960,
        scale: 1,
      }),
    ).toEqual({ left: 1_389, top: 544 });
  });

  it('converts visual coordinates and bounds into author space under UI zoom', () => {
    expect(
      windowPixelPosition({
        left: 1_500,
        top: 1_050,
        width: 800,
        height: 600,
        viewportWidth: 1_920,
        viewportHeight: 1_200,
        scale: 2,
      }),
    ).toEqual({ left: 552, top: 292 });
  });

  it('keeps windows inside the top and left margins', () => {
    expect(
      windowPixelPosition({
        left: -100,
        top: -50,
        width: 310,
        height: 408,
        viewportWidth: 1_707,
        viewportHeight: 960,
        scale: 1,
      }),
    ).toEqual({ left: 8, top: 8 });
  });

  it('anchors oversized windows at the available viewport margin', () => {
    expect(
      windowPixelPosition({
        left: 80,
        top: 60,
        width: 500,
        height: 300,
        viewportWidth: 200,
        viewportHeight: 120,
        scale: 1,
      }),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe('Hud window pixel positioning', () => {
  it('marks automatically positioned windows for viewport resize re-clamping', () => {
    setViewport(1_280, 800);
    const el = {
      dataset: {},
      style: {},
    } as unknown as HTMLElement;
    const rect = { width: 310, height: 408 } as DOMRect;
    const hud = Object.create(Hud.prototype) as unknown as WindowPositionHudHarness;

    hud.setWindowPixelPosition(el, 1_921, 1_024, rect);

    expect(el.dataset.windowMoved).toBe('1');
    expect(el.style.left).toBe('962px');
    expect(el.style.top).toBe('384px');
  });

  it('re-clamps a cascaded Bag after resize and reopen without touching ineligible windows', () => {
    setViewport(2_560, 1_440);
    document.documentElement.style.setProperty('--ui-scale', '1');

    const other = windowElement('char-window', 100, 100, 500, 600);
    const bag = windowElement('bags', 1_893, 996, 310, 408);
    const unmarked = windowElement('quest-log-window', 111, 222, 400, 500);
    const hiddenMarked = windowElement('spellbook-window', 333, 444, 420, 520);
    unmarked.el.hidden = true;
    hiddenMarked.el.hidden = true;
    hiddenMarked.el.dataset.windowMoved = '1';
    unmarked.el.style.left = '111px';
    unmarked.el.style.top = '222px';
    hiddenMarked.el.style.left = '333px';
    hiddenMarked.el.style.top = '444px';
    document.body.append(other.el, bag.el, unmarked.el, hiddenMarked.el);

    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const hud = Object.create(Hud.prototype) as unknown as WindowPositionHudHarness;
    Object.assign(hud, {
      windowObserver: null,
      windowZ: 50,
      isWindowVisible: (el: HTMLElement) => !el.hidden,
      syncAnyWindowOpenState: vi.fn(),
    });

    hud.initWindowManagement();
    const resizeListener = addWindowListener.mock.calls.find(([type]) => type === 'resize')?.[1];
    expect(typeof resizeListener).toBe('function');

    hud.placeNewWindow(bag.el);
    expect(bag.el.dataset.windowMoved).toBe('1');
    expect(bag.el.style.left).toBe('1921px');
    expect(bag.el.style.top).toBe('1024px');

    unmarked.el.hidden = false;
    setViewport(1_707, 960);
    if (typeof resizeListener === 'function') resizeListener.call(window, new Event('resize'));

    expect(bag.el.style.left).toBe('1389px');
    expect(bag.el.style.top).toBe('544px');
    expect(unmarked.el.style.left).toBe('111px');
    expect(unmarked.el.style.top).toBe('222px');
    expect(unmarked.readRect).not.toHaveBeenCalled();
    expect(hiddenMarked.el.style.left).toBe('333px');
    expect(hiddenMarked.el.style.top).toBe('444px');
    expect(hiddenMarked.readRect).not.toHaveBeenCalled();

    bag.el.hidden = true;
    delete bag.el.dataset.windowOpen;
    bag.el.style.left = '1921px';
    bag.el.style.top = '1024px';
    if (typeof resizeListener === 'function') resizeListener.call(window, new Event('resize'));
    expect(bag.el.style.left).toBe('1921px');
    expect(bag.el.style.top).toBe('1024px');

    bag.el.hidden = false;
    hud.syncWindowOpenState(bag.el);
    expect(bag.el.dataset.windowOpen).toBe('1');
    expect(bag.el.style.left).toBe('1389px');
    expect(bag.el.style.top).toBe('544px');
  });
});
