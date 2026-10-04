import type { TurretSessionView } from '../sim/turret_defense_session';
import type { CannonPoint, VehicleActionId, VehicleSession } from '../sim/types';

export type { TurretSessionView } from '../sim/turret_defense_session';
export type { VehicleSession } from '../sim/types';

export interface IWorldVehicles {
  /** The cannon seat only: it drives the top-down camera, the cannon bar and gamepad aim. */
  readonly vehicleSession: VehicleSession | null;
  /** The Fire and Fly seat: the same object until the engine revision or its feedback ring moves. */
  readonly turretSession: TurretSessionView | null;
  /** The sim tick while seated in the turret, else null: sample the view's motion segments on it. */
  readonly turretClock: number | null;
  enterVehicle(stationId: string): void;
  useVehicleAction(action: VehicleActionId, point: CannonPoint): void;
  leaveVehicle(): void;
}
