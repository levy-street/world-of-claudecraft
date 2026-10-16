import { describe, expect, it } from 'vitest';
import {
  type AnimState,
  advanceSwimBlend,
  applyLocoDirection,
  desiredBaseState,
  isSwimmingAtDepth,
  locomotionTimeScale,
  pickProxyHeight,
  SWIM_ENTER_FEET_DEPTH,
  SWIM_EXIT_FEET_DEPTH,
  shouldTriggerWaterImpact,
  waterContactFrameMode,
} from '../src/render/characters/anim_state';
import { createClientPlayerMotionDeps } from '../src/render/client_player_motion';
import { advanceSelfFacing } from '../src/render/facing_smooth';
import {
  type LocoState,
  MOVE_HOLD_TIME,
  newLocoState,
  newLocoTrack,
  STRAFE_CONFIRM_SEC,
  updateLocomotion,
  updateLocomotionInto,
} from '../src/render/locomotion';
import { createPlayer } from '../src/sim/entity';
import { stepPlayerMotion } from '../src/sim/player_motion';
import { DT, emptyMoveInput, type MoveInput, RUN_SPEED } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { assertAllocationStable } from './util/alloc_probe';

describe('per-rig gait thresholds', () => {
  it('uses the cat run gait at slowed speeds and retains hysteresis through speed noise', () => {
    const track = newLocoTrack();
    const out = newLocoState();
    const gait = { runEnter: 3.2, runExit: 2.6 };
    const settle = (speed: number) => {
      for (let i = 0; i < 90; i++) updateLocomotionInto(out, track, 0, speed / 60, 0, 1 / 60, gait);
      return out.running;
    };
    expect(settle(3.1)).toBe(false);
    expect(settle(3.5)).toBe(true);
    expect(settle(2.9)).toBe(true);
    expect(settle(2.5)).toBe(false);
    expect(settle(2.9)).toBe(false);
    expect(settle(3.5)).toBe(true);
    // The same track may return to the humanoid after a shapeshift ends.
    for (let i = 0; i < 90; i++) updateLocomotionInto(out, track, 0, 3.5 / 60, 0, 1 / 60);
    expect(out.running).toBe(false);
  });
});

const FPS = 1 / 60;
const BASE_ANIM_STATE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

// steady forward walk: ~2.2 u/s gives ~0.0367u of travel per 60fps frame
function walkStep(t: ReturnType<typeof newLocoTrack>, dt = FPS, speed = 2.2) {
  return updateLocomotion(t, 0, speed * dt, 0, dt);
}

describe('locomotion hysteresis', () => {
  it('fills one caller-owned result across entity-frame updates', () => {
    const track = newLocoTrack();
    const out = newLocoState();
    expect(() =>
      assertAllocationStable(
        () => updateLocomotionInto(out, track, 0, 0.04, 0, FPS),
        64,
        'locomotion state',
      ),
    ).not.toThrow();
  });

  it('a steady walk reports moving', () => {
    const t = newLocoTrack();
    let s = walkStep(t);
    for (let i = 0; i < 30; i++) s = walkStep(t);
    expect(s.moving).toBe(true);
    expect(s.backwards).toBe(false);
    expect(s.speed).toBeGreaterThan(1.5); // smoothed toward ~2.2
  });

  it('a single stalled frame mid-walk does NOT drop the moving state', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // interpolation stall / terrain bob: one frame with zero horizontal travel
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true); // latched through the dip — no reset
  });

  it('several consecutive stalled frames within the grace window stay moving', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    // ~0.15s of stall, under MOVE_HOLD_TIME (0.22s)
    let s = { moving: true } as ReturnType<typeof updateLocomotion>;
    for (let i = 0; i < 9; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(9 * FPS).toBeLessThan(MOVE_HOLD_TIME);
    expect(s.moving).toBe(true);
  });

  it('a genuine stop transitions to idle after the grace window', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 20; i++) walkStep(t);
    let s = updateLocomotion(t, 0, 0, 0, FPS);
    // run well past the hold window with no movement
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('keeps the backpedal direction through a stalled frame', () => {
    const t = newLocoTrack();
    // facing +Z (0); travel toward -Z is backwards
    for (let i = 0; i < 10; i++) updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    const moving = updateLocomotion(t, 0, -2.2 * FPS, 0, FPS);
    expect(moving.backwards).toBe(true);
    // a stalled frame must not flip walkBack -> walk
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true);
    expect(stalled.backwards).toBe(true);
  });

  it('treats a teleport snap as not moving', () => {
    const t = newLocoTrack();
    // 50u in one frame = 3000 u/s, far above the teleport cutoff
    const s = updateLocomotion(t, 50, 0, 0, FPS);
    expect(s.moving).toBe(false);
  });

  it('jitter scenario: alternating walk/stall frames never lose moving', () => {
    const t = newLocoTrack();
    walkStep(t);
    let everStopped = false;
    for (let i = 0; i < 60; i++) {
      // every other frame stalls (worst-case interp/terrain noise)
      const s = i % 2 === 0 ? updateLocomotion(t, 0, 0, 0, FPS) : walkStep(t);
      if (!s.moving) everStopped = true;
    }
    expect(everStopped).toBe(false);
  });
});

