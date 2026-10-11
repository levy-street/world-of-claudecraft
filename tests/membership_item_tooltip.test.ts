import { describe, expect, it } from 'vitest';
import { MEMBERSHIP_ITEMS } from '../src/sim/content/membership';
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

function harness(sim: Sim): {
  itemTooltip(
    item: ItemDef,
    compare: boolean,
    instance?: ItemInstancePayload,
    materialSources?: undefined,
    wearer?: MembershipTooltipWearer,
  ): string;
} {
  const hud = Object.create(Hud.prototype);
  hud.sim = sim;
  hud.optionsHooks = null;
  return hud;
}

describe('membership armour tooltip matches live stats', () => {
  it.each([5, 19, 20])(
    'shows the live stats and tier at level %s even with item levels hidden',
    (level) => {
      const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
      sim.player.level = level;
      sim.player.membershipActive = true;
      const item = MEMBERSHIP_ITEMS.membership_chest;
      const effective = membershipTooltipItem(item, sim);
      const meta = sim.meta(sim.player.id)!;
      const mods = sim.playerMods(meta);
      recalcPlayerStats(sim.player, 'warrior', {}, mods, {});
      const before = { ...sim.player.stats };
      recalcPlayerStats(sim.player, 'warrior', { chest: item.id }, mods, {});
      const html = harness(sim).itemTooltip(item, false);
      for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
        const gain = effective.stats?.[stat] ?? 0;
        expect(sim.player.stats[stat] - before[stat]).toBe(gain);
        if (gain)
          expect(html).toContain(
            t('itemUi.tooltip.stat', {
              value: itemNumber(gain),
              stat: itemStatName(stat),
            }),
          );
      }
      expect(html).toContain(
        t('hudChrome.options.itemLevelLine', { level: itemNumber(level < 20 ? level : 25) }),
      );
      expect(html).toContain('all 7 membership armor pieces');
      expect(html).toContain('20% more experience');
      if (level === 20) expect(html).toContain('Perfected: item level 25');
    },
  );

  it('changes caster affixes on a specialization change and suppresses all benefits while dormant', () => {
    const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: false });
    sim.player.level = 20;
    sim.player.membershipActive = true;
    expect(sim.setSpec('fire')).toBe(true);
    expect(harness(sim).itemTooltip(MEMBERSHIP_ITEMS.membership_chest, false)).toContain(
      'Spell Power',
    );
    expect(sim.setSpec('arcane')).toBe(true);
    expect(harness(sim).itemTooltip(MEMBERSHIP_ITEMS.membership_chest, false)).toContain(
      'Healing Power',
    );
    sim.player.membershipActive = false;
    const html = harness(sim).itemTooltip(MEMBERSHIP_ITEMS.membership_chest, false, {
      rolled: { stats: { spellPower: 999 } },
    });
    expect(html).toContain('Inactive: renew your membership');
    expect(html).not.toContain('999');
    expect(html).not.toContain('Healing Power');
    expect(html).not.toContain('Spell Power');
  });

  it('inspects the wearer class, specialization, level and entitlement instead of the viewer', () => {
    const viewer = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    viewer.player.level = 5;
    viewer.player.membershipActive = false;
    const wearer: MembershipTooltipWearer = {
      templateId: 'mage',
      level: 20,
      specId: 'arcane',
      membershipActive: true,
    };
    const tooltip = () =>
      harness(viewer).itemTooltip(
        MEMBERSHIP_ITEMS.membership_chest,
        false,
        { rolled: { stats: { spellPower: 999 } } },
        undefined,
        wearer,
      );
    const active = tooltip();
    expect(active).toContain('Healing Power');
    expect(active).toContain('Perfected: item level 25');
    expect(active).not.toContain('Inactive:');
    expect(active).not.toContain('tt-armor-bad');
    wearer.membershipActive = false;
    viewer.player.membershipActive = true;
    const dormant = tooltip();
    expect(dormant).toContain('Inactive:');
    expect(dormant).not.toContain('Healing Power');
    expect(dormant).not.toContain('999');
  });

  it('explains duration, carried-over time, and trading before redemption', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const html = harness(sim).itemTooltip(MEMBERSHIP_ITEMS.membership_token, false);
    expect(html).toContain('add 30 days');
    expect(html).toContain('remaining membership time is kept');
    expect(html).toContain('auction house before redemption');
  });

  it('compares replacement gear against dormant armour without counting stored enchants', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const meta = sim.meta(sim.player.id)!;
    meta.equipment.chest = 'membership_chest';
    meta.equipmentInstance.chest = { rolled: { stats: { str: 999 } } };
    const replacement: ItemDef = {
      id: 'comparison_probe',
      name: 'Comparison Probe',
      kind: 'armor',
      armorType: 'cloth',
      slot: 'chest',
      stats: { str: 2 },
      sellValue: 0,
    };
    const html = harness(sim).itemTooltip(replacement, true);
    expect(html).toContain('Currently equipped');
    expect(html).toContain('Inactive: renew your membership');
    expect(html).toContain('+2 Strength');
    expect(html).not.toContain('999');
    expect(html).not.toContain('997');
    expect(meta.equipmentInstance.chest.rolled?.stats?.str).toBe(999);
  });
});
