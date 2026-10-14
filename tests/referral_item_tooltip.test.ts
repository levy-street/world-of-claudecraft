import { describe, expect, it } from 'vitest';
import { REFERRAL_ITEMS } from '../src/sim/content/referral';
import { recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import { t } from '../src/ui/i18n';
import { itemNumber, itemStatName } from '../src/ui/item_instance_tooltip';
import {
  type MembershipTooltipWearer,
  membershipTooltipItem,
} from '../src/ui/membership_item_tooltip';

function tooltip(sim: Sim) {
  const hud = Object.create(Hud.prototype);
  hud.sim = sim;
  hud.optionsHooks = null;
  return (
    item: ItemDef,
    instance?: ItemInstancePayload,
    wearer?: MembershipTooltipWearer,
  ): string => hud.itemTooltip(item, false, instance, undefined, wearer);
}

describe('friendship armour tooltips', () => {
  it.each([5, 19, 20])('matches live stats at level %s without personal membership', (level) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.player.level = level;
    sim.player.referralInviterName = 'Aldric';
    const item = REFERRAL_ITEMS.referral_chest;
    const projected = membershipTooltipItem(item, sim);
    const mods = sim.playerMods(sim.meta(sim.player.id)!);
    recalcPlayerStats(sim.player, 'warrior', {}, mods, {});
    const before = { ...sim.player.stats };
    recalcPlayerStats(sim.player, 'warrior', { chest: item.id }, mods, {});
    const html = tooltip(sim)(item);
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
      const gain = projected.stats?.[stat] ?? 0;
      expect(sim.player.stats[stat] - before[stat]).toBe(gain);
      if (gain)
        expect(html).toContain(
          t('itemUi.tooltip.stat', { value: itemNumber(gain), stat: itemStatName(stat) }),
        );
    }
    expect(html).toContain('all 7 friendship armor pieces');
    expect(html).toContain('20% more experience while in a party with Aldric');
    expect(html).toContain('Their membership must be active');
    expect(html).not.toContain('renew your membership');
    expect(html).toContain(
      t('hudChrome.options.itemLevelLine', { level: itemNumber(level < 20 ? level : 25) }),
    );
  });

  it('uses the inspected wearer and escapes their inviter name', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.player.referralInviterName = 'ViewerInviter';
    const wearer: MembershipTooltipWearer = {
      templateId: 'mage',
      level: 20,
      specId: 'arcane',
      referralInviterName: '<Aldric&>',
    };
    const html = tooltip(sim)(REFERRAL_ITEMS.referral_chest, undefined, wearer);
    expect(html).toContain('Healing Power');
    expect(html).toContain('&lt;Aldric&amp;&gt;');
    expect(html).not.toContain('ViewerInviter');
    expect(html).not.toContain('<Aldric&>');
    wearer.referralInviterName = undefined;
    const dormant = tooltip(sim)(
      REFERRAL_ITEMS.referral_chest,
      { rolled: { stats: { spellPower: 999 } } },
      wearer,
    );
    expect(dormant).toContain('Inactive: this account');
    expect(dormant).not.toContain('999');
    expect(dormant).not.toContain('Healing Power');
  });

  it('tracks specialization without granting an always-on member XP description', () => {
    const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: false });
    sim.player.level = 20;
    sim.player.referralInviterName = 'Aldric';
    sim.setSpec('fire');
    expect(tooltip(sim)(REFERRAL_ITEMS.referral_chest)).toContain('Spell Power');
    sim.setSpec('arcane');
    const html = tooltip(sim)(REFERRAL_ITEMS.referral_chest);
    expect(html).toContain('Healing Power');
    expect(html).toContain('while in a party with Aldric');
    expect(html).not.toContain('membership armor pieces');
  });
});
