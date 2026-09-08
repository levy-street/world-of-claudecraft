import type { RuneOfPowerDisposition } from '../../world_api/combat';
import type { SimContext } from '../sim_context';

/** Matches the canonical friendly pulse, including pets and nonparty players.
 * Eligibility is an invitation, not proof that a pulse has granted the buff. */
export function runeOfPowerDispositionFor(
  ctx: SimContext,
  sourceId: number,
  viewerId: number,
): RuneOfPowerDisposition {
  const source = ctx.entities.get(sourceId),
    viewer = ctx.entities.get(viewerId);
  if (!source || !viewer || viewer.dead || viewer.hp <= 0) return 'unknown';
  if (source.dead || source.hp <= 0) return 'inactive';
  if (source.id === viewer.id || ctx.isFriendlyTo(source, viewer))
    return 'eligible';
  return ctx.isHostileTo(source, viewer) ? 'opponent' : 'unknown';
}
