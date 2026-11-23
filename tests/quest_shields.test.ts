// The three leveling quest shields (src/sim/content/quest_shields.ts): one per
// starting zone, paid to the warrior/paladin/shaman archetype by a quest that
// previously granted no item. Pins the quest wiring, the class reach through the
// REWARD_ARCHETYPE fallback, each shield's quality and the item level its quest
// confers, the exact stat budget, the shield ladder ordering, the greens sitting
// under the same-band rare, and a real turn-in grant through the Sim.
import { describe, expect, it } from 'vitest';
import { QUEST_SHIELD_ART_PENDING_ITEM_IDS } from '../src/sim/content/quest_shields';
import { ITEMS, QUESTS, questRewardItem } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { expectedStatBudget, itemLevel, itemStaminaModel } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';
import { ITEM_ART_PENDING, itemImageUrl } from '../src/ui/icons';

const SHIELD_CLASSES: readonly PlayerClass[] = ['warrior', 'paladin', 'shaman'];

const CASES = [
  {
    questId: 'q_bones',
    zone: 'Eastbrook Vale',
    itemId: 'lychgate_buckler',
    quality: 'uncommon',
    ilvl: 8,
    budget: 2,
  },
  {
    questId: 'q_bastion_door',
    zone: 'Mirefen Marsh',
    itemId: 'bastion_kite_shield',
    quality: 'uncommon',
    ilvl: 13,
    budget: 4,
  },
  {
    questId: 'q_revenants',
    zone: 'Thornpeak Heights',
    itemId: 'barrowfield_tower_shield',
    quality: 'rare',
    ilvl: 22,
    budget: 9,
  },
] as const;

describe('leveling quest shields', () => {
  for (const c of CASES) {
    it(`${c.questId} (${c.zone}) pays ${c.itemId} to exactly the shield classes`, () => {
      const quest = QUESTS[c.questId];
      expect(quest.itemRewards).toEqual({ warrior: c.itemId });
      for (const cls of ALL_CLASSES) {
        const reward = questRewardItem(quest, cls);
        if (SHIELD_CLASSES.includes(cls)) expect(reward, cls).toBe(c.itemId);
        else expect(reward, cls).toBeUndefined();
      }
    });

    it(`${c.itemId} is a ${c.quality} shield only the shield classes can equip`, () => {
      const item = ITEMS[c.itemId];
      expect(item).toMatchObject({
        kind: 'armor',
        armorType: 'mail',
        slot: 'offhand',
        shield: true,
        quality: c.quality,
      });
      for (const cls of ALL_CLASSES) {
        expect(canEquipItem(cls, item), cls).toBe(SHIELD_CLASSES.includes(cls));
      }
    });

    it(`${c.itemId} reads item level ${c.ilvl} and carries exactly its stat budget`, () => {
      const item = ITEMS[c.itemId];
      expect(itemLevel(item)).toBe(c.ilvl);
      expect(expectedStatBudget(item)).toBe(c.budget);
      const model = itemStaminaModel(item);
      expect(model?.identity).toBe('physical');
      expect((item.stats?.sta ?? 0) + (item.stats?.str ?? 0)).toBe(c.budget);
      expect(item.stats?.sta ?? 0).toBeGreaterThanOrEqual(
        model?.baseline ?? Number.POSITIVE_INFINITY,
      );
    });
  }

  it('climbs the shield ladder: armor, block, and sell value rise with each zone', () => {
    const rows = CASES.map((x) => {
      const item = ITEMS[x.itemId] as ItemDef & { blockValue?: number };
      return [item.stats?.armor ?? 0, item.blockValue ?? 0, item.sellValue] as const;
    });
    for (let i = 1; i < rows.length; i++) {
      for (let k = 0; k < 3; k++) expect(rows[i - 1][k]).toBeLessThan(rows[i][k]);
    }
  });

  it('gates only the rare: the greens equip at 1, the tower shield at its source level 19', () => {
    expect(requiredLevelFor(ITEMS.lychgate_buckler)).toBe(1);
    expect(requiredLevelFor(ITEMS.bastion_kite_shield)).toBe(1);
    expect(requiredLevelFor(ITEMS.barrowfield_tower_shield)).toBe(19);
  });

  it('the greens never out-mitigate the same-band rare shield (pearlward_aegis)', () => {
    const rare = ITEMS.pearlward_aegis as ItemDef & { blockValue?: number };
    expect(rare.quality).toBe('rare');
    for (const c of CASES.filter((x) => x.quality === 'uncommon')) {
      const item = ITEMS[c.itemId] as ItemDef & { blockValue?: number };
      expect(item.stats?.armor ?? 0, c.itemId).toBeLessThan(rare.stats?.armor ?? 0);
      expect(item.blockValue ?? 0, c.itemId).toBeLessThan(rare.blockValue ?? 0);
    }
  });

  it('serves dedicated painted art for all three quest shields', () => {
    expect(QUEST_SHIELD_ART_PENDING_ITEM_IDS).toEqual([]);
    for (const c of CASES) {
      expect(ITEM_ART_PENDING.has(c.itemId)).toBe(false);
      expect(itemImageUrl(c.itemId)).toBe(`/ui/items/${c.itemId}.webp`);
    }
  });

  it('a real turn-in grants the shield to a paladin and nothing to a mage', () => {
    for (const [cls, expected] of [
      ['paladin', 1],
      ['mage', 0],
    ] as const) {
      const sim = new Sim({ seed: 1, playerClass: cls, playerName: 'Q', autoEquip: false });
      const quest = QUESTS.q_bones;
      // biome-ignore lint/suspicious/noExplicitAny: test reaches the primary meta like quest_reward.test.ts
      const meta = (sim as any).primary;
      meta.questLog.set('q_bones', { questId: 'q_bones', state: 'ready', counts: [8] });
      sim.addItem('restless_skull', 8);
      const npc = [...sim.entities.values()].find(
        (e) => e.kind === 'npc' && e.templateId === quest.turnInNpcId,
      );
      expect(npc).toBeDefined();
      sim.player.pos = { ...npc!.pos };
      const before = sim.countItem('lychgate_buckler');
      sim.turnInQuest('q_bones');
      expect(sim.countItem('lychgate_buckler') - before, cls).toBe(expected);
    }
  });
});
