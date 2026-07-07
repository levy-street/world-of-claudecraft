import { describe, expect, it } from 'vitest';
import {
  mapCanvasPointFromClient,
  mapCanvasRenderedContentSize,
  syncMapCanvasSize,
} from '../src/ui/map_canvas_size';

function canvas(attrs: { width?: number; height?: number } = {}): HTMLCanvasElement {
  return {
    width: attrs.width ?? 560,
    height: attrs.height ?? 560,
  } as HTMLCanvasElement;
}

describe('map_canvas_size', () => {
  it('keeps the default 560px square backing store when the rendered content is 560px', () => {
    const c = canvas();
    const size = syncMapCanvasSize(c, { width: 560, height: 560 });
    expect(size).toBe(560);
    expect(c.width).toBe(560);
    expect(c.height).toBe(560);
  });

  it('shrinks the backing store to a smaller rendered square', () => {
    const c = canvas();
    const size = syncMapCanvasSize(c, { width: 438, height: 438 });
    expect(size).toBe(438);
    expect(c.width).toBe(438);
    expect(c.height).toBe(438);
  });

  it('uses the smaller rendered side so the map coordinate space stays square', () => {
    const c = canvas();
    const size = syncMapCanvasSize(c, { width: 520, height: 440 });
    expect(size).toBe(440);
    expect(c.width).toBe(440);
    expect(c.height).toBe(440);
  });

  it('falls back to the existing backing store when the rendered size is hidden or zero', () => {
    const c = canvas({ width: 512, height: 512 });
    const size = syncMapCanvasSize(c, { width: 0, height: 0 });
    expect(size).toBe(512);
    expect(c.width).toBe(512);
    expect(c.height).toBe(512);
  });

  it('maps client coordinates into the border-aware canvas content coordinate space', () => {
    const point = mapCanvasPointFromClient(
      {
        left: 100,
        top: 50,
        width: 444,
        height: 444,
        borderLeft: 2,
        borderTop: 2,
        contentWidth: 440,
        contentHeight: 440,
      },
      322,
      272,
      440,
    );
    expect(point).toEqual({ x: 220, y: 220 });
  });

  it('reads rendered content size by subtracting border from the border-box rect', () => {
    const size = mapCanvasRenderedContentSize({
      width: 444,
      height: 442,
      borderLeft: 2,
      borderRight: 2,
      borderTop: 1,
      borderBottom: 1,
    });
    expect(size).toEqual({ width: 440, height: 440 });
  });
});
