import { describe, expect, it } from 'vitest';
import {
  cameraFollowShouldSettle,
  cameraIsManual,
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
