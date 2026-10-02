import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  newTurretGroundMarker,
  TURRET_MARKER_AIR_RESAMPLE_SHARE,
  TURRET_MARKER_LIFT,
  TURRET_MARKER_MATRIX_FLOATS,
  TURRET_MARKER_MAX_TILT,
  TURRET_MARKER_RADIUS_PAD,
  TURRET_MARKER_RADIUS_SCALE,
  TURRET_MARKER_RESAMPLE_SHARE,
  TURRET_MARKER_RESAMPLE_YD,
  type TurretGroundMarker,
  TurretMarkerGround,
  turretGroundMarkerInto,
  turretGroundMarkerMatrixInto,
  turretMarkerRadius,
  turretMarkerResampleYd,
  turretMarkerShown,
} from '../src/render/turret_ground_marker_core';
import {
  newTurretMonsterPose,
  type TurretMonsterInput,
  turretMonsterPoseInto,
} from '../src/render/turret_monster_pose_core';
import { TURRET_SIZE_CLASSES } from '../src/sim/content/turret_defense';
import {
  type FlySegment,
  marchSegment,
  positionAt,
  type SkidSegment,
  stillSegment,
} from '../src/sim/minigames/thrown_body';
import type { TurretMonsterState } from '../src/sim/minigames/turret_defense';
import { DT } from '../src/sim/types';

const flat = { ground: () => 0 };
const slope = { ground: (x: number, z: number) => 0.1 * x - 0.05 * z };

function monster(
  state: TurretMonsterState,
  seg: TurretMonsterInput['seg'],
  hp = 50,
): TurretMonsterInput {
  return { id: 3, hp, maxHp: 100, state, seg, facing: 0 };
}

function markerOf(
  m: TurretMonsterInput,
  tick: number,
  probe: { ground(x: number, z: number): number },
  radius = 0.6,
): { marker: TurretGroundMarker; pose: ReturnType<typeof newTurretMonsterPose> } {
  const pose = turretMonsterPoseInto(newTurretMonsterPose(), m, { mass: 1 }, tick, probe);
  const marker = turretGroundMarkerInto(
    newTurretGroundMarker(),
    m,
    pose,
    radius,
    probe,
    new TurretMarkerGround(),
  );
  return { marker, pose };
}

const flight: FlySegment = {
  kind: 'fly',
  start: 0,
  end: 40,
  x: 5,
  y: 0.5,
  z: 2,
  vx: 6,
  vy: 12,
  vz: -3,
  g: 30,
  contact: 'ground',
  nx: 0,
  nz: 0,
};
const slide: SkidSegment = {
  kind: 'skid',
  start: 0,
  end: 30,
  x: 10,
  y: 1,
  z: 4,
  vx: 5,
  vz: 1,
  decel: 12,
  contact: 'stop',
};

