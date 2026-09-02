import { describe, expect, it } from 'vitest';
import {
  allocatedResolutionEquals,
  createResizeCoalescer,
  drawingBufferExtent,
} from '../src/render/resize_coalesce_core';

// Node-only (RENDER_PURE_CORES): no Three, no DOM, no requestAnimationFrame.
function fakeFrames(): { schedule: (cb: () => void) => void; run(): number } {
  const queued: Array<() => void> = [];
  return {
    schedule: (cb) => {
      queued.push(cb);
    },
    run(): number {
      const batch = queued.splice(0, queued.length);
      for (const cb of batch) cb();
      return batch.length;
    },
  };
}

describe('drawingBufferExtent', () => {
  it('floors the way WebGLRenderer.setSize does', () => {
    expect(drawingBufferExtent(1920, 1080, 1)).toEqual({ width: 1920, height: 1080 });
    expect(drawingBufferExtent(1920, 1080, 2)).toEqual({ width: 3840, height: 2160 });
    // 1.75 is the shipped composer-tier DPR cap: the fractional product floors,
    // and a rounding difference here would reallocate on every pass.
    expect(drawingBufferExtent(1281, 721, 1.75)).toEqual({ width: 2241, height: 1261 });
  });

  it('never reports a zero-sized buffer', () => {
    expect(drawingBufferExtent(0, 0, 1)).toEqual({ width: 1, height: 1 });
    expect(drawingBufferExtent(1, 1, 0.25)).toEqual({ width: 1, height: 1 });
  });

  it('compares both axes and the ratio, and treats a missing resolution as different', () => {
    const at = (w: number, h: number, r: number) => ({
      ...drawingBufferExtent(w, h, r),
      pixelRatio: r,
    });
    const a = at(1920, 1080, 1);
    expect(allocatedResolutionEquals(a, at(1920, 1080, 1))).toBe(true);
    expect(allocatedResolutionEquals(a, at(1921, 1080, 1))).toBe(false);
    expect(allocatedResolutionEquals(a, at(1920, 1081, 1))).toBe(false);
    // Same extent, different ratio: browser zoom, and the renderer's own pixel
    // ratio still has to be rewritten.
    expect(allocatedResolutionEquals(a, at(1280, 720, 1.5))).toBe(false);
    expect(allocatedResolutionEquals(null, a)).toBe(false);
    expect(allocatedResolutionEquals(a, null)).toBe(false);
    expect(allocatedResolutionEquals(null, null)).toBe(false);
  });
});

describe('resize coalescing', () => {
  it('collapses a burst of resize events onto one pass', () => {
    const frames = fakeFrames();
    let passes = 0;
    const gate = createResizeCoalescer(() => passes++);

    for (let i = 0; i < 20; i++) gate.request(frames.schedule);
    expect(passes).toBe(0);
    expect(frames.run()).toBe(1);
    expect(passes).toBe(1);

    // The next burst books a fresh frame rather than being swallowed.
    for (let i = 0; i < 20; i++) gate.request(frames.schedule);
    frames.run();
    expect(passes).toBe(2);
  });

  it('books the next frame for a resize the pass itself provokes', () => {
    const frames = fakeFrames();
    let passes = 0;
    const gate = createResizeCoalescer(() => {
      passes++;
      if (passes === 1) gate.request(frames.schedule);
    });
    gate.request(frames.schedule);
    frames.run();
    expect(passes).toBe(1);
    frames.run();
    expect(passes).toBe(2);
  });

  it('allocates once for an extent, then never again for the same one', () => {
    const gate = createResizeCoalescer(() => {});
    expect(gate.allocated()).toBeNull();
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
    expect(gate.allocated()).toEqual({ width: 1920, height: 1080, pixelRatio: 1 });
    for (let i = 0; i < 20; i++) expect(gate.shouldAllocate(1920, 1080, 1)).toBe(false);
  });

  it('reallocates on a browser zoom that leaves the extent identical', () => {
    // 150 percent zoom on a 1920x1080 window: the CSS viewport shrinks to
    // 1280x720 and the ratio rises to 1.5, so floor(1280 * 1.5) is 1920 again.
    // The extent matches but the renderer's pixel ratio must still be written,
    // since applyRenderRegion reads it back against the live CSS height.
    const gate = createResizeCoalescer(() => {});
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
    expect(drawingBufferExtent(1280, 720, 1.5)).toEqual(drawingBufferExtent(1920, 1080, 1));
    expect(gate.shouldAllocate(1280, 720, 1.5)).toBe(true);
    expect(gate.allocated()).toEqual({ width: 1920, height: 1080, pixelRatio: 1.5 });
    expect(gate.shouldAllocate(1280, 720, 1.5)).toBe(false);
  });

  it('reallocates on a device-pixel-ratio change with an identical CSS size', () => {
    const gate = createResizeCoalescer(() => {});
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
    // The DPR watch fires with the same CSS box; the backing store still moves.
    expect(gate.shouldAllocate(1920, 1080, 2)).toBe(true);
    expect(gate.allocated()).toEqual({ width: 3840, height: 2160, pixelRatio: 2 });
    expect(gate.shouldAllocate(1920, 1080, 2)).toBe(false);
    // And back down again.
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
  });

  it('reallocates on a CSS-size change and on a render-scale change', () => {
    const gate = createResizeCoalescer(() => {});
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
    expect(gate.shouldAllocate(1600, 900, 1)).toBe(true);
    // The allocation scale rides the same ratio argument.
    expect(gate.shouldAllocate(1600, 900, 0.75)).toBe(true);
    expect(gate.shouldAllocate(1600, 900, 0.75)).toBe(false);
  });

  it('answers the renderer shape: a burst reallocates once, a no-op burst never', () => {
    // The renderer composes exactly this: every listener calls request(), the
    // frame pass runs resizeViewport, and applyResolution asks shouldAllocate
    // before it touches any storage.
    const frames = fakeFrames();
    let allocations = 0;
    let cssWidth = 1920;
    let cssHeight = 1080;
    let ratio = 1;
    const gate = createResizeCoalescer(() => {
      if (gate.shouldAllocate(cssWidth, cssHeight, ratio)) allocations++;
    });
    const burst = (times: number): void => {
      for (let i = 0; i < times; i++) gate.request(frames.schedule);
      frames.run();
    };

    burst(20);
    expect(allocations).toBe(1);

    // Same window, twenty more events (fullscreenchange, visualViewport
    // scroll, the orientation follow-up timers): nothing is reallocated.
    burst(20);
    expect(allocations).toBe(1);

    // The window actually changes: one reallocation for the whole drag.
    cssWidth = 1600;
    cssHeight = 900;
    burst(20);
    expect(allocations).toBe(2);

    // The DPR watch fires with an unchanged CSS size: still one reallocation.
    ratio = 2;
    burst(1);
    expect(allocations).toBe(3);
    burst(1);
    expect(allocations).toBe(3);
  });

  it('reallocates unconditionally after a reset', () => {
    const gate = createResizeCoalescer(() => {});
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(false);
    gate.reset();
    expect(gate.allocated()).toBeNull();
    expect(gate.shouldAllocate(1920, 1080, 1)).toBe(true);
  });
});
