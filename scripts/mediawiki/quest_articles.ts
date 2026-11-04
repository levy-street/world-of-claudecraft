import {
  CLASSES,
  DUNGEONS,
  getActiveWorldContent,
  ITEMS,
  QUESTS,
  zoneContaining,
} from '../../src/sim/data';
import { requiredAmendsProgress } from '../../src/sim/professions/archetype';
import { questFixedReward, questRewardChoices } from '../../src/sim/quests/quest_reward_choice';
import {
  type PlayerClass,
  type QuestDef,
  type QuestObjective,
  questTurnInNpcIds,
  TICK_RATE,
} from '../../src/sim/types';
import { type ArticleTools, append, lines, recipeLabel, ref, words } from './entity_format';
import { questRoute } from './quest_route';

export function questZoneName(quest: QuestDef | undefined): string {
  const giver = quest && getActiveWorldContent().npcs[quest.giverNpcId];

  if (giver && (!giver.dynamic || giver.fixedPost || giver.id === 'drillmaster_hale')) {
    const zone = zoneContaining(giver.pos.x, giver.pos.z);

    if (zone) return zone.name;
  }

  return 'Other locations';
}

function target(w: ArticleTools, o: QuestObjective): string {
  switch (o.type) {
    case 'kill':
      return ref(w, 'mob', o.targetMobId);

    case 'collect':
      return ref(w, 'item', o.itemId);

    case 'interact':
      return o.targetNpcId
        ? ref(w, 'npc', o.targetNpcId)
        : o.targetObjectItemId && ITEMS[o.targetObjectItemId]
          ? ref(w, 'item', o.targetObjectItemId)
          : '';

    case 'craft':
      return recipeLabel(w, o.recipeId);

    case 'gather':
      return o.itemId ? ref(w, 'item', o.itemId) : words(o.nodeType!);

    default:
      return '';
  }
}

