// Deepball at the Deepglass: geometry, fluid ball physics, flooded flight and
// a live bot bout (docs/prd/deepglass.md).
//
// The bell is a sphere, so almost every invariant here is one the flat Vale
// Cup pitch never had to hold: a body must not escape through curved glass, a
// shot must reflect off a surface with no faces, and a goal is a disc in the
// air rather than a line on the ground.

import { beforeEach, describe, expect, it } from 'vitest';
import { setActiveWorldContent } from '../src/sim/data';
import {
  applyBodyContact,
  ballSpeed,
  ballSpin,
  DG_BALL_BURST_SPEED,
  DG_BALL_MAX_SPEED,
  DG_BALL_RADIUS,
  DG_BALL_SPIN_MAX,
  DG_KICKOFF_UP_SPEED,
  DG_BODY_RADIUS,
  DG_TRAP_DEAD,
  DG_TRAP_MAX,
  DG_VOLLEY_MIN_SPEED,
  type DgBallKinematics,
  type DgContactBody,
  escapedThroughHole,
  launchBall,
  reflectOffBell,
  setBallSpin,
  settleBallInPocket,
  stepBallFluid,
  sweptContactTime,
} from '../src/sim/deepglass/ball';
import {
  advanceBelief,
  assignBotRoles,
  botTraits,
  type DgBotBrain,
  type DgBotView,
  keeperFitness,
  makeBotBrain,
} from '../src/sim/deepglass/bots';
import { currentAt } from '../src/sim/deepglass/currents';
import {
  aimPitchOf,
  DG_AIM_MAX,
  DG_BOOST_SPEED,
  DG_CHARGE_MAX,
  DG_DASH_COST,
  DG_DASH_MAGNET_RANGE,
  DG_DASH_SPEED,
  DG_SWIM_SPEED,
  deepglassFlightPass,
  refillCharge,
} from '../src/sim/deepglass/flight';
import {
  clampToBell,
  DEEPGLASS_BASE_Y,
  DEEPGLASS_CENTER,
  DEEPGLASS_CRADLE_R,
  DEEPGLASS_PLAY_R,
  DEEPGLASS_RADIUS,
  DEEPGLASS_TOP_Y,
  DG_ARENA_SCALE,
  DG_RING_OFFSET,
  DG_BOOST_PADS,
  DG_HOLE_PASS_R,
  DG_HOLE_R,
  DG_POCKET_DEPTH,
  DG_POWERUP_SITES,
  DG_RING_EAST_X,
  DG_RING_MOUTH_R,
  DG_RING_RADIUS,
  DG_RING_WEST_X,
  DG_SPAWNS_A,
  DG_SPAWNS_B,
  glassHeightAt,
  insideBell,
  ringCentreFor,
  targetRingFor,
  type Vec3,
  DG_RESPAWN_B,
} from '../src/sim/deepglass/layout';
import {
  DG_COUNTDOWN,
  DG_RESPAWN_CHARGE,
  DG_RESPAWN_SECONDS,
  DG_MATCH_DURATION,
  deepballMove,
  deepglassMatch,
  endDeepglassMatch,
  startDeepglassMatch,
  updateDeepglass,
  deepglassLastBeam,
} from '../src/sim/deepglass/match';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type MoveInput } from '../src/sim/types';
import { ballMarkFromNdc } from '../src/ui/deepglass_hud';

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function ball(over: Partial<DgBallKinematics> = {}): DgBallKinematics {
  return { ...DEEPGLASS_CENTER, vx: 0, vy: 0, vz: 0, ...over };
}

function input(over: Partial<MoveInput> = {}): MoveInput {
  return {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    dive: false,
    surface: false,
    boost: false,
    ...over,
  };
}

describe('Deepglass geometry', () => {
  it('rests the bell on its cradle however big the sphere is', () => {
    // The base is the fixed thing: the cradle does not move when the arena is
    // scaled, so the CENTRE has to rise instead. Asserted as the relationship
    // rather than as a frozen 79, which is what DG_ARENA_SCALE exists to change.
    expect(DEEPGLASS_CENTER.y - DEEPGLASS_RADIUS).toBeCloseTo(3, 6); // base
    expect(DEEPGLASS_TOP_Y).toBeCloseTo(3 + DEEPGLASS_RADIUS * 2, 6); // crown
    expect(DEEPGLASS_BASE_Y).toBeGreaterThan(0); // never sunk into the slate
    // The cradle is the only flat-ground need, and the glass has to be well off
    // the ground by the time it reaches the cradle's rim.
    const atCradle = glassHeightAt(DEEPGLASS_CRADLE_R);
    expect(atCradle).not.toBeNull();
    expect(atCradle as number).toBeGreaterThan(DEEPGLASS_BASE_Y);
    expect(glassHeightAt(DEEPGLASS_RADIUS)).toBeNull();
  });

  it('cuts each goal hole through the glass, wider than the drawn ring', () => {
    // The ring planes sit exactly at the hole rims: the bell's cross-section
    // there IS the hole radius, by construction.
    expect(DG_RING_MOUTH_R).toBeCloseTo(DG_HOLE_R, 6);
    expect(DG_RING_OFFSET).toBeCloseTo(Math.sqrt(DEEPGLASS_RADIUS ** 2 - DG_HOLE_R ** 2), 6);
    // The pass radius is the hole minus the ball, so anything the scoring test
    // admits genuinely fits through the glass.
    expect(DG_HOLE_PASS_R).toBeCloseTo(DG_HOLE_R - DG_BALL_RADIUS, 1);
    expect(DG_HOLE_PASS_R + DG_BALL_RADIUS).toBeLessThanOrEqual(DG_HOLE_R + 1e-6);
    // The drawn target ring hangs inside the pass radius: graze the ring, score.
    expect(DG_RING_RADIUS).toBeLessThanOrEqual(DG_HOLE_PASS_R);
  });

  it('scales the arena WITHOUT scaling the target', () => {
    // The whole point of DG_ARENA_SCALE: more room to play, not a bigger goal.
    // If a future pass folds the scale into the ring radius, the sport gets
    // easier by accident and nothing else would catch it.
    expect(DG_RING_RADIUS).toBe(6); // widened from 5.4 with the 8.2 hole (2026-09-02)
    expect(DG_BALL_RADIUS).toBe(1.68);
    expect(DEEPGLASS_RADIUS).toBeCloseTo(38 * DG_ARENA_SCALE, 6);
    // The holes ride the glass itself, so their planes hug the bell whatever
    // the scale — always inside the sphere, always outside the play clamp.
    expect(DG_RING_OFFSET).toBeLessThan(DEEPGLASS_RADIUS);
    expect(DG_RING_OFFSET).toBeGreaterThan(DEEPGLASS_PLAY_R);
    // Every spawn, pad and powerup rode the scale rather than being left behind
    // at an old absolute coordinate.
    for (const p of [...DG_SPAWNS_A, ...DG_SPAWNS_B, ...DG_BOOST_PADS, ...DG_POWERUP_SITES]) {
      expect(insideBell(p.x, p.y, p.z)).toBe(true);
    }
  });

  it('mirrors team B spawns across the bell axis', () => {
    for (let i = 0; i < DG_SPAWNS_A.length; i++) {
      expect(DG_SPAWNS_B[i].x).toBeCloseTo(2 * DEEPGLASS_CENTER.x - DG_SPAWNS_A[i].x, 6);
      expect(DG_SPAWNS_B[i].y).toBe(DG_SPAWNS_A[i].y);
      expect(DG_SPAWNS_B[i].z).toBe(DG_SPAWNS_A[i].z);
    }
    for (const s of [...DG_SPAWNS_A, ...DG_SPAWNS_B]) {
      expect(insideBell(s.x, s.y, s.z)).toBe(true);
    }
  });

  it('places every boost pad inside the bell, symmetric across the halves', () => {
    for (const p of DG_BOOST_PADS) expect(insideBell(p.x, p.y, p.z)).toBe(true);
    // Every pad has a mirror partner, so neither half is favoured.
    for (const p of DG_BOOST_PADS) {
      const mirrored = DG_BOOST_PADS.some(
        (q) =>
          Math.abs(q.x - (2 * DEEPGLASS_CENTER.x - p.x)) < 1e-6 &&
          Math.abs(q.y - p.y) < 1e-6 &&
          Math.abs(q.z - p.z) < 1e-6,
      );
      expect(mirrored).toBe(true);
    }
  });

  it('scores only through the goal holes, and keeps the A/B contract', () => {
    const y = DEEPGLASS_CENTER.y;
    const z = DEEPGLASS_CENTER.z;
    // Past the glass limit inside the east hole, flying out: team A scores.
    expect(escapedThroughHole(ball({ x: DG_RING_EAST_X + 0.5, y, z, vx: 20 }))).toBe('A');
    // Out through the west hole: team B scores.
    expect(escapedThroughHole(ball({ x: DG_RING_WEST_X - 0.5, y, z, vx: -20 }))).toBe('B');
    // Same depth but wide of the hole's pass cylinder: no goal — that ball
    // meets glass and reflectOffBell banks it back into play.
    expect(
      escapedThroughHole(ball({ x: DG_RING_EAST_X + 0.5, y: y + DG_HOLE_PASS_R + 1, z, vx: 20 })),
    ).toBeNull();
    // Heading back INTO the bell is never a goal, wherever the ball sits.
    expect(escapedThroughHole(ball({ x: DG_RING_EAST_X + 0.5, y, z, vx: -20 }))).toBeNull();
    // Inside the limit sphere nothing scores.
    expect(escapedThroughHole(ball({ x: DEEPGLASS_CENTER.x + 10, y, z, vx: 20 }))).toBeNull();
  });

  it('settles a scored ball onto the pocket seat outside the glass', () => {
    // A rocket that just scored through the east hole, still at pace.
    const b = ball({ x: DG_RING_EAST_X + 0.5, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z });
    b.vx = 25;
    b.vy = 4;
    for (let t = 0; t < 200; t++) settleBallInPocket(b);
    const seatX = DEEPGLASS_CENTER.x + DEEPGLASS_RADIUS + DG_POCKET_DEPTH;
    expect(Math.abs(b.x - seatX)).toBeLessThan(2.5);
    expect(Math.abs(b.y - DEEPGLASS_CENTER.y)).toBeLessThan(2.5);
    expect(Math.abs(b.z - DEEPGLASS_CENTER.z)).toBeLessThan(2.5);
    // ...and it is genuinely OUTSIDE the bell, in the housing's net.
    expect(
      Math.hypot(b.x - DEEPGLASS_CENTER.x, b.y - DEEPGLASS_CENTER.y, b.z - DEEPGLASS_CENTER.z),
    ).toBeGreaterThan(DEEPGLASS_RADIUS);
  });
});