describe('gait hysteresis (run vs walk)', () => {
  const run = (t: ReturnType<typeof newLocoTrack>, dt = FPS, speed = 7) =>
    updateLocomotion(t, 0, speed * dt, 0, dt);

  it('a steady run settles into the run gait quickly', () => {
    const t = newLocoTrack();
    let s = run(t);
    for (let i = 0; i < 20; i++) s = run(t);
    expect(s.running).toBe(true);
  });

  it('noisy per-frame speed around the old threshold NEVER flips the gait', () => {
    // the world-entry glitch: load-hitch frames make the sampled speed swing
    // wildly around 4.5 u/s; the run/walk pick used a bare compare and
    // crossfaded Running<->Walking on nearly every frame
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t); // settle into run
    let flips = 0;
    let last = true;
    for (let i = 0; i < 120; i++) {
      // alternate starved and burst frames: 3 u/s then 8 u/s samples
      const s = run(t, i % 2 === 0 ? 0.017 : 0.25, i % 2 === 0 ? 3 : 8);
      if (s.running !== last) flips++;
      last = s.running;
    }
    expect(flips).toBe(0);
  });

  it('a snared runner keeps the run gait until well below the exit threshold', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t);
    let s = run(t, FPS, 4.2); // 40% snare: between exit (3.6) and enter (5.2)
    for (let i = 0; i < 30; i++) s = run(t, FPS, 4.2);
    expect(s.running).toBe(true); // no gait pop mid-snare
    for (let i = 0; i < 60; i++) s = run(t, FPS, 2.0); // hard snare: drop to walk
    expect(s.running).toBe(false);
  });

  it('a one-frame backwards read cannot flash the walkBack direction', () => {
    const t = newLocoTrack();
    for (let i = 0; i < 30; i++) run(t); // forward run, direction latched
    // a correction nudge reads one frame of backward displacement
    let s = updateLocomotion(t, 0, -7 * FPS, 0, FPS);
    expect(s.backwards).toBe(false); // dwell holds the direction
    // a REAL sustained backpedal still switches once the dwell elapses
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, -4.5 * FPS, 0, FPS);
    expect(s.backwards).toBe(true);
  });
});

