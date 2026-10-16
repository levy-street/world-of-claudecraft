import { isShardpikeItem } from './lance_balance_core';
import { LANCE_THROW_ABILITY, LANCE_THROW_RELEASE } from './lance_throw_timing';
import { scheduleProjectile } from './projectile_travel';
import type { SimContext } from './sim_context';
import type { Entity, SimEvent } from './types';
import { CAST_COMPLETE_EPS } from './types';

/** Commit a throw, then release from the live hand position after its windup.
 * The existing projectile queue owns homing, death/despawn cancellation and impact.
 * No client callback can award damage or quest credit. */
export function throwLance(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  impact: (source: Entity, target: Entity) => void,
): void {
  const sourceId = source.id;
  const targetId = target.id;
  const cue = (fx: Extract<SimEvent, { type: 'spellfx' }>['fx']) =>
    ctx.emit({
      type: 'spellfx',
      sourceId,
      targetId,
      school: 'physical',
      ability: LANCE_THROW_ABILITY,
      fx,
    });
  cue('windup');
  ctx.delayedEvents.push({
    at: ctx.time + LANCE_THROW_RELEASE - CAST_COMPLETE_EPS,
    resolve: () => {
      const liveSource = ctx.entities.get(sourceId);
      const liveTarget = ctx.entities.get(targetId);
      if (
        !liveSource ||
        liveSource.dead ||
        liveSource.ghost ||
        !liveTarget ||
        liveTarget.dead ||
        // Any Shardpike: Skerrit's quest pike OR the muster's lent copy off the rack. A
        // literal id here once silently dropped every throw of the lent pike mid-flight.
        !isShardpikeItem(ctx.players.get(sourceId)?.equipment.mainhand)
      )
        return;
      cue('projectile');
      scheduleProjectile(ctx, liveSource, liveTarget, (caster, victim) => {
        cue('ccImpact');
        impact(caster, victim);
      });
    },
  });
}
