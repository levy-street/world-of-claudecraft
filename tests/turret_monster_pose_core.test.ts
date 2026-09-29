import { describe, expect, it } from 'vitest';
import { FALL_FLAIL_ENTER_SPEED } from '../src/render/characters/anim_state';
import {
  newTurretMonsterPose,
  TURRET_HALF_WIDTH,
  TURRET_LIE_SECONDS,
  TURRET_SINK_SECONDS,
  TURRET_TICK_LEAD_MAX,
  TURRET_TUMBLE_MAX,
  TURRET_TUMBLE_TILT,
  TURRET_UPRIGHT_SECONDS,
  TurretAttitude,
  TurretDisplayClock,
  type TurretMonsterInput,
  type TurretMonsterPose,
  turretMonsterPoseInto,
  turretPivotHeight,
  turretSpinSign,
  turretTumbleTilt,
} from '../src/render/turret_monster_pose_core';
import { TURRET_PHYSICS, TURRET_TIMING } from '../src/sim/content/turret_defense';
import {
  type FlySegment,
  marchSegment,
  planFlight,
  positionAt,
  resolveFlightEnd,
  stillSegment,
  type ThrowProbe,
} from '../src/sim/minigames/thrown_body';
import type { TurretMonsterState } from '../src/sim/minigames/turret_defense';
import { DT } from '../src/sim/types';

const slope = { ground: (x: number, z: number) => 0.1 * x - 0.05 * z };
const flat: ThrowProbe = { ground: () => 0, water: () => null };

function monster(
  state: TurretMonsterState,
  seg: TurretMonsterInput['seg'],
  over: Partial<TurretMonsterInput> = {},
): TurretMonsterInput {
  return { id: 1, hp: 50, maxHp: 100, state, seg, facing: 0.4, ...over };
}

function poseOf(
  m: TurretMonsterInput,
  tick: number,
  mass = 1,
  frozen = false,
  templateId?: string,
): TurretMonsterPose {
  return turretMonsterPoseInto(
    newTurretMonsterPose(),
    m,
    { mass, templateId },
    tick,
    slope,
    frozen,
  );
}

/** World y of the attitude's body axes: side (+x), up (+y), forward (+z). */
function axesY(a: TurretAttitude): { side: number; up: number; fwd: number } {
  return {
    side: 2 * (a.x * a.y + a.w * a.z),
    up: 1 - 2 * (a.x * a.x + a.z * a.z),
    fwd: 2 * (a.y * a.z - a.w * a.x),
  };
}

/** Angle (rad) between two attitudes. */
function turn(a: { x: number; y: number; z: number; w: number }, b: typeof a): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
}

function launch(start: number, vx: number, vy: number, vz: number): FlySegment {
  return planFlight(start, 0, 0, 0, { x: vx, y: vy, z: vz }, 0.5, flat, TURRET_PHYSICS);
}

