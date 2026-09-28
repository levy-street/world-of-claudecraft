import { describe, expect, it } from 'vitest';
import { FALL_FLAIL_ENTER_SPEED } from '../src/render/characters/anim_state';
import {
  newTurretMonsterPose,
  TURRET_HALF_WIDTH,
  TURRET_LIE_SECONDS,
  TURRET_SINK_SECONDS,
  TURRET_TICK_LEAD_MAX,
  TURRET_TUMBLE_MAX,
  TurretAttitude,
  TurretDisplayClock,
  type TurretMonsterInput,
  type TurretMonsterPose,
  turretMonsterPoseInto,
  turretPivotHeight,
  turretSpinSign,
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

function poseOf(m: TurretMonsterInput, tick: number, mass = 1, frozen = false): TurretMonsterPose {
  return turretMonsterPoseInto(newTurretMonsterPose(), m, { mass }, tick, slope, frozen);
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

  it('fly: airborne, tumbling about the axis perpendicular to the horizontal velocity', () => {
    const seg = launch(50, 6, 12, -8);
    const pose = poseOf(monster('fly', seg), 50.5);
    expect(pose.airborne).toBe(true);
    expect(pose.attitude).toBe('tumble');
    expect(Math.hypot(pose.axisX, pose.axisZ)).toBeCloseTo(1, 9);
    expect(pose.axisX * seg.vx + pose.axisZ * seg.vz).toBeCloseTo(0, 9);
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
    expect(pop.axisX * Math.sin(0.7) + pop.axisZ * Math.cos(0.7)).toBeCloseTo(0, 9);
  });

  it('fly: a positive spin pitches the body forward along its flight, a negative one backward', () => {
    const tipOf = (id: number): number => {
      const m = monster('fly', launch(0, 8, 14, 0), { id });
      const att = new TurretAttitude();
      for (let t = 0; t <= 2; t++) att.step(poseOf(m, t), m.state, m.seg.start, t);
      return 2 * (att.x * att.y - att.w * att.z);
    };
    expect(tipOf(3)).toBeGreaterThan(0.05);
    expect(tipOf(4)).toBeLessThan(-0.05);
  });

  it('skid: a living body eases onto its side over the slide, a corpse rights itself', () => {
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
    expect(poseOf(monster('skid', seg, { hp: 0 }), 13).attitude).toBe('upright');
  });

  it('down, rise and dead: lie quickly, rise over the rise, sink in the last second', () => {
    const at = { x: 1, y: 0, z: 2 };
    const down = poseOf(monster('down', stillSegment(0, TURRET_TIMING.downTicks, at)), 2);
    expect(down.attitude).toBe('lie');
    expect(down.easeSeconds).toBe(TURRET_LIE_SECONDS);
    expect(TURRET_LIE_SECONDS).toBe(0.2);
    const rise = poseOf(monster('rise', stillSegment(0, TURRET_TIMING.riseTicks, at)), 3);
    expect(rise.attitude).toBe('upright');
    expect(rise.easeSeconds).toBeCloseTo(TURRET_TIMING.riseTicks * DT, 9);
    const corpse = stillSegment(0, TURRET_TIMING.corpseTicks, at);
    const dead = monster('dead', corpse, { hp: 0 });
    expect(poseOf(dead, 1).dead).toBe(true);
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

function stepThrough(
  att: TurretAttitude,
  m: TurretMonsterInput,
  from: number,
  to: number,
  frame: number,
): number[] {
  const upY: number[] = [];
  for (let t = from; t <= to + 1e-9; t += frame) {
    att.step(poseOf(m, t), m.state, m.seg.start, t);
    upY.push(att.upY());
  }
  return upY;
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
    let prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    let maxStep = 0;
    for (let t = 0; t < bounce.seg.end; t += frame) {
      const m = t < first.end ? m1 : m2;
      att.step(poseOf(m, t), m.state, m.seg.start, t);
      const dot = Math.abs(prev.x * att.x + prev.y * att.y + prev.z * att.z + prev.w * att.w);
      maxStep = Math.max(maxStep, 2 * Math.acos(Math.min(1, dot)));
      prev = { x: att.x, y: att.y, z: att.z, w: att.w };
    }
    const spin = Math.abs(poseOf(m1, 0).spin);
    expect(maxStep).toBeLessThanOrEqual(spin * frame * DT + 1e-6);
    expect(maxStep).toBeGreaterThan(0);
  });

  it('eases onto its side over the lie time, on the side its id picks, then back upright over the rise', () => {
    const at = { x: 0, y: 0, z: 0 };
    const att = new TurretAttitude();
    const down = monster('down', stillSegment(0, TURRET_TIMING.downTicks, at), { id: 7 });
    const half = TURRET_LIE_SECONDS / 2 / DT;
    att.step(poseOf(down, 0), 'down', 0, 0);
    expect(att.upY()).toBeCloseTo(1, 9);
    att.step(poseOf(down, half), 'down', 0, half);
    expect(att.upY()).toBeGreaterThan(0.2);
    expect(att.upY()).toBeLessThan(0.9);
    att.step(poseOf(down, 2 * half), 'down', 0, 2 * half);
    expect(att.upY()).toBeCloseTo(0, 6);
    // Rolled about the body's forward axis (facing 0.4): the up axis now lies sideways.
    const upX = 2 * (att.x * att.y - att.w * att.z);
    const upZ = 2 * (att.y * att.z + att.w * att.x);
    expect(upX * Math.sin(0.4) + upZ * Math.cos(0.4)).toBeCloseTo(0, 6);
    const other = new TurretAttitude();
    const downEven = monster('down', stillSegment(0, TURRET_TIMING.downTicks, at), { id: 8 });
    other.step(poseOf(downEven, 0), 'down', 0, 0);
    other.step(poseOf(downEven, 2 * half), 'down', 0, 2 * half);
    const otherUpX = 2 * (other.x * other.y - other.w * other.z);
    expect(Math.sign(otherUpX)).toBe(-Math.sign(upX));

    const riseStart = TURRET_TIMING.downTicks;
    const rise = monster('rise', stillSegment(riseStart, TURRET_TIMING.riseTicks, at), { id: 7 });
    const ups = stepThrough(att, rise, riseStart, riseStart + TURRET_TIMING.riseTicks, 1);
    expect(ups[0]).toBeCloseTo(0, 6);
    expect(ups[Math.floor(ups.length / 2)]).toBeGreaterThan(0.2);
    expect(ups[Math.floor(ups.length / 2)]).toBeLessThan(0.9);
    expect(ups.at(-1)).toBeCloseTo(1, 9);
    for (let i = 1; i < ups.length; i++) expect(ups[i]).toBeGreaterThanOrEqual(ups[i - 1] - 1e-9);
  });

  it('reduced motion drops the spin and a hold keeps the attitude', () => {
    const att = new TurretAttitude();
    const m = monster('fly', launch(0, 8, 14, 0));
    att.step(poseOf(m, 0), 'fly', 0, 0, true);
    att.step(poseOf(m, 5), 'fly', 0, 5, true);
    expect(att.w).toBe(1);
    const held = monster('fly', stillSegment(9, 0, { x: 0, y: 2, z: 0 }));
    att.step(poseOf(m, 5), 'fly', 0, 5);
    att.step(poseOf(m, 8), 'fly', 0, 8);
    const before = att.w;
    att.step(poseOf(held, 20), 'fly', 9, 20);
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
