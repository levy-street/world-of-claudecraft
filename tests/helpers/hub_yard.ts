// The built-in world WITHOUT the Eastbrook hub practice yard (the training
// dummy and Drillmaster Hale, sim/hub_practice.ts), which stands eleven yards
// from the player start. A seed-pinned combat test that fights AT the start
// with hand-placed mobs (tab targeting, trivial-con aggro, paladin and pet
// pacing) otherwise picks the hostile dummy up as a target, a block source or
// an AoE victim. The yard keys on the sparring master's def, so dropping that
// one NPC yields exactly the pre-yard world: same ids, same draws.
import { HUB_SPARRING_MASTER_ID } from '../../src/sim/content/practice_dummies';
import { BUILTIN_WORLD } from '../../src/sim/data';
import type { WorldContent } from '../../src/sim/types';

const { [HUB_SPARRING_MASTER_ID]: _hale, ...npcsWithoutYard } = BUILTIN_WORLD.npcs;

export const WORLD_WITHOUT_HUB_YARD: WorldContent = { ...BUILTIN_WORLD, npcs: npcsWithoutYard };