// A Q/E strafe keeps facing and slides the body sideways at the full run speed
// (player_motion.ts: only the backpedal is slowed). The renderer used to play
// the forward Run under that slide; the lateral read below is what lets a rig
// with authored side runs play them instead.
describe('strafe direction (Q/E sideways travel)', () => {
  type Track = ReturnType<typeof newLocoTrack>;
  /** One display frame of travel `offDeg` degrees off the facing axis toward the
   *  body's LEFT (negative: toward its right) at `speed` yd/s, built from the
   *  sim's convention: facing f points along (sin f, cos f), and the body's
   *  right is (-cos f, sin f). */
  const travel = (t: Track, facing: number, offDeg: number, speed = 7): LocoState => {
    const a = (offDeg * Math.PI) / 180;
    const fwd = Math.cos(a) * speed * FPS;
    const left = Math.sin(a) * speed * FPS;
    const vx = Math.sin(facing) * fwd + Math.cos(facing) * left;
    const vz = Math.cos(facing) * fwd - Math.sin(facing) * left;
    return updateLocomotion(t, vx, vz, facing, FPS);
  };
  const hold = (t: Track, facing: number, offDeg: number, frames = 30, speed = 7) => {
    let s = travel(t, facing, offDeg, speed);
    for (let i = 1; i < frames; i++) s = travel(t, facing, offDeg, speed);
    return s;
  };
  /** The renderer's feed: the displayed motion, then the direction facts. */
  const animOf = (loco: LocoState): AnimState => {
    const s = { ...BASE_ANIM_STATE, speed: loco.speed, moving: loco.moving, running: loco.running };
    applyLocoDirection(s, loco, false);
    return s;
  };
  /** A rig that ships walkBack and BOTH side runs (the WOC player bodies). */
  const pose = (loco: LocoState) =>
    desiredBaseState(animOf(loco), true, true, false, false, false, false, true);

  it('reads +X travel at facing 0 as a strafe LEFT (the sign, pinned literally)', () => {
    // Facing 0 looks down +Z and the camera sits behind the body, so its right
    // is (-cos 0, sin 0) = -X (player_motion.ts): +X is the body's left.
    const t = newLocoTrack();
    let s = updateLocomotion(t, 7 * FPS, 0, 0, FPS);
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 7 * FPS, 0, 0, FPS);
    expect(s.strafe).toBe('left');
    const u = newLocoTrack();
    for (let i = 0; i < 30; i++) s = updateLocomotion(u, -7 * FPS, 0, 0, FPS);
    expect(s.strafe).toBe('right');
  });

  it('reads pure sideways travel as the side the body moves toward, at any facing', () => {
    for (const facing of [0, 1.2, -2.6]) {
      const left = hold(newLocoTrack(), facing, 90);
      expect(left.strafe, `facing ${facing}`).toBe('left');
      expect(left.backwards).toBe(false);
      expect(left.running).toBe(true);
      expect(pose(left)).toBe('strafeLeft');
      const right = hold(newLocoTrack(), facing, -90);
      expect(right.strafe, `facing ${facing}`).toBe('right');
      expect(right.running).toBe(true);
      expect(pose(right)).toBe('strafeRight');
    }
  });

  it('agrees with the REAL movement kernel: Q is left, E is right, diagonals keep a gait', () => {
    // One tick of stepPlayerMotion itself, with the client's own deps (the self
    // predictor's, client_player_motion.ts) on the open-field spot
    // tests/helpers/movement_ground_truth.ts names COLLIDER_FREE_LANE, replayed as
    // a steady stream of display frames: the convention is the kernel's own.
    const deps = createClientPlayerMotionDeps(WORLD_SEED);
    const kernel = (keys: Partial<MoveInput>, facing: number): LocoState => {
      const body = createPlayer(1, 'warrior', { x: 0, y: 0, z: -1000 }, 'Strafer');
      body.pos.y = terrainHeight(body.pos.x, body.pos.z, WORLD_SEED);
      body.prevPos = { ...body.pos };
      body.fallStartY = body.pos.y;
      body.onGround = true;
      body.facing = facing;
      stepPlayerMotion(deps, body, { ...emptyMoveInput(), ...keys });
      const dx = body.pos.x - body.prevPos.x;
      const dz = body.pos.z - body.prevPos.z;
      // the kernel really moved the body (a blocked step would test nothing)
      expect(Math.hypot(dx, dz) / DT).toBeGreaterThan(RUN_SPEED * 0.6);
      // the same travel, drawn at 60 fps
      const [fx, fz] = [dx * (FPS / DT), dz * (FPS / DT)];
      const t = newLocoTrack();
      let s = updateLocomotion(t, fx, fz, facing, FPS);
      for (let i = 0; i < 30; i++) s = updateLocomotion(t, fx, fz, facing, FPS);
      return s;
    };
    for (const facing of [0, 0.7, 2.5, -2.2]) {
      const at = `facing ${facing}`;
      expect(kernel({ strafeLeft: true }, facing).strafe, at).toBe('left');
      expect(kernel({ strafeRight: true }, facing).strafe, at).toBe('right');
      // W+Q / W+E: the forward diagonal is a plain run
      const wq = kernel({ forward: true, strafeLeft: true }, facing);
      expect([wq.strafe, wq.backwards, wq.running], at).toEqual([null, false, true]);
      expect(pose(wq), at).toBe('run');
      expect(kernel({ forward: true, strafeRight: true }, facing).strafe, at).toBeNull();
      // S+Q / S+E: a backpedal, never a strafe
      const sq = kernel({ back: true, strafeLeft: true }, facing);
      expect([sq.strafe, sq.backwards], at).toEqual([null, true]);
      expect(pose(sq), at).toBe('walkBack');
      expect(kernel({ back: true, strafeRight: true }, facing).strafe, at).toBeNull();
    }
  });

  it('draws the sideways line about 58 degrees off the facing axis', () => {
    // |lateral| >= 0.85: 55 deg (sin 0.82) is still a run, 62 deg (sin 0.88) strafes
    expect(hold(newLocoTrack(), 0.4, 55).strafe).toBeNull();
    expect(hold(newLocoTrack(), 0.4, -55).strafe).toBeNull();
    expect(hold(newLocoTrack(), 0.4, 62).strafe).toBe('left');
    expect(hold(newLocoTrack(), 0.4, -62).strafe).toBe('right');
    // ...and a backwards-leaning slide is a backpedal, not a strafe
    const back = hold(newLocoTrack(), 0.4, 115);
    expect([back.strafe, back.backwards]).toEqual([null, true]);
  });

  // frames of sideways travel a strafe change needs at 60 Hz (0.12 s: the 8th frame)
  const CONFIRM = Math.ceil(STRAFE_CONFIRM_SEC / FPS - 1e-9);

  it('never counts a backpedal frame toward a strafe streak', () => {
    // 110 deg is sideways enough (lateral 0.94) but leans back (forward -0.34): a
    // backpedal frame. Two of them do not start the strafe clock, and the
    // backpedal never confirmed either.
    expect(CONFIRM).toBe(8);
    const t = newLocoTrack();
    hold(t, 0, 0);
    travel(t, 0, 110);
    travel(t, 0, 110);
    let s = travel(t, 0, 100);
    expect([s.strafe, s.backwards]).toEqual([null, false]);
    for (let i = 1; i < CONFIRM - 1; i++) s = travel(t, 0, 100);
    expect(s.strafe).toBeNull();
    expect(travel(t, 0, 100).strafe).toBe('left');
  });

  it('needs 0.12 s of sideways travel: a short sideways blip never flips the run', () => {
    const t = newLocoTrack();
    hold(t, 0.3, 0); // a steady forward run
    let s = travel(t, 0.3, 90); // a correction nudge reads one sideways frame
    expect(s.strafe).toBeNull();
    expect(pose(s)).toBe('run');
    s = travel(t, 0.3, 0);
    for (let i = 0; i < CONFIRM - 1; i++) s = travel(t, 0.3, 90);
    expect(s.strafe).toBeNull(); // the clock restarted: one frame short
    s = travel(t, 0.3, 90);
    expect(s.strafe).toBe('left'); // a REAL strafe latches on its 8th frame (0.13 s)
    expect(pose(s)).toBe('strafeLeft');
    // and leaving it takes the same time
    for (let i = 0; i < CONFIRM - 1; i++) s = travel(t, 0.3, 0);
    expect(s.strafe).toBe('left');
    s = travel(t, 0.3, 0);
    expect(s.strafe).toBeNull();
  });

  it('counts seconds, not frames: a 144 Hz display confirms on the same clock', () => {
    const t = newLocoTrack();
    const at144 = (offDeg: number) => {
      const a = (offDeg * Math.PI) / 180;
      return updateLocomotion(t, (Math.sin(a) * 7) / 144, (Math.cos(a) * 7) / 144, 0, 1 / 144);
    };
    let s = at144(0);
    for (let i = 0; i < 60; i++) s = at144(0);
    for (let i = 0; i < 17; i++) s = at144(90); // 0.118 s
    expect(s.strafe).toBeNull();
    s = at144(90); // 0.125 s
    expect(s.strafe).toBe('left');
  });

  // The real self-model turn limiter (facing_smooth.ts): mouselook engages, the travel snaps
  // onto the new heading and the displayed model eases after it, clamped per frame. The strafe
  // latch counts at most that clamp per frame, so neither a slow display nor one hitch frame
  // lets the side run flash through the turn.
  const engage = (fps: number, swing: number, hitchAt = -1) => {
    const t = newLocoTrack();
    let model = 0;
    for (let i = 0; i < 60; i++) updateLocomotion(t, 0, 7 / 60, model, 1 / 60);
    const out: (string | null)[] = [];
    for (let i = 0; i < 90; i++) {
      const dt = i === hitchAt ? 0.15 : 1 / fps;
      model = advanceSelfFacing(model, swing, swing, dt);
      const s = updateLocomotion(t, Math.sin(swing) * 7 * dt, Math.cos(swing) * 7 * dt, model, dt);
      out.push(s.strafe);
    }
    return out;
  };

  it.each([20, 25, 30, 60, 144])(
    'never flashes the side run through a 180 deg mouse-steer engage at %i fps',
    (fps) => {
      expect(engage(fps, Math.PI).filter((s) => s !== null)).toEqual([]);
      expect(engage(fps, -Math.PI * 0.95).filter((s) => s !== null)).toEqual([]);
    },
  );

  it('never latches the side run on one long hitch frame mid-turn', () => {
    // a 90 deg engage starts inside the sideways band; a raw 0.15 s hitch on the first or
    // second frame (the model still 60 to 80 deg off the travel after it) would cross the
    // 0.12 s confirm in that one frame
    expect(engage(60, Math.PI / 2, 0).filter((s) => s !== null)).toEqual([]);
    expect(engage(60, -Math.PI / 2, 1).filter((s) => s !== null)).toEqual([]);
  });

  it('never flashes the side run while mouse steering swings the heading 90 deg', () => {
    // The travel snaps onto the new heading at once while the displayed model
    // turns after it at ~10 rad/s (renderer self-facing smoothing): the travel
    // reads sideways across the still-turning model for ~0.06 s.
    const t = newLocoTrack();
    hold(t, 0, 0);
    const heading = Math.PI / 2;
    let facing = 0;
    for (let i = 0; i < 40; i++) {
      facing = Math.min(heading, facing + 10 * FPS);
      const vx = Math.sin(heading) * 7 * FPS;
      const vz = Math.cos(heading) * 7 * FPS;
      const s = updateLocomotion(t, vx, vz, facing, FPS);
      expect(s.strafe, `frame ${i}`).toBeNull();
      expect(pose(s), `frame ${i}`).toBe('run');
    }
  });

  it('never latches either side on a left/right flutter', () => {
    const t = newLocoTrack();
    hold(t, 0, 0);
    for (let i = 0; i < 40; i++) {
      const s = travel(t, 0, i % 2 === 0 ? 90 : -90);
      expect(s.strafe).toBeNull();
    }
    // ...and from a latched side, a flutter that never holds the other side for
    // 0.12 s cannot flip it
    hold(t, 0, 90);
    for (let i = 0; i < 40; i++) {
      const s = travel(t, 0, i % 3 === 0 ? 90 : -90);
      expect(s.strafe).toBe('left');
    }
  });

  it('holds the side through a stalled frame and clears it on a genuine stop', () => {
    const t = newLocoTrack();
    hold(t, 0, -90);
    const stalled = updateLocomotion(t, 0, 0, 0, FPS);
    expect(stalled.moving).toBe(true);
    expect(stalled.strafe).toBe('right');
    let s = stalled;
    for (let i = 0; i < 30; i++) s = updateLocomotion(t, 0, 0, 0, FPS);
    expect(s.moving).toBe(false);
    expect(s.strafe).toBeNull();
    // a fresh forward start is a run from its first frame, not a stale strafe
    expect(travel(t, 0, 0).strafe).toBeNull();
  });

  it('never reports a strafe together with a backpedal (the LocoState contract)', () => {
    // Unreachable through real frames (a backpedal frame reads no side, and the
    // two latch over the same confirming frames), so pinned on a hand-set track.
    const t = newLocoTrack();
    t.moveHold = MOVE_HOLD_TIME;
    t.movingBackwards = true;
    t.strafe = 'left';
    const s = updateLocomotion(t, 0, 0, 0, FPS); // stalled: nothing is re-judged
    expect([s.moving, s.backwards, s.strafe]).toEqual([true, true, null]);
  });

  it('keeps a slow sideways walk on the walk cycle', () => {
    const s = hold(newLocoTrack(), 0, 90, 60, 2.2);
    expect(s.strafe).toBe('left');
    expect(s.running).toBe(false);
    expect(pose(s)).toBe('walk');
  });

  it('never enters the state on a rig without both side runs', () => {
    const s = hold(newLocoTrack(), 0, 90);
    expect(s.strafe).toBe('left');
    // the default (every mob, NPC and mount), and an explicit "not loaded"
    expect(desiredBaseState(animOf(s), true)).toBe('run');
    expect(desiredBaseState(animOf(s), true, true, false, false, false, false, false)).toBe('run');
  });

  it('matches the side run to the travel speed against strafeRef, like the run', () => {
    const s = animOf(hold(newLocoTrack(), 0, 90));
    // the default reference is the run's: 7 yd/s at a run authored at 7 plays at 1x
    expect(locomotionTimeScale('strafeLeft', s)).toBeCloseTo(s.speed / 7, 6);
    expect(
      locomotionTimeScale('strafeLeft', s, 2.2, 7, 2.2, 2.2, 0.6, undefined, undefined, 5),
    ).toBeCloseTo(s.speed / 5, 6);
  });
});

