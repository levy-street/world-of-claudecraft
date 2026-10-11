import { VEHICLE_STATIONS } from './content/vehicle_stations';
import type { VehicleStationDef } from './types';

/** One station lookup shared by authority, wire validation, aiming and rendering. */
export function vehicleStationById(id: string): Readonly<VehicleStationDef> | undefined {
  return VEHICLE_STATIONS.find((station) => station.id === id);
}

export function vehicleStationByEntityId(id: number): Readonly<VehicleStationDef> | undefined {
  return VEHICLE_STATIONS.find((station) => station.entityId === id);
}
