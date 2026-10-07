import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_QUESTS } from '../src/sim/content/proving_shore';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
import { DUNGEONS, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import { checkStaminaModel, primaryStatBudget } from '../src/sim/item_budget';
import { itemFromRaid, itemLevel, itemSourceLevel } from '../src/sim/item_level';
import {
  defaultRewardChoice,
  isOnRoleForSpec,
  QUEST_REWARD_SPEC_WEIGHTS,
  questRewardChoices,
  specStatWeights,
} from '../src/sim/quests/quest_reward_choice';
import { MAX_LEVEL, type PlayerClass, type QuestDef } from '../src/sim/types';

// Every quest a player levels through offers a choose-one armor reward
// (content/quest_choice_rewards.ts, from content/quest_leveling_gear.ts), so
// every class gets a gear option on every quest, not only the archetype whose
// fixed reward happens to fit. A quest that rewards a blue offers blues: its
// authored piece plus a rare for every role that piece does not serve.

const raidMobs = new Set(
  Object.values(DUNGEONS)
    .filter((d) => d.suggestedPlayers >= 10)
    .flatMap((d) => d.spawns.map((s) => s.mobId)),
);

// The generator's eligibility (scripts/quest_leveling_gear_gen.ts): tutorial
// island, retired and repeatable quests, raid quests and quests above the level
// cap are left out.
function levelingQuest(q: QuestDef): boolean {
  if (q.retired || q.repeatable) return false;
  // The tutorial island keeps its own rewards (owner call, 2026-10-07).
  if (PROVING_SHORE_QUESTS[q.id]) return false;
  const raid = q.objectives.some(
    (o) =>
      (o.type === 'kill' && raidMobs.has(o.targetMobId)) ||
      (o.type === 'collect' && itemFromRaid(o.itemId)),
  );
  if (raid) return false;
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

const BLUE = new Set(['rare', 'epic', 'legendary']);
// The authored per-archetype gear blues of a quest (QuestDef.itemRewards).
const authoredBlues = (q: QuestDef) =>
  [...new Set(Object.values(q.itemRewards))]
    .map((id) => ITEMS[id as string])
    .filter((i) => i?.slot !== undefined && BLUE.has(i.quality ?? ''));

// The offense stat a weight table or a stat line leads with.
function mainStat(stats: Partial<Record<string, number>>): 'str' | 'agi' | 'int' {
  return (['str', 'agi', 'int'] as const).reduce((best, stat) =>
    (stats[stat] ?? 0) > (stats[best] ?? 0) ? stat : best,
  );
}

describe('choose-one leveling gear', () => {
  it('leaves every tutorial island quest without a choice', () => {
    const offered = Object.keys(PROVING_SHORE_QUESTS).filter(
      (id) => QUESTS[id]?.choiceRewards?.length,
    );
    expect(offered).toEqual([]);
    expect(Object.keys(PROVING_SHORE_QUESTS).length).toBeGreaterThan(0);
  });

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
      for (const [cls, specs] of Object.entries(QUEST_REWARD_SPEC_WEIGHTS) as [
        PlayerClass,
        (typeof QUEST_REWARD_SPEC_WEIGHTS)[PlayerClass],
      ][]) {
        for (const spec of Object.keys(specs)) {
          const main = mainStat(specStatWeights(cls, spec));
          const offered = questRewardChoices(quest, cls);
          // An on-role piece with the main stat is always on offer: the band's
          // own piece for the role, or on a blue quest the authored blue or the
          // rare generated for the role.
          const fitting = offered.find(
            (id) => (ITEMS[id].stats?.[main] ?? 0) > 0 && isOnRoleForSpec(ITEMS[id], cls, spec),
          );
          // And the preselected card never carries a stat the spec does not use.
          const pick = defaultRewardChoice(quest, cls, spec);
          if (!fitting || !pick || !offered.includes(pick)) {
            gaps.push(`${questId} ${cls}/${spec} offered ${fitting ?? 'nothing'}`);
          } else if (!isOnRoleForSpec(ITEMS[pick], cls, spec)) {
            gaps.push(`${questId} ${cls}/${spec} defaults off-role to ${pick}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('preselects a blue with the main stat for every spec on a quest that rewards one', () => {
    // Fairness on dungeon-boss and elite quests: a holy paladin or a feral druid
    // handed their archetype's off-role blue still gets a rare at the quest's
    // level, and nobody's default is a green.
    const blueQuests = Object.keys(QUEST_CHOICE_REWARDS).filter(
      (id) => authoredBlues(QUESTS[id]).length > 0,
    );
    expect(blueQuests.length).toBeGreaterThan(0);
    const gaps: string[] = [];
    for (const questId of blueQuests) {
      const quest = QUESTS[questId];
      // Only rares are generated for it, at the quest's own rare item level.
      const floor = Math.min(...authoredBlues(quest).map((i) => itemLevel(i) ?? 0));
      for (const id of QUEST_CHOICE_REWARDS[questId]) {
        expect(ITEMS[id].quality, id).toBe('rare');
        expect(itemLevel(ITEMS[id]) ?? 0, id).toBeGreaterThanOrEqual(floor);
      }
      for (const [cls, specs] of Object.entries(QUEST_REWARD_SPEC_WEIGHTS) as [
        PlayerClass,
        (typeof QUEST_REWARD_SPEC_WEIGHTS)[PlayerClass],
      ][]) {
        for (const spec of Object.keys(specs)) {
          const pick = defaultRewardChoice(quest, cls, spec);
          const item = pick ? ITEMS[pick] : undefined;
          const main = mainStat(specStatWeights(cls, spec));
          if (!item || !BLUE.has(item.quality ?? '') || !((item.stats?.[main] ?? 0) > 0)) {
            gaps.push(`${questId} ${cls}/${spec} defaults to ${pick} (${item?.quality})`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('gives the hybrids their main stat in their heaviest armor', () => {
    // Measured, not assumed: enhancement and feral attack power is 2 per
    // Strength (+30 Strength was +19.7 and +23.7 DPS at level 20, +30 Agility
    // +6.2 and nothing), so neither may default to the Agility leather; balance
    // and restoration druids take Intellect in leather, never the cloth robe.
    // Pinned on the quests whose list is the band set alone; a quest that also
    // offers its authored piece may preselect that piece when it fits better.
    const cases: [PlayerClass, string, string, 'str' | 'agi' | 'int'][] = [
      ['shaman', 'enhancement', 'mail', 'str'],
      ['druid', 'feral', 'leather', 'str'],
      ['paladin', 'retribution', 'mail', 'str'],
      ['rogue', 'combat', 'leather', 'agi'],
      ['hunter', 'beast_mastery', 'leather', 'agi'],
      ['shaman', 'restoration', 'mail', 'int'],
      ['druid', 'balance', 'leather', 'int'],
      ['druid', 'restoration', 'leather', 'int'],
      ['priest', 'holy', 'cloth', 'int'],
    ];
    let pinned = 0;
    for (const questId of Object.keys(QUEST_CHOICE_REWARDS)) {
      for (const [cls, spec, armorType, stat] of cases) {
        const offered = questRewardChoices(QUESTS[questId], cls);
        if (offered.some((id) => !QUEST_LEVELING_GEAR_ITEMS[id])) continue;
        pinned++;
        const pick = defaultRewardChoice(QUESTS[questId], cls, spec) ?? '';
        expect(ITEMS[pick]?.armorType, `${questId} ${spec}`).toBe(armorType);
        expect(mainStat(ITEMS[pick]?.stats ?? {}), `${questId} ${spec}`).toBe(stat);
      }
    }
    expect(pinned).toBeGreaterThan(Object.keys(QUEST_CHOICE_REWARDS).length * 4);
  });

  it('prices every piece on its derived item level and the stamina model', () => {
    for (const item of Object.values(QUEST_LEVELING_GEAR_ITEMS)) {
      expect(ITEMS[item.id], item.id).toBe(item);
      const ilvl = itemLevel(item);
      expect(ilvl, `${item.id} item level`).toBeDefined();
      const check = checkStaminaModel(
        item.stats,
        primaryStatBudget(ilvl ?? 0, item.quality, item.slot ?? 'chest'),
      );
      expect(check.onLine && check.meetsFloor, `${item.id} on its budget line`).toBe(true);
      expect(item.stats?.armor ?? 0, `${item.id} armor`).toBeGreaterThan(0);
    }
  });

  it('never offers one quest two pieces of the same armor role', () => {
    for (const [questId, ids] of Object.entries(QUEST_CHOICE_REWARDS)) {
      const roles = ids.map((id) => `${ITEMS[id].armorType}:${mainStat(ITEMS[id].stats ?? {})}`);
      expect(new Set(roles).size, questId).toBe(ids.length);
      expect(new Set(ids.map((id) => ITEMS[id].slot)).size, questId).toBe(1);
    }
  });

  it('keeps mail above leather above cloth armor on every quest', () => {
    const rank = { cloth: 0, leather: 1, mail: 2 } as const;
    for (const [questId, ids] of Object.entries(QUEST_CHOICE_REWARDS)) {
      const pieces = ids.map((id) => ITEMS[id]);
      for (const a of pieces) {
        for (const b of pieces) {
          const ra = rank[a.armorType as keyof typeof rank];
          const rb = rank[b.armorType as keyof typeof rank];
          if (ra > rb) {
            expect(a.stats?.armor ?? 0, `${questId} ${a.id} vs ${b.id}`).toBeGreaterThan(
              b.stats?.armor ?? 0,
            );
          }
        }
      }
    }
  });
});
