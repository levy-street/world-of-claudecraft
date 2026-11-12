// How far from a corpse's pivot a looter may stand: the classic INTERACT_RANGE
// for an ordinary body, measured from the body's EDGE for a template that
// authors a bodyRadius (the towering raid and dungeon bosses). A big body's
// pivot can sit where no looter can stand (the Guardian of the Heat dies in
// the middle of its 10.5 yd wellspring), so the classic 5 yd to the centre
// left it unlootable. The same body radius already moves player melee to the
// body's edge (combat/player_attack_reach.ts); looting follows it.
//
// Pure and host-agnostic: the authoritative gate (interaction.ts lootCorpse,
// the walk-by pass and the targeted interact press) and every client mirror
// (game/interactions.ts click and approach, game/nearby_interaction_core.ts,
// game/autoloot.ts, the loot popup's drift close) read this ONE function, so
// the client never offers a loot the server refuses.

import { MOBS } from '../data';
import { type Entity, INTERACT_RANGE } from '../types';

/** Yards past INTERACT_RANGE a body's own size adds to its loot reach: the
 *  template's authored bodyRadius for a mob body, 0 otherwise. */
export function corpseLootReachBonus(body: Pick<Entity, 'kind' | 'templateId'>): number {
  if (body.kind !== 'mob') return 0;
  const r = MOBS[body.templateId]?.bodyRadius;
  return r !== undefined && r > 0 ? r : 0;
}

/** The loot reach of a body, measured flat (dist2d) to its pivot. */
export function corpseLootReach(body: Pick<Entity, 'kind' | 'templateId'>): number {
  return INTERACT_RANGE + corpseLootReachBonus(body);
}

let maxReach: number | null = null;

/** The widest loot reach any mob template has: the radius a proximity scan
 *  for corpses (the untargeted interact press, the RL observation) queries
 *  before it gates each body on its own `corpseLootReach`. MOBS is fixed once
 *  the content is merged, so this is computed once. */
export function maxCorpseLootReach(): number {
  if (maxReach === null) {
    let r = 0;
    for (const t of Object.values(MOBS)) {
      if (t.bodyRadius !== undefined && t.bodyRadius > r) r = t.bodyRadius;
    }
    maxReach = INTERACT_RANGE + r;
  }
  return maxReach;
}
