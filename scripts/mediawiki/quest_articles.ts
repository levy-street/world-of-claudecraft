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
import { type TranslationKey, t } from '../../src/ui/i18n';
import { questObjectiveText } from './article_editorial';
import { type ArticleTools, append, lines, recipeLabel, ref, words } from './entity_format';
import { itemNpcPoints } from './item_npc_route';
import { type QuestRoute, questRoute } from './quest_route';

/** Event ids read as titles ("gourdlight_eve" is the page "Gourdlight Eve"). */
const eventName = (id: string) => t(`seasonal.event.${id}.name` as TranslationKey);

function contact(
  w: ArticleTools,
  ids: readonly string[],
  route: QuestRoute,
  step: 'Start' | 'Hand-in',
) {
  const npcs = getActiveWorldContent().npcs;
  return ids
    .map((id) => {
      const name = npcs[id]?.name;
      // Two contacts can share a name (both Brother Alderics), so with several contacts a
      // stop counts for this one only if it is one of this contact's own posts.
      const own = ids.length > 1 ? itemNpcPoints('Reward', id) : [];
      const locations = route.points.filter(
        (p) =>
          p.step === step &&
          (ids.length === 1 ||
            (name &&
              (p.label === name || p.label.startsWith(name + ' (')) &&
              own.some((o) => Math.abs(o.x - p.x) < 0.01 && Math.abs(o.z - p.z) < 0.01))),
      );
      const stops = locations.map((p) => {
        const place =
          p.frame === 'Overworld' ? (zoneContaining(p.x, p.z)?.name ?? p.frame) : p.frame;
        return place + ' (' + Number(p.x.toFixed(2)) + ', ' + Number(p.z.toFixed(2)) + ')';
      });
      return ref(w, 'npc', id) + (stops.length ? ' · ' + [...new Set(stops)].join(' or ') : '');
    })
    .join(' or ');
}

export function questZoneName(quest: QuestDef | undefined): string {
  const giver = quest && getActiveWorldContent().npcs[quest.giverNpcId];

  // A system-spawned giver still stands at its authored post; the origin marks none.
  if (giver && (giver.pos.x !== 0 || giver.pos.z !== 0)) {
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
      return o.itemId
        ? ref(w, 'item', o.itemId)
        : t(`hudChrome.gathering.nodeName.${o.nodeType}` as TranslationKey);

    default:
      return '';
  }
}

