// The Graveyard Shift's content: Tibbs, the mob union rep who climbs out of the
// glowing grave by the Hollow Crypt (graveyard_shift/grave_staging.ts spawns him
// on demand, so he is `dynamic`: the Sim ctor never surface-places him). Names
// IP-checked with the concept (Tibbs, Mob Union Rep: clear).

import { TIBBS_NPC_ID } from '../graveyard_shift/grave_entry';
import type { NpcDef } from '../types';

export const TIBBS_NPC_DEF: NpcDef = {
  id: TIBBS_NPC_ID,
  name: 'Tibbs',
  title: 'Mob Union Rep',
  // Placeholder, the Spirit Healer's own: never surface-placed (dynamic), he
  // rises beside his grave (grave_entry.ts tibbsSpot). Shared with that
  // placeholder so the NPC-spot readers (the furniture collider veto, the map
  // and wiki tooling) see no new point near the secret grave.
  pos: { x: 0, z: 0 },
  facing: Math.PI,
  // Old bone, a little yellowed.
  color: 0xd8cfb4,
  questIds: [],
  greeting: 'Tibbs. Mob union rep. Mind the bones, some of them are colleagues.',
  dynamic: true,
};
