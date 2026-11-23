// The Boo! daily's presentation (pure): the gossip row at a townsperson
// (hud/quest/trick_or_treat_row_view.ts) and the fright's feedback lines
// (seasonal_event_view.ts). The sim re-checks every rule; this only decides what shows.
import { describe, expect, it } from 'vitest';
import { GOURDLIGHT_DAILY_BOO_QUEST_ID } from '../src/sim/content/gourdlight_eve_dailies';
import {
  booRowFor,
  seasonalTownsfolkRows,
  seasonalTownsfolkRowsSig,
} from '../src/ui/hud/quest/trick_or_treat_row_view';
import { seasonalEventPresentation } from '../src/ui/seasonal_event_view';

const FOLK = 'trader_wilkes';

describe('the Boo! row', () => {
  it('shows only on the errand, at an answering townsperson, while the event runs', () => {
    expect(booRowFor(null, true, true, [], FOLK)).toBeNull();
    expect(booRowFor('gourdlight_eve', false, true, [], FOLK)).toBeNull();
    expect(booRowFor('gourdlight_eve', true, true, [], 'gourdlight_keeper')).toBeNull();
    expect(booRowFor('gourdlight_eve', true, true, [], FOLK)).toBe('offer');
    expect(booRowFor('gourdlight_eve', true, false, [], FOLK)).toBe('needsCostume');
    expect(booRowFor('gourdlight_eve', true, true, [`boo_${FOLK}`], FOLK)).toBe('frightened');
    // a knock on the same townsperson is not a fright
    expect(booRowFor('gourdlight_eve', true, true, [FOLK], FOLK)).toBe('offer');
  });

  it('reads the errand, the costume and the ledger off the world', () => {
    const world = {
      activeSeasonalEvent: 'gourdlight_eve',
      trickOrTreatedToday: [FOLK],
      questLog: new Map([[GOURDLIGHT_DAILY_BOO_QUEST_ID, { state: 'active' }]]),
      player: { auras: [{ id: 'gourdlight_costume_ghost' }] },
    };
    const rows = seasonalTownsfolkRows(world, FOLK);
    expect(rows).toEqual({ knock: 'knocked', boo: 'offer' });
    expect(seasonalTownsfolkRowsSig(rows)).toBe('knocked|offer');
    const bare = seasonalTownsfolkRows({ ...world, player: { auras: [] } }, FOLK);
    expect(bare.boo).toBe('needsCostume');
  });

  it('says what happened, in the catalog', () => {
    const landed = seasonalEventPresentation({ type: 'seasonal', what: 'boo', npc: FOLK });
    expect(landed?.logText).toContain('BOO');
    expect(landed?.flashText).toBeTruthy();
    for (const what of ['booNoCostume', 'booAlready', 'booNotOnErrand'] as const) {
      expect(
        seasonalEventPresentation({ type: 'seasonal', what, npc: FOLK })?.logText,
      ).toBeTruthy();
    }
  });
});
