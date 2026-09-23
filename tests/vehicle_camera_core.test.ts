import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createVehicleCamera,
  stepRendererVehicleCamera,
  stepVehicleCamera,
  vehicleCameraTarget,
} from '../src/render/vehicle_camera_core';
import { LAST_KEEP_CANNON, NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import type { VehicleSession } from '../src/sim/types';

const live = Object.freeze({ x: 368, y: 4, z: 1144, yaw: 1.2, pitch: 0.32, dist: 12 });
const target = { ...NORTH_WATCH_CANNON, y: 4 };
describe('vehicle camera composition', () => {
  it('resolves the live station for the renderer and drops unknown session identities', () => {
    const session: VehicleSession = {
      kind: 'cannon',
      stationId: LAST_KEEP_CANNON.id,
      cycle: 'wq3_8',
      origin: { x: 0, y: 8, z: 0 },
      encounter: createCannonEncounter(),
    };
    expect(vehicleCameraTarget(session)).toEqual({ ...LAST_KEEP_CANNON, y: 8 });
    session.stationId = 'missing_cannon';
    expect(vehicleCameraTarget(session)).toBeNull();
    expect(vehicleCameraTarget(null)).toBeNull();
  });
  it('centers a second station after switching away from the first', () => {
    const state = createVehicleCamera();
    stepVehicleCamera(state, live, target, 16 / 9, 60, 0, true);
    const station = LAST_KEEP_CANNON;
    const pose = stepVehicleCamera(state, live, { ...station, y: 8 }, 16 / 9, 60, 0, true);
    expect(pose.x).toBe((station.field.minX + station.field.maxX) / 2);
    expect(pose.z).toBe((station.field.minZ + station.z) / 2);
    expect(pose.y).toBe(8);
  });
  it('leaves normal orbit untouched and reuses its output', () => {
    const state = createVehicleCamera();
    const frame = stepVehicleCamera(state, live, null, 16 / 9, 60, 1 / 60, false);
    expect(frame).toEqual(live);
    expect(stepVehicleCamera(state, live, null, 16 / 9, 60, 1 / 60, false)).toBe(frame);
  });
  it('blends in and restores exactly in 600ms without changing saved camera', () => {
    const state = createVehicleCamera();
    const mid = { ...stepVehicleCamera(state, live, target, 16 / 9, 60, 0.3, false) };
    expect(mid.pitch).toBeGreaterThan(live.pitch);
    expect(mid.pitch).toBeLessThan((70 * Math.PI) / 180);
    const full = stepVehicleCamera(state, live, target, 16 / 9, 60, 0.3, false);
    expect(full.pitch).toBeCloseTo((70 * Math.PI) / 180);
    expect(full.yaw).toBeCloseTo(Math.PI);
    expect(stepVehicleCamera(state, live, null, 16 / 9, 60, 0.3, false)).toEqual(mid);
    expect(stepVehicleCamera(state, live, null, 16 / 9, 60, 0.3, false)).toEqual(live);
  });
  it.each([16 / 9, 9 / 16, 0.5])(
    'fits every field corner and the cannon at aspect %s',
    (aspect) => {
      const pose = stepVehicleCamera(createVehicleCamera(), live, target, aspect, 60, 0, true);
      for (const x of [target.field.minX, target.field.maxX]) {
        for (const z of [target.field.minZ, target.z]) {
          const depth = pose.dist + (z - pose.z) * Math.cos(pose.pitch);
          expect(Math.abs(x - pose.x) / depth).toBeLessThan(Math.tan(Math.PI / 6) * aspect);
          expect((Math.abs(z - pose.z) * Math.sin(pose.pitch)) / depth).toBeLessThan(
            Math.tan(Math.PI / 6),
          );
        }
      }
    },
  );
  it('reduced motion snaps both entry and exit even at zero delta', () => {
    const state = createVehicleCamera();
    expect(stepVehicleCamera(state, live, target, 1, 60, 0, true).pitch).toBeCloseTo(
      (70 * Math.PI) / 180,
    );
    expect(stepVehicleCamera(state, live, null, 1, 60, 0, true)).toEqual(live);
  });
});

describe('the renderer vehicle camera host seam', () => {
  it('composes the boom pivot and the manned station exactly as the direct call does', () => {
    const session = {
      kind: 'cannon',
      stationId: NORTH_WATCH_CANNON.id,
      cycle: 'wq3_8',
      origin: { x: 0, y: 4, z: 0 },
      encounter: createCannonEncounter(),
    } as VehicleSession;
    const host = {
      vehicleCamera: createVehicleCamera(),
      camBoom: { x: 360, y: 4, z: 1140 },
      camFeel: { leadX: 0.5, leadZ: -0.25 },
      sim: { vehicleSession: session },
      camera: { aspect: 1.6 },
      baseFov: 60,
    };
    const expected = stepVehicleCamera(
      createVehicleCamera(),
      { ...live, x: 360.5, y: 4, z: 1139.75 },
      vehicleCameraTarget(session),
      1.6,
      60,
      0.1,
      false,
    );
    expect({ ...stepRendererVehicleCamera(host, live, 0.1, false) }).toEqual({ ...expected });
  });

  it('stays welded to the private renderer members the host cast reads', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    for (const anchor of [
      'private readonly vehicleCamera = createVehicleCamera();',
      'private readonly camBoom = createCameraBoom();',
      'private readonly camFeel = createCameraFeel();',
      'private baseFov = CAMERA_BASE_FOV;',
      'camera: THREE.PerspectiveCamera;',
      'const pose = stepRendererVehicleCamera(this, directedPose, dt, reduce);',
    ]) {
      expect(renderer, anchor).toContain(anchor);
    }
  });
});