describe('swim animation stability', () => {
  it('uses separate enter and exit depths so waterline noise cannot flap the pose', () => {
    expect(isSwimmingAtDepth(false, false, SWIM_ENTER_FEET_DEPTH - 0.01, 2)).toBe(false);
    expect(isSwimmingAtDepth(false, false, SWIM_ENTER_FEET_DEPTH, 0.8)).toBe(true);
    expect(isSwimmingAtDepth(true, false, SWIM_EXIT_FEET_DEPTH + 0.01, 0.61)).toBe(true);
    expect(isSwimmingAtDepth(true, false, SWIM_EXIT_FEET_DEPTH - 0.01, 2)).toBe(false);
    // A wading body (MobTemplate.wadeDepth) swims only past ITS depth: feet two yards
    // under in two yards of water is a wade for a giant who can walk nine, and the same
    // giant in ten yards of water swims like anyone else.
    expect(isSwimmingAtDepth(false, false, 2, 2, 9)).toBe(false);
    expect(isSwimmingAtDepth(true, false, 2, 2, 9)).toBe(false);
    expect(isSwimmingAtDepth(false, false, 10, 10, 9)).toBe(true);
    expect(isSwimmingAtDepth(true, true, 2, 2)).toBe(false);
  });

  it('fires one impact for contact, water landing, and entering the swim state', () => {
    expect(shouldTriggerWaterImpact(false, false, false, false, false)).toBe(true);
    expect(shouldTriggerWaterImpact(true, true, false, false, false)).toBe(true);
    expect(shouldTriggerWaterImpact(true, false, false, false, true)).toBe(true);
    expect(shouldTriggerWaterImpact(true, false, false, true, true)).toBe(false);
    expect(shouldTriggerWaterImpact(true, true, true, false, false)).toBe(false);
  });

  it('suspends a culled contact and seeds it silently when visible again', () => {
    expect(waterContactFrameMode(false, true, true)).toBe('track');
    expect(waterContactFrameMode(false, false, true)).toBe('forget');
    expect(waterContactFrameMode(false, true, false)).toBe('seed');
    expect(waterContactFrameMode(true, true, true)).toBe('forget');
  });

  it('eases model lift in and out without a one-frame vertical pop', () => {
    let blend = advanceSwimBlend(0, true, FPS);
    expect(blend).toBeGreaterThan(0);
    expect(blend).toBeLessThan(0.2);
    for (let i = 0; i < 120; i++) blend = advanceSwimBlend(blend, true, FPS);
    expect(blend).toBeCloseTo(1, 4);

    const firstExitFrame = advanceSwimBlend(blend, false, FPS);
    expect(firstExitFrame).toBeGreaterThan(0.8);
    expect(firstExitFrame).toBeLessThan(blend);
    blend = firstExitFrame;
    for (let i = 0; i < 150; i++) blend = advanceSwimBlend(blend, false, FPS);
    expect(blend).toBeCloseTo(0, 4);
  });
});

