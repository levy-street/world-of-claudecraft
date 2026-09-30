import { isCannonActionId } from '../src/sim/minigames/cannon_encounter';
import type { CannonActionId, CannonPoint, VehicleActionId } from '../src/sim/types';
import { vehicleStationById } from '../src/sim/vehicle_stations';

interface VehicleCommands {
  enterVehicle(station: string, pid: number): unknown;
  useVehicleAction(action: VehicleActionId, point: CannonPoint, pid: number): unknown;
  leaveVehicle(pid: number): void;
}

// Keyed by every non-cannon action, so tsc flags a `VehicleActionId` this router would drop.
const SEAT_ACTIONS: Readonly<Record<Exclude<VehicleActionId, CannonActionId>, true>> = {
  turret_fire: true,
  turret_replay: true,
  turret_shockwave: true,
  turret_frag: true,
};

function vehicleActionId(value: unknown): value is VehicleActionId {
  return (
    isCannonActionId(value) || (typeof value === 'string' && Object.hasOwn(SEAT_ACTIONS, value))
  );
}

export function dispatchVehicleCommand(
  sim: VehicleCommands,
  pid: number,
  msg: Record<string, unknown>,
): void {
  if (msg.cmd === 'vehicle_leave') sim.leaveVehicle(pid);
  else if (
    msg.cmd === 'vehicle_enter' &&
    typeof msg.station === 'string' &&
    vehicleStationById(msg.station)
  )
    sim.enterVehicle(msg.station, pid);
  else if (
    msg.cmd === 'vehicle_action' &&
    vehicleActionId(msg.action) &&
    typeof msg.x === 'number' &&
    Number.isFinite(msg.x) &&
    typeof msg.z === 'number' &&
    Number.isFinite(msg.z)
  )
    sim.useVehicleAction(msg.action, { x: msg.x, z: msg.z }, pid);
}
