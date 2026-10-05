import { describe, expect, it } from 'vitest';
import { DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
import { DUNGEONS, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import { checkStaminaModel, primaryStatBudget } from '../src/sim/item_budget';
import { itemLevel, itemSourceLevel } from '../src/sim/item_level';
import { defaultRewardChoice, questRewardChoices } from '../src/sim/quests/quest_reward_choice';
import { MAX_LEVEL, type PlayerClass, type QuestDef } from '../src/sim/types';

// Every quest a player levels through offers a choose-one armor reward
// (content/quest_choice_rewards.ts, from content/quest_leveling_gear.ts), so
// every class gets a gear option on every quest, not only the archetype whose
// fixed reward happens to fit.

const raidMobs = new Set(
  Object.values(DUNGEONS)
    .filter((d) => d.suggestedPlayers >= 10)
    .flatMap((d) => d.spawns.map((s) => s.mobId)),
);

// The generator's eligibility (scripts/quest_leveling_gear_gen.ts): retired and
// repeatable quests, raid quests and quests above the level cap are left out.
function levelingQuest(q: QuestDef): boolean {
  if (q.retired || q.repeatable) return false;
  if (q.objectives.some((o) => o.type === 'kill' && raidMobs.has(o.targetMobId))) return false;
  // The hardest source item_level.ts prices a quest at: kill, collect, minLevel.
  const sources = q.objectives.map((o) =>
    o.type === 'kill'
      ? (MOBS[o.targetMobId]?.maxLevel ?? 0)
      : o.type === 'collect'
        ? (itemSourceLevel(o.itemId) ?? 0)
        : 0,
  );
  return Math.max(q.minLevel ?? 0, ...sources) <= MAX_LEVEL;
}

describe('choose-one leveling gear', () => {
  it('is offered by every quest a player levels through', () => {
    const missing = Object.values(QUESTS)
      .filter(levelingQuest)
      .filter((q) => !q.choiceRewards?.length)
      .map((q) => q.id);
    // A new quest needs its row: re-run scripts/quest_leveling_gear_gen.ts.
    expect(missing).toEqual([]);
    for (const questId of Object.keys(QUEST_CHOICE_REWARDS)) {
      expect(QUESTS[questId], questId).toBeDefined();
    }
  });

  it('offers every spec of every class a piece carrying its main stat', () => {
    const gaps: string[] = [];
    for (const questId of Object.keys(QUEST_CHOICE_REWARDS)) {
      const quest = QUESTS[questId];
      for (const [cls, roles] of Object.entries(DEV_KIT_ROLES) as [
        PlayerClass,
        (typeof DEV_KIT_ROLES)[PlayerClass],
      ][]) {
        for (const role of roles) {
          const offered = questRewardChoices(quest, cls);
          const main = (['str', 'agi', 'int'] as const).reduce((best, stat) =>
            (role.weights[stat] ?? 0) > (role.weights[best] ?? 0) ? stat : best,
          );
          const pick = defaultRewardChoice(quest, cls, role.spec);
          if (!pick || !offered.includes(pick) || (ITEMS[pick].stats?.[main] ?? 0) <= 0) {
            gaps.push(`${questId} ${cls}/${role.spec} -> ${pick ?? 'nothing'}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('prices every piece on its derived item level and the stamina model', () => {
    for (const item of Object.values(QUEST_LEVELING_GEAR_ITEMS)) {
      expect(ITEMS[item.id], item.id).toBe(item);
      const ilvl = itemLevel(item);
      expect(ilvl, `${item.id} item level`).toBeDefined();
      const check = checkStaminaModel(
        item.stats,
        primaryStatBudget(ilvl ?? 0, 'uncommon', item.slot ?? 'chest'),
      );
      expect(check.onLine && check.meetsFloor, `${item.id} on its budget line`).toBe(true);
      expect(item.stats?.armor ?? 0, `${item.id} armor`).toBeGreaterThan(0);
    }
  });

  it('never offers one quest two pieces of the same armor role', () => {
    for (const [questId, ids] of Object.entries(QUEST_CHOICE_REWARDS)) {
      const roles = ids.map((id) => {
        const s = ITEMS[id].stats ?? {};
        return `${ITEMS[id].armorType}:${(s.int ?? 0) > 0 ? 'caster' : 'physical'}`;
      });
      expect(new Set(roles).size, questId).toBe(ids.length);
      expect(new Set(ids.map((id) => ITEMS[id].slot)).size, questId).toBe(1);
    }
  });
});