describe('locomotion animation state', () => {
  it('uses authored walkBack for normal humanoid backpedal', () => {
    const state = { ...BASE_ANIM_STATE, moving: true, backwards: true, speed: 3 };
    expect(desiredBaseState(state, true)).toBe('walkBack');
    expect(locomotionTimeScale('walkBack', state)).toBeGreaterThan(0);
  });

  it('reverses forward locomotion for Shadewolf-style backpedal', () => {
    const state = {
      ...BASE_ANIM_STATE,
      moving: true,
      running: true,
      backwards: true,
      reverseBackpedal: true,
      speed: 7,
    };
    expect(desiredBaseState(state, true)).toBe('run');
    expect(locomotionTimeScale('run', state)).toBeLessThan(0);
  });

  it('lets a self-centered Warrior whirl override cast and movement poses', () => {
    const state = {
      ...BASE_ANIM_STATE,
      moving: true,
      running: true,
      casting: true,
      spinning: true,
    };
    expect(desiredBaseState(state, true)).toBe('spin');
  });
});

describe('pickProxyHeight (corpse pick-capsule flatten, issue 1486)', () => {
  it('uses the full standing height while alive', () => {
    expect(pickProxyHeight(1.8, 0.4, false)).toBe(1.8);
    expect(pickProxyHeight(3.0, 1.2, false)).toBe(3.0);
  });

  it('collapses a dead entity to a low, ground-hugging profile well under standing height', () => {
    // A humanoid: standing 1.8, radius 0.4 -> flat ~0.8, far below the upright column
    // that caused the phantom hitbox.
    const flat = pickProxyHeight(1.8, 0.4, true);
    expect(flat).toBeLessThan(1.8);
    expect(flat).toBe(0.8);
  });

  it('never exceeds the standing height for a wide, short creature', () => {
    // radius*2 would be 2.4 but standing height is only 1.0: clamp to the height so
    // the dead proxy is never TALLER than the living one.
    expect(pickProxyHeight(1.0, 1.2, true)).toBe(1.0);
  });

  it('scales the flat profile with body radius (long/wide creatures stay clickable)', () => {
    // A larger creature keeps a proportionally larger (but still sub-standing) flat
    // footprint so its corpse is not an unclickable sliver.
    expect(pickProxyHeight(3.0, 1.0, true)).toBe(2.0);
  });
});
