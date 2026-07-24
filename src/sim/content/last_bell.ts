// The Last Bell: story-instance spaces for the Farshore campaign.
//
// These are DungeonDefs only in the plumbing sense: they ride the existing
// 24-slot instance pool (claim, occupancy, disconnect-resume, recycling all
// reuse instances/dungeons.ts), but they are story spaces, not dungeons: no
// static spawn table (the campaign's scenario populates a claim), no
// overworld door (entry is always a scripted interaction gated on quest
// state, through instances/story_instances.ts), and no dungeon-finder or
// difficulty surface. Geometry, walls, and props come from the one shared
// area contract in src/sim/last_bell_field.ts.
//
// doorPos is the overworld RETURN anchor (where leaving the space puts you),
// chosen per quest: the mill stands at the Watch Meadow's western edge, the
// vault under the Sundered Cliffs, the breach in the Riftfields.

import type { DungeonDef } from '../types';

const STORY_INTERIOR = 'farshore_story' as const;

export const LAST_BELL_DUNGEON_DEFS: Record<string, DungeonDef> = {
  lb_tidemill: {
    id: 'lb_tidemill',
    name: 'The Tidemill',
    index: 8,
    doorPos: { x: 352, z: -8 },
    overworldDoor: false,
    entry: { x: 0, z: -18 },
    exitOffset: { x: 4, z: -20 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 1,
    enterText: 'The mill door gives. Inside, the dark is listening.',
    leaveText: 'You step out of the Tidemill into the evening air.',
  },
  lb_riftline: {
    id: 'lb_riftline',
    name: 'The Rift-Line at Dusk',
    index: 9,
    doorPos: { x: 372, z: 2 },
    overworldDoor: false,
    entry: { x: 0, z: -70 },
    exitOffset: { x: 6, z: -74 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'The meadow gate closes behind the patrol. The night belongs to the line.',
    leaveText: 'You leave the rift-line to the dawn watch.',
  },
  lb_vault: {
    id: 'lb_vault',
    name: 'The Drowned First Redoubt',
    index: 10,
    doorPos: { x: 402, z: -68 },
    overworldDoor: false,
    entry: { x: 0, z: -6 },
    exitOffset: { x: 4, z: -8 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'The rope pays out into the dark. Below, the old redoubt lies where it fell.',
    leaveText: 'You come up the cliff rope into daylight.',
  },
  lb_council: {
    id: 'lb_council',
    name: 'The Redoubt Council',
    index: 11,
    doorPos: { x: 306, z: 66 },
    overworldDoor: false,
    entry: { x: 0, z: -70 },
    exitOffset: { x: 6, z: -74 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'The council room holds six chairs. One is empty.',
    leaveText: 'You step out of the redoubt.',
  },
  lb_landing: {
    id: 'lb_landing',
    name: 'The Landing at Night',
    index: 12,
    doorPos: { x: 250, z: 10 },
    overworldDoor: false,
    entry: { x: 0, z: -50 },
    exitOffset: { x: 6, z: -54 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'The guide fires burn down the beach. The fleet waits beyond the shoals.',
    leaveText: 'You leave the Landing beach behind.',
  },
  lb_riftfields: {
    id: 'lb_riftfields',
    name: 'The Riftfields Approach',
    index: 13,
    doorPos: { x: 432, z: 54 },
    overworldDoor: false,
    entry: { x: 0, z: -50 },
    exitOffset: { x: 6, z: -54 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'Four ward sites ring the breach. The rite has closed it for twelve centuries.',
    leaveText: 'You walk back down out of the Riftfields.',
  },
  lb_breach: {
    id: 'lb_breach',
    name: 'Inside the Breach',
    index: 14,
    doorPos: { x: 436, z: 60 },
    overworldDoor: false,
    entry: { x: 0, z: -60 },
    exitOffset: { x: 6, z: -64 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 5,
    enterText: 'The light is wrong and the sky is worse. The heart sits in open ground ahead.',
    leaveText: 'You cross the threshold into ordinary night air.',
  },
  lb_lastwatch: {
    id: 'lb_lastwatch',
    name: 'The Last Watch',
    index: 15,
    doorPos: { x: 306, z: 66 },
    overworldDoor: false,
    entry: { x: 0, z: -70 },
    exitOffset: { x: 6, z: -74 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 1,
    enterText: 'The redoubt is clean and empty. Someone has to close the watch.',
    leaveText: 'You close the redoubt door behind you.',
  },
  lb_willowfen: {
    id: 'lb_willowfen',
    name: 'Willowweep',
    index: 16,
    doorPos: { x: 305, z: 72 },
    overworldDoor: false,
    entry: { x: 0, z: -32 },
    exitOffset: { x: 4, z: -34 },
    spawns: [],
    interior: STORY_INTERIOR,
    suggestedPlayers: 1,
    enterText: 'The willow does not move. The water does not either.',
    leaveText: 'You leave the willow to its quiet.',
  },
};