describe('Fire and Fly ground marker placement', () => {
  it('lies on the ground under the body for every segment kind', () => {
    const cases: [TurretMonsterState, TurretMonsterInput['seg']][] = [
      ['march', marchSegment(0, 30, 0, 12, 0, 0, 4, 2)],
      ['fly', flight],
      ['skid', slide],
      // The engine rests a body where it came down: on the ground.
      ['down', stillSegment(0, 20, { x: -6, y: slope.ground(-6, 9), z: 9 })],
      ['rise', stillSegment(0, 20, { x: 7, y: slope.ground(7, -2), z: -2 })],
    ];
    for (const [state, seg] of cases) {
      for (const tick of [0, 3.5, 11, 17.25]) {
        const { marker, pose } = markerOf(monster(state, seg), tick, slope);
        const at = positionAt(seg, tick, slope);
        expect(marker.visible, `${state} at ${tick}`).toBe(true);
        expect(marker.x).toBeCloseTo(at.x, 9);
        expect(marker.z).toBeCloseTo(at.z, 9);
        expect(marker.x).toBeCloseTo(pose.x, 12);
        expect(marker.z).toBeCloseTo(pose.z, 12);
        // A plane: the rim's mean is its center, so the lift is the only offset.
        expect(marker.y).toBeCloseTo(slope.ground(at.x, at.z) + TURRET_MARKER_LIFT, 9);
      }
    }
  });

  it('follows a flying body at its shadow point, not in the air, down to its landing spot', () => {
    let rose = false;
    for (let tick = 1; tick <= flight.end; tick += 1.5) {
      const { marker, pose } = markerOf(monster('fly', flight), tick, slope);
      if (pose.y > slope.ground(pose.x, pose.z) + 2) rose = true;
      expect(marker.x).toBeCloseTo(pose.x, 12);
      expect(marker.z).toBeCloseTo(pose.z, 12);
      expect(marker.y).toBeCloseTo(slope.ground(pose.x, pose.z) + TURRET_MARKER_LIFT, 9);
    }
    expect(rose).toBe(true);
    const landing = positionAt(flight, flight.end, flat);
    const { marker } = markerOf(monster('fly', flight), flight.end, flat);
    expect(marker.x).toBeCloseTo(landing.x, 9);
    expect(marker.z).toBeCloseTo(landing.z, 9);
    expect(marker.y).toBeCloseTo(TURRET_MARKER_LIFT, 12);
  });

  it('sizes the marker by body radius, every size class larger than its body', () => {
    expect(turretMarkerRadius(0.5)).toBeCloseTo(
      0.5 * TURRET_MARKER_RADIUS_SCALE + TURRET_MARKER_RADIUS_PAD,
      12,
    );
    const classes = Object.values(TURRET_SIZE_CLASSES)
      .map((c) => c.radius)
      .sort((a, b) => a - b);
    let last = 0;
    for (const radius of classes) {
      const r = turretMarkerRadius(radius);
      expect(r).toBeGreaterThan(radius);
      expect(r).toBeGreaterThan(last);
      last = r;
      const { marker } = markerOf(
        monster('march', marchSegment(0, 20, 0, 0, 0, 0, 4, 2)),
        2,
        flat,
        radius,
      );
      expect(marker.radius).toBeCloseTo(r, 12);
    }
  });

  it('hides the marker under a corpse, a gone body and a windup, and nowhere else', () => {
    const still = stillSegment(0, 20, { x: 3, y: 0, z: 3 });
    const hidden: [TurretMonsterState, TurretMonsterInput['seg'], number][] = [
      ['dead', still, 0],
      ['gone', still, 0],
      ['gone', still, 40],
      ['skid', slide, 0],
      // A monster killed mid-air flies once as a corpse: no marker either.
      ['fly', flight, 0],
      ['windup', still, 50],
    ];
    for (const [state, seg, hp] of hidden) {
      const { marker } = markerOf(monster(state, seg, hp), 5, flat);
      expect(marker.visible, `${state} hp ${hp}`).toBe(false);
    }
    const shown: TurretMonsterState[] = ['march', 'fly', 'skid', 'down', 'rise'];
    for (const state of shown) {
      expect(turretMarkerShown({ state, hp: 1 }, -1), state).toBe(true);
    }
    expect(turretMarkerShown({ state: 'march', hp: 1 }, 0)).toBe(false);
  });

  it('tilts with the ground under the disc, up to its tilt bound', () => {
    const marker = newTurretGroundMarker();
    const pose = { x: 4, y: 0.8, z: -2, windup: -1 };
    const body = { state: 'march' as const, hp: 10 };
    turretGroundMarkerInto(
      marker,
      body,
      pose,
      0.6,
      { ground: (x) => 0.2 * x },
      new TurretMarkerGround(),
    );
    const n = new THREE.Vector3(-0.2, 1, 0).normalize();
    expect(marker.nx).toBeCloseTo(n.x, 9);
    expect(marker.ny).toBeCloseTo(n.y, 9);
    expect(marker.nz).toBeCloseTo(n.z, 9);
    turretGroundMarkerInto(
      marker,
      body,
      pose,
      0.6,
      { ground: (_x, z) => 6 * z },
      new TurretMarkerGround(),
    );
    expect(Math.acos(marker.ny)).toBeCloseTo(TURRET_MARKER_MAX_TILT, 9);
    expect(marker.nx).toBeCloseTo(0, 12);
    expect(marker.nz).toBeLessThan(0);
    expect(Math.hypot(marker.nx, marker.ny, marker.nz)).toBeCloseTo(1, 12);
  });

  it('rises over a dip to the rim so its edge never sinks, and sits on a crest', () => {
    const marker = newTurretGroundMarker();
    const body = { state: 'march' as const, hp: 10 };
    const bowl = { ground: (x: number, z: number) => 0.3 * (x * x + z * z) };
    const pose = { x: 0, y: bowl.ground(0, 0), z: 0, windup: -1 };
    turretGroundMarkerInto(marker, body, pose, 0.6, bowl, new TurretMarkerGround());
    const r = turretMarkerRadius(0.6);
    expect(marker.y).toBeCloseTo(0.3 * r * r + TURRET_MARKER_LIFT, 9);
    const crest = { ground: (x: number, z: number) => 2 - 0.3 * (x * x + z * z) };
    const top = { ...pose, y: crest.ground(0, 0) };
    turretGroundMarkerInto(marker, body, top, 0.6, crest, new TurretMarkerGround());
    expect(marker.y).toBeCloseTo(2 + TURRET_MARKER_LIFT, 9);
  });
});

