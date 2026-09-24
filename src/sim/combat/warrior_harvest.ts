import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Red Harvest resolves on the cast tick like every other classic instant: the
 * three weapon strikes, the guaranteed Enrage and the charge refunds all land
 * before this call returns, so a target that dies, steps out or breaks line of
 * sight a moment later has already been hit and nothing paid for is lost.
 *
 * What is special is only the presentation handshake. weaponStrike is a
 * self-announcing effect (no generic cast-completion cue), so the opening cue
 * is emitted here before the strikes, and every strike carries
 * attackAnimationStarted so the client does not restart the authored clip on
 * each damage event. The client owns the 0.15 / 0.32 / 0.49 s contact timing
 * (src/render/ability_vfx/harvest_choreography.ts) over the instant result. */
export function castRedHarvest(
  ctx: SimContext,
  source: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  resolved: ResolvedAbility,
): void {
  if (target) {
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: target.id,
      school: resolved.def.school,
      fx: 'selfCast',
      ability: resolved.def.id,
    });
  }
  ctx.runEffects(source, meta, target, resolved, true);
}
