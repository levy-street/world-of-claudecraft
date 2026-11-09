import {
  WEEKLY_EMISSARY_NPC_DEF,
  WEEKLY_QUEST_REWARD,
  WEEKLY_QUESTS,
} from '../../src/sim/content/weekly_quests';
import {
  WORLD_QUEST_COPPER,
  WORLD_QUEST_XP_RATE,
  WORLD_QUESTS,
} from '../../src/sim/content/world_quests';
import { ITEMS, MOBS, NPCS } from '../../src/sim/data';
import { MAX_LEVEL } from '../../src/sim/types';
import { t } from '../../src/ui/i18n';
import {
  worldQuestDisplayName,
  worldQuestFactionCurrencyRewardText,
  worldQuestObjectiveLabel,
  worldQuestRewardText,
  worldQuestStandingRewardText,
} from '../../src/ui/world_quest_view';
import { weeklyRoute, worldRoute } from './rotating_routes';

interface QuestWriter {
  add(title: string, body: string, categories: string[]): void;
  reserve(title: string): string;
  titleBy: Record<string, Map<string, string>>;
  link(title: string, label?: string): string;
  section(title: string, body: string): string;
  table(rows: string[][]): string;
  bullets(rows: string[]): string;
}

export function addRotatingQuests({
  add,
  reserve,
  titleBy,
  link,
  section,
  table,
  bullets,
}: QuestWriter) {
  titleBy.worldQuest = new Map();
  titleBy.weekly = new Map();
  const world: string[] = [];
  const weekly: string[] = [];
  for (const quest of WORLD_QUESTS) {
    const title = reserve(worldQuestDisplayName(quest.id) + ' (World Quest)');
    world.push(title);
    titleBy.worldQuest.set(quest.id, title);
    const obj = quest.objective;
    const zone = titleBy.zone.get(quest.zoneId)!;
    const rows = [
      ['Zone', link(zone)],
      ['Minimum level', String(quest.minLevel)],
      [
        'Objective area',
        'Within ' + quest.area.radius + ' yd of (' + quest.area.x + ', ' + quest.area.z + ').',
      ],
      ['Objective', worldQuestObjectiveLabel(quest.id)],
      ['Required progress', String(quest.count)],
    ];
    if ('instructorNpcId' in obj)
      rows.push([
        'Instructor',
        link(titleBy.npc.get(obj.instructorNpcId)!, NPCS[obj.instructorNpcId].name),
      ]);
    if ('targetMobId' in obj)
      rows.push(['Target', link(titleBy.mob.get(obj.targetMobId)!, MOBS[obj.targetMobId].name)]);
    if (obj.type === 'delivery')
      for (const [role, itemId] of [
        ['Collect from', obj.pickupObjectItemId],
        ['Deliver to', obj.deliveryObjectItemId],
      ]) {
        if (ITEMS[itemId]) rows.push([role, link(titleBy.item.get(itemId)!, ITEMS[itemId].name)]);
      }
    const copper = quest.reward?.copper ?? WORLD_QUEST_COPPER;
    const rewards = [
      [
        'Base experience',
        100 * (quest.reward?.xpRate ?? WORLD_QUEST_XP_RATE) +
          '% of the XP you need to finish your current level. It is rounded to the nearest whole XP, and is always at least 1.',
      ],
      ['Base purse', copper.base + ' copper + ' + copper.perLevel + ' copper per character level.'],
      ...Array.from({ length: MAX_LEVEL - quest.minLevel + 1 }, (_, i) => {
        const level = quest.minLevel + i;
        return [
          'Level ' + level,
          [
            worldQuestRewardText(quest, level),
            worldQuestStandingRewardText(quest, level),
            worldQuestFactionCurrencyRewardText(quest, level),
          ].join(' · '),
        ];
      }),
    ];
    add(
      title,
      section(
        'How to start',
        'When this quest is active, go into its marked area. You must be at least the minimum level. You get the reward as soon as you finish the goal.',
      ) +
        section('Walkthrough', worldRoute(quest)) +
        section('Objective', table(rows)) +
        section('Base rewards by character level', table(rewards)) +
        section(
          'Rotation',
          'On some days, this quest can also give gear or Honor. The gear depends on your class and level. See ' +
            link('World quests') +
            '.',
        ),
      ['World quests', zone],
    );
  }
  for (const quest of WEEKLY_QUESTS) {
    const title = reserve(t(`hudChrome.weekly.kinds.${quest.kind}.category`) + ' (Weekly Quest)');
    weekly.push(title);
    titleBy.weekly.set(quest.id, title);
    const reward = WEEKLY_QUEST_REWARD;
    add(
      title,
      section('The charge', t(`hudChrome.weekly.kinds.${quest.kind}.lore`)) +
        section(
          'Objective',
          t(`hudChrome.weekly.kinds.${quest.kind}.goal`, { count: quest.count }),
        ) +
        section('Walkthrough', weeklyRoute(quest)) +
        section(
          'How it works',
          'Choose one charge from ' +
            link(titleBy.npc.get(WEEKLY_EMISSARY_NPC_DEF.id)!, WEEKLY_EMISSARY_NPC_DEF.name) +
            ' for the week. A new week starts each Tuesday.',
        ) +
        section(
          'Rewards',
          bullets([
            reward.copper.base +
              ' copper + ' +
              reward.copper.perLevel +
              ' copper per character level.',
            reward.cacheCount +
              ' × ' +
              link(titleBy.item.get(reward.cacheItemId)!, ITEMS[reward.cacheItemId].name),
            'Claim ' +
              reward.commendationStanding +
              ' standing with one faction you choose, as long as your standing with it is below the most your level allows.',
          ]),
        ),
      ['Weekly quests'],
    );
  }
  add(
    'World quests',
    section(
      'Daily rotation',
      'A world quest starts when you walk into its area while it is active. The list of quests changes every day (on UTC time). Each quest page lists the level you need, the goal and the base rewards.',
    ) + section('Quest list', bullets(world.sort().map((name) => link(name)))),
    ['Quests'],
  );
  add('Weekly quests', section('Emissary charges', bullets(weekly.map((name) => link(name)))), [
    'Quests',
  ]);
}
