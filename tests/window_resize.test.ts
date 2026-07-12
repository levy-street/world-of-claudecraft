import { describe, expect, it } from 'vitest';
import {
  installWindowResize,
  isResizableWindow,
  markResizableWindow,
} from '../src/ui/window_resize';
import {
  isInResizeCorner,
  RESIZE_CORNER_BAND,
  RESIZE_CORNER_BAND_TOUCH,
  RESIZE_ENGAGE_SLOP,
  RESIZE_ENGAGE_SLOP_TOUCH,
  resizedWindowSize,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_RESIZE_MARGIN,
} from '../src/ui/window_resize_core';

const LIMITS = {
  viewportWidth: 1280,
  viewportHeight: 800,
  minWidth: WINDOW_MIN_WIDTH,
  minHeight: WINDOW_MIN_HEIGHT,
  margin: WINDOW_RESIZE_MARGIN,
};

describe('isInResizeCorner', () => {
  const rect = { right: 700, bottom: 500 };

  it('hits inside the SE band and misses outside it', () => {
    expect(isInResizeCorner(rect, 695, 495, RESIZE_CORNER_BAND)).toBe(true);
    expect(
      isInResizeCorner(
        rect,
        700 - RESIZE_CORNER_BAND,
        500 - RESIZE_CORNER_BAND,
        RESIZE_CORNER_BAND,
      ),
    ).toBe(true);
    // Left of the band, above the band, and past the window edge all miss.
    expect(isInResizeCorner(rect, 700 - RESIZE_CORNER_BAND - 1, 495, RESIZE_CORNER_BAND)).toBe(
      false,
    );
    expect(isInResizeCorner(rect, 695, 500 - RESIZE_CORNER_BAND - 1, RESIZE_CORNER_BAND)).toBe(
      false,
    );
    expect(isInResizeCorner(rect, 701, 495, RESIZE_CORNER_BAND)).toBe(false);
    expect(isInResizeCorner(rect, 695, 501, RESIZE_CORNER_BAND)).toBe(false);
  });

  it('the touch band is wider than the fine-pointer band', () => {
    const x = 700 - RESIZE_CORNER_BAND_TOUCH + 1;
    const y = 500 - RESIZE_CORNER_BAND_TOUCH + 1;
    expect(isInResizeCorner(rect, x, y, RESIZE_CORNER_BAND)).toBe(false);
    expect(isInResizeCorner(rect, x, y, RESIZE_CORNER_BAND_TOUCH)).toBe(true);
  });
});

describe('resizedWindowSize', () => {
  const start = { left: 100, top: 80, width: 400, height: 300 };

  it('applies the drag delta directly when unclamped', () => {
    expect(resizedWindowSize(start, 60, -40, LIMITS)).toEqual({ width: 460, height: 260 });
  });

  it('clamps down to the minimum size', () => {
    expect(resizedWindowSize(start, -1000, -1000, LIMITS)).toEqual({
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    });
  });

  it('clamps up to the viewport minus position and margin', () => {
    expect(resizedWindowSize(start, 5000, 5000, LIMITS)).toEqual({
      width: LIMITS.viewportWidth - start.left - WINDOW_RESIZE_MARGIN,
      height: LIMITS.viewportHeight - start.top - WINDOW_RESIZE_MARGIN,
    });
  });

  it('keeps the minimum when the window sits too close to the edge for it', () => {
    const nearEdge = { left: 1200, top: 760, width: 300, height: 200 };
    expect(resizedWindowSize(nearEdge, 500, 500, LIMITS)).toEqual({
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    });
  });

  it('rounds fractional author-space sizes to whole pixels', () => {
    expect(resizedWindowSize(start, 10.4, 10.6, LIMITS)).toEqual({ width: 410, height: 311 });
  });
});

describe('isResizableWindow', () => {
  const el = (id: string) => ({ id }) as HTMLElement;

  it('excludes fixed-size boards, popups, and modal prompts', () => {
    for (const id of [
      'map-window',
      'loot-window',
      'confirm-dialog',
      'mobile-extra-controls',
      'lockpick-panel',
      'emote-editor',
    ]) {
      expect(isResizableWindow(el(id))).toBe(false);
    }
  });

  it('allows the content windows', () => {
    for (const id of ['char-window', 'quest-log-window', 'market-window', 'bags', 'spellbook']) {
      expect(isResizableWindow(el(id))).toBe(true);
    }
  });
});

describe('markResizableWindow', () => {
  const fake = (id: string) => {
    const added: string[] = [];
    return {
      el: { id, classList: { add: (c: string) => added.push(c) } } as unknown as HTMLElement,
      added,
    };
  };

  it('stamps the grip class on resizable windows only', () => {
    const win = fake('char-window');
    markResizableWindow(win.el);
    expect(win.added).toEqual(['window-resizable']);
    const excluded = fake('map-window');
    markResizableWindow(excluded.el);
    expect(excluded.added).toEqual([]);
  });
});

