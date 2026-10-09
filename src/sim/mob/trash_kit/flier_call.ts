// A flying patrol is the one pack a party cannot walk up to: it comes down
// when it sees a player from its loop (mob/patrol.ts flierSightRadius) or when
// its pack is pulled. If neither ever happens (a party that hugs a wall, a
// pull that resets while it is on the far leg), a gate that waits on its pack
// would stay shut for good. So the LAST pack of a gate always comes down: once
// every other pack of a gate that lists the flier's pack is dead, the flier
// lands on the nearest living player in its claim who is close enough to fight
// it without dragging it past its leash. Zero rng: the nearest player wins,
// ties to the lower entity id.

import { DUNGEONS } from '../../data';
import { dungeonPacksDead } from '../../instances/dungeon_gates';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DUNGEON_LEASH_DISTANCE, dist2d, type Entity } from '../../types';

/** A called flier's target stands within this of it: inside its leash, so the
 *  chase ends in a fight and never in an evade. */
export const FLIER_CALL_RANGE = DUNGEON_LEASH_DISTANCE - 15;

/** The claim-local pack label of a roster mob (`<dungeon>:<slot>:<pack>`). */
function packLabel(mob: Entity): string | null {
  const key = mob.dungeonPackId;
  return key ? key.slice(key.lastIndexOf(':') + 1) : null;
}

/** Is every OTHER pack dead in some gate that waits on this flier's pack? */
export function flierIsLastOfItsGate(ctx: SimContext, inst: InstanceSlot, mob: Entity): boolean {
  const pack = packLabel(mob);
  if (!pack) return false;
  for (const gate of DUNGEONS[inst.dungeonId]?.gates ?? []) {
    if (!gate.packs?.includes(pack)) continue;
    const others = gate.packs.filter((p) => p !== pack);
    // A gate that waits on the flier alone leaves the pull to its sight.
    if (others.length > 0 && dungeonPacksDead(ctx, inst, others)) return true;
  }
  return false;
}

/**
 * Bring an idle flying patrol down when it is the last pack of its gate.
 * Returns true when it was pulled this tick.
 */
export function callDownLastFlier(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  players: readonly Entity[],
): boolean {
  if (mob.dungeonPatrol?.flightY === undefined || mob.aiState !== 'idle') return false;
  if (!flierIsLastOfItsGate(ctx, inst, mob)) return false;
  let best: Entity | null = null;
  let bestD = FLIER_CALL_RANGE;
  for (const p of players) {
    if (p.dead || p.devNoAggro) continue;
    const d = dist2d(p.pos, mob.pos);
    if (d < bestD - 1e-9 || (best !== null && Math.abs(d - bestD) <= 1e-9 && p.id < best.id)) {
      best = p;
      bestD = d;
    }
  }
  if (!best) return false;
  // The pull the flier's own sight would have made: its pack lands with it,
  // and it is a target from this tick.
  if (!ctx.aggroMob(mob, best, true)) return false;
  mob.hostile = true;
  return true;
}
