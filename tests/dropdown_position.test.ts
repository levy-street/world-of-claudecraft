import { describe, expect, it } from 'vitest';
import { computeDropdownPlacement } from '../src/ui/dropdown_position';

describe('computeDropdownPlacement', () => {
  it('opens below and keeps the full preferred height when there is plenty of room', () => {
    const placement = computeDropdownPlacement({
      triggerTop: 100,
      triggerBottom: 120,
      containerTop: 0,
      containerBottom: 600,
      preferredMaxHeight: 236,
      gap: 4,
      minHeight: 80,
    });
    expect(placement).toEqual({ side: 'below', maxHeight: 236 });
  });

  it('shrinks (but stays below) when space below is tight but still the larger side', () => {
    const placement = computeDropdownPlacement({
      triggerTop: 250,
      triggerBottom: 280,
      containerTop: 0,
      containerBottom: 330,
      preferredMaxHeight: 236,
      gap: 4,
      minHeight: 40,
    });
    // spaceBelow = 330 - 280 - 4 = 46, spaceAbove = 250 - 0 - 4 = 246
    // spaceBelow < spaceAbove, so it should flip up despite the "still positive" space below.
    expect(placement.side).toBe('above');
    expect(placement.maxHeight).toBe(236);
  });

  it('flips above the trigger when there is more room there, matching the mobile Market clip case', () => {
    // Reproduces the reported bug: a filter select near the bottom of an
    // overflow: hidden #market-window, where the menu below would be
    // majority-clipped with no way to reach it by scrolling.
    const placement = computeDropdownPlacement({
      triggerTop: 245,
      triggerBottom: 277,
      containerTop: 38,
      containerBottom: 371,
      preferredMaxHeight: 236,
      gap: 4,
      minHeight: 80,
    });
    // spaceBelow = 371 - 277 - 4 = 90, spaceAbove = 245 - 38 - 4 = 203
    expect(placement.side).toBe('above');
    expect(placement.maxHeight).toBe(203);
  });

  it('clamps to minHeight when neither side has enough room', () => {
    const placement = computeDropdownPlacement({
      triggerTop: 50,
      triggerBottom: 60,
      containerTop: 40,
      containerBottom: 70,
      preferredMaxHeight: 236,
      gap: 4,
      minHeight: 80,
    });
    // spaceBelow = 70 - 60 - 4 = 6, spaceAbove = 50 - 40 - 4 = 6
    expect(placement.side).toBe('below');
    expect(placement.maxHeight).toBe(80);
  });
});