describe('Tidesow physics', () => {
  it('never escapes the glass, from any launch angle', () => {
    // The whole point of an analytic sphere: fire hard in many directions and
    // the ball must still be inside after a long flight.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const b = ball();
      launchBall(b, { x: Math.cos(a), y: Math.sin(a * 1.7), z: Math.sin(a) }, DG_BALL_MAX_SPEED);
      for (let t = 0; t < 600; t++) {
        const scored = stepBallFluid(b, ZERO);
        if (scored) break;
        const d = Math.hypot(
          b.x - DEEPGLASS_CENTER.x,
          b.y - DEEPGLASS_CENTER.y,
          b.z - DEEPGLASS_CENTER.z,
        );
        expect(d).toBeLessThanOrEqual(DEEPGLASS_RADIUS - DG_BALL_RADIUS + 1e-6);
      }
    }
  });

  it('banks off the glass losing energy, never gaining it', () => {
    // Past the limit sphere and still heading out: exactly what a step that
    // overshot the glass leaves behind.
    const b = ball({ x: DEEPGLASS_CENTER.x + DEEPGLASS_RADIUS - DG_BALL_RADIUS + 0.05, vx: 30 });
    const before = ballSpeed(b);
    expect(reflectOffBell(b)).toBe(true);
    expect(b.vx).toBeLessThan(0); // sent back inside
    expect(ballSpeed(b)).toBeLessThan(before);
  });

  it('cannot end up behind a goal: the mouth outside the ring is solid', () => {
    // Fire at the goal plane but WIDE of the ring. Before the goal wall existed
    // this parked the Tidesow against the glass behind the net, where a bout
    // effectively stalled.
    const b = ball({ y: DEEPGLASS_CENTER.y + DG_RING_RADIUS + 5 });
    launchBall(b, { x: -1, y: 0, z: 0 }, 45);
    for (let t = 0; t < 200; t++) {
      expect(stepBallFluid(b, ZERO)).toBeNull(); // never a goal: it is wide
      expect(b.x).toBeGreaterThan(DG_RING_WEST_X - 1e-6);
    }
  });

  it('still lets a shot ON the ring score, wall or no wall', () => {
    const b = ball({ x: DG_RING_EAST_X - 4 });
    launchBall(b, { x: 1, y: 0, z: 0 }, 45);
    let scored: 'A' | 'B' | null = null;
    for (let t = 0; t < 40 && !scored; t++) scored = stepBallFluid(b, ZERO);
    expect(scored).toBe('A');
  });

  it('drifts upward when nobody touches it', () => {
    const b = ball();
    for (let t = 0; t < 40; t++) stepBallFluid(b, ZERO);
    expect(b.y).toBeGreaterThan(DEEPGLASS_CENTER.y);
  });

  it('bleeds speed to drag instead of rolling forever', () => {
    const b = ball();
    launchBall(b, { x: 1, y: 0, z: 0 }, 40);
    for (let t = 0; t < 60; t++) stepBallFluid(b, ZERO);
    expect(ballSpeed(b)).toBeLessThan(40);
  });

  it('multiplies a strike on an already-fast ball (the volley)', () => {
    const slow = ball();
    launchBall(slow, { x: 1, y: 0, z: 0 }, 20);
    const slowSpeed = ballSpeed(slow);

    const fast = ball({ vx: DG_VOLLEY_MIN_SPEED + 5 });
    const wasVolley = launchBall(fast, { x: 1, y: 0, z: 0 }, 20);
    expect(wasVolley).toBe(true);
    expect(ballSpeed(fast)).toBeGreaterThan(slowSpeed);
  });

  it('caps speed so a maxed volley cannot break the physics', () => {
    const b = ball({ vx: DG_VOLLEY_MIN_SPEED + 10 });
    launchBall(b, { x: 1, y: 0, z: 0 }, DG_BALL_MAX_SPEED);
    expect(ballSpeed(b)).toBeLessThanOrEqual(DG_BALL_MAX_SPEED + 1e-6);
  });
});

describe('hit registration', () => {
  /** A body standing still at the bell's centre, chest height. */
  function stander(over: Partial<Vec3> = {}): DgContactBody {
    const at = { ...DEEPGLASS_CENTER, ...over };
    return { prev: { ...at }, cur: { ...at }, vel: { x: 0, y: 0, z: 0 } };
  }

  it('catches a ball that crosses a body BETWEEN two ticks', () => {
    // The bug this whole path exists for: at the old 55 yd/s cap a struck ball
    // travelled 2.75 yd per tick — wider than the contact sphere — so an
    // end-of-tick sample could have it in front of a fighter one tick and
    // behind them the next, with no sample ever seeing a touch.
    const body = stander();
    const reach = DG_BODY_RADIUS + DG_BALL_RADIUS;
    const from: Vec3 = { x: body.cur.x - 4, y: body.cur.y, z: body.cur.z };
    const to: Vec3 = { x: body.cur.x + 4, y: body.cur.y, z: body.cur.z };
    // Neither end is inside the body...
    expect(Math.hypot(from.x - body.cur.x, 0, 0)).toBeGreaterThan(reach);
    expect(Math.hypot(to.x - body.cur.x, 0, 0)).toBeGreaterThan(reach);
    // ...but the sweep still finds the crossing, part way through the tick.
    const t = sweptContactTime(from, to, body, reach);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it('misses cleanly when the ball genuinely passes wide', () => {
    const body = stander();
    const off = DG_BODY_RADIUS + DG_BALL_RADIUS + 2;
    const from: Vec3 = { x: body.cur.x - 4, y: body.cur.y, z: body.cur.z + off };
    const to: Vec3 = { x: body.cur.x + 4, y: body.cur.y, z: body.cur.z + off };
    expect(sweptContactTime(from, to, body, DG_BODY_RADIUS + DG_BALL_RADIUS)).toBe(-1);
    // A ball already moving AWAY is not a contact either.
    expect(sweptContactTime(to, from, body, 0.1)).toBe(-1);
  });

  it('always changes the ball on contact, and never leaves it inside a body', () => {
    // Every speed from a dribble to a rocket, met from every angle: the ball
    // must come out of the contact different, and outside the fighter.
    const surface = DG_BODY_RADIUS + DG_BALL_RADIUS;
    for (const speed of [2, 9, 18, 30, DG_BALL_MAX_SPEED]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const body = stander();
        const b = ball({
          x: body.cur.x - Math.cos(a) * 0.4,
          z: body.cur.z - Math.sin(a) * 0.4,
          vx: Math.cos(a) * speed,
          vz: Math.sin(a) * speed,
        });
        const before = { vx: b.vx, vy: b.vy, vz: b.vz };
        const touch = applyBodyContact(b, body);
        expect(['trap', 'carry', 'deflect']).toContain(touch);
        expect([b.vx, b.vy, b.vz]).not.toEqual([before.vx, before.vy, before.vz]);
        const d = Math.hypot(b.x - body.cur.x, b.y - body.cur.y, b.z - body.cur.z);
        expect(d).toBeGreaterThanOrEqual(surface - 1e-6);
      }
    }
  });

  it('deadens a rocket met square on, and bounces one that clips a shoulder', () => {
    const square = stander();
    const hot = ball({ x: square.cur.x - 2, vx: 30 });
    expect(applyBodyContact(hot, square)).toBe('trap');
    expect(ballSpeed(hot)).toBeLessThanOrEqual(DG_TRAP_DEAD + 1e-6);

    // Same pace, but arriving almost tangentially: that is a deflection, and it
    // keeps most of its pace.
    const glance = stander();
    const clipped = ball({
      x: glance.cur.x - 0.3,
      z: glance.cur.z + DG_BODY_RADIUS + DG_BALL_RADIUS,
      vx: 30,
      vz: 1,
    });
    expect(applyBodyContact(clipped, glance)).toBe('deflect');
    expect(ballSpeed(clipped)).toBeGreaterThan(10);
  });

  it('hands a fast loose ball to whoever flies onto it, and keeps it', () => {
    // Fly onto a loose ball at boost pace: the first contact is a trap that
    // brings the ball down to something carryable, and the NEXT one is a
    // carry — so the payoff for a good run is possession at pace, not a ball
    // that stalls behind you the moment you touch it.
    const runner: DgContactBody = {
      prev: { x: DEEPGLASS_CENTER.x - 24 * DT, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z },
      cur: { ...DEEPGLASS_CENTER },
      vel: { x: 24, y: 0, z: 0 },
    };
    const b = ball({ x: DEEPGLASS_CENTER.x + 1, vx: -20 }); // coming the other way
    expect(applyBodyContact(b, runner)).toBe('trap');
    expect(b.vx).toBeGreaterThan(0); // going the runner's way now
    expect(ballSpeed(b)).toBeLessThanOrEqual(DG_TRAP_MAX + 1e-6);
    expect(applyBodyContact(b, runner)).toBe('carry');
    expect(b.vx).toBeGreaterThan(runner.vel.x); // shepherded out in front
  });

  it('gives possession to a body moving with the ball', () => {
    const mover: DgContactBody = {
      prev: { x: DEEPGLASS_CENTER.x - 10 * DT, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z },
      cur: { ...DEEPGLASS_CENTER },
      vel: { x: 10, y: 0, z: 0 },
    };
    const b = ball({ x: DEEPGLASS_CENTER.x + 1, vx: 6 });
    expect(applyBodyContact(b, mover)).toBe('carry');
    // Shepherded along the carrier's own line, a little ahead of them.
    expect(b.vx).toBeGreaterThan(10);
    expect(ballSpeed(b)).toBeLessThan(DG_BALL_MAX_SPEED);
  });
});

describe('currents', () => {
  it('are deterministic in the clock and vanish on the axis', () => {
    const a: Vec3 = { x: 0, y: 0, z: 0 };
    const b: Vec3 = { x: 0, y: 0, z: 0 };
    currentAt(10, 45, 6, 12.5, a);
    currentAt(10, 45, 6, 12.5, b);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x, a.y, a.z)).toBeGreaterThan(0);

    const axis: Vec3 = { x: 1, y: 1, z: 1 };
    currentAt(DEEPGLASS_CENTER.x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z, 3, axis);
    expect(axis).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('push horizontally, never vertically', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    currentAt(12, 50, -8, 40, out);
    expect(out.y).toBe(0);
  });
});

