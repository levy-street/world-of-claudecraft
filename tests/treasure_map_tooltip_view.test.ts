import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { treasureMapTooltipLine } from '../src/ui/treasure_map_tooltip_view';

describe('treasure map party guidance', () => {
  it.each(['common', 'rare', 'epic', 'legendary'])(
    'shows the fixed %s encounter size',
    (rarity) => {
      expect(treasureMapTooltipLine(ITEMS[`treasure_map_${rarity}`])).toContain(
        `Suggested players: ${rarity === 'common' ? 1 : 5}`,
      );
    },
  );
  it('does not label an ordinary item as a dungeon', () => {
    expect(treasureMapTooltipLine(ITEMS.clue_scroll)).toBe('');
  });
});
