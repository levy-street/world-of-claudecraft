import { describe, expect, it } from 'vitest';
import {
  STAT_DEFENSE,
  STAT_GRID,
  STAT_OFFENSE,
  STAT_PANELS,
  STAT_RATINGS,
  STAT_SPELL,
  STAT_TILES,
} from '../src/ui/char_stats_view';

// The showcase character sheet splits the 18 character-sheet stats into five
// groups: five primary TILES, then an Offense, a Spell, a Defense and a Ratings
// panel (the sheet's two-column grid lays those four out as a 2x2 block). This
// core owns the partition; the painter (char_window.ts) only lays it out. The one
// invariant that must never drift: the groups repartition STAT_GRID EXACTLY, so
// no stat is dropped, duplicated, or silently invented as the grid changes.

describe('char_stats_view: the tiles/offense/spell/defense/ratings partition of STAT_GRID', () => {
  it('the five groups union to exactly the STAT_GRID set, with no duplicates', () => {
    const union = [...STAT_TILES, ...STAT_OFFENSE, ...STAT_SPELL, ...STAT_DEFENSE, ...STAT_RATINGS];
    // No id appears in more than one group (union length == unique count).
    expect(new Set(union).size).toBe(union.length);
    // The partition covers exactly STAT_GRID: same membership both directions.
    expect(new Set(union)).toEqual(new Set(STAT_GRID));
    // And it is a true repartition (same cardinality as the canonical grid).
    expect(union.length).toBe(STAT_GRID.length);
    expect(STAT_GRID.length).toBe(18);
  });

  it('pins the five primary tiles in order (str, agi, sta, int, spi)', () => {
    expect(STAT_TILES).toEqual(['str', 'agi', 'sta', 'int', 'spi']);
  });

  it('pins the Offense group: the weapon side and its Agility crit pool', () => {
    expect(STAT_OFFENSE).toEqual(['attackPower', 'dps', 'critChance']);
  });

  it('pins the Spell group: Spell Power, Healing Power, and the Intellect crit pool', () => {
    // Healing Power and Spell Crit are the two cells this panel added; both crit
    // pools are on the sheet, one per side, never merged into one number.
    expect(STAT_SPELL).toEqual(['spellPower', 'healPower', 'spellCrit']);
    expect(STAT_OFFENSE).toContain('critChance');
    expect(STAT_OFFENSE).not.toContain('spellCrit');
  });

  it('pins the Defense group', () => {
    expect(STAT_DEFENSE).toEqual(['armor', 'dodge', 'parry', 'warfare']);
  });

  it('pins the Ratings group: the gear ratings that feed both sides', () => {
    expect(STAT_RATINGS).toEqual(['critRating', 'hasteRating', 'hitRating']);
  });

  it('exposes five ordered panels: untitled tiles, then Offense, Spell, Defense, Ratings', () => {
    expect(STAT_PANELS.map((p) => p.kind)).toEqual(['tiles', 'stats', 'stats', 'stats', 'stats']);
    // Order matters: the grid is two columns, so this order is what places
    // Offense beside Spell and Defense beside Ratings.
    expect(STAT_PANELS.map((p) => p.titleKey)).toEqual([
      null,
      'hudChrome.charSheet.offense',
      'hudChrome.charSheet.spell',
      'hudChrome.charSheet.defense',
      'hudChrome.charSheet.ratings',
    ]);
    // The panels' stat lists ARE the same arrays the partition test pins.
    expect(STAT_PANELS[0].stats).toBe(STAT_TILES);
    expect(STAT_PANELS[1].stats).toBe(STAT_OFFENSE);
    expect(STAT_PANELS[2].stats).toBe(STAT_SPELL);
    expect(STAT_PANELS[3].stats).toBe(STAT_DEFENSE);
    expect(STAT_PANELS[4].stats).toBe(STAT_RATINGS);
  });
});
