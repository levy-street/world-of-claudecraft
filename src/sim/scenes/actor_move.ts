import type { SimContext } from '../sim_context';
import { setSquadDirective, squadActorEntity } from '../squad/squad';
import type { SceneOpDef } from './registry';

export function placeActorAtMoveEndpoint(
  ctx: SimContext,
  claimId: number,
  actorId: string,
  x: number,
  z: number,
): void {
  setSquadDirective(ctx, claimId, actorId, { kind: 'hold', x, z });
  const actor = squadActorEntity(ctx, claimId, actorId);
  if (!actor) return;
  actor.pos = ctx.groundPos(x, z);
  actor.prevPos = { ...actor.pos };
  ctx.rebucket(actor);
}

/** Settle each actor at its last authored move endpoint without consuming rng. */
export function fastForwardActorMoves(
  ctx: SimContext,
  claimId: number,
  origin: { x: number; z: number } | null,
  ops: readonly SceneOpDef[],
): void {
  if (!origin) return;
  for (const op of ops) {
    if (op.kind !== 'actorMove') continue;
    placeActorAtMoveEndpoint(ctx, claimId, op.actorId, origin.x + op.x, origin.z + op.z);
  }
}
