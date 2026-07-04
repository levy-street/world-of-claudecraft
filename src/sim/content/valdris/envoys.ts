// The Envoys' Hall, the faction gateway of the Valdris launch. The lore's
// tutorial island carries "a small hall where representatives of the three
// factions greet newcomers": three Envoys stand at the north end of Thornpeak
// Heights, just short of the buried land exit (content/valdris/barriers.ts),
// and every character (new or the pre-Valdris veterans, who all load unsworn)
// chooses a faction and a race by speaking to them. The choice is permanent
// (lore: decisions are permanent) and teleports the chooser to their faction's
// realm hub; a Landing Ferry NPC in each realm hub travels back, and the sworn
// player's own Envoy carries them out again. Flow logic: src/sim/envoys.ts.

import type { NpcDef, PlayerFaction, QuestDef, ZonePropsDef } from '../../types';
import { emptyZoneProps } from '../../types';

// The hall stands beside the north road of Thornpeak Heights, south of the
// buried exit at z = 900.
export const ENVOY_HALL_Z = 866;

// One Envoy per faction: the unsworn talk to any of them to open the choice;
// the sworn talk to their OWN Envoy to travel to their realm hub.
export const ENVOY_NPC_IDS: Record<PlayerFaction, string> = {
  kael: 'envoy_marcus_vale',
  veth: 'envoy_sylwen',
  ossara: 'envoy_amara',
};

// One Landing Ferry per realm hub: the sworn talk to it to travel back to the
// Envoys' Hall on the island.
export const FERRY_NPC_IDS: Record<PlayerFaction, string> = {
  ossara: 'ferry_rhouma',
  veth: 'ferry_neris',
  kael: 'ferry_aldwin',
};

export const ENVOY_NPCS: Record<string, NpcDef> = {
  envoy_marcus_vale: {
    id: 'envoy_marcus_vale',
    name: 'Envoy Marcus Vale',
    title: 'Voice of the Kael Empire',
    pos: { x: -5, z: ENVOY_HALL_Z },
    facing: Math.PI,
    color: 0xe0b34a,
    questIds: ['q_three_banners'],
    greeting:
      'The Empire keeps roads paved, granaries full, and ledgers exact. Swear to Kael and you will never stand alone, or unbilled.',
  },
  envoy_sylwen: {
    id: 'envoy_sylwen',
    name: 'Envoy Sylwen',
    title: 'Voice of the Veth Confederation',
    pos: { x: 0, z: ENVOY_HALL_Z + 3 },
    facing: Math.PI,
    color: 0x60a5fa,
    questIds: ['q_three_banners'],
    greeting:
      'Veth wins no wars. It ends them. Swear to the Confederation and learn how much a quiet word outweighs a loud army.',
  },
  envoy_amara: {
    id: 'envoy_amara',
    name: 'Envoy Amara',
    title: 'Voice of the Domain of Ossara',
    pos: { x: 5, z: ENVOY_HALL_Z },
    facing: Math.PI,
    color: 0xfb923c,
    questIds: ['q_three_banners'],
    greeting:
      'Before your empires drew maps, Ossara kept the faith. Swear to the Domain and inherit what the sands remember.',
  },
  ferry_rhouma: {
    id: 'ferry_rhouma',
    name: 'Sandskiff Master Rhouma',
    title: 'Passage to the Landing',
    pos: { x: 6, z: 1000 },
    facing: Math.PI,
    color: 0xd9b38c,
    questIds: [],
    greeting: 'The skiff runs south to the Landing with the evening wind. Say the word.',
  },
  ferry_neris: {
    id: 'ferry_neris',
    name: 'Blackwater Pilot Neris',
    title: 'Passage to the Landing',
    pos: { x: 6, z: 1390 },
    facing: Math.PI,
    color: 0x7fa8d9,
    questIds: [],
    greeting: 'The black rivers reach farther than most maps admit. The Landing is an easy run.',
  },
  ferry_aldwin: {
    id: 'ferry_aldwin',
    name: 'Coach Master Aldwin',
    title: 'Passage to the Landing',
    pos: { x: 6, z: 1780 },
    facing: Math.PI,
    color: 0xc9a86a,
    questIds: [],
    greeting: 'Imperial post runs to the Landing twice a bell. Papers, or coin, or a good story.',
  },
};

// Level-18 breadcrumb from Highwatch: hear all three pitches, then choose
// freely. Optional flavor and orientation XP; the choice itself gates only on
// level (src/sim/envoys.ts), never on this quest.
export const ENVOY_QUESTS: Record<string, QuestDef> = {
  q_three_banners: {
    id: 'q_three_banners',
    name: 'The Three Banners',
    giverNpcId: 'captain_thessaly',
    turnInNpcId: 'envoy_marcus_vale',
    turnInNpcIds: ['envoy_marcus_vale', 'envoy_sylwen', 'envoy_amara'],
    text: 'You have outgrown this island, $N. Three Voices wait at the Envoys Hall up the north road: the Empire, the Confederation, the Domain. Hear all three before you weigh your oath. Loyalty and debt are the only currencies out there, so spend yours knowingly.',
    completionText:
      'You have heard the three banners speak. When your heart is set, the choice is yours alone, and it is permanent.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'envoy_marcus_vale',
        count: 1,
        label: 'Hear the Voice of Kael',
      },
      { type: 'interact', targetNpcId: 'envoy_sylwen', count: 1, label: 'Hear the Voice of Veth' },
      { type: 'interact', targetNpcId: 'envoy_amara', count: 1, label: 'Hear the Voice of Ossara' },
    ],
    xpReward: 1450,
    copperReward: 900,
    itemRewards: {},
    minLevel: 18,
  },
};

export const ENVOY_QUEST_ORDER: string[] = ['q_three_banners'];

// The hall itself: a chapel-shaped building, the envoys' banner posts dressed
// with the existing prop kinds, and a fire for the ferry queue.
export const ENVOY_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  buildings: [{ kind: 'chapel', x: 0, z: ENVOY_HALL_Z + 9, w: 7, d: 5, rot: Math.PI }],
  campfires: [[-8, ENVOY_HALL_Z - 4]],
  crates: [
    [8, ENVOY_HALL_Z - 3],
    [9, ENVOY_HALL_Z - 4.2],
  ],
  tents: [{ x: -9, z: ENVOY_HALL_Z + 4, rot: 2.6, scale: 1.0 }],
};
