import { afterEach, describe, expect, it } from 'vitest';
import {
  MEADOW_MAX_STRETCH,
  meadowBladeScale,
  meadowCellGrows,
  meadowFullness,
  meadowFullnessVersion,
  meadowHeightStretch,
  STOCK_MEADOW,
  setMeadowFullness,
} from '../src/render/meadow_fullness_core';

// The formulas both grass layers used inline before they were shared, spelled
// out here so this is not a self-comparison.
const shippedGrows = (r: number, lush: number, d: number): boolean =>
  r < (0.44 + 1.7 * lush * lush) * 1.05 * Math.min(d, 1.2);
const shippedScale = (size: number, tuft: number, lush: number): number => {
  const lushHere = 0.5 + lush * 0.6;
  let s = (0.22 + size * 0.34) * lushHere;
  if (tuft < 0.1) s *= 1.5 + tuft * 3.0;
  return s;
};

afterEach(() => {
  setMeadowFullness(null);
});

describe('meadow fullness', () => {
  it('is the shipped carpet exactly when unset', () => {
    expect(meadowFullness()).toEqual(STOCK_MEADOW);
    for (let i = 0; i < 400; i++) {
      const r = (i * 0.6180339887) % 1;
      const lush = (i * 0.37) % 1;
      const d = [0, 0.6, 1, 1.55][i % 4];
      const tuft = (i * 0.071) % 1;
      expect(meadowCellGrows(r, lush, d)).toBe(shippedGrows(r, lush, d));
      expect(meadowBladeScale(r, tuft, lush)).toBe(shippedScale(r, tuft, lush));
      expect(meadowHeightStretch(lush, 0.9)).toBe((0.85 + lush * 0.5) * 0.9);
    }
  });

  it('grows more cells and taller, wider clusters when fuller', () => {
    const full = { coverage: 1, height: 1.3, width: 1.4 };
    let stock = 0;
    let fuller = 0;
    for (let i = 0; i < 1000; i++) {
      const r = (i * 0.6180339887) % 1;
      const lush = (i * 0.13) % 0.5;
      if (meadowCellGrows(r, lush, 1)) stock++;
      if (meadowCellGrows(r, lush, 1, full)) fuller++;
    }
    expect(fuller).toBeGreaterThan(stock * 1.5);
    expect(meadowBladeScale(0.5, 0.5, 0.2, full)).toBeGreaterThan(meadowBladeScale(0.5, 0.5, 0.2));
    expect(meadowHeightStretch(0.2, 1, full)).toBeGreaterThan(meadowHeightStretch(0.2, 1));
  });

  it('never asks a cluster to outgrow the lab culling bound', () => {
    setMeadowFullness({ coverage: 3, height: 9, width: 9 });
    expect(meadowFullness().coverage).toBe(1);
    expect(meadowFullness().height).toBe(MEADOW_MAX_STRETCH);
    expect(meadowFullness().width).toBe(MEADOW_MAX_STRETCH);
    // The thin-soil size lift stays under the shipped 1.1 lushness ceiling.
    for (const lush of [0, 0.3, 1]) {
      expect(
        meadowBladeScale(1, 0.5, lush, { coverage: 1, height: 1, width: 1 }),
      ).toBeLessThanOrEqual(0.56 * 1.1 + 1e-9);
    }
  });

  it('moves the version only on a change', () => {
    const v = meadowFullnessVersion();
    expect(setMeadowFullness(null)).toBe(false);
    expect(setMeadowFullness({ coverage: 0.5, height: 1, width: 1 })).toBe(true);
    expect(setMeadowFullness({ coverage: 0.5, height: 1, width: 1 })).toBe(false);
    expect(meadowFullnessVersion()).toBe(v + 1);
  });
});
