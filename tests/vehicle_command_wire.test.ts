import { describe, expect, it, vi } from 'vitest';
import { dispatchVehicleCommand } from '../server/vehicle_command_wire';
import { LAST_KEEP_CANNON, NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';

describe('vehicle command authority boundary', () => {
  it('admits the second registered station through the same authenticated command', () => {
    const sim = { enterVehicle: vi.fn(), useVehicleAction: vi.fn(), leaveVehicle: vi.fn() };
    dispatchVehicleCommand(sim, 7, { cmd: 'vehicle_enter', station: LAST_KEEP_CANNON.id, pid: 99 });
    expect(sim.enterVehicle).toHaveBeenCalledExactlyOnceWith(LAST_KEEP_CANNON.id, 7);
  });
  it('uses only the authenticated pid and discards client combat outcomes', () => {
    const sim = { enterVehicle: vi.fn(), useVehicleAction: vi.fn(), leaveVehicle: vi.fn() };
    dispatchVehicleCommand(sim, 7, {
      cmd: 'vehicle_enter',
      station: NORTH_WATCH_CANNON.id,
      pid: 99,
    });
    expect(sim.enterVehicle).toHaveBeenCalledWith(NORTH_WATCH_CANNON.id, 7);
    dispatchVehicleCommand(sim, 7, {
      cmd: 'vehicle_action',
      action: 'cannonball',
      x: 3,
      z: 4,
      pid: 99,
      damage: 999999,
    });
    expect(sim.useVehicleAction).toHaveBeenCalledWith('cannonball', { x: 3, z: 4 }, 7);
    dispatchVehicleCommand(sim, 7, { cmd: 'vehicle_leave', pid: 99 });
    expect(sim.leaveVehicle).toHaveBeenCalledWith(7);
  });

  it.each([
    { cmd: 'vehicle_enter', station: '__proto__' },
    { cmd: 'vehicle_action', action: 'constructor', x: 1, z: 2 },
    { cmd: 'vehicle_action', action: 'cannonball', x: NaN, z: 2 },
    { cmd: 'vehicle_action', action: 'cannonball', x: 1, z: Infinity },
    { cmd: 'vehicle_action', action: 'cannonball', x: '1', z: 2 },
    { cmd: 'vehicle_win' },
  ])('drops malformed or forged commands: %j', (msg) => {
    const sim = { enterVehicle: vi.fn(), useVehicleAction: vi.fn(), leaveVehicle: vi.fn() };
    dispatchVehicleCommand(sim, 7, msg);
    expect(sim.enterVehicle).not.toHaveBeenCalled();
    expect(sim.useVehicleAction).not.toHaveBeenCalled();
    expect(sim.leaveVehicle).not.toHaveBeenCalled();
  });
});
