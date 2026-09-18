import { describe, expect, it } from 'vitest';
import { computeDropdownPlacement, dropdownClipBounds } from '../src/ui/dropdown_position';

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

describe('dropdownClipBounds', () => {
  it('intersects every clipping ancestor, so the innermost one wins each edge', () => {
    expect(
      dropdownClipBounds([
        { top: 51, bottom: 445 },
        { top: 143, bottom: 400 },
      ]),
    ).toEqual({ top: 143, bottom: 400 });
  });

  it('returns the single band unchanged and never inverts an impossible one', () => {
    expect(dropdownClipBounds([{ top: 51, bottom: 445 }])).toEqual({ top: 51, bottom: 445 });
    // A trigger inside a fully collapsed column: bottom is pinned to top rather
    // than going negative, so the placement math still gets real numbers.
    const degenerate = dropdownClipBounds([
      { top: 300, bottom: 320 },
      { top: 400, bottom: 420 },
    ]);
    expect(degenerate.bottom).toBeGreaterThanOrEqual(degenerate.top);
  });
});

describe('the World Market armor-slot filter at 1280x500 (issue: clipped first option)', () => {
  // The reported geometry, measured on the real MarketWindow: #market-window's
  // padding box runs y51..y445, but `.mkt-controls` scrolls and so clips in its own
  // right, starting at y143. The armor-slot trigger sits at y239..y263.
  const WINDOW_BAND = { top: 51, bottom: 445 };
  const CONTROLS_BAND = { top: 143, bottom: 445 };
  const TRIGGER = { triggerTop: 239, triggerBottom: 263 };
  const MENU = { preferredMaxHeight: 236, gap: 6, minHeight: 120 };

  it('placed against the window alone, the menu overruns the controls column (the bug)', () => {
    const placement = computeDropdownPlacement({
      ...TRIGGER,
      containerTop: WINDOW_BAND.top,
      containerBottom: WINDOW_BAND.bottom,
      ...MENU,
    });
    // spaceAbove = 239 - 51 - 6 = 182, spaceBelow = 445 - 263 - 6 = 176: it flips up
    // and renders y51..y233, so the first option sits 92px above the column's top
    // edge, invisible and hit-testing through to the window title.
    expect(placement.side).toBe('above');
    const menuTop = TRIGGER.triggerTop - MENU.gap - placement.maxHeight;
    expect(menuTop).toBe(51);
    expect(menuTop).toBeLessThan(CONTROLS_BAND.top);
  });

  it('clamped to the scrolling column, the whole menu stays inside it', () => {
    const clip = dropdownClipBounds([WINDOW_BAND, CONTROLS_BAND]);
    const placement = computeDropdownPlacement({
      ...TRIGGER,
      containerTop: clip.top,
      containerBottom: clip.bottom,
      ...MENU,
    });
    // spaceAbove is now 239 - 143 - 6 = 90, so below (176) wins and fits.
    expect(placement.side).toBe('below');
    const menuTop = TRIGGER.triggerBottom + MENU.gap;
    const menuBottom = menuTop + placement.maxHeight;
    expect(menuTop).toBeGreaterThanOrEqual(clip.top);
    expect(menuBottom).toBeLessThanOrEqual(clip.bottom);
  });
});
