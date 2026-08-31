import { describe, expect, it } from 'vitest';
import { moverHeight, resolveMovement } from '../src/sim/colliders';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { DT, emptyMoveInput, type MoveInput, RUN_SPEED } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  type CommandSample,
  commandedDirection,
  commandedSpeed,
  computeFacingCameraSplit,
  computeFacingContinuity,
  computeFacingSettleError,
  computeMovementMetrics,
  computeReplayEvents,
  type DrawnSample,
  FACING_REVERSAL_DEADBAND_RAD,
  type GroundTruthSample,
  MOVEMENT_METRICS_DEFAULTS,
} from './helpers/movement_metrics';

// The metrics are the measuring instrument the latency baseline is read off, so
// they are calibrated here against hand-built trajectories whose expected
// numbers are arithmetic, not a previous run's output: a clean run must score
// zero, and each artifact must be detected at the size it was injected.

const TICK_MS = 50;
const STEP_YD = RUN_SPEED * (TICK_MS / 1000); // 0.35 yd per tick at run speed
const TICKS = 40;

const held = (over: Partial<MoveInput> = {}): MoveInput => ({ ...emptyMoveInput(), ...over });

/** A straight +z run from the origin: tick k ends at z = STEP_YD * (k + 1). */
function straightTruth(ticks = TICKS): GroundTruthSample[] {
  const out: GroundTruthSample[] = [];
  for (let k = 0; k < ticks; k++) out.push({ tick: k, x: 0, z: STEP_YD * (k + 1) });
  return out;
}

/** Drawn frames sitting exactly on the authoritative poses (a perfect client). */
function perfectFrames(truth: readonly GroundTruthSample[]): DrawnSample[] {
  return truth.map((sample) => ({ tMs: (sample.tick + 1) * TICK_MS, x: sample.x, z: sample.z }));
}

const FORWARD_COMMANDS: CommandSample[] = [{ tMs: 0, mi: held({ forward: true }), facing: 0 }];

describe('commanded intent resolution', () => {
  it('matches the movement kernel convention for forward, strafe, and backpedal', () => {
    const forward = commandedDirection(held({ forward: true }), 0);
    expect(forward?.x).toBeCloseTo(0, 12);
    expect(forward?.z).toBeCloseTo(1, 12);
    // Facing f points along (sin f, cos f), so a quarter turn puts forward on +x.
    const turned = commandedDirection(held({ forward: true }), Math.PI / 2);
    expect(turned?.x).toBeCloseTo(1, 12);
    expect(turned?.z).toBeCloseTo(0, 12);
    // Screen-right is (-cos f, sin f): strafing right at facing 0 goes -x.
    const strafe = commandedDirection(held({ strafeRight: true }), 0);
    expect(strafe?.x).toBeCloseTo(-1, 12);
    expect(strafe?.z).toBeCloseTo(0, 12);
    expect(commandedDirection(held(), 0)).toBeNull();

    expect(commandedSpeed(held({ forward: true }))).toBe(RUN_SPEED);
    expect(commandedSpeed(held({ back: true }))).toBeCloseTo(RUN_SPEED * 0.65, 12);
    expect(commandedSpeed(held())).toBe(0);
    expect(commandedSpeed(held({ jump: true }))).toBe(0);
  });
});

