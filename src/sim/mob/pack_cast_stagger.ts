// Pack cast stagger: when a pack is pulled, every mob of one type used to seed
// its ability cadence on the same tick, so three Gravecaller Adepts raised
// three Grave Bolt bars in the same frame and every one after that too. This
// spreads a pack's FIRST cast of each ability evenly across one cadence
// interval, in pull order, so the casts alternate (one, then the next...). The
// cadence itself (`every`) is untouched, so each mob casts exactly as often as
// before, and a mob with no engaged same-type peer is not offset at all (a
// single mob's timing is unchanged).
//
// Deterministic and zero-rng: the rank is the number of same-type peers in the
// claim that had ALREADY begun their pull when this mob begins its own (the
// roster is walked in its stored order, and the mob AI engages a pack in
// roster order), so the same pull always staggers the same way on every host.
// No wall clock, no draw.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Seconds to add to a pack member's first cast: rank r of n spreads over one
 *  interval (0, every/n, 2*every/n, ...). Rank 0, or a pack of one, adds 0. */
export function packStaggerOffset(rank: number, size: number, every: number): number {
  if (size <= 1 || rank <= 0 || !(every > 0)) return 0;
  return (every * (rank % size)) / size;
}

/** Is a peer in its fight (pulled, alive, holding a target)? */
function peerEngaged(e: Entity): boolean {
  return !e.dead && e.hp > 0 && e.inCombat && e.aggroTargetId !== null;
}

/**
 * This mob's place among the engaged mobs of its own template in `roster`:
 * `rank` counts the peers that already began their pull (`started`), `size`
 * every engaged peer including the mob itself. Pure over the roster it is
 * handed.
 */
export function packPeerRank(
  roster: Iterable<Entity | undefined>,
  mob: Entity,
  started: (peer: Entity) => boolean,
): { rank: number; size: number } {
  let rank = 0;
  let size = 1;
  for (const e of roster) {
    if (!e || e.id === mob.id || e.kind !== 'mob' || e.templateId !== mob.templateId) continue;
    if (!peerEngaged(e)) continue;
    size++;
    if (started(e)) rank++;
  }
  return { rank, size };
}

/**
 * The breath-cone twin (MobTemplate.breathCone, seeded lazily in
 * mob/locomotion.ts): a dungeon mob's offset among the same-type peers of its
 * claim that already seeded their breath. Open-world mobs (no claim) are never
 * offset, so their timing is exactly as before.
 */
export function packBreathStagger(ctx: SimContext, mob: Entity, every: number): number {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(mob.id));
  if (!inst) return 0;
  const roster = inst.mobIds.map((id) => ctx.entities.get(id));
  const { rank, size } = packPeerRank(roster, mob, (peer) => peer.breathTimer !== undefined);
  return packStaggerOffset(rank, size, every);
}
