import { describe, expect, it } from 'vitest';
import { itemHover } from '../scripts/mediawiki/item_hover';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { esc } from '../src/ui/esc';
import { factionRewardTooltipLines } from '../src/ui/hud/faction_reward_tooltip_view';
import { itemCombatTooltipLines } from '../src/ui/item_combat_tooltip_view';
import { instanceTitleHtml, vendorSellTooltipLine } from '../src/ui/item_instance_tooltip';
import { seasonalItemTooltipText } from '../src/ui/seasonal_item_tooltip';

describe('encyclopedia item hovers', () => {
  it('renders every item without a DOM, with the HUD title and no unresolved values or player comparisons', () => {
    for (const item of Object.values(ITEMS)) {
      const html = itemHover(item);
      expect(html, item.id).toContain(instanceTitleHtml(item, undefined, itemDisplayName(item)));
      expect(html, item.id).not.toMatch(/\b(?:NaN|undefined|Infinity)\b|\{[a-zA-Z]+\}|tt-compare/);
    }
  });
  it('uses in-game combat, vendor, seasonal and use descriptions', () => {
    const weapon = Object.values(ITEMS).find(
      (i) => i.kind === 'weapon' && !i.soulbound && i.sellValue > 0,
    )!;
    expect(itemHover(weapon)).toContain(itemCombatTooltipLines(weapon));
    expect(itemHover(weapon)).toContain(vendorSellTooltipLine(weapon));
    const bomb = ITEMS.clockwork_shock_bomb;
    expect(itemHover(bomb)).toContain(factionRewardTooltipLines(bomb));
    const treat = ITEMS.gourdlight_treat_pouch;
    const effect = seasonalItemTooltipText(treat);
    expect(effect).toBeTruthy();
    expect(itemHover(treat)).toContain(esc(effect!));
  });
  it('retains a crafting pattern’s skill gate and product card without a personal skill or known-recipe claim', () => {
    const pattern = ITEMS.pattern_crucible_str_mail;
    const html = itemHover(pattern);
    expect(html).toContain('Requires ');
    expect(html).toContain('tt-recipe-product');
    expect(html).not.toContain('tt-red');
    expect(html).not.toContain('already know');
  });
});
