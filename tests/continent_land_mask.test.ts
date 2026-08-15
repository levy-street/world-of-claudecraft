// Behavior pins for the continent land-mask helper (src/ui/continent_land_mask.ts).
//
// Driven through a fake document + fake 2D context (the tests/text_sprite_cache.ts
// idiom), never a source scan. The claims that matter to the map: the helper mints
// exactly one detached canvas, rasterizes the plate at a bounded size, writes the
// CORE's mask back onto it, and returns null (rather than throwing) on every
// failure the browser can hand it, since a null mask is what makes the painter
// fall back to its flat rectangle wash.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLandMaskCanvas,
  MASK_MAX_DIMENSION,
  maskDimensions,
} from '../src/ui/continent_land_mask';
import { buildLandMaskRgba } from '../src/ui/continent_land_mask_core';

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): FakeContext | null;
  ctx: FakeContext;
}

interface FakeContext {
  /** Every drawImage, as the destination box it was asked for. */
  draws: Array<{ w: number; h: number }>;
  /** The last buffer handed to putImageData. */
  written: Uint8ClampedArray | null;
  drawImage(src: unknown, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}

interface Trace {
  canvases: FakeCanvas[];
  /** Element names document.createElement was asked for. */
  created: string[];
  /** Fills the fake getImageData returns, per pixel. */
  pixel: (index: number) => [number, number, number];
  /** When false, getContext('2d') returns null. */
  context: boolean;
  /** When true, getImageData throws like a tainted canvas does. */
  tainted: boolean;
}

function installFakeDocument(trace: Trace): void {
  vi.stubGlobal('document', {
    createElement(kind: string): FakeCanvas {
      trace.created.push(kind);
      const ctx: FakeContext = {
        draws: [],
        written: null,
        drawImage(_src, _dx, _dy, dw, dh): void {
          ctx.draws.push({ w: dw, h: dh });
        },
        getImageData(_x, _y, w, h): { data: Uint8ClampedArray } {
          if (trace.tainted) throw new Error('SecurityError: tainted canvas');
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            const [r, g, b] = trace.pixel(i);
            data[i * 4] = r;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
          }
          return { data };
        },
        createImageData(w, h): { data: Uint8ClampedArray } {
          return { data: new Uint8ClampedArray(w * h * 4) };
        },
        putImageData(image): void {
          ctx.written = image.data;
        },
      };
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        ctx,
        getContext(kind: string): FakeContext | null {
          return kind === '2d' && trace.context ? ctx : null;
        },
      };
      trace.canvases.push(canvas);
      return canvas;
    },
  });
}

const SEA: [number, number, number] = [23, 90, 129];
const GRASS: [number, number, number] = [97, 108, 40];

function newTrace(over: Partial<Trace> = {}): Trace {
  return {
    canvases: [],
    created: [],
    pixel: (i) => (i % 2 === 0 ? SEA : GRASS),
    context: true,
    tainted: false,
    ...over,
  };
}

/** The shipped plate's real pixel size (public/map_art/world_overview.webp). */
const PLATE_W = 543;
const PLATE_H = 1100;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('continent land mask helper: dimensions', () => {
  it('caps the long axis and keeps the plate aspect', () => {
    const capped = maskDimensions(PLATE_W, PLATE_H);
    expect(capped.height).toBe(MASK_MAX_DIMENSION);
    expect(capped.width).toBe(Math.round((PLATE_W * MASK_MAX_DIMENSION) / PLATE_H));
    expect(capped.width / capped.height).toBeCloseTo(PLATE_W / PLATE_H, 2);
  });

  it('never scales a small plate UP, and refuses a degenerate size', () => {
    expect(maskDimensions(100, 200)).toEqual({ width: 100, height: 200 });
    expect(maskDimensions(0, 0)).toEqual({ width: 0, height: 0 });
    expect(maskDimensions(Number.NaN, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('continent land mask helper: building', () => {
  it('mints one canvas, rasterizes the plate at the capped size, and writes the core mask', () => {
    const trace = newTrace();
    installFakeDocument(trace);
    const canvas = buildLandMaskCanvas({} as CanvasImageSource, PLATE_W, PLATE_H);

    expect(trace.created).toEqual(['canvas']);
    expect(canvas).toBe(trace.canvases[0] as unknown as HTMLCanvasElement);
    const expected = maskDimensions(PLATE_W, PLATE_H);
    expect({ width: trace.canvases[0].width, height: trace.canvases[0].height }).toEqual(expected);
    // The plate is drawn to fill that surface, so mask pixel (x,y) is plate (x,y).
    expect(trace.canvases[0].ctx.draws).toEqual([{ w: expected.width, h: expected.height }]);

    // What was written back is exactly what the pure core produces for those
    // pixels: the helper adds no classification of its own.
    const source = trace.canvases[0].ctx.getImageData(0, 0, expected.width, expected.height);
    expect(trace.canvases[0].ctx.written).toEqual(
      buildLandMaskRgba(source.data, expected.width, expected.height),
    );
  });

  it('returns null without a 2D context, on a tainted plate, and on a zero-size plate', () => {
    const noCtx = newTrace({ context: false });
    installFakeDocument(noCtx);
    expect(buildLandMaskCanvas({} as CanvasImageSource, PLATE_W, PLATE_H)).toBeNull();
    vi.unstubAllGlobals();

    const tainted = newTrace({ tainted: true });
    installFakeDocument(tainted);
    expect(buildLandMaskCanvas({} as CanvasImageSource, PLATE_W, PLATE_H)).toBeNull();
    vi.unstubAllGlobals();

    const empty = newTrace();
    installFakeDocument(empty);
    expect(buildLandMaskCanvas({} as CanvasImageSource, 0, 0)).toBeNull();
    // A refused size mints no canvas at all.
    expect(empty.created).toEqual([]);
  });
});
