// The Hellgate: the warlock's summoning gate and the three-zone pact that
// teaches it. Data only; the object lives in src/sim/party_gate.ts. While the
// gate stands the warlock bleeds HELLGATE_BLEED_PCT of max health a second with
// no natural regen; clicking it while targeting a group member pulls them to it.

import type { AbilityDef, QuestDef } from '../types';

export const HELLGATE_ABILITY_ID = 'hellgate';
export const HELLGATE_OBJECT_ITEM_ID = 'hellgate';
export const HELLGATE_DURATION = 99;
export const HELLGATE_COOLDOWN = 600;
export const HELLGATE_CAST_TIME = 10;
export const HELLGATE_BLEED_PCT = 0.01;
export const HELLGATE_BLEED_AURA_ID = 'hellgate_toll';
export const HELLGATE_FINAL_QUEST_ID = 'q_hellgate_gate';

export const HELLGATE_ABILITY: AbilityDef = {
  id: HELLGATE_ABILITY_ID,
  name: 'Hellgate',
  class: 'warlock',
  learnLevel: 13,
  cost: 150,
  castTime: HELLGATE_CAST_TIME,
  cooldown: HELLGATE_COOLDOWN,
  range: 0,
  school: 'shadow',
  requiresTarget: false,
  requiresOutOfCombat: true,
  requiresQuest: HELLGATE_FINAL_QUEST_ID,
  effects: [
    { type: 'summonHellgate', duration: HELLGATE_DURATION },
    {
      type: 'selfDotPctMax',
      pct: HELLGATE_BLEED_PCT,
      duration: HELLGATE_DURATION,
      interval: 1,
      noRegen: true,
    },
  ],
  description:
    'Tears open a Hellgate at your feet for 99 sec. Click the gate while targeting a group member to pull them to it. While it stands, the demons beyond it bleed you for 1% of your maximum health every second and stop your health from regenerating. 10 sec cast.',
};

export const HELLGATE_QUEST_ORDER = ['q_hellgate_pact', 'q_hellgate_rite', HELLGATE_FINAL_QUEST_ID];

export const HELLGATE_QUESTS: Record<string, QuestDef> = {
  q_hellgate_pact: {
    id: 'q_hellgate_pact',
    name: 'The Unquiet Pact',
    giverNpcId: 'apothecary_lin',
    turnInNpcId: 'apothecary_lin',
    text: 'You carry a demon on a leash, $N, and you think that makes you its master. The old pacts say otherwise: a gate is only ever opened from the far side. If you would learn to tear one open yourself, start by proving the dead of the chapel yard cannot hold you. Lay 8 Restless Bones to rest and bring me what you learn.',
    completionText:
      'The bones lie still, and you are still standing. Good. The next words of the pact were carried north into the marsh by a scout who keeps her own counsel. Find Scout Maren in Fenbridge.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'restless_bones',
        count: 8,
        label: 'Restless Bones laid to rest',
      },
    ],
    xpReward: 700,
    copperReward: 300,
    itemRewards: {},
    requiredClass: ['warlock'],
    minLevel: 8,
  },
  q_hellgate_rite: {
    id: 'q_hellgate_rite',
    name: 'Rites of the Gravecallers',
    giverNpcId: 'scout_maren',
    turnInNpcId: 'scout_maren',
    text: 'Lin sent you? Then you already know the Gravecallers are not raising the drowned for company. Their cultists chant a rite that thins the veil, the same rite the pact needs. Silence 6 Gravecaller Cultists and listen to what they say before they fall.',
    completionText:
      'You heard it too, then: the gate answers the one who is bled for it. There is a loremaster in Highwatch who has the last of it, and he will not like being asked. Seek Loremaster Caddis.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'gravecaller_cultist',
        count: 6,
        label: 'Gravecaller Cultist silenced',
      },
    ],
    xpReward: 1100,
    copperReward: 600,
    itemRewards: {},
    requiredClass: ['warlock'],
    requiresQuest: 'q_hellgate_pact',
    minLevel: 10,
  },
  [HELLGATE_FINAL_QUEST_ID]: {
    id: HELLGATE_FINAL_QUEST_ID,
    name: 'The Hellgate',
    giverNpcId: 'loremaster_caddis',
    turnInNpcId: 'loremaster_caddis',
    text: 'So Maren sends the marsh to my door now. Very well, $N. The pact is written in the shale: the Boneclad that walk the peaks were the last to hold a gate open, and they paid for it in blood. Break 5 Boneclad Revenants and the mountain will give you the words.',
    completionText:
      'The words are yours. Remember what they cost the Boneclad: every second a Hellgate stands, it feeds on the one who opened it. Use it for your friends, and close it before it closes you.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'boneclad_revenant',
        count: 5,
        label: 'Boneclad Revenant broken',
      },
    ],
    xpReward: 1600,
    copperReward: 1_000,
    itemRewards: {},
    requiredClass: ['warlock'],
    requiresQuest: 'q_hellgate_rite',
    minLevel: 13,
  },
};