describe('flooded flight', () => {
  function flier(over: Partial<Entity> = {}): Entity {
    return {
      pos: { ...DEEPGLASS_CENTER },
      prevPos: { ...DEEPGLASS_CENTER },
      facing: Math.PI / 2, // east
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: false,
      jumping: true,
      fallStartY: 0,
      swimStroke: 0,
      swimDiving: false,
      dgFlight: true,
      dgCharge: DG_CHARGE_MAX,
      ...over,
    } as Entity;
  }

  it('suppresses the fall/jump state the water is carrying', () => {
    const e = flier();
    deepglassFlightPass(e, input(), false, ZERO);
    expect(e.onGround).toBe(true);
    expect(e.jumping).toBe(false);
    expect(e.fallStartY).toBe(e.pos.y);
  });

  it('steers on explicit axes: WASD flat, Space up, Ctrl down', () => {
    // Deliberately NOT fly-where-you-look. Pitching the thrust vector with the
    // camera made altitude and heading the same control, which was the single
    // thing that made the bell hard to steer.
    const up = flier();
    for (let t = 0; t < 20; t++) {
      deepglassFlightPass(up, input({ forward: true, jump: true }), false, ZERO);
    }
    expect(up.pos.y).toBeGreaterThan(DEEPGLASS_CENTER.y);
    expect(up.pos.x).toBeGreaterThan(DEEPGLASS_CENTER.x); // still going east

    const down = flier();
    for (let t = 0; t < 20; t++) {
      deepglassFlightPass(down, input({ forward: true, dive: true }), false, ZERO);
    }
    expect(down.pos.y).toBeLessThan(DEEPGLASS_CENTER.y);

    // Forward alone stays level: heading no longer leaks into altitude.
    const flat = flier();
    for (let t = 0; t < 20; t++) {
      deepglassFlightPass(flat, input({ forward: true }), false, ZERO);
    }
    expect(flat.pos.y).toBeCloseTo(DEEPGLASS_CENTER.y, 6);
  });

  /** A flier parked in the west of the bell facing east, so a long boosted run
   *  has 60 yards of clear water ahead of it and never reaches the glass (a
   *  body pinned on the glass has its radial speed stripped, which would read
   *  as "the pack stopped working"). */
  function runwayFlier(): Entity {
    return flier({
      pos: { x: -30, y: DEEPGLASS_CENTER.y, z: 0 },
      prevPos: { x: -30, y: DEEPGLASS_CENTER.y, z: 0 },
    });
  }

  it('spools up: slow off the mark, quick once it is wound out', () => {
    // The feel the mode is built around. A standing start must NOT be instant —
    // the pack takes a beat to bite — and the same body a second later must be
    // travelling much faster off the same input.
    const e = flier();
    const sample = (ticks: number): number => {
      for (let t = 0; t < ticks; t++) deepglassFlightPass(e, input({ forward: true }), false, ZERO);
      return Math.hypot(e.vx, e.vy, e.vz);
    };
    const early = sample(2); // 0.1s in
    const mid = sample(5); // 0.35s in
    const wound = sample(28); // 1.5s in, spool full
    expect(early).toBeLessThan(DG_SWIM_SPEED * 0.5);
    expect(mid).toBeGreaterThan(early * 1.5);
    // The spool is quicker than it was (DG_SPOOL_UP 0.5s) so the ramp is
    // mostly done by the mid sample; wound just has to hold the ceiling.
    expect(wound).toBeGreaterThanOrEqual(mid);
    expect(wound).toBeGreaterThan(DG_SWIM_SPEED * 0.9);
    expect(e.dgSpool).toBeCloseTo(1, 5);
  });

  it('glides down gradually once the sticks are released', () => {
    // Off the throttle at boost pace, a body must COAST — still travelling well
    // a second later — rather than braking to a stop in place.
    const e = runwayFlier();
    for (let t = 0; t < 24; t++) {
      deepglassFlightPass(e, input({ forward: true, boost: true }), false, ZERO);
    }
    const top = Math.hypot(e.vx, e.vy, e.vz);
    expect(top).toBeGreaterThan(DG_SWIM_SPEED * 1.5);

    for (let t = 0; t < 20; t++) deepglassFlightPass(e, input(), false, ZERO); // 1s of coast
    const coasting = Math.hypot(e.vx, e.vy, e.vz);
    expect(coasting).toBeLessThan(top); // it IS slowing
    expect(coasting).toBeGreaterThan(top * 0.4); // but has not stopped dead

    for (let t = 0; t < 160; t++) deepglassFlightPass(e, input(), false, ZERO);
    expect(Math.hypot(e.vx, e.vy, e.vz)).toBeLessThan(1); // and it does settle
  });

  it('turns hard: thrust against your own motion bites harder than thrust with it', () => {
    // The Rocket League rule. Coming to a stop from cruise by reversing must be
    // markedly quicker than accelerating from a standstill to that same cruise,
    // or a flick of the stick feels like steering a barge.
    const runUp = runwayFlier();
    for (let t = 0; t < 40; t++) {
      deepglassFlightPass(runUp, input({ forward: true }), false, ZERO);
    }
    const cruise = Math.hypot(runUp.vx, runUp.vy, runUp.vz);
    expect(cruise).toBeGreaterThan(DG_SWIM_SPEED * 0.8);

    // Now demand the opposite direction and count the ticks to kill the pace.
    // Measured along the ORIGINAL heading, not as a speed magnitude: with the
    // air brake in, a reversing body can cross from +1.5 to -1.4 yd/s inside one
    // tick, so a "speed under half a yard" window is a window a hard enough
    // brake jumps clean over — the test would then run on forever while the body
    // accelerated away backwards.
    const heading = { x: runUp.vx / cruise, y: runUp.vy / cruise, z: runUp.vz / cruise };
    const along = (): number => runUp.vx * heading.x + runUp.vy * heading.y + runUp.vz * heading.z;
    let reverseTicks = 0;
    while (reverseTicks < 200) {
      deepglassFlightPass(runUp, input({ back: true }), false, ZERO);
      reverseTicks++;
      if (along() <= 0) break;
    }

    // ...against the ticks a standing body needs to REACH that speed.
    const fromRest = runwayFlier();
    let launchTicks = 0;
    while (launchTicks < 200) {
      deepglassFlightPass(fromRest, input({ forward: true }), false, ZERO);
      launchTicks++;
      if (Math.hypot(fromRest.vx, fromRest.vy, fromRest.vz) >= cruise - 0.5) break;
    }
    expect(reverseTicks).toBeLessThan(launchTicks);
  });

  it('kicks on the tick the burners light', () => {
    const kicked = runwayFlier();
    deepglassFlightPass(kicked, input({ forward: true, boost: true }), false, ZERO);
    const afterFirst = Math.hypot(kicked.vx, kicked.vy, kicked.vz);

    const coldStart = runwayFlier();
    deepglassFlightPass(coldStart, input({ forward: true }), false, ZERO);
    const unboosted = Math.hypot(coldStart.vx, coldStart.vy, coldStart.vz);
    // One tick of thrust alone is under a yard per second; the kick is metres.
    expect(afterFirst).toBeGreaterThan(unboosted + 3);
  });

  it('handicaps a body given a speed scale (the bots)', () => {
    const human = runwayFlier();
    const bot = runwayFlier();
    for (let t = 0; t < 30; t++) {
      deepglassFlightPass(human, input({ forward: true, boost: true }), false, ZERO, 1);
      deepglassFlightPass(bot, input({ forward: true, boost: true }), false, ZERO, 0.82);
    }
    expect(Math.hypot(bot.vx, bot.vy, bot.vz)).toBeLessThan(
      Math.hypot(human.vx, human.vy, human.vz),
    );
  });

  it('boosts faster than it swims, and spends the charge doing it', () => {
    // Sampled at 2s: from the centre, 8 yd/s reaches the glass at ~4.5s, and a
    // body pinned against it has its whole (radial) velocity stripped.
    const drift = flier();
    for (let t = 0; t < 40; t++) deepglassFlightPass(drift, input({ forward: true }), false, ZERO);
    const driftSpeed = Math.hypot(drift.vx, drift.vy, drift.vz);
    expect(driftSpeed).toBeGreaterThan(1);
    expect(driftSpeed).toBeLessThanOrEqual(DG_SWIM_SPEED + 0.5);

    const burn = flier();
    for (let t = 0; t < 30; t++) {
      deepglassFlightPass(burn, input({ forward: true, boost: true }), false, ZERO);
    }
    expect(Math.hypot(burn.vx, burn.vy, burn.vz)).toBeGreaterThan(DG_SWIM_SPEED * 1.5);
    expect(burn.dgCharge!).toBeLessThan(DG_CHARGE_MAX);
    expect(burn.dgBoosting).toBe(true);
  });

  it('gives roughly the documented 2.5s of burn, then cuts out', () => {
    const e = flier();
    let burning = 0;
    for (let t = 0; t < 200; t++) {
      deepglassFlightPass(e, input({ forward: true, boost: true }), false, ZERO);
      if (!e.dgBoosting) break;
      burning++;
    }
    expect(burning * DT).toBeGreaterThan(2.2);
    expect(burning * DT).toBeLessThan(2.8);
    expect(e.dgBoosting).toBe(false); // spent, and it stays out
    expect(e.dgCharge).toBe(0);
  });

  it('does NOT refill itself: the map is the fuel supply', () => {
    // The Rocket League rule. Ten seconds off the throttle used to hand the
    // whole tank back, which made boost a cooldown and the twelve lit vents in
    // the bell a decoration nobody detoured for.
    const e = flier({ dgCharge: 0 });
    for (let t = 0; t < 200; t++) deepglassFlightPass(e, input(), false, ZERO);
    const trickled = e.dgCharge ?? 0;
    expect(trickled).toBeGreaterThan(0); // you can always limp to a pad
    expect(trickled).toBeLessThan(DG_CHARGE_MAX * 0.4);

    // A vent is what actually fills you: a small one tops up, a big one fills.
    expect(refillCharge(e)).toBe(true);
    expect(e.dgCharge).toBeGreaterThan(trickled);
    expect(e.dgCharge).toBeLessThan(DG_CHARGE_MAX);
    e.dgCharge = 0;
    expect(refillCharge(e, DG_CHARGE_MAX)).toBe(true);
    expect(e.dgCharge).toBe(DG_CHARGE_MAX);
    // A full tank takes nothing from a vent, so it stays lit for a team-mate.
    expect(refillCharge(e, DG_CHARGE_MAX)).toBe(false);
  });

  it('cannot fly through the glass, however hard it burns', () => {
    const e = flier();
    for (let t = 0; t < 2000; t++) {
      deepglassFlightPass(e, input({ forward: true, boost: true }), false, ZERO);
      expect(insideBell(e.pos.x, e.pos.y, e.pos.z)).toBe(true);
    }
  });

  it('slows a body that is carrying the Tidesow', () => {
    const free = runwayFlier();
    const carrying = runwayFlier();
    for (let t = 0; t < 30; t++) {
      deepglassFlightPass(free, input({ forward: true, boost: true }), false, ZERO);
      deepglassFlightPass(carrying, input({ forward: true, boost: true }), true, ZERO);
    }
    expect(Math.hypot(carrying.vx, carrying.vy, carrying.vz)).toBeLessThan(
      Math.hypot(free.vx, free.vy, free.vz),
    );
  });

  it('clamps a body dropped outside the bell back onto the glass', () => {
    const p = { x: 500, y: 500, z: 500 };
    expect(clampToBell(p)).toBe(true);
    expect(
      Math.hypot(p.x - DEEPGLASS_CENTER.x, p.y - DEEPGLASS_CENTER.y, p.z - DEEPGLASS_CENTER.z),
    ).toBeCloseTo(DEEPGLASS_PLAY_R, 6);
  });
});

