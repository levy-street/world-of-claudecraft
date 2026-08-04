// Toolbelt item tooltip lines: the pure string-builder composed inside
// Hud.itemTooltip (the gather_tool_tooltip.test.ts idiom). English copy is
// asserted directly, and the "only a toolbelt" arm matters because every item
// in the game passes through this builder.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { toolbeltTooltipLines } from '../src/ui/toolbelt_tooltip';

const DESC = 'A belt that can hold your tools, freeing up space in your backpack.';

describe('toolbeltTooltipLines', () => {
  it('quotes the slot count and states what the belt is for', () => {
    expect(toolbeltTooltipLines(ITEMS.basic_toolbelt)).toBe(
      `<div class="tt-stat">Holds 2 tools</div><div class="tt-desc">${DESC}</div>`,
    );
    // The ladder's numbers come from each def's toolSlots, not a constant.
    expect(toolbeltTooltipLines(ITEMS.reinforced_toolbelt)).toContain('Holds 3 tools');
    expect(toolbeltTooltipLines(ITEMS.artisans_toolbelt)).toContain('Holds 4 tools');
  });

  it('renders nothing for every other item kind', () => {
    // A bag is the near miss: it quotes bagSlots instead, from the caller.
    expect(toolbeltTooltipLines(ITEMS.linen_pouch)).toBe('');
    // A tool that BELONGS in the belt is still not the belt.
    expect(toolbeltTooltipLines(ITEMS.copper_mining_pick)).toBe('');
    expect(toolbeltTooltipLines(ITEMS.baked_bread)).toBe('');
    expect(toolbeltTooltipLines(ITEMS.worn_sword)).toBe('');
  });

  it('covers every toolbelt in the catalog, not just the ladder ids', () => {
    const belts = Object.values(ITEMS).filter((item) => item.kind === 'toolbelt');
    expect(belts.length).toBeGreaterThan(0);
    for (const belt of belts) {
      expect(toolbeltTooltipLines(belt), `${belt.id} must describe itself`).toContain('tt-desc');
      expect(toolbeltTooltipLines(belt), `${belt.id} must quote its slots`).toContain('tt-stat');
    }
  });
});
