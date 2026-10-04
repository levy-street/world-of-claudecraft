import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GP } from '../src/game/gamepad_map';
import { raceOrVehicleMovementLocked } from '../src/game/glider_controls';
import {
  facingToward,
  leaveTurretOnEscape,
  TURRET_PAD_WEAPON_BUTTONS,
  turretLookYaw,
  turretPadWeaponSlot,
  turretRenderFacing,
  turretSeated,
} from '../src/game/turret_controls';
import { TURN_SPEED } from '../src/sim/types';

const SEATED = { origin: { x: 0, y: 0, z: 0 } };

describe('the turret facing', () => {
  it('points along +z at 0 and +x at a quarter turn (x += sin, z += cos)', () => {
    const at = { x: 5, z: -3 };
    expect(facingToward(at, { x: 5, z: 7 })).toBeCloseTo(0);
    expect(facingToward(at, { x: 15, z: -3 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(facingToward(at, { x: 5, z: -13 })!)).toBeCloseTo(Math.PI);
    expect(facingToward(at, { x: -5, z: -3 })).toBeCloseTo(-Math.PI / 2);
    const diagonal = facingToward(at, { x: 6, z: -2 })!;
    expect(Math.sin(diagonal)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.cos(diagonal)).toBeCloseTo(Math.SQRT1_2);
  });

  it('gives no heading for a point on the player', () => {
    expect(facingToward({ x: 1, z: 1 }, { x: 1, z: 1 })).toBeNull();
  });

  it('tracks the reticle while seated, holds without one, and yields off the seat', () => {
    const player = { pos: { x: 0, z: 0 }, facing: 1.25 };
    const reticle = { point: { x: 0, z: -10 } };
    expect(turretRenderFacing({ turretSession: SEATED, player }, { point: { x: 10, z: 0 } })).toBe(
      Math.PI / 2,
    );
    expect(Math.abs(turretRenderFacing({ turretSession: SEATED, player }, reticle)!)).toBeCloseTo(
      Math.PI,
    );
    expect(turretRenderFacing({ turretSession: SEATED, player }, { point: { x: 0, z: 10 } })).toBe(
      0,
    );
    expect(turretRenderFacing({ turretSession: SEATED, player }, null)).toBe(1.25);
    expect(turretRenderFacing({ turretSession: SEATED, player }, { point: { x: 0, z: 0 } })).toBe(
      1.25,
    );
    expect(turretRenderFacing({ turretSession: null, player }, reticle)).toBeNull();
    expect(turretRenderFacing({ player }, reticle)).toBeNull();
  });
});

describe('the turret seat input', () => {
  it('reads a seat from the turret view only', () => {
    expect(turretSeated({})).toBe(false);
    expect(turretSeated({ turretSession: null })).toBe(false);
    expect(turretSeated({ turretSession: SEATED })).toBe(true);
  });

  it('leaves the turret on Escape, and hands Escape back off the seat', () => {
    const leaveVehicle = vi.fn();
    expect(leaveTurretOnEscape({ turretSession: SEATED, leaveVehicle })).toBe(true);
    expect(leaveVehicle).toHaveBeenCalledTimes(1);
    expect(leaveTurretOnEscape({ turretSession: null, leaveVehicle })).toBe(false);
    expect(leaveVehicle).toHaveBeenCalledTimes(1);
  });

  it('turns the view with the held turn keys or the touch stick while seated, at the keyboard turn rate', () => {
    const turn = (keys: number, touch: number) => ({
      heldTurnAxis: () => keys,
      touchTurnAxis: () => touch,
    });
    const at = (input: ReturnType<typeof turn>, dt = 0.05) =>
      turretLookYaw({ turretSession: SEATED }, input, dt);
    expect(at(turn(1, 0))).toBeCloseTo(TURN_SPEED * 0.05);
    expect(at(turn(-1, 0))).toBeCloseTo(-TURN_SPEED * 0.05);
    expect(at(turn(0, 1))).toBeCloseTo(TURN_SPEED * 0.05);
    expect(at(turn(0, -1))).toBeCloseTo(-TURN_SPEED * 0.05);
    // Key and stick the same way turn no faster than one; opposite ways cancel.
    expect(at(turn(1, 1))).toBeCloseTo(TURN_SPEED * 0.05);
    expect(at(turn(1, -1))).toBe(0);
    expect(at(turn(1, 0), 5)).toBeCloseTo(TURN_SPEED * 0.1);
    expect(turretLookYaw({ turretSession: null }, turn(1, 1), 0.05)).toBe(0);
  });

  it('locks local movement while seated in the turret, the cannon unchanged', () => {
    const lock = (vehicleSession: unknown, turretSession?: unknown) =>
      raceOrVehicleMovementLocked({ mountRaceView: () => null, vehicleSession, turretSession });
    expect(lock(null)).toBe(false);
    expect(lock(null, null)).toBe(false);
    expect(lock(null, SEATED)).toBe(true);
    expect(lock({ stationId: 'north_watch_cannon' }, null)).toBe(true);
  });
});

describe('the turret wiring in main.ts', () => {
  const code = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ');
  const pinned = (anchor: string) => expect(code.includes(anchor), anchor).toBe(true);

  it('lets the reticle drive the facing first, and keeps the camera from chasing it', () => {
    pinned(
      'function renderFacingOverride(): number | null { if (turretControls.turretSeated(world)) return turretControls.turretRenderFacing(world, hud.groundAimReticle());',
    );
    pinned(
      'cameraDriven: turretControls.turretSeated(world) || (input.isMouseCameraMode() && cameraMoveActive()),',
    );
  });

  it('turns the view with the held turn keys and the touch stick', () => {
    pinned('input.camYaw += turretControls.turretLookYaw(world, input, frameDt);');
    pinned('stickTurnsView: () => turretControls.turretSeated(world),');
  });

  it('fires a lifted touch at the reticle shown, never a re-projected finger', () => {
    pinned(
      'onGroundAimTap: (x, y) => { if (!hud.isGroundAimActive()) return false; if (turretControls.turretSeated(world)) { hud.commitGroundAimAt(); return true; }',
    );
  });

  it('leaves the turret on Escape only once no window is left to close, from keys and pad', () => {
    const leaveOnEscape =
      'if (hud.cancelGroundAim()) break; if (!hud.closeAll() && !turretControls.leaveTurretOnEscape(world)) hud.toggleOptionsMenu();';
    pinned(leaveOnEscape);
    pinned(leaveOnEscape.replace('break;', 'return;'));
  });
});

describe('the turret pad weapons', () => {
  it('maps Y to the Shockwave slot and LB to the fragmentation slot, only while seated', () => {
    expect(TURRET_PAD_WEAPON_BUTTONS).toEqual([GP.Y, GP.LB]);
    expect(turretPadWeaponSlot({ turretSession: SEATED }, GP.Y)).toBe(0);
    expect(turretPadWeaponSlot({ turretSession: SEATED }, GP.LB)).toBe(1);
    expect(turretPadWeaponSlot({ turretSession: SEATED }, GP.A)).toBeNull();
    expect(turretPadWeaponSlot({ turretSession: null }, GP.Y)).toBeNull();
    expect(turretPadWeaponSlot({}, GP.LB)).toBeNull();
  });
});
