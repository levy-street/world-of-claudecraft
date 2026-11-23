import { describe, expect, it, vi } from 'vitest';
import { drawBrush } from '../src/editor/canvas';
import { Camera } from '../src/editor/view';

describe('2D brush cursor footprint', () => {
  it('projects the square half-size and center through the same camera as the map', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
    };
    const camera = new Camera({ x: 10, z: 20 }, 4);
    drawBrush(
      ctx as unknown as CanvasRenderingContext2D,
      camera,
      { width: 400, height: 200 },
      { x: 12, z: 23, radius: 3, raise: true, shape: 'square' },
    );
    expect(ctx.rect).toHaveBeenCalledWith(196, 100, 24, 24);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('keeps the circular cursor as the default', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
    };
    drawBrush(
      ctx as unknown as CanvasRenderingContext2D,
      new Camera(),
      { width: 400, height: 200 },
      { x: 0, z: 0, radius: 3, raise: true },
    );
    expect(ctx.arc).toHaveBeenCalledWith(200, 100, 6, 0, Math.PI * 2);
    expect(ctx.rect).not.toHaveBeenCalled();
  });
});
