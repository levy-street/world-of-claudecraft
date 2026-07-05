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
      if (prop === 'setProperty') return (n: string, v: string) => { target[n] = v; };
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
    getBoundingClientRect() { return { left: 0, top: 0, width: clientWidth, height: 40 }; },
    getContext() {
      // A no-op 2D context: every method is a stub, every prop a sink.
      return new Proxy({}, { get: () => () => {} });
    },
  };
}

const WIDE = 320;

function makeOverlay() {
  (globalThis as any).window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, addEventListener() {} };
  (globalThis as any).document = { createElement: (tag: string) => fakeEl(tag, WIDE) };
  const host = fakeEl('div', WIDE);
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
