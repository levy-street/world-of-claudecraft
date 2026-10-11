import { describe, expect, it } from 'vitest';
import { rangedShotProfile } from '../src/sim/combat/ranged_shot';
import { ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import {
  PRIMARY_STATS,
  realizedLineBudget,
  staminaBaseline,
  statIdentity,
} from '../src/sim/item_budget';
import { activeItemInstanceStats } from '../src/sim/item_instance_stats';
import { itemLevel } from '../src/sim/item_level';
import {
  type LootQualityDescriptor,
  lootQualityBonuses,
  lootQualityWeapon,
  qualityLineBudget,
} from '../src/sim/loot_quality';
import { isEnchantedInstance } from '../src/sim/professions/enchanting';
import { type ItemInstancePayload, SPELL_POWER_PER_INT } from '../src/sim/types';

const quality: LootQualityDescriptor = { version: 1, tier: 4, weights: [700, 200, 300, 800, 400] };
const instance: ItemInstancePayload = { lootQuality: quality };

describe('loot quality combat integration', () => {
  it('gives every catalog primary line only its tier curve delta, preserving authored power', () => {
    let checked = 0;
    for (const item of Object.values(ITEMS)) {
      const level = itemLevel(item);
      if (
        !level ||
        !item.stats ||
        !['weapon', 'armor', 'held_offhand'].includes(item.kind) ||
        !['uncommon', 'rare', 'epic', 'legendary'].includes(item.quality ?? '')
      )
        continue;
      const base = realizedLineBudget(item.stats);
      if (!base) continue;
      for (const tier of [1, 2, 3, 4] as const) {
        const bonus = lootQualityBonuses(item, { lootQuality: { ...quality, tier } });
        const delta = qualityLineBudget(item, level + 2 * tier) - qualityLineBudget(item, level);
        const expected =
          delta +
          (statIdentity(item.stats) === 'caster' && (item.stats.sta ?? 0) > 0
            ? staminaBaseline(base + delta) - staminaBaseline(base)
            : 0);
        expect(
          PRIMARY_STATS.reduce((n, k) => n + (bonus[k] ?? 0), 0),
          `${item.id} T${tier}`,
        ).toBe(expected);
        for (const k of PRIMARY_STATS) {
          expect(bonus[k] ?? 0).toBeGreaterThanOrEqual(0);
          if (!(item.stats[k] ?? 0)) expect(bonus[k] ?? 0).toBe(0);
        }
        if ((item.stats.sta ?? 0) > 0 && (item.stats.sta ?? 0) >= staminaBaseline(base)) {
          expect(
            (item.stats.sta ?? 0) + (bonus.sta ?? 0),
            `${item.id} final stamina floor`,
          ).toBeGreaterThanOrEqual(staminaBaseline(base + delta));
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it.each(['spellPower', 'healPower'] as const)('applies %s to its actual combat lane', (lane) => {
    const item = Object.values(ITEMS).find(
      (i) => i.slot === 'chest' && i.quality === 'epic' && (i[lane] ?? 0) > 10,
    )!;
    expect(item).toBeDefined();
    const p = createPlayer(1, 'priest', { x: 0, y: 0, z: 0 }, 'Probe');
    p.level = 20;
    recalcPlayerStats(p, 'priest', { chest: item.id }, undefined, {});
    const plain = { sp: p.spellPower, hp: p.healPower, sta: p.stats.sta, int: p.stats.int };
    recalcPlayerStats(p, 'priest', { chest: item.id }, undefined, { chest: instance });
    const bonus = lootQualityBonuses(item, instance);
    expect(p.stats.sta - plain.sta).toBe(bonus.sta ?? 0);
    expect(p.stats.int - plain.int).toBe(bonus.int ?? 0);
    const intellectSpellDelta =
      Math.round(p.stats.int * SPELL_POWER_PER_INT) - Math.round(plain.int * SPELL_POWER_PER_INT);
    expect(p.spellPower - plain.sp).toBe(intellectSpellDelta + (bonus.spellPower ?? 0));
    expect(p.healPower - plain.hp).toBe(
      intellectSpellDelta + (bonus.spellPower ?? 0) + (bonus.healingPower ?? 0),
    );
    expect(p.healPower - p.spellPower - (plain.hp - plain.sp)).toBe(bonus.healingPower ?? 0);
    if (lane === 'healPower') expect(bonus.healingPower).toBeGreaterThan(0);
    else expect(bonus.spellPower).toBeGreaterThan(0);
  });

  it('equips exact mainhand and offhand damage and uses the hunter weapon for ranged shots', () => {
    const item = ITEMS.duskwhisper;
    const p = createPlayer(1, 'rogue', { x: 0, y: 0, z: 0 }, 'Probe');
    p.level = 20;
    recalcPlayerStats(p, 'rogue', { mainhand: item.id, offhand: item.id }, undefined, {
      mainhand: instance,
      offhand: instance,
    });
    expect(p.weapon).toEqual(lootQualityWeapon(item, instance));
    expect(p.offhandWeapon).toEqual(p.weapon);
    expect(p.weapon.min).toBeGreaterThan(item.weapon!.min);
    expect(p.weapon.speed).toBe(item.weapon!.speed);
    expect(rangedShotProfile({ min: 1, max: 2, speed: 1 }, p.weapon)).toEqual({
      min: p.weapon.min,
      max: p.weapon.max,
      speed: p.weapon.speed,
    });
    expect(rangedShotProfile({ min: 1, max: 2, speed: 1, wand: true }, p.weapon)).toEqual({
      min: 1,
      max: 2,
      speed: 1,
    });
  });

  it('keeps quality separate from enchant identity and never scales enchant stats', () => {
    const item = ITEMS.duskwhisper;
    expect(isEnchantedInstance(instance)).toBe(false);
    const enchanted = {
      ...instance,
      enchant: 'enchant_weapon_crusader',
      rolled: { stats: { str: 17, spellPower: 23 } },
    };
    expect(isEnchantedInstance(enchanted)).toBe(true);
    const derived = activeItemInstanceStats(enchanted, item)!;
    const bonus = lootQualityBonuses(item, instance);
    expect(derived.str).toBe(17 + (bonus.str ?? 0));
    expect(derived.spellPower).toBe(23 + (bonus.spellPower ?? 0));
    expect(enchanted.rolled.stats).toEqual({ str: 17, spellPower: 23 });
  });
});
