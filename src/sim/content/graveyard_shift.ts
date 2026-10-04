// The Graveyard Shift's content: Tibbs, the mob union rep who climbs out of the
// glowing grave by the Hollow Crypt (graveyard_shift/grave_staging.ts spawns him
// on demand, so he is `dynamic`: the Sim ctor never surface-places him). Names
// IP-checked with the concept (Tibbs, Mob Union Rep: clear).

import { GRAVE_POS, TIBBS_NPC_ID, TIBBS_OFFSET } from '../graveyard_shift/grave_entry';
import type { NpcDef } from '../types';

export const TIBBS_NPC_DEF: NpcDef = {
  id: TIBBS_NPC_ID,
  name: 'Tibbs',
  title: 'Mob Union Rep',
  // Where he stands when he is up, beside his grave.
  pos: { x: GRAVE_POS.x + TIBBS_OFFSET.x, z: GRAVE_POS.z + TIBBS_OFFSET.z },
  facing: Math.PI,
  // Old bone, a little yellowed.
  color: 0xd8cfb4,
  questIds: [],
  greeting: 'Tibbs. Mob union rep. Mind the bones, some of them are colleagues.',
  dynamic: true,
};
