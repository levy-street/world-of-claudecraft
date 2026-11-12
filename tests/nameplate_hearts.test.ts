// The skill event heart row over a nameplate (src/render/nameplate_hearts.ts):
// which plates draw hearts, which keep the health bar, and which hide the row.

import { describe, expect, it } from 'vitest';
import { NAMEPLATE_HEARTS_HIDDEN, nameplateHeartsFor } from '../src/render/nameplate_hearts';

describe('nameplateHeartsFor', () => {
  it('keeps the health bar for a unit outside a heart fight', () => {
    expect(nameplateHeartsFor(undefined, false, false)).toBe(-1);
    expect(nameplateHeartsFor(undefined, true, true)).toBe(-1);
  });

  it('draws the hearts left over other fighters, on desktop and touch alike', () => {
    expect(nameplateHeartsFor(3, false, false)).toBe(3);
    expect(nameplateHeartsFor(3, false, true)).toBe(3);
    expect(nameplateHeartsFor(0, false, true)).toBe(0);
  });

  it('hides only your own heart row, and only on a touch screen', () => {
    expect(nameplateHeartsFor(2, true, true)).toBe(NAMEPLATE_HEARTS_HIDDEN);
    expect(nameplateHeartsFor(2, true, false)).toBe(2);
    expect(NAMEPLATE_HEARTS_HIDDEN).not.toBe(-1);
  });
});
