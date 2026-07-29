import { describe, expect, it } from 'vitest';
import {
  cameraFollowShouldSettle,
  cameraIsManual,
  isRespawnFacingResyncEdge,
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
    // untouched: chasing its own output is what produced the wobble.
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
    expect(cameraIsManual(false, false)).toBe(false); // classic, hands off, follow runs
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

  describe('respawn/release-spirit facing resync', () => {
    it('flags the release-spirit and revive edges (ghost rises, or dead clears), not death itself', () => {
      // release-spirit: dead stays true, ghost rises false -> true.
      expect(isRespawnFacingResyncEdge(true, false, true, true)).toBe(true);
      // any revive (corpse rez, spirit healer, instance reentry, delve respawn):
      // dead flips true -> false, whether or not a ghost stage preceded it.
      expect(isRespawnFacingResyncEdge(true, true, false, false)).toBe(true);
      expect(isRespawnFacingResyncEdge(true, false, false, false)).toBe(true);
      // dying itself (alive -> dead) does not force a facing reset: no edge.
      expect(isRespawnFacingResyncEdge(false, false, true, false)).toBe(false);
      // steady states: no edge.
      expect(isRespawnFacingResyncEdge(false, false, false, false)).toBe(false);
      expect(isRespawnFacingResyncEdge(true, true, true, true)).toBe(false);
    });

    // Reproduces the bug numerically: the sim-side facing=0/prevFacing=0 pairing
    // makes the render-interpolated facing land cleanly on 0, but the camera's
    // OWN lastInterpFacing (tracked in main.ts, independent of the entity) still
    // holds the pre-death heading. The rigid-follow term reads that as a turn,
    // but because lastInterpFacing re-syncs to interpFacing every call regardless
    // of whether camYaw caught up, only ONE frame's worth of the correction is
    // ever applied before the term goes quiet again: a spurious partial turn that
    // sticks. This is why a prevFacing-only fix does not reliably resolve it: the
    // stale value lives on the camera side, not the sim.
    it('without a resync, a stale camera lastInterpFacing applies one spurious partial turn after a respawn', () => {
      const dt = 1 / 60;
      // Camera was settled in behind the player before death (camYaw in sync with
      // the pre-death facing).
      let camYaw = 2.5;
      let lastInterpFacing: number | null = 2.5;
      // Respawn/release-spirit forces facing (now also prevFacing, per the sim
      // fix) to 0; the player does not move afterward (moving stays false).
      for (let f = 0; f < 10; f++) {
        const next = updateFollowCameraYaw({
          camYaw,
          interpFacing: 0,
          lastInterpFacing,
          frameDt: dt,
          mouselook: false,
          moving: false,
          orbiting: false,
        });
        camYaw = next.camYaw;
        lastInterpFacing = next.lastInterpFacing;
      }
      // The large gap from facing 0 (camYaw stays near 2.5) is expected: the
      // rigid-follow term only settles the camera while the player is moving,
      // and that persists after the fix too. What the fix removes is the ONE
      // spurious capped step (~0.06 rad at MAX_AUTO_YAW_SPEED) the stale
      // lastInterpFacing otherwise applies on this frame, dropping camYaw from
      // 2.5 to about 2.44 before the term goes quiet again.
      expect(camYaw).toBeGreaterThan(2.2);
      expect(camYaw).toBeLessThan(2.5);
    });

    it('resyncing lastInterpFacing on the respawn edge (mirroring the click-to-move release resync) leaves the camera exactly where it was, no spurious partial turn', () => {
      const dt = 1 / 60;
      let camYaw = 2.5;
      let lastInterpFacing: number | null = 2.5;
      let prevDead = true;
      let prevGhost = false;
      // The revive edge (dead: true -> false) lands on this frame; main.ts
      // detects it via isRespawnFacingResyncEdge and resyncs before calling
      // updateFollowCameraYaw, exactly like the click-to-move release resync.
      const dead = false;
      const ghost = false;
      if (isRespawnFacingResyncEdge(prevDead, prevGhost, dead, ghost)) {
        lastInterpFacing = 0; // this frame's interpFacing
      }
      prevDead = dead;
      prevGhost = ghost;
      for (let f = 0; f < 10; f++) {
        const next = updateFollowCameraYaw({
          camYaw,
          interpFacing: 0,
          lastInterpFacing,
          frameDt: dt,
          mouselook: false,
          moving: false,
          orbiting: false,
        });
        camYaw = next.camYaw;
        lastInterpFacing = next.lastInterpFacing;
      }
      // No spurious jump or stuck offset: the camera holds its pre-respawn yaw
      // (the player has not moved, so nothing has asked the camera to turn).
      expect(camYaw).toBeCloseTo(2.5, 6);
    });
  });
});
