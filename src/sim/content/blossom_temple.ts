import type { GroundObjectDef, ItemDef, NpcDef, QuestDef } from '../types';

// The Blossom Temple's monks (the grove itself is content/cherry_grove.ts):
// four trainees drilling a kata in the courtyard on a fixed loop
// (src/sim/monk_training.ts drives their emotes), the master on the temple
// steps, and the training mat where a player learns the kata and earns the
// title (deed in deeds.ts, triggered by q_blossom_kata).

/** Trainees flank the path in front of the temple, facing it. */
export const MONK_TRAINEE_IDS = [
  'monk_trainee_a',
  'monk_trainee_b',
  'monk_trainee_c',
  'monk_trainee_d',
] as const;

/** The mat sits on the courtyard lawn just west of the path. */
export const BLOSSOM_TRAINING_MAT = { x: 302.5, z: 1062 };
export const BLOSSOM_TRAINING_MAT_ITEM = 'blossom_training_mat';
export const BLOSSOM_KATA_QUEST = 'q_blossom_kata';

const trainee = (id: string, name: string, x: number, z: number, facing: number): NpcDef => ({
  id,
  name,
  title: 'Temple Trainee',
  pos: { x, z },
  facing,
  color: 0xd9822b,
  questIds: [],
  greeting: 'Breathe in with the blossoms. Strike out with the wind. Again.',
});

export const BLOSSOM_TEMPLE_NPCS: Record<string, NpcDef> = {
  master_monk_sora: {
    id: 'master_monk_sora',
    name: 'Master Sora',
    title: 'Keeper of the Blossom Temple',
    pos: { x: 305, z: 1068.5 },
    facing: 0,
    color: 0xc7682a,
    questIds: [BLOSSOM_KATA_QUEST],
    greeting:
      'The petals fall the same way every spring, and still each one is new. So it is with the kata.',
  },
  monk_trainee_a: trainee('monk_trainee_a', 'Trainee Hiro', 300, 1046, Math.PI / 2),
  monk_trainee_b: trainee('monk_trainee_b', 'Trainee Mei', 300, 1052, Math.PI / 2),
  monk_trainee_c: trainee('monk_trainee_c', 'Trainee Kenji', 316, 1046, -Math.PI / 2),
  monk_trainee_d: trainee('monk_trainee_d', 'Trainee Aiko', 316, 1052, -Math.PI / 2),
};

export const BLOSSOM_TEMPLE_ITEMS: Record<string, ItemDef> = {
  [BLOSSOM_TRAINING_MAT_ITEM]: {
    id: BLOSSOM_TRAINING_MAT_ITEM,
    name: 'Temple Training Mat',
    kind: 'quest',
    sellValue: 0,
    questId: BLOSSOM_KATA_QUEST,
    noVendorSell: true,
  },
};

export const BLOSSOM_TEMPLE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: BLOSSOM_TRAINING_MAT_ITEM,
    name: 'Temple Training Mat',
    positions: [{ ...BLOSSOM_TRAINING_MAT }],
    // reserved high range: appending must not shift the legacy roster's ids
    entityIds: [2_147_100_201],
  },
];

export const BLOSSOM_TEMPLE_QUESTS: Record<string, QuestDef> = {
  [BLOSSOM_KATA_QUEST]: {
    id: BLOSSOM_KATA_QUEST,
    name: 'The Way of the Blossom',
    giverNpcId: 'master_monk_sora',
    turnInNpcId: 'master_monk_sora',
    text: 'You watch my students the way a cat watches a pond, $N. Good. Watching is the first lesson. The second is the mat: step onto it, empty your mind, and let the kata move you. Come back when your feet remember it.',
    completionText:
      'Your stance was crooked and your breath was loud. And still the blossoms leaned toward you. Welcome, monk of the Blossom Temple.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: BLOSSOM_TRAINING_MAT_ITEM,
        count: 1,
        label: 'Practice the kata on the training mat',
      },
    ],
    xpReward: 2800,
    copperReward: 1000,
    itemRewards: {},
  },
};

export const BLOSSOM_TEMPLE_QUEST_ORDER: string[] = [BLOSSOM_KATA_QUEST];