export function addQuestArticles(w: ArticleTools, itemSources: Map<string, Set<string>>) {
  for (const quest of Object.values(QUESTS)) {
    const zone = questZoneName(quest);

    const facts: [string, string][] = [
      ['Starts with', ref(w, 'npc', quest.giverNpcId)],
      [
        'Turn in to',
        questTurnInNpcIds(quest)
          .map((id) => ref(w, 'npc', id))
          .join(' or '),
      ],

      ['Starting area', zone],
      ['Base experience', String(quest.xpReward)],
      ['Base money', w.money(quest.copperReward)],
    ];

    if (quest.minLevel) facts.push(['Minimum level', String(quest.minLevel)]);

    if (quest.maxLevel) facts.push(['Highest level to accept', String(quest.maxLevel)]);

    if (quest.requiredClass)
      facts.push(['Classes', quest.requiredClass.map((c) => ref(w, 'class', c)).join(', ')]);

    if (quest.requiresQuest) facts.push(['First complete', ref(w, 'quest', quest.requiresQuest)]);

    if (quest.requiresRidingTrained) facts.push(['Training', 'Learn riding before accepting.']);

    if (quest.requiresUsableHealAbility)
      facts.push(['Ability required', 'Learn a usable healing ability.']);

    if (quest.suggestedPlayers)
      facts.push(['Suggested group size', String(quest.suggestedPlayers)]);

    if (quest.gatedWithDungeon)
      facts.push([
        'Dungeon gate',
        ref(w, 'dungeon', quest.gatedWithDungeon) +
          (DUNGEONS[quest.gatedWithDungeon]?.guideVisible === false
            ? ' is unlisted in the public guide, so new players cannot accept this quest.'
            : ' is currently listed in the public guide. Its visibility is required to accept this quest.'),
      ]);

    if (quest.retired)
      facts.push(['Retired', 'Finishable if already in your log. Closed to new players.']);

    if (quest.seasonalEvent) facts.push(['Event', words(quest.seasonalEvent)]);

    if (quest.shareable === false)
      facts.push(['Sharing', 'Each player must accept it independently.']);

    if (quest.repeatable)
      facts.push([
        'Repeatable',
        quest.weeklyReset
          ? 'After the weekly reset.'
          : quest.dailyReset
            ? 'After the daily reset.'
            : quest.repeatCadenceTicks
              ? quest.repeatCadenceTicks / TICK_RATE / 3600 + ' hours after turn-in.'
              : 'Immediately after turn-in.',
      ]);

    const objectives = quest.objectives.map((o, i) => {
      const t = target(w, o);

      const count =
        quest.resolvedObjectiveCounts === 'archetypeAmends' && i === 0
          ? requiredAmendsProgress(0) +
            ' plus ' +
            (requiredAmendsProgress(1) - requiredAmendsProgress(0)) +
            ' per previous switch'
          : String(o.count);

      return o.label + ' (required: ' + count + ')' + (t ? '. Target: ' + t : '');
    });

    if (quest.objectives.some((o) => o.type === 'collect'))
      objectives.push(
        quest.keepsCollectedItems
          ? 'Keep the collected items after turn-in. Equipped copies count.'
          : 'Hand over the requested items at turn-in.',
      );

    if (quest.requiredItems?.length)
      objectives.push(
        'If missing, these items are reissued on acceptance: ' +
          quest.requiredItems.map((id) => ref(w, 'item', id)).join(', ') +
          '.',
      );

    const byReward = new Map<string, string[]>();

    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const fixed = questFixedReward(quest, cls);

      const choice = questRewardChoices(quest, cls);

      if (!fixed && !choice.length) continue;

      const text = [
        fixed ? 'Receive ' + ref(w, 'item', fixed) + '.' : '',
        choice.length
          ? 'Choose one of ' + choice.map((id) => ref(w, 'item', id)).join(', ') + '.'
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      const classes = byReward.get(text) ?? [];

      classes.push(ref(w, 'class', cls));

      byReward.set(text, classes);

      for (const itemId of [...choice, ...(fixed ? [fixed] : [])])
        append(
          itemSources,
          itemId,
          'Quest reward from ' + ref(w, 'quest', quest.id) + '. See the class reward list.',
        );
    }

    const rewards = Array.from(
      byReward,
      ([reward, classes]) =>
        (classes.length === Object.keys(CLASSES).length ? 'All classes' : classes.join(', ')) +
        ': ' +
        reward,
    );

    if (quest.recipeReward)
      rewards.push(
        'Learn to make ' +
          recipeLabel(w, quest.recipeReward) +
          '. Meet the recipe skill requirement to turn in.',
      );

    const route = questRoute(quest);

    const markers: [string, string][] = route.points.map((p) => [
      String(p.step),
      p.label +
        ' at (' +
        Number(p.x.toFixed(2)) +
        ', ' +
        Number(p.z.toFixed(2)) +
        ') in ' +
        p.frame +
        (p.radius ? ', within ' + Number(p.radius.toFixed(2)) + ' yd' : ''),
    ]);

    const steps = quest.objectives.map((o, i) => {
      const n = o.count;

      const what = target(w, o);

      const instructions = route.notes.filter((r) => r.step === i + 1).map((r) => r.text);

      const places = route.points.filter((p) => p.step === i + 1);

      let action: string;

      switch (o.type) {
        case 'kill':
          action = 'Defeat ' + what + ' ' + (n === 1 ? 'once' : n + ' times') + '.';
          break;

        case 'collect':
          action =
            'Collect ' +
            n +
            ' × ' +
            what +
            '. ' +
            (quest.keepsCollectedItems
              ? 'Equipped copies count. You keep them at turn-in.'
              : 'Keep the required items in your bags for turn-in.');
          break;

        case 'gather':
          action =
            'Harvest ' +
            what +
            ' until you earn ' +
            n +
            ' gathering credits. Merely buying the material does not count.';
          break;

        case 'craft':
          action = 'Make ' + what + ' ' + n + ' time' + (n === 1 ? '' : 's') + '.';
          break;

        case 'farm':
          action =
            (o.action === 'plant' ? 'Plant' : 'Harvest') +
            ' ' +
            (o.cropId ? words(o.cropId) : 'a crop') +
            ' ' +
            n +
            ' time' +
            (n === 1 ? '' : 's') +
            '.';
          break;

        case 'escort':
          action = 'Start the escort and follow the waypoints below.';
          break;

        case 'interact':
          action = o.targetNpcId ? 'Speak to ' + what + '.' : o.label + ' (required: ' + n + ').';
          break;

        case 'event':
          action = o.label + ' (required: ' + n + ').';
          break;
      }

      if (quest.resolvedObjectiveCounts === 'archetypeAmends' && i === 0)
        action = objectives[0] + '.';

      if (places.length)
        action +=
          ' ' +
          places[0].label +
          ' at (' +
          Number(places[0].x.toFixed(2)) +
          ', ' +
          Number(places[0].z.toFixed(2)) +
          ')' +
          (places[0].frame === 'Overworld' ? '' : ' inside ' + places[0].frame) +
          '.';

      return '# ' + [action, ...instructions].join(' ');
    });

    const directions =
      w.section(
        'Walkthrough',
        'Accept the quest from ' +
          ref(w, 'npc', quest.giverNpcId) +
          '.\n\n' +
          steps.join('\n') +
          '\n\nHand in to ' +
          questTurnInNpcIds(quest)
            .map((id) => ref(w, 'npc', id))
            .join(' or ') +
          '.',
      ) +
      (w.questMap?.(route) ??
        w.section(
          'Coordinates',
          'Coordinates are X, Z in yards. Instance coordinates are measured from the room origin.\n\n' +
            w.table(markers),
        ));

    const e = quest.completionEffect;

    if (e)
      rewards.push(
        e.type === 'switchHobby'
          ? 'Switch to the selected hobby.'
          : 'Attune the ' + (e.pairId ? words(e.pairId) : 'selected') + ' profession pair.',
      );

    const next = Object.values(QUESTS)
      .filter((q) => q.requiresQuest === quest.id)
      .map((q) => ref(w, 'quest', q.id));

    w.add(
      w.titleBy.quest.get(quest.id)!,
      w.section(
        'Quest text',
        quest.text.replaceAll('$N', 'adventurer').replaceAll('$C', 'adventurer'),
      ) +
        w.section('Facts', w.table(facts)) +
        lines(w, 'Objectives', objectives) +
        directions +
        w.section(
          'Completion',
          quest.completionText.replaceAll('$N', 'adventurer').replaceAll('$C', 'adventurer'),
        ) +
        lines(w, 'Rewards', rewards) +
        lines(w, 'Unlocks', next),
      ['Quests', zone],
    );
  }
}