describe('Fire and Fly ground marker matrix', () => {
  it("writes three's own matrix for the marker: up turned to the ground normal, scaled, placed", () => {
    const marker = newTurretGroundMarker();
    turretGroundMarkerInto(
      marker,
      { state: 'fly', hp: 5 },
      { x: 12, y: 9, z: -7, windup: -1 },
      0.9,
      {
        ground: (x, z) => 0.3 * x + 0.15 * z + 2,
      },
      new TurretMarkerGround(),
    );
    const out = new Float32Array(TURRET_MARKER_MATRIX_FLOATS * 2);
    turretGroundMarkerMatrixInto(out, TURRET_MARKER_MATRIX_FLOATS, marker);
    const normal = new THREE.Vector3(marker.nx, marker.ny, marker.nz);
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3(marker.x, marker.y, marker.z),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
      new THREE.Vector3().setScalar(marker.radius),
    );
    for (let i = 0; i < 16; i++) {
      expect(out[TURRET_MARKER_MATRIX_FLOATS + i], `element ${i}`).toBeCloseTo(
        expected.elements[i],
        5,
      );
    }
    expect([...out.subarray(0, TURRET_MARKER_MATRIX_FLOATS)].every((v) => v === 0)).toBe(true);
  });

  it('is the plain scale and translation on flat ground', () => {
    const marker = newTurretGroundMarker();
    turretGroundMarkerInto(
      marker,
      { state: 'march', hp: 5 },
      { x: 1, y: 0, z: 2, windup: -1 },
      0.5,
      flat,
      new TurretMarkerGround(),
    );
    const out = new Float32Array(TURRET_MARKER_MATRIX_FLOATS);
    turretGroundMarkerMatrixInto(out, 0, marker);
    const s = marker.radius;
    const expected = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 1, TURRET_MARKER_LIFT, 2, 1];
    for (let i = 0; i < 16; i++) expect(out[i], `element ${i}`).toBeCloseTo(expected[i], 6);
  });
});