describe('RESIZE_ENGAGE_SLOP', () => {
  it('is a small positive travel threshold (a tap must not resize)', () => {
    expect(RESIZE_ENGAGE_SLOP).toBeGreaterThan(0);
    expect(RESIZE_ENGAGE_SLOP).toBeLessThan(RESIZE_CORNER_BAND);
  });

  it('the touch slop covers finger tap wobble and stays inside the touch band', () => {
    expect(RESIZE_ENGAGE_SLOP_TOUCH).toBeGreaterThan(RESIZE_ENGAGE_SLOP);
    // Browsers budget roughly 10px of internal tap slop; ours must not be under it.
    expect(RESIZE_ENGAGE_SLOP_TOUCH).toBeGreaterThanOrEqual(8);
    expect(RESIZE_ENGAGE_SLOP_TOUCH).toBeLessThan(RESIZE_CORNER_BAND_TOUCH);
  });
});

// Fake-DOM harness for the controller (this repo deliberately has no jsdom;
// tests/CLAUDE.md: model only the contract under test). The element and
// document stubs cover exactly what installWindowResize touches.
describe('installWindowResize tap safety', () => {
  // Window at (100,100), 400x300 author px, scale 1: SE client corner (500,400).
  const CORNER = { x: 495, y: 395 };

  const setup = () => {
    const classes = new Set<string>(['window', 'panel']);
    const el: any = {
      id: 'quest-log-window',
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
      clientLeft: 0,
      clientTop: 0,
      clientWidth: 400,
      clientHeight: 300,
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 300 }),
      closest: (sel: string) => (sel.includes('.window.panel') ? el : null),
      setPointerCapture: () => {},
    };
    const listeners = new Map<string, ((ev: any) => void)[]>();
    const doc: any = {
      querySelectorAll: () => [el],
      addEventListener: (type: string, fn: (ev: any) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener: (type: string, fn: (ev: any) => void) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn),
        );
      },
    };
    const g = globalThis as any;
    const prevDoc = g.document;
    const prevWin = g.window;
    g.document = doc;
    g.window = { innerWidth: 1280, innerHeight: 800 };
    const pins: unknown[] = [];
    const teardown = installWindowResize({
      getScale: () => 1,
      pinWindow: (_target, rect) => pins.push(rect),
      isCoarsePointer: () => false,
    });
    const fire = (type: string, ev: Record<string, unknown>) => {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn({
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
          target: el,
          preventDefault: () => {},
          ...ev,
        });
      }
    };
    const restore = () => {
      teardown();
      g.document = prevDoc;
      g.window = prevWin;
    };
    return { el, pins, fire, restore };
  };

  it('a sub-slop tap in the corner band leaves the window completely untouched', () => {
    const { el, pins, fire, restore } = setup();
    try {
      fire('pointerdown', { clientX: CORNER.x, clientY: CORNER.y });
      fire('pointermove', { clientX: CORNER.x + RESIZE_ENGAGE_SLOP - 1, clientY: CORNER.y });
      fire('pointerup', { clientX: CORNER.x + RESIZE_ENGAGE_SLOP - 1, clientY: CORNER.y });
      expect(pins).toHaveLength(0);
      expect(el.style).toEqual({});
      expect(el.dataset).toEqual({});
      expect(el.classList.contains('window-resizing')).toBe(false);
    } finally {
      restore();
    }
  });

  it('engaging past the slop pins once, stamps windowMoved, and resizes', () => {
    const { el, pins, fire, restore } = setup();
    try {
      fire('pointerdown', { clientX: CORNER.x, clientY: CORNER.y });
      fire('pointermove', { clientX: CORNER.x + RESIZE_ENGAGE_SLOP, clientY: CORNER.y });
      expect(pins).toHaveLength(1);
      expect(el.dataset.windowMoved).toBe('1');
      expect(el.classList.contains('window-resizing')).toBe(true);
      // The engaged drag resizes from the engage-time baseline (400x300).
      fire('pointermove', { clientX: CORNER.x + RESIZE_ENGAGE_SLOP + 30, clientY: CORNER.y + 20 });
      expect(el.style.width).toBe('430px');
      expect(el.style.height).toBe('320px');
      fire('pointerup', {});
      expect(el.classList.contains('window-resizing')).toBe(false);
      expect(el.style.width).toBe('430px');
    } finally {
      restore();
    }
  });

  it('touch needs the wider slop before engaging', () => {
    const { pins, fire, restore } = setup();
    try {
      fire('pointerdown', { pointerType: 'touch', clientX: CORNER.x, clientY: CORNER.y });
      // Past the mouse slop but inside the touch slop: still a tap, not a resize.
      fire('pointermove', {
        pointerType: 'touch',
        clientX: CORNER.x + RESIZE_ENGAGE_SLOP_TOUCH - 1,
        clientY: CORNER.y,
      });
      expect(pins).toHaveLength(0);
      fire('pointermove', {
        pointerType: 'touch',
        clientX: CORNER.x + RESIZE_ENGAGE_SLOP_TOUCH,
        clientY: CORNER.y,
      });
      expect(pins).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('a pending session bails when no buttons are down (swallowed pointerup)', () => {
    const { el, pins, fire, restore } = setup();
    try {
      fire('pointerdown', { clientX: CORNER.x, clientY: CORNER.y });
      fire('pointermove', { clientX: CORNER.x, clientY: CORNER.y, buttons: 0 });
      // The session is gone: a later far move must not engage a resize.
      fire('pointermove', { clientX: CORNER.x + 100, clientY: CORNER.y + 100 });
      expect(pins).toHaveLength(0);
      expect(el.style).toEqual({});
      expect(el.dataset).toEqual({});
    } finally {
      restore();
    }
  });
});
