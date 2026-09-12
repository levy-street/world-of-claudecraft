import { describe, expect, it } from 'vitest';
import { mapDragPanCenter } from '../src/ui/map_pan_core';

describe('map pan core', () => {
  const drag = { px: 100, py: 100, cx: 50, cz: -20 };
  const span = { spanX: 400, spanZ: 800 };
  const canvas = { width: 200, height: 200 };

  it('keeps the grabbed world point under the cursor (+X left, +Z up)', () => {
    // 2 world units per px on X, 4 on Z: a 10 px drag right / 5 px down moves
    // the centre +20 on X and +20 on Z.
    expect(mapDragPanCenter(drag, span, canvas, 110, 105)).toEqual({ x: 70, z: 0 });
    expect(mapDragPanCenter(drag, span, canvas, 90, 95)).toEqual({ x: 30, z: -40 });
  });

  it('is the identity when the pointer has not moved', () => {
    expect(mapDragPanCenter(drag, span, canvas, 100, 100)).toEqual({ x: 50, z: -20 });
  });
});
