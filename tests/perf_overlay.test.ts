// Regression guard for the perf-overlay DOM consumer (src/ui/perf_overlay.ts).
//
// The frame-time sparkline canvas must NEVER pin its own CSS width to an absolute
// pixel value. Doing so makes the canvas prop the shrink-wrapped panel open: the
// next `rowsEl.clientWidth` read stays wide, so switching the metric set from
// "Everything" back to "Minimal" left the graph stuck at the expanded width (only
// a full overlay off/on cleared it). The canvas follows the panel via CSS
// `width:100%` instead, so it can never inflate the measurement it is sized from.
//
// Vitest runs in plain Node here (no jsdom), so we hand-roll the minimal DOM the
// consumer touches, mirroring the stub style of tests/input.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PerfOverlay } from '../src/ui/perf_overlay';
import { defaultPerfOverlayConfig } from '../src/ui/perf_overlay_config';
import type { PerfOverlayView } from '../src/ui/perf_overlay_model';

function fakeStyle(): any {
  const store: Record<string, string> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop === 'setProperty')
        return (n: string, v: string) => {
          target[n] = v;
        };
      return target[prop] ?? '';
    },
    set(target, prop: string, value: string) {
      target[prop] = value;
      return true;
    },
  });
}

// One fake element covers div + canvas; `clientWidth` simulates a wide panel.
function fakeEl(tag: string, clientWidth: number): any {
  return {
    tagName: tag,
    className: '',
    textContent: '',
    style: fakeStyle(),
    dataset: {} as Record<string, string>,
    width: 0,
    height: 0,
    clientWidth,
    childElementCount: 0,
    offsetWidth: clientWidth,
    offsetHeight: 40,
    offsetParent: null,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    replaceChildren() {},
    append() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    // getBoundingClientRect() reports VISUAL (post-#ui-zoom) space, unlike
    // offsetWidth/offsetHeight above, which stay AUTHOR-space under a CSS `zoom`
    // ancestor (confirmed live against the real client: see perf_overlay.ts's
    // visualSize() comment). Modeling that divergence here is what lets the UI
    // Scale describe block below actually exercise the bug it regression-guards.
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: clientWidth * uiScaleStub,
        height: 40 * uiScaleStub,
      };
    },
    getContext() {
      // A no-op 2D context: every method is a stub, every prop a sink.
      return new Proxy({}, { get: () => () => {} });
    },
  };
}

const WIDE = 320;

// The live UI Scale getUiScale() reads back through getComputedStyle('--ui-scale'),
// mirroring the tests/movable_frame.test.ts stub. Default 1 keeps every existing
// assertion a no-op; the positioning describe below drives it to a reduced value to
// prove the corner write divides into #ui author space.
let uiScaleStub = 1;

beforeEach(() => {
  uiScaleStub = 1;
});

function makeOverlay(hostWidth = WIDE) {
  (globalThis as any).window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    addEventListener() {},
  };
  (globalThis as any).document = {
    createElement: (tag: string) => fakeEl(tag, WIDE),
    documentElement: {},
  };
  (globalThis as any).getComputedStyle = () => ({
    getPropertyValue: (p: string) => (p === '--ui-scale' ? String(uiScaleStub) : ''),
  });
  (globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const host = fakeEl('div', hostWidth);
  const overlay = new PerfOverlay(host);
  overlay.setEnabled(true);
  overlay.applyConfig(defaultPerfOverlayConfig());
  // The canvas is the 3rd child appended in the constructor; grab it back.
  const canvas = (overlay as any).canvas as ReturnType<typeof fakeEl>;
  return { overlay, canvas };
}

function viewWithGraph(): PerfOverlayView {
  return {
    rows: [],
    badges: [],
    graph: { samples: [16, 17, 16, 18, 16, 17], targetMs: 1000 / 60 },
  };
}

describe('PerfOverlay graph sizing', () => {
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).getComputedStyle;
    delete (globalThis as any).localStorage;
  });

  it('never pins an absolute pixel CSS width on the canvas (display size is CSS-driven)', () => {
    const { overlay, canvas } = makeOverlay();
    overlay.render(viewWithGraph());
    // Pinning `<measured>px` here is what let the canvas prop the panel open; the
    // canvas display size now comes from CSS (`position:absolute; width:100%`).
    expect(canvas.style.width.endsWith('px')).toBe(false);
  });

  it('toggles the graph wrapper, not the canvas, so hidden it reserves no width', () => {
    const { overlay } = makeOverlay();
    const wrap = (overlay as any).graphWrap as { style: { display: string } };
    overlay.render({ rows: [], badges: [], graph: { samples: [16], targetMs: 1000 / 60 } });
    expect(wrap.style.display).toBe('none'); // <2 samples => hidden
    overlay.render(viewWithGraph());
    expect(wrap.style.display).toBe('block');
  });

  it('still scales the backing store from the measured width and DPR', () => {
    const { overlay, canvas } = makeOverlay();
    overlay.render(viewWithGraph());
    // dpr clamped to 2; backing pixels = measured CSS width * dpr.
    expect(canvas.width).toBe(WIDE * 2);
    expect(canvas.height).toBe(26 * 2);
  });
});

