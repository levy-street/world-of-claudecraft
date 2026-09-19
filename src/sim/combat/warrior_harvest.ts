import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import { hasEscapeStealth } from '../threat';
import { CAST_COMPLETE_EPS, dist2d, type Entity } from '../types';
import { effectivePlayerAttackRange } from './player_attack_reach';

export const RED_HARVEST_IMPACT_DELAY = 0.5;

/** Commit the opening now; deliver the complete three-strike ability once at
 * its final crossing. The ordinary cast caller already spent cost/cooldown.
 * No rolls, refunds or Enrage happen until this guarded simulation deadline. */
export function scheduleRedHarvest(
  ctx: SimContext,
  source: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  resolved: ResolvedAbility,
): void {
  if (!target) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: resolved.def.school,
    fx: 'selfCast',
    ability: resolved.def.id,
  });
  const valid = () =>
    ctx.entities.get(source.id) === source &&
    ctx.entities.get(target.id) === target &&
    ctx.players.get(source.id) === meta &&
    !source.dead &&
    !target.dead &&
    ctx.isHostileTo(source, target) &&
    !hasEscapeStealth(target) &&
    dist2d(source.pos, target.pos) <= effectivePlayerAttackRange(target, resolved.def.range) + 2 &&
    !ctx.lineOfSightBlocked(source, target, resolved.def);
  ctx.delayedEvents.push({
    // The 20 Hz clock accumulates fractional seconds. Match cast completion's
    // numerical tolerance so 0.49999999999999994 does not add a whole tick.
    at: ctx.time + RED_HARVEST_IMPACT_DELAY - CAST_COMPLETE_EPS,
    guard: valid,
    resolve: () => {
      // Recheck references at delivery; changing the selected target never
      // redirects this paid swing, nor can a replacement reuse its entity id.
      if (valid()) ctx.runEffects(source, meta, target, resolved, true);
    },
  });
}