export function addQuestArticles(w: ArticleTools, itemSources: Map<string, Set<string>>) {
  for (const quest of Object.values(QUESTS)) {
    const zone = questZoneName(quest);
    const dungeonClosed =
      quest.gatedWithDungeon && DUNGEONS[quest.gatedWithDungeon]?.guideVisible === false;
    const closed = quest.retired || dungeonClosed;
    const availability = quest.retired
      ? "'''Retired quest.''' The quest giver does not offer it anymore. If it is already in your quest log, you can still finish it."
      : dungeonClosed
        ? `'''Unavailable for new starts.''' The quest giver only offers this quest while ${ref(w, 'dungeon', quest.gatedWithDungeon!)} is open for it.`
        : quest.seasonalEvent
          ? "'''Seasonal quest.''' The quest giver only offers it during " +
            eventName(quest.seasonalEvent) +
            '.'
          : '';
    const route = questRoute(quest);

    const facts: [string, string][] = [
      ['Start', contact(w, [quest.giverNpcId], route, 'Start')],
      ['Hand in', contact(w, questTurnInNpcIds(quest), route, 'Hand-in')],
      ['Minimum level', String(quest.minLevel ?? 1)],
    ];

    if (quest.maxLevel) facts.push(['Highest level to accept', String(quest.maxLevel)]);

    if (quest.requiredClass)
      facts.push(['Classes', quest.requiredClass.map((c) => ref(w, 'class', c)).join(', ')]);

    if (quest.requiresQuest) facts.push(['First complete', ref(w, 'quest', quest.requiresQuest)]);

    if (quest.requiresRidingTrained)
      facts.push(['Training', 'Learn to ride before you take this quest.']);

    if (quest.requiresUsableHealAbility)
      facts.push(['Ability required', 'You must know a healing spell you can use.']);

    if (quest.suggestedPlayers)
      facts.push(['Suggested group size', String(quest.suggestedPlayers)]);

    if (quest.gatedWithDungeon)
      facts.push([
        'Dungeon gate',
        ref(w, 'dungeon', quest.gatedWithDungeon) +
          (DUNGEONS[quest.gatedWithDungeon]?.guideVisible === false
            ? ' is not listed in the public guide right now, so new players cannot take this quest.'
            : ' is listed in the public guide right now. You can only take this quest while it stays listed.'),
      ]);

    if (quest.retired)
      facts.push([
        'Retired',
        'New players cannot take it. You can finish it if it is already in your log.',
      ]);

    if (quest.seasonalEvent) facts.push(['Event', eventName(quest.seasonalEvent)]);

    if (quest.shareable === false)
      facts.push([
        'Sharing',
        'It cannot be shared. Each player must take it from the quest giver.',
      ]);

    if (quest.repeatable)
      facts.push([
        'Repeatable',
        quest.weeklyReset
          ? 'Again after the weekly reset.'
          : quest.dailyReset
            ? 'Again after the daily reset.'
            : quest.repeatCadenceTicks
              ? quest.repeatCadenceTicks / TICK_RATE / 3600 + ' hours after you turn it in.'
              : 'Right after you turn it in.',
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

      return questObjectiveText(o, t, count);
    });

    if (quest.objectives.some((o) => o.type === 'collect'))
      objectives.push(
        quest.keepsCollectedItems
          ? 'You keep the items when you turn in the quest. Items you are wearing count too.'
          : 'You give the items to the quest giver when you turn in the quest.',
      );

    const byReward = new Map<string, string[]>();

    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const fixed = questFixedReward(quest, cls);

      const choice = questRewardChoices(quest, cls);

      if (!fixed && !choice.length) continue;

      const text = [
        fixed ? 'Receive ' + ref(w, 'item', fixed) + '.' : '',
        choice.length
          ? (choice.length === 1 ? 'Receive ' : 'Choose one of ') +
            choice.map((id) => ref(w, 'item', id)).join(', ') +
            '.'
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
          (closed ? 'Only if you already have the quest. Reward from ' : 'Quest reward from ') +
            ref(w, 'quest', quest.id) +
            '. The reward depends on your class, so check the list there.',
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
          '. You need enough skill for the recipe before you can turn in the quest.',
      );

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
              ? 'Items you are wearing count too. You keep them when you turn in the quest.'
              : 'Keep the items in your bags until you turn in the quest.');
          break;

        case 'gather':
          action =
            o.nodeType === 'ore' && !o.itemId
              ? 'Mine ore veins ' + n + ' ' + (n === 1 ? 'time.' : 'times.')
              : 'Gather ' + what + ' until you earn ' + n + ' gathering credits.';
          action += ' You only get credit for what you gather yourself.';
          break;

        case 'craft':
          action = 'Make ' + what + ' ' + n + ' time' + (n === 1 ? '' : 's') + '.';
          break;

        case 'farm':
          action =
            (o.action === 'plant' ? 'Plant' : 'Harvest') +
            ' ' +
            (o.cropId ? (ITEMS[o.cropId]?.name ?? 'a crop') : 'a crop') +
            ' ' +
            n +
            ' time' +
            (n === 1 ? '' : 's') +
            '.';
          break;

        case 'escort':
          action = 'Start the escort and follow the numbered stops below.';
          break;

        case 'interact':
          action = o.targetNpcId
            ? 'Speak to ' + what + '.'
            : questObjectiveText(o, what, String(n));
          break;

        case 'event':
          action = questObjectiveText(o, what, String(n));
          break;
      }

      if (quest.resolvedObjectiveCounts === 'archetypeAmends' && i === 0) action = objectives[0];

      if (places.length) {
        const spot = places[0];
        const zone = spot.frame === 'Overworld' ? zoneContaining(spot.x, spot.z) : null;
        const nearby = zone?.pois
          .filter((poi) => !poi.hideOnMap && Math.hypot(poi.x - spot.x, poi.z - spot.z) <= 35)
          .sort(
            (a, b) =>
              Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(b.x - spot.x, b.z - spot.z),
          )[0];
        action +=
          ' Where: ' +
          spot.label.charAt(0).toUpperCase() +
          spot.label.slice(1) +
          ' (' +
          Number(spot.x.toFixed(2)) +
          ', ' +
          Number(spot.z.toFixed(2)) +
          ')' +
          (nearby ? ', near ' + nearby.label : '') +
          (spot.frame === 'Overworld' ? '' : ' inside ' + spot.frame) +
          '.';
      }

      return '# ' + [action, ...instructions].join(' ');
    });

    const directions = w.section(
      'Walkthrough',
      (closed ? 'Original quest giver: ' : 'Accept the quest from ') +
        ref(w, 'npc', quest.giverNpcId) +
        '.' +
        (quest.requiredItems?.length
          ? ' If missing, you receive ' +
            quest.requiredItems.map((id) => ref(w, 'item', id)).join(', ') +
            ' when you accept.'
          : '') +
        '\n\n' +
        steps.join('\n') +
        '\n\nHand in to ' +
        questTurnInNpcIds(quest)
          .map((id) => ref(w, 'npc', id))
          .join(' or ') +
        '.',
    );
    const map =
      w.questMap?.(route) ??
      w.section(
        'Coordinates',
        'Coordinates are written (X, Z) and measured in yards. Inside a dungeon or building, they start from that room.\n\n' +
          w.table(markers),
      );

    const e = quest.completionEffect;

    if (e)
      rewards.push(
        e.type === 'switchHobby'
          ? 'Your hobby changes to the one you picked.'
          : 'You attune to the ' + (e.pairId ? words(e.pairId) : 'selected') + ' profession pair.',
      );

    const next = Object.values(QUESTS)
      .filter((q) => q.requiresQuest === quest.id)
      .map((q) => ref(w, 'quest', q.id));

    w.add(
      w.titleBy.quest.get(quest.id)!,
      (availability ? availability + '\n\n' : '') +
        w.section('Quest brief', w.table(facts)) +
        lines(w, 'Objectives', objectives) +
        directions +
        w.section(
          'Rewards',
          w.table([
            ['Base experience', quest.xpReward + ' XP'],
            ['Base money', w.money(quest.copperReward)],
          ]) + (rewards.length ? '\n\n' + w.bullets(rewards) : ''),
        ) +
        lines(w, 'Unlocks', next) +
        map +
        w.section(
          'Quest dialogue',
          quest.text.replaceAll('$N', 'adventurer').replaceAll('$C', 'adventurer'),
        ) +
        w.section(
          'On completion',
          quest.completionText.replaceAll('$N', 'adventurer').replaceAll('$C', 'adventurer'),
        ),
      ['Quests', zone],
    );
  }
}
