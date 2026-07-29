import { describe, expect, it } from 'vitest';
import { buildMeterTabMenu } from '../src/ui/meters_menu_view';
import type { MeterTab } from '../src/ui/meters_rows_view';

const DETACHABLE: readonly MeterTab[] = ['heal', 'threat'];

describe('meter tab context menu', () => {
  it('offers Separate for a meter still docked in the tabbed window', () => {
    for (const tab of DETACHABLE) {
      expect(buildMeterTabMenu({ tab, detached: false, detachable: DETACHABLE })).toEqual([
        { act: 'separate', tab },
      ]);
    }
  });

  it('offers Regroup once that meter has its own window', () => {
    for (const tab of DETACHABLE) {
      expect(buildMeterTabMenu({ tab, detached: true, detachable: DETACHABLE })).toEqual([
        { act: 'regroup', tab },
      ]);
    }
  });

  it('offers nothing for damage, the meter that cannot leave its window', () => {
    // An empty list means "open no menu", so a right-click on the damage tab is
    // left alone rather than flashing an inert popup.
    expect(buildMeterTabMenu({ tab: 'dmg', detached: false, detachable: DETACHABLE })).toEqual([]);
    expect(buildMeterTabMenu({ tab: 'dmg', detached: true, detachable: DETACHABLE })).toEqual([]);
  });

  it('reads the detachable set it is given rather than hardcoding one', () => {
    // Narrowing the set must narrow the menu, so the rule stays in one place.
    expect(buildMeterTabMenu({ tab: 'heal', detached: false, detachable: ['threat'] })).toEqual([]);
    expect(buildMeterTabMenu({ tab: 'threat', detached: false, detachable: ['threat'] })).toEqual([
      { act: 'separate', tab: 'threat' },
    ]);
  });

  it('names the tab on the row, so the caller need not re-derive it', () => {
    const [row] = buildMeterTabMenu({ tab: 'threat', detached: true, detachable: DETACHABLE });
    expect(row.tab).toBe('threat');
  });
});