describe('Fire and Fly ground marker slope sample', () => {
  function counting(ground: (x: number, z: number) => number) {
    const probe = {
      reads: 0,
      ground(x: number, z: number): number {
        probe.reads++;
        return ground(x, z);
      },
    };
    return probe;
  }

  it("takes a grounded body's height from its pose, and reads the slope again once it has moved a share of the disc", () => {
    const ground = (x: number, z: number) => 0.2 * x + 0.1 * z;
    const probe = counting(ground);
    const slope = new TurretMarkerGround();
    const marker = newTurretGroundMarker();
    const body = { state: 'march' as const, hp: 10 };
    const every = turretMarkerResampleYd(turretMarkerRadius(0.6), false);
    expect(every).toBeCloseTo(turretMarkerRadius(0.6) * TURRET_MARKER_RESAMPLE_SHARE, 12);
    const on = (x: number) => ({ x, y: ground(x, 0), z: 0, windup: -1 });
    turretGroundMarkerInto(marker, body, on(0), 0.6, probe, slope);
    expect(probe.reads).toBe(4);
    const step = every / 4;
    for (let i = 1; i <= 3; i++) {
      turretGroundMarkerInto(marker, body, on(i * step), 0.6, probe, slope);
      // The disc follows the body's own height, so it never floats or sinks on the slope.
      expect(marker.y).toBeCloseTo(ground(i * step, 0) + TURRET_MARKER_LIFT, 9);
    }
    expect(probe.reads).toBe(4);
    turretGroundMarkerInto(marker, body, on(every), 0.6, probe, slope);
    expect(probe.reads).toBe(4 + 4);
    // A different disc (another body in the same slot) samples afresh, as does a reset one.
    turretGroundMarkerInto(marker, body, on(every), 1.2, probe, slope);
    expect(probe.reads).toBe(4 + 4 + 4);
    slope.reset();
    turretGroundMarkerInto(marker, body, on(every), 1.2, probe, slope);
    expect(probe.reads).toBe(4 + 4 + 4 + 4);
  });

  it('reads the ground under a flying body every frame, and its slope once the shadow has swept a whole disc', () => {
    const ground = (x: number, z: number) => 0.2 * x + 0.1 * z;
    const probe = counting(ground);
    const slope = new TurretMarkerGround();
    const marker = newTurretGroundMarker();
    const body = { state: 'fly' as const, hp: 10 };
    const every = turretMarkerResampleYd(turretMarkerRadius(0.6), true);
    expect(every).toBeCloseTo(turretMarkerRadius(0.6) * TURRET_MARKER_AIR_RESAMPLE_SHARE, 12);
    const up = (x: number) => ({ x, y: ground(x, 0) + 9, z: 0, windup: -1 });
    turretGroundMarkerInto(marker, body, up(0), 0.6, probe, slope);
    expect(probe.reads).toBe(5);
    for (let i = 1; i <= 3; i++) {
      turretGroundMarkerInto(marker, body, up((i * every) / 4), 0.6, probe, slope);
      expect(marker.y).toBeCloseTo(ground((i * every) / 4, 0) + TURRET_MARKER_LIFT, 9);
    }
    expect(probe.reads).toBe(5 + 3);
    turretGroundMarkerInto(marker, body, up(every), 0.6, probe, slope);
    expect(probe.reads).toBe(5 + 3 + 5);
    // Never finer than the floor, whatever the disc.
    expect(turretMarkerResampleYd(0.1, false)).toBe(TURRET_MARKER_RESAMPLE_YD);
  });

  it('keeps a fast throw and a march within their ground-read budgets at 60 frames a second', () => {
    const frames = 60;
    const ticksPerFrame = 1 / (frames * DT);
    const readsPerFrame = (m: TurretMonsterInput): number => {
      const probe = counting(() => 0);
      const slope = new TurretMarkerGround();
      const marker = newTurretGroundMarker();
      const pose = newTurretMonsterPose();
      for (let f = 0; f < frames; f++) {
        turretMonsterPoseInto(pose, m, { mass: 1 }, f * ticksPerFrame, flat);
        turretGroundMarkerInto(marker, m, pose, 0.6, probe, slope);
        expect(marker.visible).toBe(true);
      }
      return probe.reads / frames;
    };
    // A small body thrown at 24 yd/s for a second: re-reading the slope every
    // frame would cost five reads a frame (the center plus four across the disc).
    const throwSeg: FlySegment = {
      ...flight,
      end: 1 / DT,
      x: 0,
      y: 0,
      z: 0,
      vx: 24,
      vy: 15,
      vz: 0,
    };
    expect(readsPerFrame(monster('fly', throwSeg))).toBeLessThanOrEqual(2.5);
    // A march at 4 yd/s reads no center at all, and its slope a few times a second.
    expect(readsPerFrame(monster('march', marchSegment(0, 30, 0, 0, 0, 0, 4, 2)))).toBeLessThan(1);
  });

  it('reads nothing for a hidden marker', () => {
    const probe = counting(() => 0);
    const marker = newTurretGroundMarker();
    turretGroundMarkerInto(
      marker,
      { state: 'dead', hp: 0 },
      { x: 0, y: 0, z: 0, windup: -1 },
      0.6,
      probe,
      new TurretMarkerGround(),
    );
    expect(marker.visible).toBe(false);
    expect(probe.reads).toBe(0);
  });
});
