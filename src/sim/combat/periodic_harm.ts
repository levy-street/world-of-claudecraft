// Periodic harm between PLAYERS re-checks the verdict on every tick. A mob's
// hostility to a player, and a player's to a mob, never change while an aura
// rides; the open-world verdict does (src/sim/pvp/world_pvp.ts): an unflagged
// victim who walks out of a free-for-all zone, or into a sanctuary, and a pair
// whose duel or battleground has ended, are no longer someone the source may
// hit, and a bleed that landed a second before the crossing must not keep
// killing them on the far side of it (PR 4146 review, finding 1). The aura
// walk (auras.ts) asks here before every damaging tick of a `dot`, a Maledict
// Gaze and a Hex of Violence; a tick the verdict refuses is skipped and the
// aura expires (its remaining time zeroed, so the walk's ordinary expiry
// prunes it that same pass with the usual fade), never left to tick again.
//
// Two deliberate limits keep the classic feel: a source who has died keeps
// their ticks landing (a warlock's curses outlive the warlock, in a duel or an
// arena as much as anywhere; isHostileTo refuses a dead attacker, so it is not
// consulted for one), and a source who has left the world entirely is treated
// the same way. Host-agnostic: no rng, no clock, pure over ctx.isHostileTo.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The player controlling `source`: the player, or a player's pet; null for a
 *  wild mob, an object, or a source that is gone. */
function controllerOf(ctx: SimContext, source: Entity | null): Entity | null {
  if (!source) return null;
  if (source.kind === 'player') return source;
  if (source.kind === 'mob' && source.ownerId !== null) {
    const owner = ctx.entities.get(source.ownerId);
    return owner?.kind === 'player' ? owner : null;
  }
  return null;
}

/**
 * May a periodic harmful tick from `source` still land on `target`? True for
 * every pair that is not player-versus-player, for a self-inflicted tick, and
 * for a source who has died or left; otherwise the live verdict.
 */
export function periodicHarmStands(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
): boolean {
  if (target.kind !== 'player') return true;
  const controller = controllerOf(ctx, source);
  if (!controller || controller.dead || controller.id === target.id) return true;
  // `source` (not the controller) so a pet resolves through the sim's own
  // pvpController arm exactly as its direct hits do.
  return ctx.isHostileTo(source as Entity, target);
}
