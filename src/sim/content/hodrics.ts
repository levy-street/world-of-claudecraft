// Hodric's Castle: overworld-facing content. The Gauntlet Herald is the one
// world NPC of the feature: talk to him to open the race window (queue,
// standings, practice). The course itself lives in sim/hodrics_layout.ts.

import type { NpcDef } from '../types';

export const HC_HERALD_NPC_ID = 'hodrics_herald';

/**
 * The Herald's RESERVED entity id. He is spawned at world init OUTSIDE the
 * nextId sequence: the parity goldens pin `nextId` (and every ctor-spawned
 * id) per frame, so allocating him normally would shift every later id and
 * red the whole golden suite. nextId grows by roughly one per mob respawn,
 * so reaching 1e9 would take decades of uptime; the +100 offset keeps him
 * clear of other reserved ids on sibling feature branches.
 */
export const HC_HERALD_ID = 1_000_000_100;

/**
 * Vestigial surface position. Osric now stands in the Proving Grounds hub (see
 * data.ts MINIGAME_HUB + MINIGAME_HUB_OSRIC); spawnHcHerald places him there.
 */
export const HC_HERALD_POS = { x: -24, z: -6 };

export const HC_HERALD: NpcDef = {
  id: HC_HERALD_NPC_ID,
  name: 'Herald Osric',
  // The nameplate subtitle is the game name he recruits for, shown beside Maro
  // in the hub, not a personal role title.
  title: "Hodric's Castle",
  // Placeholder position: never surface-placed (dynamic), spawned guarded at
  // world init with the reserved id above, at the hub anchor.
  pos: { x: 0, z: 0 },
  facing: Math.PI * 0.75,
  // Hodric's purple, trimmed in gold: the banner colors of the castle.
  color: 0x9a6cd8,
  questIds: [],
  greeting:
    'Lord Hodric opens his causeway to all comers! Race the Gauntlet, dodge the flails, take the crown!',
  dynamic: true,
};
