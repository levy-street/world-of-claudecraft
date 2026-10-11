import { describe, expect, it, vi } from 'vitest';
import { LAST_KEEP_CANNON, NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { VehicleAimCore } from '../src/ui/hud/vehicle/vehicle_aim_core';
import type { IWorldVehicles } from '../src/world_api/vehicles';

describe('vehicle ground aim', () => {
  it.each([NORTH_WATCH_CANNON, LAST_KEEP_CANNON])(
    'aims inside $id and supports switching and cancelling',
    (station) => {
      const world: IWorldVehicles = {
        vehicleSession: {
          kind: 'cannon',
          stationId: station.id,
          cycle: 'wq3_8',
          origin: { x: station.x, y: 3, z: station.z },
          encounter: createCannonEncounter(),
        },
        enterVehicle: vi.fn(),
        leaveVehicle: vi.fn(),
        useVehicleAction: vi.fn(),
      };
      const clear = vi.fn();
      const aim = new VehicleAimCore(world, clear);
      aim.begin('cannonball', 0);
      const target = {
        x: (station.field.minX + station.field.maxX) / 2,
        z: (station.field.minZ + station.field.maxZ) / 2,
      };
      expect(aim.isActive()).toBe(false);
      world.vehicleSession!.encounter.phase = 'wave';
      aim.begin('cannonball', 0);
      expect(aim.rawAimPoint()).toEqual(target);
      aim.nudge(10000, -10000);
      expect(aim.rawAimPoint()).toEqual({ x: station.field.maxX, z: station.field.minZ });
      aim.updatePoint({ x: 0, z: 0 });
      expect(aim.reticle()?.blocked).toBe(true);
      expect(aim.commitAt()).toBe(true);
      expect(world.useVehicleAction).not.toHaveBeenCalled();
      expect(aim.isActive()).toBe(true);
      aim.begin('incendiary', 2);
      expect(aim.reticle()?.radius).toBe(7);
      expect(aim.commitAt(target)).toBe(true);
      expect(world.useVehicleAction).toHaveBeenCalledWith('incendiary', target);
      expect(aim.isActive()).toBe(false);
      aim.begin('grapeshot', 1);
      expect(aim.cancel()).toBe(true);
      expect(aim.cancel()).toBe(false);
      expect(clear).toHaveBeenCalledTimes(2);
    },
  );
});
