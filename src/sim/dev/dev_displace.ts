// The one dev-only displacement: every /dev teleport (coordinates, town hub,
// the mount-quest stable jump) moves a player the same way, through the same
// profession-session teardown a real teleport runs, and re-buckets the entity
// so the grids never hold a stale cell. Dev-gated by every caller (the
// handleDevChat surface behind ctx.devCommands); never reached in production.
import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import type { SimContext } from '../sim_context';
import type { Entity, Vec3 } from '../types';

export function displacePlayerForDev(ctx: SimContext, entity: Entity, x: number, z: number): Vec3 {
  cancelProfessionSessionOnDisplacement(ctx, entity);
  const pos = ctx.groundPos(x, z);
  entity.pos = pos;
  entity.prevPos = { ...pos };
  ctx.rebucket(entity);
  return pos;
}
