import { describe, expect, it, vi } from 'vitest';
import { drawNameplateLootIcon } from '../src/render/nameplate_loot_icon';

describe('nameplate loot icon', () => {
  it('draws a compact satchel and glint with canvas shapes', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawNameplateLootIcon(ctx, 20, 12, '#f2c84b', '#1b1205');

    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.beginPath).toHaveBeenCalledTimes(4);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(6);
    expect(ctx.arc).toHaveBeenCalledWith(20, 13, 1.25, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledTimes(4);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});