describe('metric conventions', () => {
  it('pins the thresholds the metrics score against', () => {
    // Every default here is a bar in disguise: widening the ramp window or the
    // correction angle makes a worse trajectory score better, and the baseline
    // suite would move with it and stay green.
    expect(MOVEMENT_METRICS_DEFAULTS).toEqual({
      tickMs: 50,
      tickPhaseMs: 50,
      backwardDeadbandYd: 0.001,
      rampWindowMs: 150,
      correctionAngleDeg: 30,
      minStepYd: 0.01,
    });
    expect(FACING_REVERSAL_DEADBAND_RAD).toBe(0.005);
  });

  it('scores nothing, rather than throwing, on empty input', () => {
    // The stated contract for a degenerate call: no drawn frames, no
    // authoritative path and no commands yields every metric at zero with
    // samples 0. The sample counts are what make that readable as "nothing was
    // examined" instead of "nothing was wrong", which is why every other test
    // here asserts them.
    expect(computeMovementMetrics([], [], [])).toEqual({
      backwardSteps: { count: 0, worstYd: 0, samples: 0 },
      pathDeviation: { maxYd: 0, meanYd: 0, samples: 0 },
      progressError: { maxAbsYd: 0, meanYd: 0, terminalYd: 0, samples: 0 },
      speedContinuity: { maxSpeedErr: 0, maxSpeedDelta: 0, samples: 0 },
      correctionEvents: { count: 0, worstDeg: 0, samples: 0 },
      inputToAuthorityMs: { maxMs: 0, meanMs: 0, samples: 0 },
      facingContinuity: { maxPostReleaseYawRate: 0, reversals: 0, samples: 0 },
      facingCameraSplit: { maxRad: 0, samples: 0 },
      facingSettleError: { terminalRad: 0, samples: 0 },
      replayEvents: {
        count: 0,
        byMode: { match: 0, replayed: 0, ignore: 0, stale: 0, suspend: 0 },
        worstResidualYd: 0,
      },
    });
  });

  it('measures each consumed client tick from sampling to authority once', () => {
    const commands: CommandSample[] = [
      { tMs: 10, mi: held({ forward: true }), facing: 0, ct: 4 },
      { tMs: 60, mi: held({ forward: true }), facing: 0, ct: 5 },
    ];
    const authorityTicks = [
      { tMs: 50, consumedCt: -1 },
      { tMs: 100, consumedCt: 4 },
      { tMs: 150, consumedCt: 4 },
      { tMs: 200, consumedCt: 5 },
    ];

    const metrics = computeMovementMetrics([], [], commands, {}, authorityTicks);

    expect(metrics.inputToAuthorityMs).toEqual({ maxMs: 140, meanMs: 115, samples: 2 });
  });

  it('dates client-tick truth from its send instant and sampler phase', () => {
    const truth: GroundTruthSample[] = [
      { tick: -1, x: 0, z: 0 },
      { tick: 0, x: 0, z: STEP_YD, ct: 10 },
      { tick: 1, x: 0, z: STEP_YD * 2, ct: 11 },
    ];
    const commands: CommandSample[] = [
      { tMs: 30, mi: held({ forward: true }), facing: 0, ct: 10, samplerInterpolationAlpha: 0.1 },
      { tMs: 80, mi: held({ forward: true }), facing: 0, ct: 11, samplerInterpolationAlpha: 0.1 },
    ];
    const drawn: DrawnSample[] = [
      { tMs: 75, x: 0, z: STEP_YD },
      { tMs: 125, x: 0, z: STEP_YD * 2 },
    ];

    const dated = computeMovementMetrics(drawn, truth, commands);
    expect(dated.progressError.maxAbsYd).toBeCloseTo(0, 12);
    expect(dated.progressError.terminalYd).toBeCloseTo(0, 12);

    const fallback = computeMovementMetrics(
      drawn,
      truth.map(({ ct: _ct, ...sample }) => sample),
      commands,
    );
    expect(fallback.progressError.maxAbsYd).toBeCloseTo(STEP_YD / 2, 12);
  });

  it('resolves intent the way the real movement kernel moves a body', () => {
    // The load-bearing claim behind every number this module produces:
    // commandedDirection and commandedSpeed are not a model of the movement,
    // they are the movement. One tick of the real stepPlayerMotion, driven with
    // the client dep shape (tests/player_motion.test.ts idiom), must land
    // exactly where they say it will. Strafe rather than forward on purpose:
    // the strafe axis is where a sign or an axis swap would hide.
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const deps: PlayerMotionDeps = {
      seed: sim.cfg.seed,
      moveSpeedMult: (e) => moveSpeedMult(e, 0),
      resolveMove: (fromX, fromZ, nx, nz, r, e, ignoreFences) =>
        resolveMovement(
          sim.cfg.seed,
          fromX,
          fromZ,
          nx,
          nz,
          r,
          ignoreFences,
          undefined,
          moverHeight(e),
        ),
      resolvedAbility: () => null,
      cancelCast: () => {},
      standUp: () => {},
      dealDamage: () => {},
    };
    // The collider-free lane the harness runs its scenarios in (the same spot
    // tests/helpers/movement_ground_truth.ts names COLLIDER_FREE_LANE): open
    // field, so the step is movement rather than collision response. The lane
    // is not flat, so only the horizontal plane is asserted; terrain owns y.
    const facing = 0.7;
    const actor = sim.player;
    actor.pos.x = 0;
    actor.pos.z = -1000;
    actor.pos.y = terrainHeight(actor.pos.x, actor.pos.z, sim.cfg.seed);
    actor.prevPos = { ...actor.pos };
    actor.fallStartY = actor.pos.y;
    actor.onGround = true;
    actor.vx = 0;
    actor.vz = 0;
    actor.vy = 0;
    actor.facing = facing;

    const input = held({ strafeRight: true });
    const fromX = actor.pos.x;
    const fromZ = actor.pos.z;
    stepPlayerMotion(deps, actor, input);
    const dx = actor.pos.x - fromX;
    const dz = actor.pos.z - fromZ;
    const stepYd = Math.hypot(dx, dz);
    const direction = commandedDirection(input, facing);
    if (!direction) throw new Error('strafeRight must resolve a direction');

    expect(stepYd).toBeCloseTo(commandedSpeed(input) * DT, 9);
    expect(dx / stepYd).toBeCloseTo(direction.x, 9);
    expect(dz / stepYd).toBeCloseTo(direction.z, 9);
  });
});