describe('a live bout', () => {
  let sim: Sim;

  beforeEach(() => {
    setActiveWorldContent(buildDeepglassWorld());
    sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: buildDeepglassWorld(),
    });
  });

  it('seats both sides inside the bell and drops the Tidesow at the centre', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 3);
    expect(m.teamA).toContain(sim.primaryId);
    expect(m.teamA.length).toBe(3);
    expect(m.teamB.length).toBe(3);
    for (const pid of [...m.teamA, ...m.teamB]) {
      const e = sim.entities.get(pid)!;
      expect(e.dgFlight).toBe(true);
      expect(insideBell(e.pos.x, e.pos.y, e.pos.z)).toBe(true);
    }
    expect(m.ball).not.toBeNull();
    expect(sim.entities.get(m.ball!.entityId)).toBeDefined();
    endDeepglassMatch(sim.ctx);
  });

  it('blows the whistle, then plays, and the bots actually move the ball', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 3);
    expect(m.phase).toBe('countdown');

    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('active');

    // Measured as the FURTHEST the ball ever got from the kickoff spot, not
    // where it finished: a bout that scores resets the ball to the centre, so
    // sampling only the final position is a coin flip on the goal clock.
    const start = { x: m.ball!.x, y: m.ball!.y, z: m.ball!.z };
    let furthest = 0;
    for (let t = 0; t < 600; t++) {
      updateDeepglass(sim.ctx);
      const b = m.ball!;
      furthest = Math.max(furthest, Math.hypot(b.x - start.x, b.y - start.y, b.z - start.z));
    }
    expect(furthest).toBeGreaterThan(5);
    endDeepglassMatch(sim.ctx);
  });

  it('keeps every body inside the glass; the ball leaves ONLY through a goal', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 4);
    for (let t = 0; t < 3000; t++) {
      updateDeepglass(sim.ctx);
      if (!deepglassMatch()) break;
      // The players can NEVER leave — not even through the goal holes, which
      // only the ball may use.
      for (const pid of [...m.teamA, ...m.teamB]) {
        const e = sim.entities.get(pid);
        if (!e?.dgFlight) continue;
        expect(insideBell(e.pos.x, e.pos.y, e.pos.z)).toBe(true);
      }
      const b = m.ball!;
      const d = Math.hypot(
        b.x - DEEPGLASS_CENTER.x,
        b.y - DEEPGLASS_CENTER.y,
        b.z - DEEPGLASS_CENTER.z,
      );
      if (m.phase === 'goal') {
        // A scored ball sits outside in a housing pocket: on the goal axis
        // (inside the hole's cylinder) and never further out than the seat.
        expect(Math.hypot(b.y - DEEPGLASS_CENTER.y, b.z - DEEPGLASS_CENTER.z)).toBeLessThan(
          DG_HOLE_R + 1,
        );
        expect(Math.abs(b.x - DEEPGLASS_CENTER.x)).toBeLessThan(
          DEEPGLASS_RADIUS + DG_POCKET_DEPTH + 4,
        );
      } else {
        expect(d).toBeLessThanOrEqual(DEEPGLASS_RADIUS + 1e-6);
      }
    }
    endDeepglassMatch(sim.ctx);
  });

  it('scores, celebrates and re-kicks off', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('active');

    // Fire the Tidesow straight through the east ring: team A scores.
    const b = m.ball!;
    b.x = DG_RING_EAST_X - 3;
    b.y = DEEPGLASS_CENTER.y;
    b.z = DEEPGLASS_CENTER.z;
    launchBall(b, { x: 1, y: 0, z: 0 }, 40);
    for (let t = 0; t < 10; t++) {
      updateDeepglass(sim.ctx);
      if (m.phase === 'goal') break;
    }
    expect(m.scoreA).toBe(1);
    expect(m.phase).toBe('goal');

    // The celebration runs out and the bell resets to a fresh kickoff.
    for (let t = 0; t < Math.round(5 / DT); t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('countdown');
    expect(m.ball!.x).toBeCloseTo(DEEPGLASS_CENTER.x, 6);
    endDeepglassMatch(sim.ctx);
  });

  it('throws the ball up to the crown at the whistle, and scatters it off the top', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    // Through the countdown: the ball holds its spot on the centre mark.
    for (let t = 0; t < Math.round(DG_COUNTDOWN / DT) - 1; t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('countdown');
    expect(m.ball!.y).toBeCloseTo(DEEPGLASS_CENTER.y, 6);

    // The whistle fires it upward...
    while (m.phase === 'countdown') updateDeepglass(sim.ctx);
    expect(m.ball!.vy).toBeGreaterThan(DG_KICKOFF_UP_SPEED * 0.5);

    // ...and it climbs into the top of the bell.
    let peak = m.ball!.y;
    for (let t = 0; t < 60; t++) {
      updateDeepglass(sim.ctx);
      peak = Math.max(peak, m.ball!.y);
    }
    // Well up into the crown half, and never through the glass.
    expect(peak).toBeGreaterThan(DEEPGLASS_CENTER.y + DEEPGLASS_RADIUS * 0.55);
    expect(peak).toBeLessThanOrEqual(DEEPGLASS_CENTER.y + DEEPGLASS_RADIUS);
    endDeepglassMatch(sim.ctx);
  });

  it('bounces off the crown on a DIFFERENT line depending on the scatter', () => {
    // Same ball, same arrival at the top of the bell, opposite scatter: the
    // two must come off the crown on visibly different lines. This is what
    // stops a jump ball being a memorised race to one spot.
    const drop = (scatter: number): { vx: number; vz: number } => {
      const b = ball({
        x: DEEPGLASS_CENTER.x,
        y: DEEPGLASS_CENTER.y + DEEPGLASS_RADIUS - DG_BALL_RADIUS + 0.05,
        z: DEEPGLASS_CENTER.z,
        vy: 24,
      });
      reflectOffBell(b, scatter);
      return { vx: b.vx, vz: b.vz };
    };
    const left = drop(-1);
    const right = drop(1);
    // Both are sent back down...
    expect(Math.hypot(left.vx, left.vz)).toBeGreaterThan(1);
    expect(Math.hypot(right.vx, right.vz)).toBeGreaterThan(1);
    // ...and not down the same line.
    expect(Math.hypot(left.vx - right.vx, left.vz - right.vz)).toBeGreaterThan(2);
    // A wall bounce well off the crown stays analytic whatever the scatter says.
    const wall = (scatter: number): number => {
      const b = ball({
        x: DEEPGLASS_CENTER.x + DEEPGLASS_RADIUS - DG_BALL_RADIUS + 0.05,
        y: DEEPGLASS_CENTER.y,
        z: DEEPGLASS_CENTER.z,
        vx: 24,
      });
      reflectOffBell(b, scatter);
      return b.vy;
    };
    expect(wall(1)).toBeCloseTo(wall(-1), 9);
  });

  it('runs identically twice from the same seed (no rng on the tick path)', () => {
    const run = (): number[] => {
      setActiveWorldContent(buildDeepglassWorld());
      const s = new Sim({
        seed: 7,
        playerClass: 'warrior',
        devCommands: true,
        world: buildDeepglassWorld(),
      });
      const m = startDeepglassMatch(s.ctx, s.primaryId, 3);
      for (let t = 0; t < 900; t++) updateDeepglass(s.ctx);
      const out = [m.ball!.x, m.ball!.y, m.ball!.z, m.scoreA, m.scoreB];
      endDeepglassMatch(s.ctx);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('paces like a sport, and no two bouts are the same', () => {
    // Guards the tuning pass. Before the keeper, the range-scaled bot aim and
    // the radial ball return, a 4v4 hit the five-goal cap in about ninety
    // seconds and EVERY bout was byte-identical, because bot aim is a pure
    // function of (tick, pid). The per-bout salt is what breaks the tie.
    const bout = (preTicks: number) => {
      setActiveWorldContent(buildDeepglassWorld());
      const s = new Sim({
        seed: 11,
        playerClass: 'warrior',
        devCommands: true,
        world: buildDeepglassWorld(),
      });
      for (let i = 0; i < preTicks; i++) s.tick();
      const m = startDeepglassMatch(s.ctx, null, 3);
      let ticks = 0;
      const cap = Math.round(300 / DT);
      while (ticks < cap && deepglassMatch()) {
        updateDeepglass(s.ctx);
        ticks++;
      }
      const out = {
        secs: ticks * DT,
        goals: m.scoreA + m.scoreB,
        score: `${m.scoreA}-${m.scoreB}`,
      };
      endDeepglassMatch(s.ctx);
      return out;
    };

    const runs = [bout(3), bout(37), bout(71)];
    for (const r of runs) {
      // A bout that empties in under a minute is the old broken pacing.
      expect(r.secs).toBeGreaterThan(60);
      const perMin = (r.goals / r.secs) * 60;
      expect(perMin).toBeLessThan(4);
    }
    // Different kickoff ticks must produce different matches.
    expect(new Set(runs.map((r) => r.score)).size).toBeGreaterThan(1);
  });

  it('hands out powerups on contact, one slot, and respawns the site', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    const me = sim.entities.get(sim.primaryId)!;
    expect(me.dgPowerup).toBeUndefined();

    // Fly onto the Lance at the bell's floor.
    const lance = DG_POWERUP_SITES.find((s) => s.kind === 'zap')!;
    me.pos.x = lance.x;
    me.pos.y = lance.y;
    me.pos.z = lance.z;
    updateDeepglass(sim.ctx);
    expect(me.dgPowerup).toBe('zap');
    // Taken: the site goes dark and nobody else can pick it up behind you.
    expect(m.powerupCooldown[DG_POWERUP_SITES.indexOf(lance)]).toBeGreaterThan(0);
    me.dgPowerup = undefined;
    updateDeepglass(sim.ctx);
    expect(me.dgPowerup).toBeUndefined();
    endDeepglassMatch(sim.ctx);
  });

  it('zaps whoever the Lance is aimed at, and only an opponent: demolished, then respawned by their goal', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    const me = sim.entities.get(sim.primaryId)!;
    const foe = sim.entities.get(m.teamB[0])!;
    const mate = sim.entities.get(m.teamA[1])!;

    // Line them both up dead ahead: the team-mate must NOT be a valid target.
    me.pos.x = 0;
    me.pos.y = DEEPGLASS_CENTER.y;
    me.pos.z = 0;
    me.facing = Math.PI / 2; // east
    mate.pos.x = 8;
    mate.pos.y = DEEPGLASS_CENTER.y;
    mate.pos.z = 0;
    foe.pos.x = 14;
    foe.pos.y = DEEPGLASS_CENTER.y;
    foe.pos.z = 0;
    foe.vx = 20;

    me.dgPowerup = 'zap';
    expect(deepballMove(sim.ctx, me, 'power', null)).toBe('zap');
    expect(foe.dgDeadTicks).toBe(Math.round(DG_RESPAWN_SECONDS / DT));
    expect(foe.dgZappedBy).toBe(me.id);
    expect(foe.vx).toBe(0); // blown up on the spot, momentum and all
    expect(mate.dgDeadTicks).toBeUndefined();
    // Spent: the slot is empty and a second press does nothing.
    expect(me.dgPowerup).toBeUndefined();
    expect(deepballMove(sim.ctx, me, 'power', null)).toBe('empty');
    // A demolished body has no moves and is nobody's target.
    expect(deepballMove(sim.ctx, foe, 'shot', null, 1)).toBe(null);
    // A second shot cannot pick the demolished body: it snaps to the OTHER
    // opponent instead (the closest-enemy fallback), never to a corpse.
    me.dgPowerup = 'zap';
    expect(deepballMove(sim.ctx, me, 'power', null)).toBe('zap');
    expect(deepglassLastBeam()?.victimId).not.toBe(foe.id);
    expect(deepglassLastBeam()?.victimId).toBe(m.teamB[1]);
    expect(foe.dgDeadTicks).toBe(Math.round(DG_RESPAWN_SECONDS / DT));

    // The timer counts down through the match tick; the body holds station...
    const deadAt = { ...foe.pos };
    for (let t = 0; t < Math.round(DG_RESPAWN_SECONDS / DT) - 1; t++) updateDeepglass(sim.ctx);
    expect(foe.dgDeadTicks).toBe(1);
    expect(foe.pos.x).toBe(deadAt.x);
    // ...and on zero it is seated back in front of its own goal, facing play,
    // with a third of a tank.
    updateDeepglass(sim.ctx);
    expect(foe.dgDeadTicks).toBeUndefined();
    expect(foe.pos.x).toBeCloseTo(DG_RESPAWN_B.x, 6);
    expect(foe.pos.z).toBeCloseTo(DG_RESPAWN_B.z, 6);
    expect(foe.facing).toBeCloseTo(DG_RESPAWN_B.facing, 6);
    expect(foe.dgCharge).toBe(DG_RESPAWN_CHARGE);
    expect(foe.dgFlight).toBe(true);
    endDeepglassMatch(sim.ctx);
  });

  it('turns the overburn orb into ten seconds of free burners', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    const me = sim.entities.get(sim.primaryId)!;
    me.dgPowerup = 'overburn';
    me.dgCharge = 0;
    expect(deepballMove(sim.ctx, me, 'power', null)).toBe('ok');
    expect(me.dgCharge).toBe(DG_CHARGE_MAX);
    expect((me.dgOverburnTicks ?? 0) * DT).toBeCloseTo(10, 1);
    void m;
    endDeepglassMatch(sim.ctx);
  });

  it('sets the player back down on solid ground at the final whistle', () => {
    // The bug: teardown cleared the flight state and left the body hanging at
    // y=41 with its fall measured from up there, so the bout ended by dropping
    // the player forty yards onto the slate and killing them.
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    const human = sim.entities.get(sim.primaryId)!;
    for (let t = 0; t < 120; t++) updateDeepglass(sim.ctx);
    expect(human.pos.y).toBeGreaterThan(20); // up in the bell

    endDeepglassMatch(sim.ctx);
    expect(human.dgFlight).toBeUndefined();
    expect(human.pos.y).toBeLessThan(DEEPGLASS_CENTER.y - DEEPGLASS_RADIUS + 1); // below the glass
    expect(human.onGround).toBe(true);
    expect(human.vy).toBe(0);
    // The whole point: no stored fall to cash in on the next ground tick.
    expect(human.fallStartY).toBe(human.pos.y);
    void m;
  });

  it('tears down cleanly: no flight state, no ball entity left behind', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 3);
    const ballId = m.ball!.entityId;
    const pids = [...m.teamA, ...m.teamB];
    endDeepglassMatch(sim.ctx);
    expect(deepglassMatch()).toBeNull();
    expect(sim.entities.get(ballId)).toBeUndefined();
    const human = sim.entities.get(pids[0])!;
    expect(human.dgFlight).toBeUndefined();
    expect(human.dgCharge).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The control overhaul: a continuous aim, a throttle that works on its own, an
