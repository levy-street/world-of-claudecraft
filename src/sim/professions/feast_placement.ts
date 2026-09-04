import { isRiftPos } from '../data';
import { PLAYER_BODY_RADIUS } from '../pathfind';
import { floorHeightAt } from '../physics';
import { riftPlayerLift } from '../rift/runs';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { groundHeight } from '../world';

/** Resolve support once at placement: objects have no gravity of their own.
 * Use the movement floor below the player's feet, including standable props
 * and battleground decks, without lifting a table onto an overhead surface.
 * Rift elevation is a separate runtime lift, shared with its object lift tick. */
export function feastPlacementHeight(ctx: SimContext, player: Entity): number {
  const { x, y, z } = player.pos;
  if (isRiftPos(x)) return groundHeight(x, z, ctx.cfg.seed) + riftPlayerLift(ctx, player);
  return floorHeightAt(ctx.cfg.seed, x, z, PLAYER_BODY_RADIUS, y);
}
