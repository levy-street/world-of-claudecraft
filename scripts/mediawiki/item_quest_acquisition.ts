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
      'You need to be level ' +
        (q.minLevel ?? 1) +
        (q.maxLevel ? ' to ' + q.maxLevel : ' or higher') +
        '.',
      ...(q.requiresQuest
        ? ['You must finish ' + ref(w, 'quest', q.requiresQuest) + ' first.']
        : []),
      ...(q.requiredClass?.length
        ? [
            'Only these classes can accept it: ' +
              q.requiredClass.map((c) => ref(w, 'class', c)).join(', ') +
              '.',
          ]
        : []),
      ...(q.requiresRidingTrained ? ['You must learn riding before you can accept it.'] : []),
      ...(q.seasonalEvent ? ['You can only get this quest during its seasonal event.'] : []),
      ...(q.retired
        ? [
            'Nobody can accept this quest anymore. This only works if the quest is already in your quest log.',
          ]
        : []),
      ...(q.gatedWithDungeon && DUNGEONS[q.gatedWithDungeon]?.guideVisible === false
        ? [
            'The dungeon for this quest is hidden from the public guide right now, so new characters cannot accept this quest.',
          ]
        : []),
    ];
    const objectives = q.objectives.map((o, i) => {
      const notes = route.notes.filter((n) => n.step === i + 1).map((n) => n.text);
      return (
        'Quest objective ' +
        (i + 1) +
        ': ' +
        o.label +
        ' (you need ' +
        o.count +
        '). ' +
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
                'You always get one when you hand in the quest' +
                  (row.fixed.length === Object.keys(CLASSES).length
                    ? ', whatever your class.'
                    : ', if you play one of these classes: ' +
                      row.fixed.map((c) => ref(w, 'class', c)).join(', ') +
                      '.'),
              ]
            : []),
          ...(row.choice.length
            ? [
                'When you hand in the quest, you can pick this item as your reward. It is offered to ' +
                  (row.choice.length === Object.keys(CLASSES).length
                    ? 'every class'
                    : row.choice.map((c) => ref(w, 'class', c)).join(', ')) +
                  '. If you pick a different reward, you do not get this item.',
              ]
            : []),
          ...route.notes.filter((n) => typeof n.step !== 'number').map((n) => n.text),
        ],
        steps: [
          q.retired
            ? 'Keep going with the quest already in your quest log.'
            : 'Talk to ' +
              ref(w, 'npc', q.giverNpcId) +
              ', pick ' +
              ref(w, 'quest', q.id) +
              ' and click Accept.',
          ...objectives,
          'Go back to ' +
            turnins +
            '. ' +
            (row.choice.length
              ? 'If ' + ref(w, 'item', id) + ' is one of your reward choices, pick it. '
              : '') +
            'Click Complete Quest. The reward goes into your bags.',
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
          'Talk to ' + ref(w, 'npc', q.giverNpcId) + ' and accept ' + ref(w, 'quest', q.id) + '.',
          'If you no longer have the item the quest needs, the quest gives it to you. Check your bags before you travel to the objective.',
        ],
        points: [
          ...itemNpcPoints('Start', q.giverNpcId),
          ...itemNpcPoints('Reward', q.giverNpcId, 'The quest gives you this item'),
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
          'This is something you use out in the world, not an item you keep in your bags. You can use it while this world quest is on your board. You need to be level ' +
            worldQuest.minLevel +
            ' or higher.',
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
          'This is an object in the world. Using it moves your quest forward. It does not go into your bags.',
        ],
        steps: [
          'Talk to ' +
            ref(w, 'npc', quest.giverNpcId) +
            ' and accept ' +
            ref(w, 'quest', quest.id) +
            '.',
          ...route.notes.filter((n) => typeof n.step === 'number').map((n) => n.text),
          'Find ' +
            object.name +
            ' at the places on the map and do what the quest asks. Check your quest log to see your progress.',
        ],
        points: route.points,
      });
      continue;
    }
    if (item.id === 'ps_ferry_bell') {
      addAcquisition(result, item.id, {
        title: 'Ferry bell world interaction',
        details: ['This bell is used for travel. It does not go into your bags.'],
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
          ? 'Accept ' + ref(w, 'quest', quest.id) + '. Do not finish collecting its items yet.'
          : 'Make room in your bags. Then go to one of the pickup spots on the map.',
        'Stand next to ' +
          object.name +
          ' and use it. Each pickup gives you one ' +
          ref(w, 'item', item.id) +
          '.',
        quest
          ? 'Do this again at other objects until you have as many as the quest needs. Keep the items for your quest.'
          : 'The item goes into your bags.',
      ],
      details: [
        'If the object is there and you meet its requirements, you always get the item. Once an object is used up, you must wait for it to come back before you can pick it up again.',
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
        'If this quest is on your world-quest board, finishing it always gives you ' +
          reward.count +
          (reward.count === 1 ? ' copy' : ' copies') +
          '. You need to be level ' +
          quest.minLevel +
          ' or higher. You get the reward as soon as you finish, with no hand-in.',
      ],
      steps: [
        ...route.instructions,
        'Look in your bags for the item. If your bags were full, it was sent to your mailbox instead, so pick it up there.',
      ],
      points: route.points,
    });
  }
  for (const [cls, definition] of Object.entries(CLASSES))
    for (const id of [definition.startWeapon, definition.startChest])
      addAcquisition(result, id, {
        title: 'Starting equipment · ' + ref(w, 'class', cls),
        steps: [
          'When you make a new character, choose ' + ref(w, 'class', cls) + '.',
          'Enter the world with the new character. It starts with this item.',
        ],
        details: [
          'Every new character of this class starts with it. You do not need to buy it or wait for it to drop.',
        ],
      });
  addAcquisition(result, 'wardens_seal', {
    title: 'Current availability',
    steps: [
      'Do [[The Waking Warden]], then [[The Seal Restored]]. Neither quest asks you to collect this item.',
    ],
    details: [
      ref(w, 'mob', 'waking_warden') +
        ' is set up to drop this item for a quest. But that quest never asks you to collect it, so the loot rules never give you a copy. No shop or crafting recipe that we know of gives it either.',
    ],
  });
  return result;
}
