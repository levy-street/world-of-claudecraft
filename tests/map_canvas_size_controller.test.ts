// The map canvas size controller over a fake canvas and a fake ResizeObserver:
// a sized desktop window gets a backing store that follows the displayed box
// (with one repaint per real change), anything else keeps the shipped 560.
import { afterEach, describe, expect, it } from 'vitest';
import {
  MapCanvasSizeController,
  mapWindowPlayerSized,
  mapWindowSizeIsStale,
} from '../src/ui/hud/map/map_canvas_size_controller';

type ObserverCallback = (
  entries: { contentBoxSize: { inlineSize: number; blockSize: number }[] }[],
) => void;

const g = globalThis as { ResizeObserver?: unknown };
const realObserver = g.ResizeObserver;
afterEach(() => {
  g.ResizeObserver = realObserver;
});

function rig(sized: boolean) {
  const canvas = { width: 560, height: 560 } as HTMLCanvasElement;
  let callback: ObserverCallback | null = null;
  const observed: unknown[] = [];
  let disconnected = false;
  g.ResizeObserver = class {
    constructor(cb: ObserverCallback) {
      callback = cb;
    }
    observe(target: unknown) {
      observed.push(target);
    }
    disconnect() {
      disconnected = true;
    }
  };
  const state = { sized, resizing: false, releases: 0, repaints: 0 };
  const controller = new MapCanvasSizeController({
    canvas,
    sized: () => state.sized,
    resizing: () => state.resizing,
    releaseStaleSize: () => {
      state.releases += 1;
    },
    repaint: () => {
      state.repaints += 1;
    },
  });
  controller.install();
  const deliver = (inlineSize: number, blockSize: number) =>
    callback?.([{ contentBoxSize: [{ inlineSize, blockSize }] }]);
  return { canvas, controller, deliver, observed, state, disconnected: () => disconnected };
}

describe('MapCanvasSizeController', () => {
  it('observes the canvas once', () => {
    const r = rig(true);
    r.controller.install();
    expect(r.observed).toEqual([r.canvas]);
  });

  it('follows the displayed box on a sized window and repaints once per change', () => {
    const r = rig(true);
    r.deliver(812, 812);
    expect([r.canvas.width, r.canvas.height]).toEqual([812, 812]);
    expect(r.state.repaints).toBe(1);
    r.deliver(812, 812);
    expect(r.state.repaints).toBe(1);
    r.deliver(700, 900);
    expect([r.canvas.width, r.canvas.height]).toEqual([700, 700]);
    expect(r.state.repaints).toBe(2);
  });

  it('keeps the shipped 560 store while the window is not player-sized', () => {
    const r = rig(false);
    r.deliver(330, 330); // the touch sheet CSS-scales the canvas down
    expect(r.canvas.width).toBe(560);
    expect(r.state.repaints).toBe(0);
  });

  it('returns to 560 when the size is cleared, and ignores a hidden window', () => {
    const r = rig(true);
    r.deliver(900, 900);
    r.deliver(0, 0); // display: none
    expect(r.canvas.width).toBe(900);
    r.state.sized = false;
    r.deliver(560, 560);
    expect(r.canvas.width).toBe(560);
    expect(r.state.repaints).toBe(2);
  });

  it('disconnects on dispose, and a host without ResizeObserver keeps the shipped size', () => {
    const r = rig(true);
    r.controller.dispose();
    expect(r.disconnected()).toBe(true);
    g.ResizeObserver = undefined;
    const canvas = { width: 560, height: 560 } as HTMLCanvasElement;
    new MapCanvasSizeController({
      canvas,
      sized: () => true,
      resizing: () => false,
      releaseStaleSize: () => {},
      repaint: () => {},
    }).install();
    expect(canvas.width).toBe(560);
  });

  it('defers the backing write during a live resize drag, then applies the last box once', () => {
    const r = rig(true);
    r.state.resizing = true;
    r.deliver(700, 700);
    r.deliver(820, 820);
    r.deliver(900, 900);
    expect(r.canvas.width).toBe(560);
    expect(r.state.repaints).toBe(0);
    r.controller.flush(); // still dragging: nothing yet
    expect(r.state.repaints).toBe(0);
    r.state.resizing = false;
    r.controller.flush();
    expect([r.canvas.width, r.canvas.height]).toEqual([900, 900]);
    expect(r.state.repaints).toBe(1);
    r.controller.flush(); // nothing left to apply
    expect(r.state.repaints).toBe(1);
  });

  it('offers a stale desktop size for release before every size decision', () => {
    const r = rig(true);
    r.deliver(700, 700);
    r.state.resizing = true;
    r.deliver(800, 800);
    expect(r.state.releases).toBe(2);
  });
});

describe('map window size flags', () => {
  it('a player-sized map is a sized window on the desktop layout only', () => {
    expect(mapWindowPlayerSized({ windowSized: true, touch: false })).toBe(true);
    expect(mapWindowPlayerSized({ windowSized: true, touch: true })).toBe(false);
    expect(mapWindowPlayerSized({ windowSized: false, touch: false })).toBe(false);
    expect(mapWindowPlayerSized({ windowSized: false, touch: true })).toBe(false);
  });

  it('a desktop size is stale once the HUD is in the touch layout', () => {
    expect(mapWindowSizeIsStale({ windowSized: true, touch: true })).toBe(true);
    expect(mapWindowSizeIsStale({ windowSized: true, touch: false })).toBe(false);
    expect(mapWindowSizeIsStale({ windowSized: false, touch: true })).toBe(false);
    expect(mapWindowSizeIsStale({ windowSized: false, touch: false })).toBe(false);
  });
});
