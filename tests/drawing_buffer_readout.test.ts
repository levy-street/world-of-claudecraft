import { afterEach, describe, expect, it } from 'vitest';
import {
  drawingBufferReadout,
  readDrawingBuffer,
  setDrawingBufferReadoutSource,
} from '../src/ui/drawing_buffer_readout';

afterEach(() => setDrawingBufferReadoutSource(null));

describe('drawing buffer readout', () => {
  it('pairs the allocated buffer with the display pixels the canvas covers', () => {
    // A DPR 1 4K panel on ultra: the budget bounded the buffer at 1440p-plus.
    expect(
      drawingBufferReadout(
        { width: 3840, height: 2160, drawingBuffer: { width: 2795, height: 1572 } },
        1,
      ),
    ).toEqual({ width: 2795, height: 1572, nativeWidth: 3840, nativeHeight: 2160 });
    // A Retina MacBook on medium: CSS 1440x900 at DPR 2 is a 2880x1800 display.
    expect(
      drawingBufferReadout(
        { width: 1440, height: 900, drawingBuffer: { width: 2131, height: 1332 } },
        2,
      ),
    ).toEqual({ width: 2131, height: 1332, nativeWidth: 2880, nativeHeight: 1800 });
    // A 1080p panel at DPR 1: the two sizes agree, so the line reads as "no change".
    expect(
      drawingBufferReadout(
        { width: 1920, height: 1080, drawingBuffer: { width: 1920, height: 1080 } },
        1,
      ),
    ).toEqual({ width: 1920, height: 1080, nativeWidth: 1920, nativeHeight: 1080 });
  });

  it('tolerates a missing or degenerate device pixel ratio', () => {
    expect(
      drawingBufferReadout(
        { width: 1280, height: 720, drawingBuffer: { width: 1280, height: 720 } },
        Number.NaN,
      ).nativeWidth,
    ).toBe(1280);
    expect(
      drawingBufferReadout({ width: 0, height: 0, drawingBuffer: { width: 0, height: 0 } }, 0),
    ).toEqual({ width: 1, height: 1, nativeWidth: 1, nativeHeight: 1 });
  });

  it('reads null until a source is registered, then follows the source', () => {
    expect(readDrawingBuffer()).toBeNull();
    let live = { width: 1920, height: 1080, nativeWidth: 1920, nativeHeight: 1080 };
    setDrawingBufferReadoutSource(() => live);
    expect(readDrawingBuffer()).toEqual(live);
    live = { width: 2795, height: 1572, nativeWidth: 3840, nativeHeight: 2160 };
    expect(readDrawingBuffer()).toEqual(live);
    setDrawingBufferReadoutSource(null);
    expect(readDrawingBuffer()).toBeNull();
  });
});