describe('Fire and Fly monster pose per segment kind', () => {
  it('march: samples the segment at a fractional tick, faces its direction and walks at its speed', () => {
    const seg = marchSegment(100, 40, 0, 10, 0, 0, 4.4, 4);
    const m = monster('march', seg);
    const pose = poseOf(m, 112.4);
    const expected = positionAt(seg, 112.4, slope);
    expect(pose.x).toBeCloseTo(expected.x, 9);
    expect(pose.z).toBeCloseTo(expected.z, 9);
    expect(pose.y).toBeCloseTo(slope.ground(expected.x, expected.z), 9);
    expect(pose.x).toBeLessThan(poseOf(m, 112).x);
    expect(pose.yaw).toBeCloseTo(Math.atan2(-40, -10), 9);
    expect(pose.moving).toBe(true);
    expect(pose.speed).toBe(4.4);
    expect(pose.attitude).toBe('upright');
    const arrived = poseOf(m, seg.end + 0.5);
    expect(arrived.moving).toBe(false);
    expect(arrived.speed).toBe(0);
  });

  it('windup: reports its progress and faces the turret', () => {
    const seg = stillSegment(200, TURRET_TIMING.windupTicks, { x: 3, y: 0, z: 4 });
    const pose = poseOf(
      monster('windup', seg, { facing: -2 }),
      200 + TURRET_TIMING.windupTicks / 2,
    );
    expect(pose.windup).toBeCloseTo(0.5, 9);
    expect(pose.yaw).toBe(-2);
    expect(pose.moving).toBe(false);
    expect(poseOf(monster('march', marchSegment(0, 9, 0, 9, 0, 0, 2, 1)), 1).windup).toBe(-1);
  });

  it('fly: airborne, tumbling about a horizontal axis near square to the flight, leaning by id', () => {
    const seg = launch(50, 6, 12, -8);
    const pose = poseOf(monster('fly', seg), 50.5);
    expect(pose.airborne).toBe(true);
    expect(pose.attitude).toBe('tumble');
    expect(Math.hypot(pose.axisX, pose.axisZ)).toBeCloseTo(1, 9);
    // The axis leans off the square to the flight by the id's own tilt, never past the bound.
    const h = Math.hypot(seg.vx, seg.vz);
    const along = (pose.axisX * seg.vx + pose.axisZ * seg.vz) / h;
    expect(along).toBeCloseTo(Math.sin(turretTumbleTilt(1)), 9);
    expect(Math.abs(along)).toBeLessThanOrEqual(Math.sin(TURRET_TUMBLE_TILT) + 1e-12);
    const tilts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => turretTumbleTilt(id).toFixed(6)));
    expect(tilts.size).toBeGreaterThan(4);
    expect(pose.x).toBeCloseTo(positionAt(seg, 50.5, slope).x, 9);
    expect(pose.falling).toBe(false);
    // Just past the apex it is still airborne, not yet falling fast enough to flail.
    const apex = seg.vy / seg.g + (0.5 * FALL_FLAIL_ENTER_SPEED) / seg.g;
    expect(50 + apex / DT).toBeLessThan(seg.end);
    expect(poseOf(monster('fly', seg), 50 + apex / DT).falling).toBe(false);
    // Well past the apex the body falls (the rig's fall pose where it has one).
    const late = poseOf(monster('fly', launch(50, 6, 12, -8)), 50 + 0.95 * (seg.end - seg.start));
    expect(late.falling).toBe(true);
  });

  it('fly: the spin sign comes from the id and the rate from speed and mass', () => {
    const seg = launch(0, 10, 10, 0);
    const odd = poseOf(monster('fly', seg, { id: 3 }), 1);
    const even = poseOf(monster('fly', seg, { id: 4 }), 1);
    expect(turretSpinSign(3)).toBe(1);
    expect(turretSpinSign(4)).toBe(-1);
    expect(odd.spin).toBeGreaterThan(0);
    expect(even.spin).toBeCloseTo(-odd.spin, 9);
    expect(odd.side).toBe(1);
    expect(even.side).toBe(-1);
    const heavy = poseOf(monster('fly', seg, { id: 3 }), 1, 4);
    expect(heavy.spin).toBeCloseTo(odd.spin / 2, 9);
    const faster = poseOf(monster('fly', launch(0, 40, 40, 0), { id: 3 }), 1);
    expect(faster.spin).toBeLessThanOrEqual(TURRET_TUMBLE_MAX);
    // A dead-center pop with no horizontal speed still tumbles, about the body's own side axis.
    const pop = poseOf(monster('fly', launch(0, 0, 10, 0), { facing: 0.7 }), 1);
    expect(Math.hypot(pop.axisX, pop.axisZ)).toBeCloseTo(1, 9);
    expect(pop.axisX * Math.sin(0.7) + pop.axisZ * Math.cos(0.7)).toBeCloseTo(
      Math.sin(turretTumbleTilt(1)),
      9,
    );
  });

  it('fly: a positive spin pitches the body forward along its flight, a negative one backward', () => {
    const tipOf = (id: number): number => {
      const m = monster('fly', launch(0, 8, 14, 0), { id, facing: 0 });
      const att = new TurretAttitude();
      for (let t = 0; t <= 2; t++) att.step(poseOf(m, t), t);
      return 2 * (att.x * att.y - att.w * att.z);
    };
    expect(tipOf(3)).toBeGreaterThan(0.05);
    expect(tipOf(4)).toBeLessThan(-0.05);
  });

  it('skid: a living body settles over the slide, a corpse rights itself and plays its death', () => {
    const seg = {
      kind: 'skid' as const,
      start: 10,
      end: 16,
      x: 0,
      y: 0,
      z: 0,
      vx: 5,
      vz: 0,
      decel: 25,
      contact: 'stop' as const,
    };
    const living = poseOf(monster('skid', seg), 13);
    expect(living.attitude).toBe('lie');
    expect(living.easeSeconds).toBeCloseTo(6 * DT, 9);
    expect(living.elapsed).toBeCloseTo(3 * DT, 9);
    expect(living.dead).toBe(false);
    const corpse = poseOf(monster('skid', seg, { hp: 0 }), 13);
    expect(corpse.attitude).toBe('upright');
    expect(corpse.keepHeading).toBe(true);
    expect(corpse.dead).toBe(true);
  });

  it('down, rise and dead: lie quickly, rise over the rise, sink in the last second', () => {
    const at = { x: 1, y: 0, z: 2 };
    const down = poseOf(monster('down', stillSegment(0, TURRET_TIMING.downTicks, at)), 2);
    expect(down.attitude).toBe('lie');
    const rise = poseOf(monster('rise', stillSegment(0, TURRET_TIMING.riseTicks, at)), 3);
    expect(rise.attitude).toBe('upright');
    expect(rise.keepHeading).toBe(false);
    expect(rise.easeSeconds).toBeCloseTo(TURRET_TIMING.riseTicks * DT, 9);
    // Getting up, it turns toward the turret it walks back to.
    const center = { cx: 11, cz: -4 };
    const facing = turretMonsterPoseInto(
      newTurretMonsterPose(),
      monster('rise', stillSegment(0, TURRET_TIMING.riseTicks, at)),
      { mass: 1 },
      3,
      slope,
      false,
      center,
    );
    expect(facing.yaw).toBeCloseTo(Math.atan2(center.cx - at.x, center.cz - at.z), 12);
    const corpse = stillSegment(0, TURRET_TIMING.corpseTicks, at);
    const dead = monster('dead', corpse, { hp: 0 });
    expect(poseOf(dead, 1).dead).toBe(true);
    expect(poseOf(dead, 1).keepHeading).toBe(true);
    expect(poseOf(dead, 1).health).toBe(0);
    const sinkStart = corpse.end - TURRET_SINK_SECONDS / DT;
    expect(poseOf(dead, sinkStart - 1).sink).toBe(0);
    expect(poseOf(dead, (sinkStart + corpse.end) / 2).sink).toBeCloseTo(0.5, 9);
    expect(poseOf(dead, corpse.end).sink).toBe(1);
  });

  it('a lost session freezes every body where it stands', () => {
    const flight = monster('fly', stillSegment(40, 0, { x: 0, y: 3, z: 0 }));
    expect(poseOf(flight, 45).attitude).toBe('hold');
    const march = monster('march', marchSegment(0, 9, 0, 9, 0, 0, 3, 1));
    const frozen = poseOf(march, 5, 1, true);
    expect(frozen.moving).toBe(false);
    expect(frozen.attitude).toBe('hold');
    const corpse = monster('dead', stillSegment(40, 0, { x: 0, y: 0, z: 0 }), { hp: 0 });
    expect(poseOf(corpse, 45, 1, true).sink).toBe(0);
  });
});