describe('facing and replay metrics on hand-built traces', () => {
  it('measures the post-release yaw rate and direction reversals outside steady gating', () => {
    const frames: DrawnSample[] = [
      { tMs: 0, x: 0, z: 0, drawnYaw: 0, turnInputActive: true },
      { tMs: 100, x: 0, z: 0, drawnYaw: 0.3, turnInputActive: true },
      { tMs: 200, x: 0, z: 0, drawnYaw: 0.4, turnInputActive: false },
      { tMs: 300, x: 0, z: 0, drawnYaw: 0.35, turnInputActive: false },
      { tMs: 400, x: 0, z: 0, drawnYaw: 0.37, turnInputActive: false },
    ];

    const metric = computeFacingContinuity(frames);
    expect(metric.maxPostReleaseYawRate).toBeCloseTo(1, 12);
    expect(metric.reversals).toBe(2);
    expect(metric.samples).toBe(3);
  });

  it('ignores sub-deadband yaw changes when counting perceptual reversals', () => {
    const frames: DrawnSample[] = [
      { tMs: 0, x: 0, z: 0, drawnYaw: 0, turnInputActive: true },
      { tMs: 100, x: 0, z: 0, drawnYaw: 0.3, turnInputActive: false },
      { tMs: 200, x: 0, z: 0, drawnYaw: 0.2983, turnInputActive: false },
      { tMs: 300, x: 0, z: 0, drawnYaw: 0.31, turnInputActive: false },
    ];

    expect(computeFacingContinuity(frames).reversals).toBe(0);
  });

  it('starts the post-release window after an explicit fast mouselook sweep', () => {
    const frames: DrawnSample[] = [
      { tMs: 0, x: 0, z: 0, drawnYaw: 0, turnInputActive: true },
      { tMs: 20, x: 0, z: 0, drawnYaw: 0.4, turnInputActive: true },
      { tMs: 40, x: 0, z: 0, drawnYaw: 0.8, turnInputActive: true },
      { tMs: 60, x: 0, z: 0, drawnYaw: 0.8, turnInputActive: false },
      { tMs: 80, x: 0, z: 0, drawnYaw: 0.8, turnInputActive: false },
    ];

    expect(computeFacingContinuity(frames)).toEqual({
      maxPostReleaseYawRate: 0,
      reversals: 0,
      samples: 2,
    });
  });

  it('takes the shortest wrapped angle for camera split and terminal settle error', () => {
    const frames: DrawnSample[] = [
      {
        tMs: 0,
        x: 0,
        z: 0,
        drawnYaw: Math.PI - 0.02,
        cameraFacing: -Math.PI + 0.03,
        authoritativeFacing: -Math.PI + 0.08,
      },
      {
        tMs: 50,
        x: 0,
        z: 0,
        drawnYaw: 1.2,
        cameraFacing: 1.1,
        authoritativeFacing: 1.15,
      },
    ];

    const split = computeFacingCameraSplit(frames);
    expect(split.maxRad).toBeCloseTo(0.1, 12);
    expect(split.samples).toBe(2);
    expect(computeFacingSettleError(frames).terminalRad).toBeCloseTo(0.05, 12);
  });

  it('counts non-match reconciliation modes and the worst horizontal residual', () => {
    const frames: DrawnSample[] = [
      { tMs: 0, x: 0, z: 0, reconcileMode: 'match', residualYd: 0 },
      { tMs: 50, x: 0, z: 0, reconcileMode: 'replayed', residualYd: 0.3 },
      { tMs: 100, x: 0, z: 0, reconcileMode: 'ignore', residualYd: 0.1 },
      { tMs: 150, x: 0, z: 0, reconcileMode: 'stale' },
      { tMs: 200, x: 0, z: 0, reconcileMode: 'suspend', residualYd: 0.2 },
    ];

    expect(computeReplayEvents(frames)).toEqual({
      count: 4,
      byMode: { match: 1, replayed: 1, ignore: 1, stale: 1, suspend: 1 },
      worstResidualYd: 0.3,
    });
  });
});

