// The item tooltip's potion Use lines (src/ui/potion_tooltip_view.ts), moved
// out of Hud.itemTooltip: one line per restore the def carries, none for an
// item that carries none.
import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/ui/i18n';
import { potionTooltipLines } from '../src/ui/potion_tooltip_view';

describe('potionTooltipLines', () => {
  it('states each restore once, in health, percent, mana order', () => {
    setLanguage('en');
    const html = potionTooltipLines({ potionHp: 120, potionHpPctMax: 0.25, potionMana: 90 });
    const lines = html.match(/<div class="tt-desc">[^<]*<\/div>/g) ?? [];
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('120');
    expect(lines[1]).toContain('25');
    expect(lines[2]).toContain('90');
  });

  it('is empty for an item with no potion restore', () => {
    expect(potionTooltipLines({})).toBe('');
  });
});
