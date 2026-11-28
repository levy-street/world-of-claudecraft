// How far from a corpse's pivot a looter may stand: the classic INTERACT_RANGE
// for an ordinary body, measured from the body's EDGE for a template that
// authors a bodyRadius (the towering raid and dungeon bosses). A big body's
// pivot can sit where no looter can stand (the Guardian of the Heat dies in
// the middle of its 10.5 yd wellspring), so the classic 5 yd to the centre
// left it unlootable. The same body radius already moves player melee to the
// body's edge (combat/player_attack_reach.ts); looting follows it.
//
// A Smith's Heart guardian's loot is also taken from its authored loot spot,
// where its forge coffer stands on open floor (encounters/smith_heart/
// loot_spots.ts): `corpseLootDistance` is the nearer of the two.
//
// Pure and host-agnostic: the authoritative gate (interaction.ts lootCorpse,
// the walk-by pass and both interact presses, the RL observation) and every
// client mirror (game/interactions.ts click and approach,
// game/nearby_interaction_core.ts, game/autoloot.ts, the loot popup's drift
// close) read `corpseLootDistance`, so the client never offers a loot the
// server refuses.

import { SMITH_HEART_DUNGEON } from '../content/smith_heart';
import { dungeonAt, MOBS } from '../data';
import { smithHeartLootSpot } from '../encounters/smith_heart/loot_spots';
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

const _spot = { x: 0, z: 0, yaw: 0 };

/** How far `from` stands from being able to loot this body, in the yards the
 *  classic INTERACT_RANGE gate compares: the flat distance to the body less
 *  its loot reach bonus (a big body is looted from its edge), or the flat
 *  distance to its authored loot spot, whichever is nearer. A looter may take
 *  the body's loot when this is at most INTERACT_RANGE. */
export function corpseLootDistance(
  body: Pick<Entity, 'kind' | 'templateId' | 'pos'>,
  from: { x: number; z: number },
): number {
  const dx = from.x - body.pos.x;
  const dz = from.z - body.pos.z;
  const atBody = Math.sqrt(dx * dx + dz * dz) - corpseLootReachBonus(body);
  if (body.kind !== 'mob') return atBody;
  const spot = smithHeartLootSpot(body.templateId, body.pos.x, body.pos.z, _spot);
  if (!spot) return atBody;
  const sx = from.x - spot.x;
  const sz = from.z - spot.z;
  return Math.min(atBody, Math.sqrt(sx * sx + sz * sz));
}

/** Where a looter walks to take this body's loot: its authored loot spot when
 *  it has one (the coffer), else the body itself. */
export function corpseLootApproachPoint(body: Pick<Entity, 'kind' | 'templateId' | 'pos'>): {
  x: number;
  z: number;
} {
  const spot =
    body.kind === 'mob' ? smithHeartLootSpot(body.templateId, body.pos.x, body.pos.z) : null;
  return spot ? { x: spot.x, z: spot.z } : { x: body.pos.x, z: body.pos.z };
}

/** Yards round a looter at `pos` a proximity scan for lootable bodies must
 *  query: the widest loot reach anywhere, and inside the Smith's Heart wide
 *  enough to find a guardian's body anywhere in its arena from its loot spot. */
export const SMITH_HEART_LOOT_SCAN_R = 120;
export function corpseLootScanRadius(pos: { x: number }): number {
  return dungeonAt(pos.x)?.id === SMITH_HEART_DUNGEON
    ? SMITH_HEART_LOOT_SCAN_R
    : maxCorpseLootReach();
}
