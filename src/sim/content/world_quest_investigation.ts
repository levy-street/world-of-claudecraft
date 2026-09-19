import type { MobTemplate, NpcDef, WorldQuestDef } from '../types';
import { ZONE2_MOBS } from './zone2';

export const INVESTIGATION_QUEST_ID = 'wq_mirefen_infiltrator';
export const INVESTIGATION_MOB_ID = 'fenbridge_infiltrator';
export const INVESTIGATION_NPC_IDS = [
  2146900020, 2146900021, 2146900022, 2146900023, 2146900024,
] as const;
export const INVESTIGATION_NPCS: readonly NpcDef[] = [
  {
    id: 'infiltrator_captain',
    name: 'Sergeant Alric',
    title: 'Fenbridge Watch',
    pos: { x: -8, z: 284 },
    facing: 1.57,
    color: 0x687d85,
    questIds: [],
    dynamic: true,
    greeting:
      "A creature has stolen a soldier's face. Read the standing orders and the watch ledger, question all four guards, then come back and name the one whose story contradicts our records.",
  },
  {
    id: 'infiltrator_nella',
    name: 'Guard Nella',
    title: 'Fenbridge Watch',
    pos: { x: -10, z: 275 },
    facing: 0,
    color: 0x687d85,
    questIds: [],
    dynamic: true,
    greeting: 'Reporting for duty.',
  },
  {
    id: 'infiltrator_orin',
    name: 'Guard Orin',
    title: 'Fenbridge Watch',
    pos: { x: -3, z: 276 },
    facing: -1.57,
    color: 0x687d85,
    questIds: [],
    dynamic: true,
    greeting: 'Reporting for duty.',
  },
  {
    id: 'infiltrator_bram',
    name: 'Guard Bram',
    title: 'Fenbridge Watch',
    pos: { x: -10, z: 289 },
    facing: 1.57,
    color: 0x687d85,
    questIds: [],
    dynamic: true,
    greeting: 'Reporting for duty.',
  },
  {
    id: 'infiltrator_tessa',
    name: 'Guard Tessa',
    title: 'Fenbridge Watch',
    pos: { x: -3, z: 291 },
    facing: 3.14,
    color: 0x687d85,
    questIds: [],
    dynamic: true,
    greeting: 'Reporting for duty.',
  },
];
export function isInvestigationNpc(templateId: string): boolean {
  return INVESTIGATION_NPCS.some((npc) => npc.id === templateId);
}
export const INVESTIGATION_CLUES = [
  {
    entityId: 2146900025,
    objectItemId: 'wq_infiltrator_orders',
    name: 'Standing Orders',
    x: -7,
    z: 280,
  },
  {
    entityId: 2146900026,
    objectItemId: 'wq_infiltrator_ledger',
    name: 'Watch Ledger',
    x: -7,
    z: 294,
  },
] as const;
export const INVESTIGATION_VARIANTS = [
  {
    culprit: 1,
    clues: [
      'The south bridge has been closed since dawn. All patrols must use the western road.',
      'Orin was assigned to gate duty. Nella, Bram and Tessa patrolled the western road.',
    ],
    statements: [
      'My patrol took the western road this morning.',
      'I crossed the south bridge on my morning patrol.',
      'I patrolled the western road with Nella and Tessa.',
      'The south bridge is closed. We used the western road.',
    ],
  },
  {
    culprit: 3,
    clues: [
      "Today's password is Reedwatch. Yesterday's password, Lantern, is no longer valid.",
      'All four guards were briefed on the new password at dawn.',
    ],
    statements: [
      'Reedwatch. I learned the new password at dawn.',
      "Lantern was yesterday's password. Today we use Reedwatch.",
      'All four of us attended the dawn briefing.',
      "Today's password is Lantern. I heard it at the dawn briefing.",
    ],
  },
  {
    culprit: 0,
    clues: [
      'All garrison supply crates must carry blue wax seals. Reject any crate with a red seal.',
      "Today's delivery was inspected: every crate had an intact blue wax seal.",
    ],
    statements: [
      "I inspected today's delivery. Every crate had a red wax seal.",
      'We only accept crates sealed with blue wax.',
      "The ledger records blue seals on today's delivery.",
      'No crates with red seals were accepted today.',
    ],
  },
  {
    culprit: 2,
    clues: [
      'The night watch relights the east beacon at dusk. The west beacon stays dark until the ferry signals.',
      'Nella and Orin held the gate through the night. Bram and Tessa walked the causeway and relit the east beacon at dusk.',
    ],
    statements: [
      'Orin and I had the gate all night. Nothing came through but the fog.',
      'Gate duty with Nella. We watched the east beacon come alight at dusk, as ordered.',
      'Tessa and I walked the causeway. We lit the west beacon at dusk so the ferry could see us.',
      'Causeway patrol with Bram. We relit the east beacon the moment the sun went down.',
    ],
  },
  {
    culprit: 1,
    clues: [
      "The quartermaster's cart arrives at noon by the north road. No supplies come by water while the marsh is flooded.",
      'Noon delivery received from the north road. Tessa signed for it; Bram and Nella unloaded; Orin was at the well.',
    ],
    statements: [
      'I helped Bram unload the cart at noon. Salt pork and lamp oil, the usual.',
      'I unloaded the noon delivery myself, straight off the supply barge.',
      'Nella and I carried the crates in. Tessa signed the ledger.',
      'The cart came up the north road at noon. I signed for it.',
    ],
  },
  {
    culprit: 3,
    clues: [
      "The fallen from the last raid lie in the chapel crypt. Nobody enters the crypt without the sergeant's key.",
      "The sergeant's key has not left his belt since the raid. Nella, Orin and Bram stood the wall; Tessa kept the yard.",
    ],
    statements: [
      'I stood the wall. The crypt has stayed locked since the raid; only the sergeant holds the key.',
      'Wall duty with Nella and Bram. Quiet, except for the frogs.',
      'The wall, all day. Nobody has been near the crypt.',
      'I kept the yard and looked in on the crypt this morning. The fallen are resting.',
    ],
  },
] as const;
export const INVESTIGATION_MOB: MobTemplate = {
  ...ZONE2_MOBS.drowned_dead,
  id: INVESTIGATION_MOB_ID,
  name: 'The Borrowed Face',
  minLevel: 6,
  maxLevel: 10,
  loot: [],
};
export const WORLD_QUEST_INVESTIGATION: WorldQuestDef = {
  id: INVESTIGATION_QUEST_ID,
  zoneId: 'mirefen_marsh',
  minLevel: 6,
  area: { x: -6, z: 284, radius: 35 },
  objective: { type: 'investigation', targetMobId: INVESTIGATION_MOB_ID },
  count: 1,
  reward: { type: 'xp', rate: 0.12 },
};
