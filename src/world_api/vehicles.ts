import type { CannonActionId, CannonPoint, VehicleSession } from '../sim/types';

export type { VehicleSession } from '../sim/types';

export interface IWorldVehicles {
  readonly vehicleSession: VehicleSession | null;
  enterVehicle(stationId: string): void;
  useVehicleAction(action: CannonActionId, point: CannonPoint): void;
  leaveVehicle(): void;
}