// air brake, and the click dash.
// ---------------------------------------------------------------------------
describe('flying by the camera', () => {
  function flier(over: Partial<Entity> = {}): Entity {
    return {
      pos: { ...DEEPGLASS_CENTER },
      prevPos: { ...DEEPGLASS_CENTER },
      facing: Math.PI / 2, // east
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: false,
      jumping: true,
      fallStartY: 0,
      swimStroke: 0,
      swimDiving: false,
      dgFlight: true,
      dgCharge: DG_CHARGE_MAX,
      ...over,
    } as Entity;
  }

  it('clamps the aim pitch, and reads an absent one as level', () => {
    expect(aimPitchOf(input())).toBe(0);
    expect(aimPitchOf(input({ aimPitch: 0.5 }))).toBeCloseTo(0.5, 6);
    expect(aimPitchOf(input({ aimPitch: 9 }))).toBeCloseTo(DG_AIM_MAX, 6);
    expect(aimPitchOf(input({ aimPitch: -9 }))).toBeCloseTo(-DG_AIM_MAX, 6);
    expect(aimPitchOf(input({ aimPitch: Number.NaN }))).toBe(0);
  });

  it('pitches the thrust with the camera: W flies where you look', () => {
    // The control the bell was missing. Same key, same facing, three aims.
    const up = flier();
    const level = flier();
    const down = flier();
    for (let t = 0; t < 20; t++) {
      deepglassFlightPass(up, input({ forward: true, aimPitch: 0.9 }), false, ZERO);
      deepglassFlightPass(level, input({ forward: true }), false, ZERO);
      deepglassFlightPass(down, input({ forward: true, aimPitch: -0.9 }), false, ZERO);
    }
    expect(up.pos.y).toBeGreaterThan(DEEPGLASS_CENTER.y + 2);
    expect(down.pos.y).toBeLessThan(DEEPGLASS_CENTER.y - 2);
    // Level is the OLD behaviour, unchanged: the bands never pitched anything.
    expect(level.pos.y).toBeCloseTo(DEEPGLASS_CENTER.y, 1);
    // All three still went east.
    for (const e of [up, level, down]) expect(e.pos.x).toBeGreaterThan(DEEPGLASS_CENTER.x);
  });

  it('keeps the trim keys absolute, so you can hold height while aiming down', () => {
    const e = flier();
    for (let t = 0; t < 24; t++) {
      // Nose buried, climb key held: the trim wins, because it is not part of
      // the look frame at all.
      deepglassFlightPass(e, input({ jump: true, aimPitch: -1.2 }), false, ZERO);
    }
    expect(e.pos.y).toBeGreaterThan(DEEPGLASS_CENTER.y);
    // ...and the aim is still down there for a shot to leave along.
    expect(e.dgAimPitch).toBeLessThan(-1);
  });

  it('flies on the throttle alone, along the look', () => {
    const e = flier();
    for (let t = 0; t < 10; t++) {
      deepglassFlightPass(e, input({ boost: true, aimPitch: 0.6 }), false, ZERO);
    }
    expect(e.dgBoosting).toBe(true);
    expect(e.pos.x).toBeGreaterThan(DEEPGLASS_CENTER.x + 1);
    expect(e.pos.y).toBeGreaterThan(DEEPGLASS_CENTER.y + 1);
  });

  it('brakes hard on the back key, and coasts when nothing is held', () => {
    // Run up from the WEST side of the bell, not the centre: 30 ticks of boost
    // crosses half the sphere and the wall bounce would be what the test
    // measured. Fourteen keeps both bodies in open water.
    const brake = flier({ pos: { ...DEEPGLASS_CENTER, x: DEEPGLASS_CENTER.x - 20 } });
    const coast = flier({ pos: { ...DEEPGLASS_CENTER, x: DEEPGLASS_CENTER.x - 20 } });
    for (let t = 0; t < 14; t++) {
      deepglassFlightPass(brake, input({ forward: true, boost: true }), false, ZERO);
      deepglassFlightPass(coast, input({ forward: true, boost: true }), false, ZERO);
    }
    const entry = Math.hypot(coast.vx, coast.vy, coast.vz);
    expect(entry).toBeGreaterThan(DG_SWIM_SPEED);
    // Measured along the entry heading, not as a magnitude: a braking body
    // reverses and accelerates away backwards, so |v| stops being the question
    // once the brake has done its job.
    const hx = coast.vx / entry;
    const hy = coast.vy / entry;
    const hz = coast.vz / entry;
    const along = (e: Entity): number => e.vx * hx + e.vy * hy + e.vz * hz;
    deepglassFlightPass(brake, input({ back: true }), false, ZERO);
    deepglassFlightPass(coast, input(), false, ZERO);
    // The flag is live on the first tick of the brake, and gone once the body has
    // actually stopped (there is nothing left to brake).
    expect(brake.dgBraking).toBe(true);
    expect(coast.dgBraking).toBe(false);
    for (let t = 0; t < 7; t++) {
      deepglassFlightPass(brake, input({ back: true }), false, ZERO);
      deepglassFlightPass(coast, input(), false, ZERO);
    }
    // The brake has to be plainly better than letting go, or nobody will use it:
    // stopped (or already going the other way) against still coasting along.
    expect(along(brake)).toBeLessThanOrEqual(0);
    expect(along(coast)).toBeGreaterThan(DG_SWIM_SPEED);
  });

  describe('the dash', () => {
    /** A click with a key held: the player's gesture, one tick. */
    function clickDash(e: Entity, key?: 'strafeLeft' | 'strafeRight' | 'forward' | 'back'): void {
      deepglassFlightPass(
        e,
        input(key ? { [key]: true, dash: true } : { dash: true }),
        false,
        ZERO,
      );
    }

    it('throws the body sideways on a click while strafing, for FREE', () => {
      const e = flier();
      clickDash(e, 'strafeRight');
      // Facing east, so screen-right is (-cos f, sin f) = NORTH (+z) by the
      // sim's own convention (the same one the strafe axis uses).
      expect(e.vz).toBeGreaterThan(DG_DASH_SPEED * 0.5);
      // A dash costs no charge at all: the cooldown is the whole price.
      expect(e.dgCharge).toBe(DG_CHARGE_MAX);
      expect(e.dgDashTicks ?? 0).toBeGreaterThan(0);
      expect(e.dgDashKind).toBe(8); // right, for the render's roll
    });

    it('fires on a left click (MoveInput.dash): keys steer it, else the look', () => {
      // Bare click, no keys: the dash leaves down the look. Facing east.
      const e = flier();
      clickDash(e);
      expect(e.vx).toBeGreaterThan(DG_DASH_SPEED * 0.5);
      expect(e.dgCharge).toBe(DG_CHARGE_MAX); // free, like every dash
      expect(e.dgDashKind).toBe(1);
      // Click while strafing left: the dash goes LEFT (south for an
      // east-facing body), and the kind records the axis for the flip.
      const strafing = flier();
      clickDash(strafing, 'strafeLeft');
      expect(strafing.vz).toBeLessThan(-DG_DASH_SPEED * 0.4);
      expect(strafing.dgDashKind).toBe(4);
      // Click while backing up: a back flip, against the look.
      const backing = flier();
      clickDash(backing, 'back');
      expect(backing.vx).toBeLessThan(-DG_DASH_SPEED * 0.5);
      expect(backing.dgDashKind).toBe(2);
    });

    it('no longer answers a double-tap: keys alone never dash', () => {
      // The Rocket League rule: the flip is the click, the keys only aim it.
      // A hand rolling across WASD used to fire dashes nobody asked for.
      const e = flier();
      deepglassFlightPass(e, input({ strafeRight: true }), false, ZERO);
      deepglassFlightPass(e, input(), false, ZERO);
      deepglassFlightPass(e, input({ strafeRight: true }), false, ZERO);
      expect(e.dgDashTicks ?? 0).toBe(0);
      expect(Math.abs(e.vz)).toBeLessThan(DG_DASH_SPEED * 0.4);
      const held = flier();
      for (let t = 0; t < 12; t++) {
        deepglassFlightPass(held, input({ strafeRight: true }), false, ZERO);
      }
      expect(held.dgDashTicks ?? 0).toBe(0);
    });

    it('holds a cooldown, and no longer cares about the tank', () => {
      const e = flier();
      clickDash(e, 'strafeRight');
      const afterFirst = Math.hypot(e.vx, e.vy, e.vz);
      clickDash(e, 'strafeRight'); // inside the cooldown: no second impulse
      expect(Math.hypot(e.vx, e.vy, e.vz)).toBeLessThan(afterFirst + DG_DASH_SPEED * 0.25);

      // Dashes are free now: a body with an EMPTY tank still dashes. This is
      // the whole point of decoupling mobility from the boost economy.
      const spent = flier({ dgCharge: 0 });
      clickDash(spent, 'strafeLeft');
      expect(spent.dgDashTicks ?? 0).toBeGreaterThan(0);
      expect(Math.hypot(spent.vx, spent.vy, spent.vz)).toBeGreaterThan(DG_DASH_SPEED * 0.5);
    });

    describe('the ball magnet', () => {
      /** Dash forward with the ball parked at `ball`, and report the impulse. */
      function dashAt(ballAt: Vec3 | null): { vx: number; vy: number; vz: number } {
        const e = flier();
        // Facing east, so a click dash with no keys leaves down +x.
        deepglassFlightPass(e, input({ dash: true }), false, ZERO, 1, ballAt);
        return { vx: e.vx, vy: e.vy, vz: e.vz };
      }

      it('bends a close dash onto the ball', () => {
        const plain = dashAt(null);
        // Ball a few yards ahead and well off to one side: the dash should
        // arrive with real sideways pace it would not otherwise have.
        const bent = dashAt({
          x: DEEPGLASS_CENTER.x + 4,
          y: DEEPGLASS_CENTER.y + 1,
          z: DEEPGLASS_CENTER.z + 4,
        });
        expect(Math.abs(plain.vz)).toBeLessThan(0.5);
        expect(bent.vz).toBeGreaterThan(DG_DASH_SPEED * 0.25);
        // ...without turning into a teleport: the dash keeps its own speed.
        expect(Math.hypot(bent.vx, bent.vy, bent.vz)).toBeCloseTo(
          Math.hypot(plain.vx, plain.vy, plain.vz),
          4,
        );
      });

      it('ignores a ball beyond the magnet range', () => {
        const far = dashAt({
          x: DEEPGLASS_CENTER.x + DG_DASH_MAGNET_RANGE + 6,
          y: DEEPGLASS_CENTER.y,
          z: DEEPGLASS_CENTER.z + DG_DASH_MAGNET_RANGE + 6,
        });
        expect(Math.abs(far.vz)).toBeLessThan(0.5);
      });

      it('never rescues a dash thrown the wrong way', () => {
        // Ball BEHIND the flier: an assist that pulled here would be a homing
        // move, and dashing away from the ball has to stay possible.
        const behind = dashAt({
          x: DEEPGLASS_CENTER.x - 5,
          y: DEEPGLASS_CENTER.y,
          z: DEEPGLASS_CENTER.z,
        });
        expect(behind.vx).toBeGreaterThan(DG_DASH_SPEED * 0.5); // still went east
      });
    });

    it('dashes along the LOOK, so a click with W and the nose up lifts', () => {
      const e = flier();
      deepglassFlightPass(e, input({ forward: true, dash: true, aimPitch: 1.2 }), false, ZERO);
      expect(e.vy).toBeGreaterThan(DG_DASH_SPEED * 0.5);
    });

    it('survives the speed ceiling instead of being clipped flat on arrival', () => {
      // The dash is an impulse above the cruise cap; the coast term is what lets
      // it live. Without that it was deleted on the very tick it fired.
      const e = flier();
      clickDash(e, 'strafeRight');
      const burst = Math.hypot(e.vx, e.vy, e.vz);
      expect(burst).toBeGreaterThan(DG_SWIM_SPEED * 1.2);
      for (let t = 0; t < 8; t++) deepglassFlightPass(e, input(), false, ZERO);
      const after = Math.hypot(e.vx, e.vy, e.vz);
      expect(after).toBeLessThan(burst); // ...and then it bleeds away
      expect(after).toBeGreaterThan(1);
    });

    it('fires from a key that was ALREADY held: the click is the edge, not the key', () => {
      // The bots hold a strafe to slide onto the ball and then click; a human
      // does the same. No release is needed any more.
      const e = flier();
      for (let t = 0; t < 4; t++) {
        deepglassFlightPass(e, input({ strafeRight: true }), false, ZERO);
      }
      deepglassFlightPass(e, input({ strafeRight: true, dash: true }), false, ZERO);
      expect(e.dgDashTicks ?? 0).toBeGreaterThan(0);
    });

    it('is taken away with the controls when a body is frozen', () => {
      const frozen = flier({ dgFrozenTicks: 20 });
      clickDash(frozen, 'strafeRight');
      expect(frozen.dgDashTicks ?? 0).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Spin
// ---------------------------------------------------------------------------
describe('the Tidesow curls', () => {
  it('takes spin from the striker slicing ACROSS the line, not along it', () => {
    const along = ball();
    launchBall(along, { x: 0, y: 0, z: 1 }, 25, { x: 0, y: 0, z: 12 });
    expect(ballSpin(along)).toBeCloseTo(0, 6);

    const sliced = ball();
    launchBall(sliced, { x: 0, y: 0, z: 1 }, 25, { x: 12, y: 0, z: 0 });
    expect(ballSpin(sliced)).toBeGreaterThan(5);
  });

  it('bends the flight, and bends it the way the striker was moving', () => {
    // Struck north, sliced eastward: it must finish EAST of the straight line.
    const curler = ball();
    launchBall(curler, { x: 0, y: 0, z: 1 }, 28, { x: 14, y: 0, z: 0 });
    const straight = ball();
    launchBall(straight, { x: 0, y: 0, z: 1 }, 28);
    for (let t = 0; t < 30; t++) {
      stepBallFluid(curler, ZERO);
      stepBallFluid(straight, ZERO);
    }
    expect(curler.x).toBeGreaterThan(straight.x + 0.5);
  });

  it('bleeds the spin off, so a curler is not a boomerang', () => {
    const b = ball();
    launchBall(b, { x: 0, y: 0, z: 1 }, 28, { x: 14, y: 0, z: 0 });
    const opening = ballSpin(b);
    for (let t = 0; t < 60; t++) stepBallFluid(b, ZERO);
    expect(ballSpin(b)).toBeLessThan(opening * 0.3);
  });

  it('caps spin however hard it is sliced', () => {
    const b = ball();
    launchBall(b, { x: 0, y: 0, z: 1 }, 28, { x: 400, y: 0, z: 0 });
    expect(ballSpin(b)).toBeLessThanOrEqual(DG_BALL_SPIN_MAX + 1e-6);
  });

  it('is cleared by an unswiped strike, so a set piece flies true', () => {
    const b = ball();
    setBallSpin(b, 9, 9, 9);
    launchBall(b, { x: 1, y: 0, z: 0 }, 20);
    expect(ballSpin(b)).toBe(0);
  });

  it('takes spin off a body it rubs past', () => {
    const b = ball({ x: DEEPGLASS_CENTER.x + 2.7, vx: 0, vz: 0 });
    const brusher: DgContactBody = {
      prev: { ...DEEPGLASS_CENTER },
      cur: { ...DEEPGLASS_CENTER },
      vel: { x: 0, y: 0, z: 14 }, // sliding past, square to the contact normal
    };
    applyBodyContact(b, brusher);
    expect(ballSpin(b)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Contact continuity — the cliff that made a touch's outcome double for no
// visible reason.
// ---------------------------------------------------------------------------
describe('contact is continuous', () => {
  it('hands the ball on at a factor that RAMPS across the control threshold', () => {
    // Sweep the closing speed through DG_CONTROL_REL_SPEED and watch the outgoing
    // speed. Before the ramp this jumped from 1.15x the carrier's pace to 0.6x
    // between two neighbouring samples.
    const speeds: number[] = [];
    for (let rel = 6; rel <= 26; rel += 0.5) {
      const carrier: DgContactBody = {
        prev: { x: DEEPGLASS_CENTER.x - 12 * DT, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z },
        cur: { ...DEEPGLASS_CENTER },
        vel: { x: 12, y: 0, z: 0 },
      };
      // Ball ahead of the carrier, coming back at it: relative speed is rel.
      const b = ball({ x: DEEPGLASS_CENTER.x + 1, vx: 12 - rel });
      applyBodyContact(b, carrier);
      speeds.push(ballSpeed(b));
    }
    for (let i = 1; i < speeds.length; i++) {
      const step = Math.abs(speeds[i] - speeds[i - 1]);
      expect(step).toBeLessThan(2.2);
    }
  });

  it('a DASH SMASH batters the ball far harder than the same bump without one', () => {
    const body = (): DgContactBody => ({
      prev: { x: DEEPGLASS_CENTER.x - 14 * DT, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z },
      cur: { ...DEEPGLASS_CENTER },
      vel: { x: 14, y: 0, z: 0 },
    });
    // Same geometry, same speeds: a glancing arrival that would deflect.
    const bump = ball({ x: DEEPGLASS_CENTER.x + 1.2, z: DEEPGLASS_CENTER.z + 2.4, vx: -10 });
    const bumpKind = applyBodyContact(bump, body());
    const smash = ball({ x: DEEPGLASS_CENTER.x + 1.2, z: DEEPGLASS_CENTER.z + 2.4, vx: -10 });
    const smashKind = applyBodyContact(smash, body(), true);
    expect(smashKind).toBe('smash');
    expect(ballSpeed(smash)).toBeGreaterThan(ballSpeed(bump) + 8);
    // A smash may break the cruise cap, never the burst ceiling.
    expect(ballSpeed(smash)).toBeLessThanOrEqual(DG_BALL_BURST_SPEED + 1e-6);
    // A dash NEVER traps or carries: the square-on case still batters.
    const square = ball({ x: DEEPGLASS_CENTER.x + 2, vx: -6 });
    expect(applyBodyContact(square, body(), true)).toBe('smash');
    expect(ballSpeed(square)).toBeGreaterThan(DG_BALL_MAX_SPEED * 0.8);
  });

  it('a bank inside the pinch window GAINS energy, up to the burst ceiling', () => {
    // Ball pressed against the glass moving outward, as after a body contact.
    const out = { x: DEEPGLASS_RADIUS - DG_BALL_RADIUS + 0.4, y: 0, z: 0 };
    const plain = ball({
      x: DEEPGLASS_CENTER.x + out.x,
      vx: 20,
    });
    reflectOffBell(plain);
    const pinched = ball({
      x: DEEPGLASS_CENTER.x + out.x,
      vx: 20,
    });
    reflectOffBell(pinched, 0, true);
    expect(ballSpeed(pinched)).toBeGreaterThan(ballSpeed(plain) * 1.5);
    expect(ballSpeed(pinched)).toBeGreaterThan(20); // energy GAIN off the squeeze
    expect(ballSpeed(pinched)).toBeLessThanOrEqual(DG_BALL_BURST_SPEED + 1e-6);
  });

  it('burst speed bleeds back under the cruise cap instead of persisting', () => {
    const b = ball({ vx: DG_BALL_BURST_SPEED });
    for (let i = 0; i < 40; i++) stepBallFluid(b, { x: 0, y: 0, z: 0 });
    expect(ballSpeed(b)).toBeLessThan(DG_BALL_MAX_SPEED + 1);
  });

  it('leaves a carried ball a little of its own drift, so a dribble is a skill', () => {
    const carrier: DgContactBody = {
      prev: { x: DEEPGLASS_CENTER.x - 10 * DT, y: DEEPGLASS_CENTER.y, z: DEEPGLASS_CENTER.z },
      cur: { ...DEEPGLASS_CENTER },
      vel: { x: 10, y: 0, z: 0 },
    };
    // The ball is drifting sideways as it is taken.
    const b = ball({ x: DEEPGLASS_CENTER.x + 1, vx: 8, vz: 6 });
    applyBodyContact(b, carrier);
    expect(b.vz).toBeGreaterThan(0.5); // not welded to the carrier's heading
    expect(b.vz).toBeLessThan(6); // but most of the squirm is absorbed
  });
});

// ---------------------------------------------------------------------------
// The roster. What is being tested here is not that the bots are GOOD — it is
// that they are ignorant in the specific ways a player is, because that is what
// "they do not feel like bots" is made of.
// ---------------------------------------------------------------------------
describe('bot brains', () => {
  function brainFor(pid: number, salt = 7): DgBotBrain {
    return makeBotBrain(pid, salt, DEEPGLASS_CENTER);
  }

  function viewWith(over: Partial<DgBotView> = {}): DgBotView {
    return {
      tick: 0,
      salt: 7,
      ball: {
        ...DEEPGLASS_CENTER,
        vx: 0,
        vy: 0,
        vz: 0,
        lastTouchTeam: null,
        lastTouchPid: null,
      },
      team: 'A',
      mates: [],
      foes: [],
      keeperPid: -1,
      ownRing: ringCentreFor('A'),
      foeRing: targetRingFor('A'),
      litPads: [],
      strike: () => {},
      ...over,
    };
  }

  function botBody(id: number, at: Vec3): Entity {
    return {
      id,
      pos: { ...at },
      prevPos: { ...at },
      facing: Math.PI / 2,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      jumping: false,
      fallStartY: at.y,
      swimStroke: 0,
      swimDiving: false,
      dgFlight: true,
      dgCharge: DG_CHARGE_MAX,
    } as Entity;
  }

  it('gives every fighter a different temperament, and the same one every time', () => {
    const a = botTraits(11, 3);
    expect(botTraits(11, 3)).toEqual(a); // pure
    expect(botTraits(12, 3)).not.toEqual(a); // and per-fighter
    const skills = [1, 2, 3, 4, 5, 6].map((pid) => botTraits(pid, 3).skill);
    // A roster where everyone is the same is a roster of one bot.
    expect(Math.max(...skills) - Math.min(...skills)).toBeGreaterThan(0.2);
    for (const t of [1, 2, 3, 4, 5, 6].map((pid) => botTraits(pid, 3))) {
      for (const v of Object.values(t)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sees the ball late: the belief lags a ball that has just been struck', () => {
    const brain = brainFor(4);
    const self = botBody(4, { x: -10, y: 41, z: 0 });
    const view = viewWith({ mates: [self] });
    // Settle the belief on a still ball.
    for (let t = 0; t < 20; t++) {
      view.tick = t;
      advanceBelief(brain, view, self);
    }
    // Now the ball is smashed across the bell. The bot does not know yet.
    view.ball.vx = 30;
    view.ball.vz = 10;
    let staleTicks = 0;
    for (let t = 20; t < 40; t++) {
      view.tick = t;
      view.ball.x += view.ball.vx * DT;
      view.ball.z += view.ball.vz * DT;
      advanceBelief(brain, view, self);
      const off = Math.hypot(brain.belief.x - view.ball.x, brain.belief.z - view.ball.z);
      if (off > 1) staleTicks++;
    }
    // It catches up eventually, but not on the tick the ball moved.
    expect(staleTicks).toBeGreaterThan(0);
  });

  it('misjudges a distant ball more than one under its nose', () => {
    // Averaged over many glances, because a single draw can land anywhere.
    const near = averageSightError({ x: 0, y: 41, z: 4 });
    const far = averageSightError({ x: 0, y: 41, z: 34 });
    expect(far).toBeGreaterThan(near * 1.5);
  });

  function averageSightError(ballAt: Vec3): number {
    let total = 0;
    let samples = 0;
    for (let pid = 1; pid <= 6; pid++) {
      const brain = brainFor(pid, 5);
      const self = botBody(pid, { ...DEEPGLASS_CENTER });
      const view = viewWith({ mates: [self] });
      view.ball.x = ballAt.x;
      view.ball.y = ballAt.y;
      view.ball.z = ballAt.z;
      for (let t = 0; t < 200; t++) {
        view.tick = t;
        const before = brain.belief.next;
        advanceBelief(brain, view, self);
        if (before === 0 && brain.belief.hold === 0) {
          total += Math.hypot(
            brain.belief.x - view.ball.x,
            brain.belief.y - view.ball.y,
            brain.belief.z - view.ball.z,
          );
          samples++;
        }
        // Freeze the belief's own drift so only the glance error is measured.
        brain.belief.vx = 0;
        brain.belief.vy = 0;
        brain.belief.vz = 0;
      }
    }
    return total / Math.max(1, samples);
  }

  it('posts exactly one chaser and one keeper on a side, and sticks with them', () => {
    const mates = [
      botBody(1, { x: -10, y: 41, z: 0 }),
      botBody(2, { x: -20, y: 41, z: 8 }),
      botBody(3, { x: -28, y: 41, z: -8 }),
    ];
    const brains = new Map(mates.map((m) => [m.id, brainFor(m.id)]));
    const view = viewWith({ mates, keeperPid: 3 });
    assignBotRoles(view, brains, false);
    const roles = mates.map((m) => brains.get(m.id)?.role);
    expect(roles.filter((r) => r === 'chase').length).toBe(1);
    expect(brains.get(3)?.role).toBe('keeper');

    // Commitment: the sitting chaser keeps the job through a beat in which a
    // mate has become nominally closer.
    const chaser = mates.find((m) => brains.get(m.id)?.role === 'chase');
    expect(chaser).toBeDefined();
    const other = mates.find((m) => m.id !== chaser?.id && m.id !== 3);
    if (other && chaser) {
      other.pos.x = view.ball.x;
      other.pos.z = view.ball.z;
      assignBotRoles(view, brains, false);
      expect(brains.get(chaser.id)?.role).toBe('chase');
    }
  });

  it('makes an attacking run when its side has the ball, and drops off when it does not', () => {
    const mates = [botBody(1, { x: -10, y: 41, z: 0 }), botBody(2, { x: -20, y: 41, z: 6 })];
    const brains = new Map(mates.map((m) => [m.id, brainFor(m.id)]));
    const view = viewWith({ mates, keeperPid: -1 });
    assignBotRoles(view, brains, true);
    const supporting = mates.map((m) => brains.get(m.id)?.role);
    expect(supporting).toContain('support');
    assignBotRoles(view, brains, false);
    // Roles hold for a beat, so wind the hold down before re-asking.
    for (const b of brains.values()) b.roleHold = 0;
    assignBotRoles(view, brains, false);
    expect(mates.map((m) => brains.get(m.id)?.role)).toContain('cover');
  });

  it('picks its steadiest fighter to keep goal', () => {
    // keeperFitness is what the match sorts on; assert it actually prefers the
    // composed over the reckless rather than that some pid wins.
    const steady = {
      skill: 0.7,
      vision: 0.7,
      aggression: 0.1,
      discipline: 0.6,
      composure: 0.9,
      flair: 0.2,
    };
    const hothead = {
      skill: 0.7,
      vision: 0.7,
      aggression: 0.95,
      discipline: 0.6,
      composure: 0.25,
      flair: 0.9,
    };
    expect(keeperFitness(steady)).toBeGreaterThan(keeperFitness(hothead));
  });
});

// ---------------------------------------------------------------------------
// The bout, with the new roster and the new rules.
// ---------------------------------------------------------------------------
describe('a bout with fallible fighters', () => {
  let sim: Sim;

  beforeEach(() => {
    setActiveWorldContent(buildDeepglassWorld());
    sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: buildDeepglassWorld(),
    });
  });

  it('whiffs sometimes: a swing at a ball that is no longer there', () => {
    const m = startDeepglassMatch(sim.ctx, null, 3);
    for (let t = 0; t < Math.round(180 / DT) && deepglassMatch(); t++) updateDeepglass(sim.ctx);
    expect(m.stats.strikes).toBeGreaterThan(10);
    // Not a metronome: some of those swings met water. (A roster that never
    // whiffs is a roster reading the ball's true position.)
    expect(m.stats.whiffs).toBeGreaterThan(0);
    expect(m.stats.whiffs / m.stats.strikes).toBeLessThan(0.4);
    endDeepglassMatch(sim.ctx);
  });

  it('keeps the fighters solid: they bump instead of sharing a yard of water', () => {
    const m = startDeepglassMatch(sim.ctx, null, 3);
    // Stack two bodies on the same point and let the bout resolve them.
    const [a, b] = m.teamA.map((pid) => sim.entities.get(pid)!);
    for (let t = 0; t < 70; t++) updateDeepglass(sim.ctx);
    b.pos.x = a.pos.x;
    b.pos.y = a.pos.y;
    b.pos.z = a.pos.z;
    updateDeepglass(sim.ctx);
    const apart = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
    expect(apart).toBeGreaterThan(0.5);
    expect(m.stats.bumps).toBeGreaterThan(0);
    endDeepglassMatch(sim.ctx);
  });

  it('credits the goal to whoever put it in, and calls an own goal an own goal', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    const me = sim.entities.get(sim.primaryId)!;
    const mate = m.teamA.find((pid) => pid !== sim.primaryId)!;
    // A mate touched it, then I did, then it went in: my goal, their assist.
    m.touches.length = 0;
    m.touches.push({ pid: sim.primaryId, team: 'A', tick: m.tick, kind: 'strike' });
    m.touches.push({ pid: mate, team: 'A', tick: m.tick - 4, kind: 'strike' });
    const ball = m.ball!;
    ball.x = DG_RING_EAST_X - 2;
    ball.y = DEEPGLASS_CENTER.y;
    ball.z = DEEPGLASS_CENTER.z;
    ball.vx = 30;
    ball.vy = 0;
    ball.vz = 0;
    // Keep the bodies out of the way of the shot.
    for (const pid of [...m.teamA, ...m.teamB]) {
      const e = sim.entities.get(pid);
      if (e && e.id !== me.id) e.pos.y = DEEPGLASS_CENTER.y - 25;
    }
    for (let t = 0; t < 6 && m.phase === 'active'; t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('goal');
    expect(m.lastGoalBy).toBe('A');
    expect(m.lastGoalScorer).toBe(sim.primaryId);
    expect(m.lastGoalAssist).toBe(mate);
    expect(m.lastGoalOwn).toBe(false);
    expect(m.stats.goalsStruck).toBe(1);
    endDeepglassMatch(sim.ctx);
  });

  it('marks a goal put in by the defending side as an own goal', () => {
    const m = startDeepglassMatch(sim.ctx, null, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    // Team A last touched it and it went through team A's OWN ring (the west
    // one), which is a goal for B.
    m.touches.length = 0;
    m.touches.push({ pid: m.teamA[0], team: 'A', tick: m.tick, kind: 'body' });
    const ball = m.ball!;
    ball.x = DG_RING_WEST_X + 2;
    ball.y = DEEPGLASS_CENTER.y;
    ball.z = DEEPGLASS_CENTER.z;
    ball.vx = -30;
    ball.vy = 0;
    ball.vz = 0;
    for (const pid of [...m.teamA, ...m.teamB]) {
      const e = sim.entities.get(pid);
      if (e) e.pos.y = DEEPGLASS_CENTER.y + 25;
    }
    for (let t = 0; t < 6 && m.phase === 'active'; t++) updateDeepglass(sim.ctx);
    expect(m.phase).toBe('goal');
    expect(m.lastGoalBy).toBe('B');
    expect(m.lastGoalOwn).toBe(true);
    expect(m.lastGoalAssist).toBeNull();
    expect(m.stats.ownGoals).toBe(1);
    endDeepglassMatch(sim.ctx);
  });

  it('goes to sudden death when the clock runs out level, and ends on the next goal', () => {
    const m = startDeepglassMatch(sim.ctx, null, 2);
    for (let t = 0; t < 80; t++) updateDeepglass(sim.ctx);
    m.scoreA = 2;
    m.scoreB = 2;
    m.clock = DG_MATCH_DURATION - DT / 2;
    updateDeepglass(sim.ctx);
    expect(m.overtime).toBe(true);
    expect(m.phase).toBe('active'); // play carries on
    // The next goal is the last one.
    m.scoreA = 3;
    m.lastGoalBy = 'A';
    m.phase = 'goal';
    m.timer = 0;
    updateDeepglass(sim.ctx);
    expect(m.phase).toBe('over');
    endDeepglassMatch(sim.ctx);
  });

  it('clears every dash and aim field off a body at the final whistle', () => {
    const m = startDeepglassMatch(sim.ctx, sim.primaryId, 2);
    for (let t = 0; t < 60; t++) updateDeepglass(sim.ctx);
    const me = sim.entities.get(sim.primaryId)!;
    me.dgDashTicks = 4;
    me.dgDashCd = 9;
    me.dgAimPitch = 0.7;
    me.dgBraking = true;
    endDeepglassMatch(sim.ctx);
    expect(me.dgDashTicks).toBeUndefined();
    expect(me.dgDashCd).toBeUndefined();
    expect(me.dgAimPitch).toBeUndefined();
    expect(me.dgBraking).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The ball marker. The renderer owns the camera projection; this is the mapping
// from a projected point to what the HUD draws, which is where the cases (and
// the sign trap) live.
// ---------------------------------------------------------------------------
describe('the ball marker', () => {
  it('sits on the ball while it is in view', () => {
    const m = ballMarkFromNdc(0, 0, 0.5, 20);
    expect(m.edge).toBe(false);
    expect(m.x).toBeCloseTo(0.5, 6);
    expect(m.y).toBeCloseTo(0.5, 6);
    expect(m.dist).toBe(20);
    // NDC y is UP, screen y is DOWN.
    expect(ballMarkFromNdc(0, 0.5, 0.5, 20).y).toBeLessThan(0.5);
    expect(ballMarkFromNdc(0.5, 0, 0.5, 20).x).toBeGreaterThan(0.5);
  });

  it('becomes an edge pointer once the ball leaves the frame', () => {
    const right = ballMarkFromNdc(1.6, 0, 0.5, 40);
    expect(right.edge).toBe(true);
    expect(right.x).toBeGreaterThan(0.9); // pinned to the right edge
    expect(right.angle).toBeCloseTo(0, 2); // pointing right
    const up = ballMarkFromNdc(0, 1.6, 0.5, 40);
    expect(up.y).toBeLessThan(0.1);
    // A CSS rotation is CLOCKWISE (screen y grows downward), so the pointer that
    // aims at the top of the screen is a NEGATIVE quarter turn.
    expect(up.angle).toBeCloseTo(-Math.PI / 2, 2);
    expect(ballMarkFromNdc(0, -1.6, 0.5, 40).angle).toBeCloseTo(Math.PI / 2, 2);
  });

  it('points BACKWARD for a ball behind the camera, not forward', () => {
    // The sign trap: past the camera the projection flips, so the raw coords
    // would pin the pointer to the opposite edge from the ball.
    const behind = ballMarkFromNdc(0.4, 0, 1.4, 30);
    expect(behind.edge).toBe(true);
    expect(behind.x).toBeLessThan(0.5); // ball is behind-left of the view
    expect(Math.abs(behind.angle)).toBeGreaterThan(Math.PI / 2);
    // Dead behind and dead centre is still an edge pointer, never a ring on the
    // middle of the screen.
    expect(ballMarkFromNdc(0, 0, 2, 30).edge).toBe(true);
  });

  it('keeps the pointer inside the viewport from every direction', () => {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const mark = ballMarkFromNdc(Math.cos(a) * 3, Math.sin(a) * 3, 0.5, 10);
      expect(mark.edge).toBe(true);
      expect(mark.x).toBeGreaterThanOrEqual(0);
      expect(mark.x).toBeLessThanOrEqual(1);
      expect(mark.y).toBeGreaterThanOrEqual(0);
      expect(mark.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('the goal surround', () => {
  it('shrinks around the aperture without ever closing in on it', () => {
    // The surround is scaled down (deepglass_kit.ts GATE_SURROUND_SCALE) so the
    // architecture stops promising an opening three times wider than the one
    // that scores. The guard that matters is the other way round: it must never
    // be shrunk so far that the arch clips the ring the ball has to pass
    // through, which would read as a goal frame with no hole in it.
    const AUTHORED_MOUTH_R = 19.5; // scripts/assets/deepglass/dg_gate.py
    const SURROUND_SCALE = 0.62; // deepglass_kit.ts
    const innerEdge = AUTHORED_MOUTH_R * SURROUND_SCALE;
    expect(innerEdge).toBeGreaterThan(DG_RING_RADIUS * 1.5);
    // ...and the ring is still the smaller, honest target.
    expect(DG_RING_RADIUS).toBeLessThan(innerEdge);
  });
});

describe('flight momentum (the Rocket League pass)', () => {
  function flier(over: Partial<Entity> = {}): Entity {
    return {
      pos: { ...DEEPGLASS_CENTER },
      prevPos: { ...DEEPGLASS_CENTER },
      facing: Math.PI / 2, // east
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: false,
      jumping: true,
      fallStartY: 0,
      swimStroke: 0,
      swimDiving: false,
      dgFlight: true,
      dgCharge: DG_CHARGE_MAX,
      ...over,
    } as Entity;
  }

  it('keeps most of a climb after the climb key is released: no altitude hold', () => {
    // The old 1.8/s hold parked a body at its last height inside half a
    // second. A car that leaves the ground keeps going; so does a flier now.
    const e = flier();
    for (let t = 0; t < 20; t++) deepglassFlightPass(e, input({ jump: true }), false, ZERO);
    const climbing = e.vy;
    expect(climbing).toBeGreaterThan(5);
    for (let t = 0; t < 10; t++) deepglassFlightPass(e, input(), false, ZERO); // 0.5s hands off
    expect(e.vy).toBeGreaterThan(climbing * 0.55);
    // ...and horizontal drift is bled no harder than vertical drift is, within
    // the whisper of extra vertical damping that is left.
    const h = flier();
    for (let t = 0; t < 20; t++) deepglassFlightPass(h, input({ forward: true }), false, ZERO);
    const cruising = Math.hypot(h.vx, h.vz);
    for (let t = 0; t < 10; t++) deepglassFlightPass(h, input(), false, ZERO);
    expect(Math.hypot(h.vx, h.vz) / cruising).toBeGreaterThan(e.vy / climbing);
  });

  it('cruises faster than the first cut, and boosts past it by less than double', () => {
    // The proportions Rocket League runs at: throttle pace within reach of a
    // moving ball, boost a clear but not absurd step above it.
    expect(DG_SWIM_SPEED).toBeGreaterThanOrEqual(13);
    expect(DG_BOOST_SPEED / DG_SWIM_SPEED).toBeGreaterThan(1.8);
    expect(DG_BOOST_SPEED / DG_SWIM_SPEED).toBeLessThan(2.6);
    const e = flier();
    for (let t = 0; t < 40; t++) deepglassFlightPass(e, input({ forward: true }), false, ZERO);
    expect(Math.hypot(e.vx, e.vy, e.vz)).toBeGreaterThan(12);
  });

  it('bites almost fully on the first tick: the spool is a wind-up, not a delay', () => {
    const e = flier();
    deepglassFlightPass(e, input({ forward: true }), false, ZERO);
    // DG_SPOOL_FLOOR: at least 0.86 of the full first-tick acceleration lands.
    const firstTick = Math.hypot(e.vx, e.vy, e.vz);
    const full = flier({ dgSpool: 1 });
    deepglassFlightPass(full, input({ forward: true }), false, ZERO);
    expect(firstTick).toBeGreaterThan(Math.hypot(full.vx, full.vy, full.vz) * 0.85);
  });
});
