import { describe, expect, it } from 'vitest';

import { MAX_PAINT_SLOTS, paintTextureSlotUsage } from '../src/render/terrain_paint_layers';
import type { CustomPaintSwatch } from '../src/sim/types';

// The Studio's Paint-panel tally ("Texture slots: 15 / 24 used · 9 free") and
// its over-limit warning read paintTextureSlotUsage, which must count exactly
// what planSlots gives a shader slot: one per DISTINCT texture, snow-family
// built-ins excluded (they ride the dedicated snow channel), colour-only
// swatches excluded.
const swatch = (id: number, textureSha?: string): CustomPaintSwatch => ({
  id,
  color: 0x808080,
  ...(textureSha ? { textureSha } : {}),
});

describe('paintTextureSlotUsage', () => {
  it('reports every slot free on a map with no textured swatches', () => {
    expect(paintTextureSlotUsage([])).toEqual({
      used: 0,
      max: MAX_PAINT_SLOTS,
      free: MAX_PAINT_SLOTS,
      over: 0,
    });
    // colour-only swatches claim nothing
    expect(paintTextureSlotUsage([swatch(200), swatch(201)]).used).toBe(0);
  });

  it('counts one slot per distinct texture and none for snow', () => {
    const usage = paintTextureSlotUsage([
      swatch(200, 'builtin:Cobblestone001'),
      swatch(201, 'builtin:Cobblestone001'), // a hue variant of the same texture
      swatch(202, 'builtin:PavingStones046'),
      swatch(203, 'builtin:Snow004'), // snow channel, no slot
      swatch(204, 'a'.repeat(64)), // an imported texture
    ]);
    expect(usage).toEqual({ used: 3, max: MAX_PAINT_SLOTS, free: MAX_PAINT_SLOTS - 3, over: 0 });
  });

  it('reports the overflow past the shader budget', () => {
    const imported = Array.from({ length: MAX_PAINT_SLOTS + 2 }, (_, i) =>
      swatch(200 + i, i.toString(16).padStart(64, '0')),
    );
    expect(paintTextureSlotUsage(imported)).toEqual({
      used: MAX_PAINT_SLOTS,
      max: MAX_PAINT_SLOTS,
      free: 0,
      over: 2,
    });
  });
});
