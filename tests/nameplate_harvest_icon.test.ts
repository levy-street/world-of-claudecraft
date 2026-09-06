import { describe, expect, it, vi } from 'vitest';
import { drawNameplateHarvestIcon } from '../src/render/nameplate_harvest_icon';
import { drawNameplateLootIcon } from '../src/render/nameplate_loot_icon';

function fakeContext() {
  return {
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
    fillText: vi.fn(),
  };
}

describe('nameplate harvest icon', () => {
  it('draws a skinning blade and handle from canvas shapes, never text', () => {
    const ctx = fakeContext();

    drawNameplateHarvestIcon(
      ctx as unknown as CanvasRenderingContext2D,
      20,
      12,
      '#c9a86a',
      '#1b1205',
    );

    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.beginPath).toHaveBeenCalledTimes(3);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('is a different silhouette from the ordinary loot satchel, not a recolor of it', () => {
    const harvest = fakeContext();
    const loot = fakeContext();
    drawNameplateHarvestIcon(
      harvest as unknown as CanvasRenderingContext2D,
      20,
      12,
      '#fff',
      '#000',
    );
    drawNameplateLootIcon(loot as unknown as CanvasRenderingContext2D, 20, 12, '#fff', '#000');

    const shape = (ctx: ReturnType<typeof fakeContext>) => ({
      curves: ctx.quadraticCurveTo.mock.calls.length,
      arcs: ctx.arc.mock.calls.length,
      lines: ctx.lineTo.mock.calls.length,
    });
    expect(shape(harvest)).not.toEqual(shape(loot));
  });
});