describe('movement metrics on hand-built trajectories', () => {
  it('scores a clean run at zero on every metric', () => {
    const truth = straightTruth();
    const metrics = computeMovementMetrics(perfectFrames(truth), truth, FORWARD_COMMANDS);

    expect(metrics.backwardSteps.count).toBe(0);
    expect(metrics.backwardSteps.worstYd).toBe(0);
    expect(metrics.backwardSteps.samples).toBe(TICKS - 1);
    expect(metrics.pathDeviation.maxYd).toBeCloseTo(0, 12);
    expect(metrics.pathDeviation.meanYd).toBeCloseTo(0, 12);
    expect(metrics.progressError.maxAbsYd).toBeCloseTo(0, 12);
    expect(metrics.progressError.terminalYd).toBeCloseTo(0, 12);
    expect(metrics.speedContinuity.maxSpeedErr).toBeCloseTo(0, 12);
    expect(metrics.speedContinuity.maxSpeedDelta).toBeCloseTo(0, 12);
    expect(metrics.correctionEvents.count).toBe(0);
    expect(metrics.correctionEvents.worstDeg).toBeCloseTo(0, 12);
    // Not a vacuous pass: the frames really were examined.
    expect(metrics.correctionEvents.samples).toBe(TICKS - 1);
  });

  it('detects an injected 0.2 yd backward snap and the correction it implies', () => {
    const truth = straightTruth();
    const frames = perfectFrames(truth);
    const snapAt = 20;
    // One frame drawn 0.2 yd BEHIND the previous one: the snap-back artifact.
    frames[snapAt] = { ...frames[snapAt], z: frames[snapAt - 1].z - 0.2 };
    const metrics = computeMovementMetrics(frames, truth, FORWARD_COMMANDS);

    expect(metrics.backwardSteps.count).toBe(1);
    expect(metrics.backwardSteps.worstYd).toBeCloseTo(-0.2, 12);
    // The same step points 180 degrees away from the held direction.
    expect(metrics.correctionEvents.count).toBe(1);
    expect(metrics.correctionEvents.worstDeg).toBeCloseTo(180, 9);
    // And it shows up as a speed discontinuity: 0.2 yd back in a 50 ms frame is
    // 4 yd/s, then 2 steps plus the snap (0.9 yd) forward is 18 yd/s.
    expect(metrics.speedContinuity.maxSpeedDelta).toBeCloseTo(18 - 4, 9);
    expect(metrics.speedContinuity.maxSpeedErr).toBeCloseTo(18 - RUN_SPEED, 9);
    // The snap is ALONG the authoritative line, so it is progress error, not
    // path deviation: one step of lag plus the snap itself.
    expect(metrics.pathDeviation.maxYd).toBeCloseTo(0, 9);
    expect(metrics.progressError.maxAbsYd).toBeCloseTo(STEP_YD + 0.2, 9);
  });

  it('registers an off-line drag as path deviation without faking progress error', () => {
    const truth = straightTruth();
    const frames = perfectFrames(truth).map((frame) => ({ ...frame, x: frame.x + 0.5 }));
    const metrics = computeMovementMetrics(frames, truth, FORWARD_COMMANDS);

    expect(metrics.pathDeviation.maxYd).toBeCloseTo(0.5, 9);
    expect(metrics.pathDeviation.meanYd).toBeCloseTo(0.5, 9);
    // Perpendicular displacement moves nothing along the path.
    expect(metrics.progressError.maxAbsYd).toBeCloseTo(0, 9);
    expect(metrics.backwardSteps.count).toBe(0);
  });

  it('measures a display lead as signed progress error', () => {
    const truth = straightTruth();
    const lead = 0.7;
    // Stop short of the polyline end so the lead is measured, not clamped.
    const frames = perfectFrames(truth)
      .slice(0, TICKS - 4)
      .map((frame) => ({ ...frame, z: frame.z + lead }));
    const metrics = computeMovementMetrics(frames, truth, FORWARD_COMMANDS);

    expect(metrics.progressError.maxAbsYd).toBeCloseTo(lead, 9);
    expect(metrics.progressError.meanYd).toBeCloseTo(lead, 9);
    expect(metrics.progressError.terminalYd).toBeCloseTo(lead, 9);
    expect(metrics.pathDeviation.maxYd).toBeCloseTo(0, 9);
  });

  it('measures the settling error left behind after motion stops', () => {
    const truth = straightTruth();
    const frames = perfectFrames(truth);
    const stopTick = 25;
    const overshoot = 0.3;
    // Truth stops at stopTick; the display overruns it and settles there.
    const stopped = truth.map((sample) =>
      sample.tick <= stopTick ? sample : { ...sample, z: truth[stopTick].z },
    );
    const drawn = frames.map((frame, i) =>
      i <= stopTick ? frame : { ...frame, z: truth[stopTick].z + overshoot },
    );
    const commands: CommandSample[] = [
      { tMs: 0, mi: held({ forward: true }), facing: 0 },
      { tMs: (stopTick + 1) * TICK_MS, mi: held(), facing: 0 },
    ];
    const metrics = computeMovementMetrics(drawn, stopped, commands, { tickMs: TICK_MS });

    // The settle is measured with the keys already up, past the end of the
    // authoritative path, so it must not clamp to zero.
    expect(metrics.progressError.terminalYd).toBeCloseTo(overshoot, 9);
    expect(metrics.progressError.maxAbsYd).toBeCloseTo(overshoot, 9);
    // Deviation stays a steering metric: nothing was steered off the line.
    expect(metrics.pathDeviation.maxYd).toBeCloseTo(0, 9);
  });

  it('excludes the ramp window around a held-input change from the steady metrics', () => {
    const truth = straightTruth();
    const frames = perfectFrames(truth);
    const changeTick = 20;
    const changeAtMs = (changeTick + 1) * TICK_MS;
    const stopped = truth.map((sample) =>
      sample.tick <= changeTick ? sample : { ...sample, z: truth[changeTick].z },
    );
    // A settle jitter 100 ms after the release: inside a 150 ms ramp window it
    // is release behavior, outside a 30 ms one it is choppiness.
    const jitterIndex = changeTick + 2;
    const drawn = frames.map((frame, i) => {
      if (i <= changeTick) return frame;
      const z = truth[changeTick].z + (i === jitterIndex ? 0.25 : 0);
      return { ...frame, z };
    });
    const commands: CommandSample[] = [
      { tMs: 0, mi: held({ forward: true }), facing: 0 },
      { tMs: changeAtMs, mi: held(), facing: 0 },
    ];

    const wide = computeMovementMetrics(drawn, stopped, commands, { rampWindowMs: 150 });
    expect(wide.speedContinuity.maxSpeedErr).toBeCloseTo(0, 9);
    expect(wide.speedContinuity.maxSpeedDelta).toBeCloseTo(0, 9);

    const narrow = computeMovementMetrics(drawn, stopped, commands, { rampWindowMs: 30 });
    expect(narrow.speedContinuity.maxSpeedDelta).toBeCloseTo(0.25 / (TICK_MS / 1000), 9);
    expect(narrow.speedContinuity.maxSpeedErr).toBeCloseTo(0.25 / (TICK_MS / 1000), 9);
  });

  it('keeps a smooth facing sweep inside the steady segment', () => {
    // A curved run: the commanded direction rotates every frame, and the drawn
    // steps follow it exactly. Steering is not an input change, so none of this
    // may be excused by the ramp window or counted as a correction.
    const commands: CommandSample[] = [];
    const drawn: DrawnSample[] = [];
    const truth: GroundTruthSample[] = [];
    let x = 0;
    let z = 0;
    for (let k = 0; k < TICKS; k++) {
      const facing = (k / TICKS) * (Math.PI / 2);
      const direction = commandedDirection(held({ forward: true }), facing);
      if (!direction) throw new Error('forward must resolve a direction');
      x += direction.x * STEP_YD;
      z += direction.z * STEP_YD;
      const tMs = (k + 1) * TICK_MS;
      commands.push({ tMs, mi: held({ forward: true }), facing });
      truth.push({ tick: k, x, z });
      drawn.push({ tMs, x, z });
    }
    const metrics = computeMovementMetrics(drawn, truth, commands);

    expect(metrics.correctionEvents.count).toBe(0);
    expect(metrics.backwardSteps.count).toBe(0);
    // Every frame stayed in the steady segment (no held-input change anywhere).
    expect(metrics.speedContinuity.samples).toBe(TICKS - 1);
    expect(metrics.speedContinuity.maxSpeedErr).toBeLessThan(0.01);
  });
});
