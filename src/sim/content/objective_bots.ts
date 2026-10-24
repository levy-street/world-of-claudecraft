// The practice champion: the body an authored map's objective rehearsal fields
// so a maker walking their own capture-the-flag map has something to play
// against (social/map_objective_bots.ts drives it).
//
// It lives in the MOBS table like every other mob, for the same reason the Vale
// Cup ball does: the mob paths look their template up by id (mob/targeting.ts
// isTrivialTo, the damage arm's elite multiplier, corpse harvest, deeds), and an
// unregistered id is an immediate crash rather than a graceful default. Nothing
// spawns it from a camp, the rehearsal driver is its only source, and the base
// world has no camps referencing it.

import type { MobTemplate } from '../types';

export const OBJECTIVE_BOT_TEMPLATE_ID = 'objective_practice_champion';

export const OBJECTIVE_BOT_MOB: MobTemplate = {
  id: OBJECTIVE_BOT_TEMPLATE_ID,
  name: 'Practice Champion',
  minLevel: 1,
  maxLevel: 60,
  family: 'humanoid',
  // Tuned as a sparring partner, not a boss: enough health to survive the run
  // across the field, enough damage to punish standing still on the flag, and
  // fast enough to actually contest a carrier.
  hpBase: 220,
  hpPerLevel: 34,
  dmgBase: 6,
  dmgPerLevel: 1.4,
  attackSpeed: 2,
  armorPerLevel: 8,
  moveSpeed: 6.4,
  aggroRadius: 12,
  // No loot and no harvest components: a rehearsal must not become a farm.
  loot: [],
  scale: 1,
  color: 0xd1413a,
};
