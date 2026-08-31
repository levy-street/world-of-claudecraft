import { moverHeight, resolveMovement } from '../sim/colliders';
import { moveSpeedMult, type PlayerMotionDeps } from '../sim/player_motion';
import type { Entity } from '../sim/types';

export function createClientPlayerMotionDeps(
  seed: number,
  speedMult: (entity: Entity) => number = (entity) => moveSpeedMult(entity, 0),
  riftCollisionToken = 0,
): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: speedMult,
    resolveMove: (fromX, fromZ, nx, nz, radius, entity, ignoreFences) =>
      resolveMovement(
        seed,
        fromX,
        fromZ,
        nx,
        nz,
        radius,
        ignoreFences,
        undefined,
        moverHeight(entity),
        riftCollisionToken,
      ),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}
