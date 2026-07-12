import { describe, expect, it } from 'vitest';
import {
  cameraFollowShouldSettle,
  cameraIsManual,
  newCameraReleaseHold,
  stepCameraReleaseHold,
  updateFollowCameraYaw,
  wrapAngle,
} from '../src/game/camera_follow';

describe('camera follow', () => {
  it('wraps angles to the shortest signed turn', () => {
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });

  it('animates character turn deltas under the global yaw-speed cap', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1.0,
      interpFacing: 0.4,
      lastInterpFacing: 0.2,
      frameDt: 1 / 60,
      mouselook: false,
      moving: false,
      orbiting: false,
    });
    expect(next.camYaw).toBeGreaterThan(1.0);
    expect(next.camYaw).toBeLessThan(1.2);
    expect(next.camYaw).toBeCloseTo(1.06);
    expect(next.lastInterpFacing).toBe(0.4);
  });

  it('caps automatic yaw movement even after a long frame hitch', () => {
    const next = updateFollowCameraYaw({
      camYaw: 0,
      interpFacing: Math.PI,
      lastInterpFacing: 0,
      frameDt: 1,
      mouselook: false,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBeGreaterThan(0);
    expect(next.camYaw).toBeLessThan(0.13);
  });

  it('tracks facing through mouselook without changing yaw', () => {
    const next = updateFollowCameraYaw({
      camYaw: 2.0,
      interpFacing: 0.6,
      lastInterpFacing: 0.1,
      frameDt: 1 / 60,
      mouselook: true,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBe(2.0);
    expect(next.lastInterpFacing).toBe(0.6);
  });

  it('eases large moving offsets instead of snapping the camera behind the character', () => {
    const next = updateFollowCameraYaw({
      camYaw: Math.PI,
      interpFacing: 0,
      lastInterpFacing: 0,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBeLessThan(Math.PI);
    expect(next.camYaw).toBeGreaterThan(Math.PI - 0.2);
  });

  it('settles medium moving offsets quickly but not instantly', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1.2,
      interpFacing: 0,
      lastInterpFacing: 0,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBeLessThan(1.2);
    expect(next.camYaw).toBeGreaterThan(0);
    expect(next.camYaw).toBeGreaterThan(1.0);
  });

  it('treats keyboard turning as active follow movement', () => {
    expect(
      cameraFollowShouldSettle(
        {
          forward: false,
          back: false,
          strafeLeft: false,
          strafeRight: false,
          turnLeft: true,
          turnRight: false,
        },
        false,
      ),
    ).toBe(true);
  });

  it('does not auto-follow while the camera drives the facing (mouse-camera move)', () => {
    // facing is slaved to camYaw this frame, so the follower must leave camYaw
    // untouched — chasing its own output is what produced the wobble.
    const next = updateFollowCameraYaw({
      camYaw: 1.0,
      interpFacing: 0.2,
      lastInterpFacing: 0.9,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      cameraDriven: true,
      orbiting: false,
    });
    expect(next.camYaw).toBe(1.0);
    expect(next.lastInterpFacing).toBe(0.2); // still tracked so re-coupling won't snap
  });

  it('does not follow or auto-settle while the player is actively orbit-dragging', () => {
    const next = updateFollowCameraYaw({
      camYaw: 1,
      interpFacing: 0.4,
      lastInterpFacing: 0.1,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      orbiting: true,
    });
    expect(next.camYaw).toBe(1);
  });

  it('decouples click-to-move turns from the camera and eases only gently', () => {
    const next = updateFollowCameraYaw({
      camYaw: Math.PI,
      interpFacing: 0,
      lastInterpFacing: Math.PI - 0.5,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      clickMoving: true,
      orbiting: false,
    });
    expect(next.camYaw).toBeLessThan(Math.PI);
    expect(next.camYaw).toBeGreaterThan(Math.PI - 0.04);
  });

  it('treats mouse-camera mode as manual control even though mouselook reports false', () => {
    // Right-mouse mouselook already counts as manual; Mouse Camera mode reports
    // mouselook=false on desktop but must be folded in so it takes the same path.
    expect(cameraIsManual(true, false)).toBe(true); // classic right-mouse mouselook
    expect(cameraIsManual(false, true)).toBe(true); // Mouse Camera mode (always on)
    expect(cameraIsManual(true, true)).toBe(true);
    expect(cameraIsManual(false, false)).toBe(false); // classic, hands off — follow runs
  });

  it('keeps the camera locked to the drag in mouse-camera mode (no follow drift)', () => {
    // Reproduces the bug: in Mouse Camera mode the player walks forward while
    // dragging the camera, and the sim locks facing to camYaw every frame. Routed
    // through the manual flag (cameraIsManual=true) the follow system is bypassed,
    // so the camera tracks the drag exactly. With the old wiring (mouselook=false)
    // the follow code fights the drag and the view drifts tens of degrees.
    const simulate = (manual: boolean): number => {
      const dt = 1 / 60;
      const dragPerFrame = 0.03;
      let camYaw = Math.PI;
      let intended = Math.PI;
      let lastInterpFacing: number | null = camYaw;
      for (let f = 0; f < 90; f++) {
        camYaw += dragPerFrame; // the player's drag this frame
        intended += dragPerFrame; // where the drag actually asked the camera to point
        const next = updateFollowCameraYaw({
          camYaw,
          interpFacing: camYaw,
          frameDt: dt,
          lastInterpFacing,
          mouselook: manual,
          moving: true,
          orbiting: false,
        });
        camYaw = next.camYaw;
        lastInterpFacing = next.lastInterpFacing;
      }
      return Math.abs(wrapAngle(camYaw - intended));
    };
    expect(simulate(true)).toBeCloseTo(0, 6); // fixed: camera goes exactly where dragged
    expect(simulate(false)).toBeGreaterThan(0.5); // old wiring: drifts >0.5 rad (~30°+)
  });

  it('settles click-to-move turns more softly when the facing jump is large', () => {
    const large = updateFollowCameraYaw({
      camYaw: Math.PI,
      interpFacing: 0,
      lastInterpFacing: Math.PI - 0.5,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      clickMoving: true,
      orbiting: false,
    });
    const small = updateFollowCameraYaw({
      camYaw: 0.25,
      interpFacing: 0,
      lastInterpFacing: 0.3,
      frameDt: 1 / 60,
      mouselook: false,
      moving: true,
      clickMoving: true,
      orbiting: false,
    });
    expect(Math.PI - large.camYaw).toBeGreaterThan(0);
    expect(Math.PI - large.camYaw).toBeLessThan(0.01);
    expect(0.25 - small.camYaw).toBeGreaterThan(Math.PI - large.camYaw);
  });
});

// BUG: "camera briefly shakes before stabilizing" after a touch-look (or
// right-mouse mouselook) release. While the drag is live the follow system is
// bypassed and each sim tick commits facing = camYaw; but the render-
// interpolated facing lags that commit by up to a tick (offline) or a round
// trip (online). The instant the drag releases, follow re-engages and its
// rigid term replays that catch-up sweep into camYaw, pushing the camera PAST
// the heading the player chose; the settle term then drags it back: a visible
// overshoot-and-return bounce. The fix holds follow disengaged (cameraDriven)
// until the interpolated facing converges onto the released yaw.
describe('camera release hold (touch-look release bounce)', () => {
  const DT = 1 / 20; // the sim tick, mirrors src/sim (20 Hz)
  const TURN_RATE = 2.5; // rad/s of finger swipe while dragging
  const DRAG_S = 0.58; // drag long enough to cross several ticks, release mid-window
  const SETTLE_S = 1.2;

  // Mirrors the main.ts offline frame loop: pointer deltas land before the
  // frame body; the accumulator runs 20 Hz ticks; while mouselook is active
  // each tick commits facing = camYaw; the camera-driven falling edge latches
  // the final yaw (mouselookReleaseFacing -> pendingReleaseFacing) so the next
  // tick commits it; updateFollowCameraYaw runs on the render-interpolated
  // facing after the ticks.
  function simulateTouchLookRelease(
    fps: number,
    useHold: boolean,
  ): { trace: Array<{ t: number; yaw: number }>; releaseYaw: number; releaseAt: number } {
    const dtF = 1 / fps;
    const dragFrames = Math.ceil(DRAG_S / dtF);
    const totalFrames = dragFrames + Math.ceil(SETTLE_S / dtF);
    let camYaw = 0;
    let facing = 0;
    let prevFacing = 0;
    let acc = 0;
    let lastInterpFacing: number | null = null;
    let pendingReleaseFacing: number | null = null;
    let mouselook = true;
    let releaseYaw = 0;
    const hold = newCameraReleaseHold();
    const trace: Array<{ t: number; yaw: number }> = [];
    for (let f = 0; f < totalFrames; f++) {
      if (f < dragFrames) {
        camYaw += TURN_RATE * dtF; // the finger's pointer deltas this frame
      } else if (mouselook) {
        mouselook = false; // finger lifted between the previous frame and this one
        releaseYaw = camYaw;
        pendingReleaseFacing = camYaw; // the falling-edge commit (mouselook_release.ts)
      }
      acc += dtF;
      while (acc >= DT) {
        prevFacing = facing;
        const stepFacing = mouselook ? camYaw : pendingReleaseFacing;
        if (stepFacing !== null) facing = stepFacing;
        pendingReleaseFacing = null;
        acc -= DT;
      }
      const interpFacing = prevFacing + wrapAngle(facing - prevFacing) * (acc / DT);
      const holdActive = useHold
        ? stepCameraReleaseHold(hold, {
            cameraOwned: mouselook,
            camYaw,
            interpFacing,
            frameDt: dtF,
          })
        : false;
      const next = updateFollowCameraYaw({
        camYaw,
        interpFacing,
        frameDt: dtF,
        lastInterpFacing,
        mouselook,
        moving: true, // the player keeps running on the joystick
        orbiting: false,
        cameraDriven: holdActive,
      });
      camYaw = next.camYaw;
      lastInterpFacing = next.lastInterpFacing;
      trace.push({ t: (f + 1) * dtF, yaw: camYaw });
    }
    return { trace, releaseYaw, releaseAt: dragFrames * dtF };
  }

  it('documents the pre-fix mechanism: instant follow re-engage replays the facing sweep and bounces', () => {
    const sim = simulateTouchLookRelease(60, false);
    const post = sim.trace.filter((p) => p.t > sim.releaseAt);
    const overshoot = Math.max(...post.map((p) => wrapAngle(p.yaw - sim.releaseYaw)));
    // The camera runs PAST the heading the finger chose...
    expect(overshoot).toBeGreaterThan(0.05);
    // ...and the settle then drags it back where it already was: the visible shake.
    const final = post[post.length - 1];
    expect(Math.abs(wrapAngle(final.yaw - sim.releaseYaw))).toBeLessThan(0.02);
  });

  it('holds the released heading: no overshoot past the release yaw at 30/60/144 fps', () => {
    for (const fps of [30, 60, 144]) {
      const sim = simulateTouchLookRelease(fps, true);
      const post = sim.trace.filter((p) => p.t > sim.releaseAt);
      expect(post.length).toBeGreaterThan(0);
      for (const p of post) {
        expect(Math.abs(wrapAngle(p.yaw - sim.releaseYaw))).toBeLessThanOrEqual(0.021);
      }
    }
  });

  it('settles without oscillation: the post-release yaw never reverses direction past tolerance', () => {
    const tol = 0.005;
    for (const fps of [30, 60, 144]) {
      const sim = simulateTouchLookRelease(fps, true);
      const post = sim.trace.filter((p) => p.t > sim.releaseAt);
      let sawForward = false;
      for (let i = 1; i < post.length; i++) {
        const v = wrapAngle(post[i].yaw - post[i - 1].yaw);
        if (v > tol) sawForward = true;
        // Once the camera moved forward after release, it must never swing back:
        // that reversal IS the reported shake.
        if (sawForward) expect(v).toBeGreaterThanOrEqual(-tol);
      }
    }
  });

  it('release behavior is frame-rate independent: 30/60/144 fps land on the same heading', () => {
    const finals = [30, 60, 144].map((fps) => {
      const sim = simulateTouchLookRelease(fps, true);
      const final = sim.trace[sim.trace.length - 1];
      return wrapAngle(final.yaw - sim.releaseYaw);
    });
    for (const e of finals) expect(Math.abs(e)).toBeLessThanOrEqual(0.021);
    expect(Math.abs(finals[0] - finals[1])).toBeLessThanOrEqual(0.02);
    expect(Math.abs(finals[1] - finals[2])).toBeLessThanOrEqual(0.02);
  });

  it('re-engages follow after convergence instead of suppressing it forever', () => {
    const hold = newCameraReleaseHold();
    // Live drag: never suppresses (the mouselook flag already bypasses follow).
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: true,
        camYaw: 1,
        interpFacing: 0,
        frameDt: 1 / 60,
      }),
    ).toBe(false);
    // Release with the interpolated facing still behind: suppress...
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: false,
        camYaw: 1,
        interpFacing: 0.9,
        frameDt: 1 / 60,
      }),
    ).toBe(true);
    // ...until it converges within the wire-rounding seam; the converging frame
    // still suppresses so its interp step never leaks into the rigid term...
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: false,
        camYaw: 1,
        interpFacing: 0.995,
        frameDt: 1 / 60,
      }),
    ).toBe(true);
    // ...and afterwards the auto-follow owns the camera again.
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: false,
        camYaw: 1,
        interpFacing: 0.995,
        frameDt: 1 / 60,
      }),
    ).toBe(false);
  });

  it('gives up after the grace timeout when the facing never converges (e.g. server refusal)', () => {
    const hold = newCameraReleaseHold();
    stepCameraReleaseHold(hold, { cameraOwned: true, camYaw: 2, interpFacing: 0, frameDt: 1 / 60 });
    let suppressed = 0;
    for (let f = 0; f < 60; f++) {
      if (
        stepCameraReleaseHold(hold, {
          cameraOwned: false,
          camYaw: 2,
          interpFacing: 0,
          frameDt: 1 / 60,
        })
      )
        suppressed += 1;
    }
    // Held for the grace window (350ms ~ 21 frames at 60fps), then released.
    expect(suppressed).toBeGreaterThan(15);
    expect(suppressed).toBeLessThan(30);
  });

  it('a manual keyboard turn breaks the hold so the follow camera tracks the turn', () => {
    const hold = newCameraReleaseHold();
    stepCameraReleaseHold(hold, { cameraOwned: true, camYaw: 2, interpFacing: 0, frameDt: 1 / 60 });
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: false,
        camYaw: 2,
        interpFacing: 0,
        frameDt: 1 / 60,
        manualTurn: true,
      }),
    ).toBe(true); // the breaking frame still suppresses (keeps lastInterpFacing fresh)
    expect(
      stepCameraReleaseHold(hold, {
        cameraOwned: false,
        camYaw: 2,
        interpFacing: 0,
        frameDt: 1 / 60,
      }),
    ).toBe(false);
  });

  it('plain moving settle stays frame-rate independent and never oscillates (regression pin)', () => {
    const settleTrace = (fps: number): Array<{ t: number; yaw: number }> => {
      const dtF = 1 / fps;
      let camYaw = 1.2;
      let lastInterpFacing: number | null = 0;
      const trace: Array<{ t: number; yaw: number }> = [];
      for (let f = 0; f * dtF < 1.0; f++) {
        const next = updateFollowCameraYaw({
          camYaw,
          interpFacing: 0,
          frameDt: dtF,
          lastInterpFacing,
          mouselook: false,
          moving: true,
          orbiting: false,
        });
        camYaw = next.camYaw;
        lastInterpFacing = next.lastInterpFacing;
        trace.push({ t: (f + 1) * dtF, yaw: camYaw });
      }
      return trace;
    };
    const sampleAt = (trace: Array<{ t: number; yaw: number }>, t: number): number => {
      // linear interpolation between the two nearest frames
      let i = 0;
      while (i < trace.length - 1 && trace[i + 1].t < t) i++;
      const a = trace[i];
      const b = trace[Math.min(i + 1, trace.length - 1)];
      if (b.t === a.t) return a.yaw;
      const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      return a.yaw + (b.yaw - a.yaw) * k;
    };
    const traces = [30, 60, 144].map(settleTrace);
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const yaws = traces.map((tr) => sampleAt(tr, t));
      expect(Math.abs(yaws[0] - yaws[1])).toBeLessThanOrEqual(0.05);
      expect(Math.abs(yaws[1] - yaws[2])).toBeLessThanOrEqual(0.05);
    }
    // No oscillation: the error decays toward 0 and never crosses below it.
    for (const tr of traces) {
      for (let i = 1; i < tr.length; i++) {
        expect(tr[i].yaw).toBeLessThanOrEqual(tr[i - 1].yaw + 1e-9);
        expect(tr[i].yaw).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});
