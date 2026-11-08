import { WORLD_QUESTS } from '../../src/sim/content/world_quests';
import { CLASSES, DUNGEONS, getActiveWorldContent, ITEMS, QUESTS } from '../../src/sim/data';
import { questFixedReward, questRewardChoices } from '../../src/sim/quests/quest_reward_choice';
import { type PlayerClass, questTurnInNpcIds } from '../../src/sim/types';
import { worldQuestDisplayName } from '../../src/ui/world_quest_view';
import { type ArticleTools, ref } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import { itemNpcPoints } from './item_npc_route';
import { questRoute } from './quest_route';
import { worldRouteData } from './rotating_routes';

export function questAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const result = new Map<string, ItemAcquisition[]>();
  for (const q of Object.values(QUESTS)) {
    const rewards = new Map<string, { choice: PlayerClass[]; fixed: PlayerClass[] }>();
    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const fixed = questFixedReward(q, cls);
      for (const [ids, key] of [
        [fixed ? [fixed] : [], 'fixed'],
        [questRewardChoices(q, cls), 'choice'],
      ] as const)
        for (const id of ids) {
          const row = rewards.get(id) ?? { choice: [], fixed: [] };
          row[key].push(cls);
          rewards.set(id, row);
        }
    }
    if (!rewards.size && !q.requiredItems?.length) continue;
    const route = questRoute(q);
    const conditions = [
      'Requires character level ' +
        (q.minLevel ?? 1) +
        (q.maxLevel ? ' through ' + q.maxLevel : ' or above') +
        '.',
      ...(q.requiresQuest ? ['First complete ' + ref(w, 'quest', q.requiresQuest) + '.'] : []),
      ...(q.requiredClass?.length
        ? ['Accepting classes: ' + q.requiredClass.map((c) => ref(w, 'class', c)).join(', ') + '.']
        : []),
      ...(q.requiresRidingTrained ? ['Learn riding before accepting.'] : []),
      ...(q.seasonalEvent ? ['The quest is offered only during its seasonal event.'] : []),
      ...(q.retired
        ? ['Closed to new acceptance. This route works only if the quest is already in your log.']
        : []),
      ...(q.gatedWithDungeon && DUNGEONS[q.gatedWithDungeon]?.guideVisible === false
        ? [
            'The linked dungeon is currently hidden from the public guide, so new characters cannot accept this quest.',
          ]
        : []),
    ];
    const objectives = q.objectives.map((o, i) => {
      const notes = route.notes.filter((n) => n.step === i + 1).map((n) => n.text);
      return (
        'Quest objective ' +
        (i + 1) +
        '. ' +
        o.label +
        ' (' +
        o.count +
        ' required). ' +
        notes.join(' ')
      );
    });
    const turnins = questTurnInNpcIds(q)
      .map((id) => ref(w, 'npc', id))
      .join(' or ');
    for (const [id, row] of rewards) {
      addAcquisition(result, id, {
        title: 'Quest reward · ' + ref(w, 'quest', q.id),
        details: [
          ...conditions,
          ...(row.fixed.length
            ? [
                'Guaranteed one copy on turn-in for ' +
                  (row.fixed.length === Object.keys(CLASSES).length
                    ? 'every class'
                    : row.fixed.map((c) => ref(w, 'class', c)).join(', ')) +
                  '.',
              ]
            : []),
          ...(row.choice.length
            ? [
                'Choose one copy from the reward cards. It is offered to ' +
                  (row.choice.length === Object.keys(CLASSES).length
                    ? 'every class'
                    : row.choice.map((c) => ref(w, 'class', c)).join(', ')) +
                  '. Selecting another reward gives no copy of this item.',
              ]
            : []),
          ...route.notes.filter((n) => typeof n.step !== 'number').map((n) => n.text),
        ],
        steps: [
          q.retired
            ? 'Continue the quest already in your log.'
            : 'Speak to ' +
              ref(w, 'npc', q.giverNpcId) +
              ', select ' +
              ref(w, 'quest', q.id) +
              ' and click Accept.',
          ...objectives,
          'Return to ' +
            turnins +
            '. ' +
            (row.choice.length
              ? 'Select ' + ref(w, 'item', id) + ' if shown among your reward choices. '
              : '') +
            'Click Complete Quest. The reward goes to your bags.',
        ],
        points: route.points.map((p) => ({
          ...p,
          step: p.step === 'Hand-in' ? 'Reward' : typeof p.step === 'number' ? p.step + 1 : p.step,
        })),
      });
    }
    for (const id of q.requiredItems ?? []) {
      addAcquisition(result, id, {
        title: 'Supplied for ' + ref(w, 'quest', q.id),
        details: conditions,
        steps: [
          'Speak to ' + ref(w, 'npc', q.giverNpcId) + ' and accept ' + ref(w, 'quest', q.id) + '.',
          'The quest supplies the required item if you no longer carry it. Check your bags before travelling to its objective.',
        ],
        points: [
          ...itemNpcPoints('Start', q.giverNpcId),
          ...itemNpcPoints('Reward', q.giverNpcId, 'Required quest supply'),
        ],
      });
    }
  }
  for (const object of getActiveWorldContent().groundObjects) {
    const item = ITEMS[object.itemId];
    if (!item) continue;
    const worldQuest = WORLD_QUESTS.find((q) => q.id === item.questId);
    if (worldQuest) {
      const name = worldQuestDisplayName(worldQuest.id);
      const title = w.titleBy.worldQuest?.get(worldQuest.id);
      const reference = title ? w.link(title, name) : name;
      const route = worldRouteData(worldQuest);
      addAcquisition(result, item.id, {
        title: 'Rotating world-quest interaction · ' + reference,
        details: [
          'This catalog entry is an activity object, not a permanent bag item. Its interactions work while this world quest is active on your board. Minimum level ' +
            worldQuest.minLevel +
            '.',
        ],
        steps: route.instructions,
        points: route.points,
      });
      continue;
    }
    const quest = item.questId ? QUESTS[item.questId] : undefined;
    const collect = quest?.objectives.find((o) => o.type === 'collect' && o.itemId === item.id);
    // Objects without a matching collect objective may trigger an event rather than give an item.
    if (quest && !collect) {
      const route = questRoute(quest);
      addAcquisition(result, item.id, {
        title: 'World interaction in ' + ref(w, 'quest', quest.id),
        details: [
          'This catalog entry describes a world object. Interacting with it advances the quest rather than placing the object in your bags.',
        ],
        steps: [
          'Speak to ' +
            ref(w, 'npc', quest.giverNpcId) +
            ' and accept ' +
            ref(w, 'quest', quest.id) +
            '.',
          ...route.notes.filter((n) => typeof n.step === 'number').map((n) => n.text),
          'Follow the quest instructions for ' +
            object.name +
            ' at the mapped objective locations. Check the quest log for credited progress.',
        ],
        points: route.points,
      });
      continue;
    }
    if (item.id === 'ps_ferry_bell') {
      addAcquisition(result, item.id, {
        title: 'Ferry bell world interaction',
        details: ['This bell is a travel object. It is not added to your bags.'],
        steps: [
          'Walk to one of the two bells marked on the map.',
          'Click the ferry bell to cross between Eastbrook and The Proving Shore.',
        ],
        points: object.positions.map((p) => ({
          step: 1,
          frame: 'Overworld',
          x: p.x,
          z: p.z,
          label: object.name,
        })),
      });
      continue;
    }
    addAcquisition(result, item.id, {
      title: 'World pickup · ' + object.name,
      steps: [
        quest
          ? 'Accept ' + ref(w, 'quest', quest.id) + ' and leave its item collection incomplete.'
          : 'Make room in your bags and visit one of the marked pickup sites.',
        'Move beside ' +
          object.name +
          ' and interact with it. Each successful pickup gives one copy of ' +
          ref(w, 'item', item.id) +
          '.',
        quest
          ? 'Repeat at available objects until you have the required quantity. Keep the items for your quest.'
          : 'Collect the item in your bags.',
      ],
      details: [
        'The object pickup is guaranteed when it is available and you meet its interaction requirements. A depleted object must respawn before another pickup.',
      ],
      points: object.positions.map((p) => ({
        step: 'Reward',
        frame: 'Overworld',
        x: p.x,
        z: p.z,
        label: object.name + ' pickup',
      })),
    });
  }
  for (const quest of WORLD_QUESTS) {
    const reward = quest.reward?.extraItem;
    if (!reward) continue;
    const name = worldQuestDisplayName(quest.id);
    const title = w.titleBy.worldQuest?.get(quest.id);
    const route = worldRouteData(quest);
    addAcquisition(result, reward.itemId, {
      title: 'Complete the world quest ' + (title ? w.link(title, name) : name),
      details: [
        'When this quest is on your active world-quest board, completion guarantees ' +
          reward.count +
          ' copy. Requires level ' +
          quest.minLevel +
          '. The reward is credited at completion with no hand-in.',
      ],
      steps: [
        ...route.instructions,
        'Check your bags for the item reward. If the reward was mailed because your bags were full, collect it from your mailbox.',
      ],
      points: route.points,
    });
  }
  for (const [cls, definition] of Object.entries(CLASSES))
    for (const id of [definition.startWeapon, definition.startChest])
      addAcquisition(result, id, {
        title: 'Starting equipment · ' + ref(w, 'class', cls),
        steps: [
          'At character creation choose ' + ref(w, 'class', cls) + '.',
          'Enter the world on the new character. The item is supplied as part of that character’s starting equipment.',
        ],
        details: ['Guaranteed starting equipment. No vendor payment or drop roll is required.'],
      });
  addAcquisition(result, 'wardens_seal', {
    title: 'Current availability',
    steps: [
      'Continue [[The Waking Warden]] and then [[The Seal Restored]] through their quest objectives. Neither requires you to collect this item.',
    ],
    details: [
      'This item record has an authored drop on ' +
        ref(w, 'mob', 'waking_warden') +
        ', but the linked quest has no collect objective for it. The current loot rules therefore award no bag copy. There is no verified vendor or crafting source.',
    ],
  });
  return result;
}