/**
 * Tumbles a fresh attitude through a flight for `ticks`, as a painter would at
 * 3 frames a tick; the body faces back toward the blast, as the engine turns it.
 */
function tumbled(id: number, vx: number, vy: number, vz: number, ticks: number): TurretAttitude {
  const att = new TurretAttitude();
  const m = monster('fly', launch(0, vx, vy, vz), { id, facing: Math.atan2(-vx, -vz) });
  for (let t = 0; t <= ticks + 1e-9; t += 1 / 3) att.step(poseOf(m, t), t);
  return att;
}

describe('Fire and Fly monster attitude', () => {
  it('tumbles continuously through a bounce (a new segment never snaps the body)', () => {
    const first = launch(0, 8, 14, 0);
    const bounce = resolveFlightEnd(first, 0.5, flat, TURRET_PHYSICS);
    expect(bounce.kind).toBe('bounce');
    if (bounce.kind !== 'bounce') return;
    const att = new TurretAttitude();
    const m1 = monster('fly', first, { id: 5 });
    const m2 = monster('fly', bounce.seg, { id: 5 });
    const frame = 1 / 3;
    att.step(poseOf(m1, 0), 0);
    let prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    let maxStep = 0;
    for (let t = frame; t < bounce.seg.end; t += frame) {
      const m = t < first.end ? m1 : m2;
      att.step(poseOf(m, t), t);
      maxStep = Math.max(maxStep, turn(prev, att));
      prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    }
    const spin = Math.abs(poseOf(m1, 0).spin);
    expect(maxStep).toBeLessThanOrEqual(spin * frame * DT + 1e-6);
    expect(maxStep).toBeGreaterThan(0);
  });

  it('settles out of a tumble without a pop, however short the slide', () => {
    // The engine's slides can last a single tick: the settle keeps its own floor.
    const att = tumbled(3, 9, 16, 2, 20);
    const skid = {
      kind: 'skid' as const,
      start: 20,
      end: 21,
      x: 0,
      y: 0,
      z: 0,
      vx: 4,
      vz: 0,
      decel: 25,
      contact: 'stop' as const,
    };
    const frame = 1 / 3;
    let prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    let maxStep = 0;
    for (let t = 20; t <= 21 + TURRET_LIE_SECONDS / DT + 1; t += frame) {
      const m =
        t < 21
          ? monster('skid', skid, { id: 3 })
          : monster('down', stillSegment(21, TURRET_TIMING.downTicks, { x: 0.2, y: 0, z: 0 }), {
              id: 3,
            });
      att.step(poseOf(m, t), t);
      maxStep = Math.max(maxStep, turn(prev, att));
      prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    }
    // At most a quarter turn to a lying pose, spread over the settle floor: a
    // frame never turns more than an ease-out's opening step allows.
    const easeTicks = TURRET_LIE_SECONDS / DT;
    expect(maxStep).toBeLessThanOrEqual((Math.PI / 2) * (2 / easeTicks) * frame + 1e-6);
    expect(Math.abs(att.upY())).toBeLessThan(1e-6);
  });

  it('lies down on the nearest flank or back: a two-legged body can end face up or face down', () => {
    const at = { x: 0, y: 0, z: 0 };
    const seen = new Set<string>();
    for (let id = 1; id <= 16; id++) {
      const att = tumbled(id, 7, 12 + (id % 5), 3 - (id % 3), 8 + (id % 7));
      const before = { x: att.x, y: att.y, z: att.z, w: att.w };
      const down = monster('down', stillSegment(30, TURRET_TIMING.downTicks, at), { id });
      att.step(poseOf(down, 30), 30);
      att.step(poseOf(down, 30 + TURRET_LIE_SECONDS / DT), 30 + TURRET_LIE_SECONDS / DT);
      const ax = axesY(att);
      // Lying: the up axis is level, and a flank or the chest/back faces straight up or down.
      expect(Math.abs(ax.up)).toBeLessThan(1e-6);
      const flank = Math.abs(Math.abs(ax.side) - 1) < 1e-6;
      const flat = Math.abs(Math.abs(ax.fwd) - 1) < 1e-6;
      expect(flank || flat).toBe(true);
      seen.add(flank ? 'flank' : ax.fwd > 0 ? 'back' : 'front');
      // The nearest lying pose: never more than a quarter turn from where it landed.
      expect(turn(before, att)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('lies a four-legged body on a flank or on its back, legs up, never on its chest or nose', () => {
    const at = { x: 0, y: 0, z: 0 };
    const seen = new Set<string>();
    for (let id = 1; id <= 16; id++) {
      const att = tumbled(id, 7, 12 + (id % 5), 3 - (id % 3), 8 + (id % 7));
      const down = monster('down', stillSegment(30, TURRET_TIMING.downTicks, at), { id });
      const lying = (t: number) => poseOf(down, t, 1, false, 'forest_wolf');
      expect(lying(30).quadruped).toBe(true);
      att.step(lying(30), 30);
      att.step(lying(30 + TURRET_LIE_SECONDS / DT), 30 + TURRET_LIE_SECONDS / DT);
      const ax = axesY(att);
      const flank = Math.abs(Math.abs(ax.side) - 1) < 1e-6 && Math.abs(ax.up) < 1e-6;
      const back = Math.abs(ax.up + 1) < 1e-6;
      expect(flank || back).toBe(true);
      seen.add(flank ? 'flank' : 'back');
    }
    expect(seen.size).toBeGreaterThanOrEqual(1);
    expect(poseOf(monster('down', stillSegment(0, 1, at)), 0).quadruped).toBe(false);
  });

  it('an upright body knocked flat with no tumble falls on the flank its id picks', () => {
    const at = { x: 0, y: 0, z: 0 };
    const sideOf = (id: number): number => {
      const att = new TurretAttitude();
      const march = monster('march', marchSegment(0, 9, 0, 9, 0, 0, 3, 1), { id });
      att.step(poseOf(march, 0), 0);
      const down = monster('down', stillSegment(1, TURRET_TIMING.downTicks, at), { id });
      att.step(poseOf(down, 1), 1);
      att.step(poseOf(down, 1 + TURRET_LIE_SECONDS / DT), 1 + TURRET_LIE_SECONDS / DT);
      expect(Math.abs(att.upY())).toBeLessThan(1e-6);
      return axesY(att).side;
    };
    expect(Math.sign(sideOf(7))).toBe(-Math.sign(sideOf(8)));
  });

  it('keeps settling on the same curve when a slide becomes a rest (no restart, no stall)', () => {
    const att = tumbled(5, 8, 14, 1, 12);
    const skid = monster(
      'skid',
      {
        kind: 'skid',
        start: 12,
        end: 13,
        x: 0,
        y: 0,
        z: 0,
        vx: 3,
        vz: 0,
        decel: 25,
        contact: 'stop',
      },
      { id: 5 },
    );
    const down = monster(
      'down',
      stillSegment(13, TURRET_TIMING.downTicks, { x: 0.1, y: 0, z: 0 }),
      {
        id: 5,
      },
    );
    const steps: number[] = [];
    let prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    for (let t = 12; t <= 12 + TURRET_LIE_SECONDS / DT; t += 0.5) {
      att.step(poseOf(t < 13 ? skid : down, t), t);
      steps.push(turn(prev, att));
      prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    }
    // An ease-out: every step no larger than the one before (a restart would jump back up).
    for (let i = 2; i < steps.length; i++)
      expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9);
  });

  it('gets up over the rise without a snap, turning to face the turret, and walks on at that heading', () => {
    const at = { x: 6, y: 0, z: -3 };
    const center = { cx: 0, cz: 0 };
    const att = new TurretAttitude();
    const down = monster('down', stillSegment(0, TURRET_TIMING.downTicks, at), {
      id: 7,
      facing: 2,
    });
    const pose = (m: TurretMonsterInput, t: number) =>
      turretMonsterPoseInto(newTurretMonsterPose(), m, { mass: 1 }, t, flat, false, center);
    att.step(pose(down, 0), 0);
    att.step(pose(down, TURRET_TIMING.downTicks), TURRET_TIMING.downTicks);
    expect(att.upY()).toBeCloseTo(0, 6);
    const riseStart = TURRET_TIMING.downTicks;
    const rise = monster('rise', stillSegment(riseStart, TURRET_TIMING.riseTicks, at), {
      id: 7,
      facing: 2,
    });
    const ups: number[] = [];
    let prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    let maxStep = 0;
    for (let t = riseStart; t <= riseStart + TURRET_TIMING.riseTicks + 1e-9; t += 0.5) {
      att.step(pose(rise, t), t);
      ups.push(att.upY());
      maxStep = Math.max(maxStep, turn(prev, att));
      prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    }
    expect(ups[0]).toBeCloseTo(0, 6);
    expect(ups.at(-1)).toBeCloseTo(1, 9);
    for (let i = 1; i < ups.length; i++) expect(ups[i]).toBeGreaterThanOrEqual(ups[i - 1] - 1e-9);
    // A smoothstep over the whole rise: its steepest half-tick turns at most 1.5x the average.
    expect(maxStep).toBeLessThanOrEqual((Math.PI / TURRET_TIMING.riseTicks) * 0.5 * 1.5 + 1e-6);
    // Upright, facing the turret: the heading the march then walks at, so it does not restart.
    const heading = 2 * Math.atan2(att.y, att.w);
    expect(Math.cos(heading - Math.atan2(-at.x, -at.z))).toBeCloseTo(1, 9);
    const march = monster(
      'march',
      marchSegment(riseStart + TURRET_TIMING.riseTicks, at.x, 0, at.z, 0, 0, 3, 4),
      { id: 7 },
    );
    const before = { x: att.x, y: att.y, z: att.z, w: att.w };
    att.step(
      pose(march, riseStart + TURRET_TIMING.riseTicks + 1),
      riseStart + TURRET_TIMING.riseTicks + 1,
    );
    expect(turn(before, att)).toBeLessThan(1e-9);
  });

  it('a corpse rights itself on the heading it landed on, over at least the upright floor', () => {
    const att = tumbled(9, 6, 13, 0, 10);
    const twist = 2 * Math.atan2(att.y, att.w);
    const corpse = monster(
      'dead',
      stillSegment(10, TURRET_TIMING.corpseTicks, { x: 0, y: 0, z: 0 }),
      {
        id: 9,
        hp: 0,
        facing: 1.2,
      },
    );
    att.step(poseOf(corpse, 10), 10);
    const half = TURRET_UPRIGHT_SECONDS / DT / 2;
    att.step(poseOf(corpse, 10 + half), 10 + half);
    expect(att.upY()).toBeLessThan(1 - 1e-3);
    att.step(poseOf(corpse, 10 + 2 * half), 10 + 2 * half);
    expect(att.upY()).toBeCloseTo(1, 9);
    expect(Math.cos(2 * Math.atan2(att.y, att.w) - twist)).toBeCloseTo(1, 9);
  });

  it('snaps a body first seen at rest or marching to its pose, facing its heading', () => {
    const att = new TurretAttitude();
    const march = monster('march', marchSegment(0, 9, 0, 9, 0, 0, 3, 1), { id: 2 });
    att.step(poseOf(march, 0), 0);
    expect(att.upY()).toBeCloseTo(1, 12);
    expect(Math.cos(2 * Math.atan2(att.y, att.w) - Math.atan2(-9, -9))).toBeCloseTo(1, 12);
    const lying = new TurretAttitude();
    const down = monster('down', stillSegment(0, 16, { x: 0, y: 0, z: 0 }), { id: 2 });
    lying.step(poseOf(down, 3), 3);
    expect(lying.upY()).toBeCloseTo(0, 9);
  });

  it('reduced motion drops the spin and a hold keeps the attitude', () => {
    const att = new TurretAttitude();
    const m = monster('fly', launch(0, 8, 14, 0), { facing: 0 });
    att.step(poseOf(m, 0), 0, true);
    att.step(poseOf(m, 5), 5, true);
    expect(att.w).toBe(1);
    const held = monster('fly', stillSegment(9, 0, { x: 0, y: 2, z: 0 }));
    att.step(poseOf(m, 5), 5);
    att.step(poseOf(m, 8), 8);
    const before = att.w;
    att.step(poseOf(held, 20), 20);
    expect(att.w).toBe(before);
  });

  it('keeps the body resting on its lowest point at any attitude', () => {
    expect(turretPivotHeight(2, 1)).toBe(1);
    expect(turretPivotHeight(2, 0)).toBeCloseTo(TURRET_HALF_WIDTH * 2, 9);
    expect(turretPivotHeight(2, -1)).toBe(1);
    const mid = turretPivotHeight(2, Math.SQRT1_2);
    expect(mid).toBeGreaterThan(TURRET_HALF_WIDTH * 2);
    expect(mid).toBeLessThan(1);
  });
});

describe('Fire and Fly display clock', () => {
  function run(fps: number, frames: number): { ticks: number[]; clocks: number[] } {
    const clock = new TurretDisplayClock();
    const ticks: number[] = [];
    const clocks: number[] = [];
    for (let i = 0; i < frames; i++) {
      const time = i / fps;
      const simTick = 1000 + Math.floor(time / DT + 1e-9);
      ticks.push(clock.sample(simTick, time));
      clocks.push(simTick);
    }
    return { ticks, clocks };
  }

  it.each([144, 60, 30, 24])(
    'stays within [clock, clock + lead] and advances evenly at %i fps',
    (fps) => {
      const { ticks, clocks } = run(fps, fps * 6);
      const expected = 1 / (fps * DT);
      for (let i = 0; i < ticks.length; i++) {
        expect(ticks[i]).toBeGreaterThanOrEqual(clocks[i]);
        expect(ticks[i]).toBeLessThanOrEqual(clocks[i] + TURRET_TICK_LEAD_MAX);
      }
      // Settled, a frame's step never strays from the frame time by more than a
      // twentieth of a tick (the raw time-since-change estimate strays by a whole
      // frame at 30 fps).
      const settled = ticks.slice(fps * 2);
      for (let i = 1; i < settled.length; i++) {
        const step = settled[i] - settled[i - 1];
        expect(Math.abs(step - expected)).toBeLessThan(0.05);
      }
    },
  );

  it('follows a sim that runs slightly slow instead of riding the lead cap', () => {
    const clock = new TurretDisplayClock();
    const fps = 60;
    const slow = 1.003;
    for (let i = 0; i < fps * 60; i++) {
      const time = i / fps;
      const simTick = 1000 + Math.floor(time / (DT * slow) + 1e-9);
      const lead = clock.sample(simTick, time) - simTick;
      if (i >= fps * 30) expect(lead).toBeLessThan(1.1);
    }
  });

  it('snaps to a clock that jumped ahead, holds at the lead when the sim stalls, and resets on a new seat', () => {
    expect(TURRET_TICK_LEAD_MAX).toBe(1.25);
    const clock = new TurretDisplayClock();
    expect(clock.sample(10, 0)).toBe(10);
    expect(clock.sample(30, 0.05)).toBe(30);
    expect(clock.sample(30, 5)).toBe(30 + TURRET_TICK_LEAD_MAX);
    expect(clock.sample(4, 5.05)).toBe(4);
    clock.reset();
    expect(clock.sample(900, 6)).toBe(900);
  });
});