// Regression guard for the reported bug: at a reduced UI Scale (interface shrunk via
// the Options > Interface slider), the overlay could not be placed flush in a screen
// corner while every other movable window (movable_frame.ts) still could. Root cause:
// #perf-overlay lives inside #ui (`zoom: var(--ui-scale)`, src/styles/hud.css), which
// gives every #ui descendant TWO coordinate spaces: AUTHOR (offsetWidth/offsetHeight,
// style.left/top writes) and VISUAL (getBoundingClientRect(), pointer clientX/clientY,
// the zoom-re-multiplied render). reposition()/onPointerMove() computed their clamp
// from a MIX of the two (a visual viewport against an author-space element size,
// confirmed live: offsetWidth 116 vs getBoundingClientRect().width 98.4 at UI Scale
// 0.85) and then wrote the visual clamp straight to style.left/top with no scale
// division at all, so at uiScale != 1 the panel fell short of (or overflowed) the
// true corner. The fake DOM below models that same offsetWidth/getBoundingClientRect
// divergence (see fakeEl's getBoundingClientRect comment), so these numbers only
// come out flush against the fixture's own corner when BOTH the clamp's size input
// and the final write are correctly all-visual / all-author respectively.
const HOST_W = 200; // author width; a multiple of 20 so *0.85 stays integral below
describe('PerfOverlay author-space placement under UI Scale (#ui zoom compensation)', () => {
  const VW = 1028;
  const VH = 722;

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).getComputedStyle;
    delete (globalThis as any).localStorage;
  });

  function bottomRightCorner(overlay: ReturnType<typeof makeOverlay>['overlay']) {
    (globalThis as any).window.innerWidth = VW;
    (globalThis as any).window.innerHeight = VH;
    overlay.applyConfig({ ...defaultPerfOverlayConfig(), posX: 1, posY: 1 });
    return (overlay as any).el as { style: { left: string; top: string } };
  }

  it('at UI Scale 1 (default) the corner write is unaffected (regression baseline)', () => {
    const { overlay } = makeOverlay(HOST_W);
    const el = bottomRightCorner(overlay);
    // parent (window fallback) 1028x722, overlay visual size 200x40 (scale 1, so
    // author == visual), 8px margin: availX = 1028-200-16 = 812; left = 8+812 = 820.
    // availY = 722-40-16 = 666; top = 8+666 = 674.
    expect(el.style.left).toBe('820px');
    expect(el.style.top).toBe('674px');
  });

  it('at a reduced UI Scale (0.85) the corner write divides into #ui author space, so it still lands flush at the true visual corner', () => {
    uiScaleStub = 0.85;
    const { overlay } = makeOverlay(HOST_W);
    const el = bottomRightCorner(overlay);
    // Visual overlay size is now 200*0.85=170 / 40*0.85=34 (the getBoundingClientRect
    // the clamp must use, not the unscaled 200x40 offsetWidth/offsetHeight).
    // availX = 1028-170-16 = 842; left(visual) = 8+842 = 850. Author write: 850/0.85 = 1000.
    // availY = 722-34-16 = 672; top(visual) = 8+672 = 680. Author write: 680/0.85 = 800.
    // (An unfixed clamp that mixed in the unscaled 200x40 size, or skipped the
    // division on the write, both land short of these numbers.)
    expect(el.style.left).toBe('1000px');
    expect(el.style.top).toBe('800px');
  });

  it('a live drag write divides into #ui author space at a reduced UI Scale, while the persisted fraction stays scale-invariant', () => {
    uiScaleStub = 0.85;
    const { overlay } = makeOverlay(HOST_W);
    (globalThis as any).window.innerWidth = VW;
    (globalThis as any).window.innerHeight = VH;
    overlay.setPlacementMode(true);
    const el = (overlay as any).el as { style: { left: string; top: string } };
    let changed: [number, number] | null = null;
    overlay.onPositionChange = (x, y) => {
      changed = [x, y];
    };
    // Grab offset from the host's visual rect (0,0,170,34) at UI Scale 0.85:
    // pointerdown at (10,10) => grabDX/DY (10,10).
    (overlay as any).onPointerDown({ clientX: 10, clientY: 10, pointerId: 1, preventDefault() {} });
    // Drag far past the corner; the VISUAL clamp caps left/top at 850/680 (matching
    // bottomRightCorner() above), written as the author-space 1000/800.
    (overlay as any).onPointerMove({ clientX: 2000, clientY: 2000, pointerId: 1 });
    expect(el.style.left).toBe('1000px'); // 850 / 0.85
    expect(el.style.top).toBe('800px'); // 680 / 0.85
    (overlay as any).onPointerUp({ pointerId: 1 });
    // The dropped fraction is derived from the VISUAL (undivided) clamp, so it is the
    // same 1,1 corner fraction regardless of UI Scale, and renders back correctly at
    // any scale after a reload.
    expect(changed).toEqual([1, 1]);
  });
});
