// The built-in world WITHOUT the Eastbrook hub practice yard (the training
// dummy and Drillmaster Hale, sim/hub_practice.ts). A seed-pinned combat test
// that fights AT the start with hand-placed mobs (tab targeting, trivial-con
// aggro, paladin and pet pacing) otherwise could pick the hostile dummy up as a
// target, a block source or an AoE victim (the yard stood eleven yards from the
// player start until the Studio town rework (#4593) moved it north). The yard
// keys on the sparring master's def, so dropping that one NPC yields exactly
// the pre-yard world: same ids, same draws.
import {
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_SPARRING_MASTER_ID,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../../src/sim/content/practice_dummies';
import { BUILTIN_WORLD } from '../../src/sim/data';
import { practiceDummyPos } from '../../src/sim/moved_objects';
import type { WorldContent } from '../../src/sim/types';

const { [HUB_SPARRING_MASTER_ID]: _hale, ...npcsWithoutYard } = BUILTIN_WORLD.npcs;

export const WORLD_WITHOUT_HUB_YARD: WorldContent = { ...BUILTIN_WORLD, npcs: npcsWithoutYard };

// Where the shipped world actually stands the two hub dummies. The Studio town
// rework (#4593) moved both through the live touch-up's object moves
// (sim/moved_objects.ts), which sim/hub_practice.ts resolves over the content
// marks (HUB_TRAINING_DUMMY_POS, HUB_HEALING_DUMMY_POS), so a test that looks
// a dummy up or stands beside it reads these. tests/hub_training_dummy.test.ts
// and tests/hub_healing_dummy.test.ts pin them as literals.
export const HUB_TRAINING_DUMMY_MARK = practiceDummyPos(
  BUILTIN_WORLD.objectMoves,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
);
export const HUB_HEALING_DUMMY_MARK = practiceDummyPos(
  BUILTIN_WORLD.objectMoves,
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
);
