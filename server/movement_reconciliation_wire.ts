import type { Entity } from '../src/sim/types';

export interface MovementReconciliationSessionWireState {
  movementWireVersion: 1 | 2;
  lastConsumedCt: number;
  movementOverrideEpoch: number;
  movementOverrideActive: boolean;
  movementMoveSpeedMult: number;
}

export { updateMovementOverrideEpochs as updateOverrideEpochs } from './movement_override_epoch';

export function reconciliationSelfWire(
  session: MovementReconciliationSessionWireState,
  entity: Entity,
): Record<string, number> {
  if (session.movementWireVersion !== 2) return {};
  // Full precision for rpx/rpy/rpz/rpf is LOAD-BEARING for exact-match reconciliation.
  // Rounding makes every acknowledged pose mismatch and forces a replay.
  // The r-prefix keeps this self-only pose outside wireEntity's terse-key namespace.
  return {
    ackCt: session.lastConsumedCt,
    rpx: entity.pos.x,
    rpy: entity.pos.y,
    rpz: entity.pos.z,
    rpf: entity.facing,
    ovE: session.movementOverrideEpoch,
    ...(session.movementOverrideActive ? { ovA: 1 } : {}),
    ...(session.movementMoveSpeedMult !== 1 ? { msm: session.movementMoveSpeedMult } : {}),
  };
}
