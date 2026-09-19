import { moverHeight, resolveMovement } from '../sim/colliders';
import {
  clampDelveDoorSolids,
  clampDelveModuleBounds,
  type DelveDoorClampSolid,
  type DelveModuleBoundsRun,
} from '../sim/delves/geometry';
import { moveSpeedMult, type PlayerMotionDeps } from '../sim/player_motion';
import type { Entity } from '../sim/types';

/** The mirrored delve state the predictor's resolveMove needs to reproduce
 *  the server's clampDelveModuleBounds + clampDelveDoors chain: the module
 *  shell/bounds view (matches either host's DelveRun/DelveRunInfo shape) plus
 *  this frame's door/prop solids, derived from the mirrored entity roster
 *  (delveDoorClampSolidsFromEntities, src/sim/delves/geometry.ts). Null
 *  outside a delve, so every other position keeps resolving exactly as before. */
export interface ClientDelveMotionState {
  run: DelveModuleBoundsRun;
  solids: readonly DelveDoorClampSolid[];
}

export function createClientPlayerMotionDeps(
  seed: number,
  speedMult: (entity: Entity) => number = (entity) => moveSpeedMult(entity, 0),
  riftCollisionToken = 0,
  delveState: () => ClientDelveMotionState | null = () => null,
): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: speedMult,
    resolveMove: (fromX, fromZ, nx, nz, radius, entity, ignoreFences) => {
      const delve = delveState();
      const res = resolveMovement(
        seed,
        fromX,
        fromZ,
        nx,
        nz,
        radius,
        ignoreFences,
        delve?.run.modules,
        moverHeight(entity),
        riftCollisionToken,
      );
      if (!delve) return res;
      const bounded = clampDelveModuleBounds(delve.run, res.x, res.z, radius);
      return clampDelveDoorSolids(delve.solids, bounded.x, bounded.z, radius);
    },
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}
