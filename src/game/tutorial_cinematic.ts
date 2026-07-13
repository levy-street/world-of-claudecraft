// The starter tutorial's cinematic camera: pure math, no DOM and no Three.
//
// A scene is a list of SHOTS. Each shot is a camera eye position and a look-at
// target that ease from one pose to the next over a duration, so a scene reads as
// a cut-free glide: swing off the player's shoulder, push in on the brush, hold
// while the wolf bursts out, pull back to gameplay.
//
// The renderer already has a free-camera override (`Renderer.freeCam`: an eye plus
// a look target), which the map editor's viewport drives. This module produces the
// same pair, so the host (src/game/tutorial_scenes.ts) just writes the returned
// pose onto it each frame and clears it when the scene ends. Nothing here knows
// what a Renderer is, which is what makes the whole thing Vitest-drivable
// (tests/tutorial_cinematic.test.ts locks the continuity and landing contract).

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** One camera pose: where the eye is, and what it looks at. */
export interface ShotPose {
  eye: Vec3Like;
  target: Vec3Like;
}

export interface Shot {
  /** The pose held at the END of this shot. The shot eases from the previous
   *  shot's pose (or the scene's opening pose, for the first shot) to this one.
   *  Ignored on a `hold` shot, which by definition does not move. */
  to: ShotPose;
  durationSec: number;
  /** A hold shot parks the camera exactly where the previous shot left it, for its
   *  duration. That is the beat the reveal lands on: the camera is already framed
   *  on the brush, and it stays dead still while the wolf comes out of it. Holding
   *  on the INCOMING pose rather than on a `to` of its own is what keeps a scene
   *  cut-free by construction. */
  hold?: true;
  /** Fires once when this shot starts: the cue the host acts on (spawn the wolf,
   *  burst the VFX, speak the line). */
  cue?: string;
}

export interface Scene {
  /** Where the camera starts, normally the live gameplay pose so there is no cut. */
  open: ShotPose;
  shots: Shot[];
}

export function sceneDuration(scene: Scene): number {
  return scene.shots.reduce((sum, s) => sum + s.durationSec, 0);
}

export interface ScenePose extends ShotPose {
  done: boolean;
  /** The index of the shot that is live at this instant, -1 once done. */
  shotIndex: number;
}

/**
 * The camera pose `elapsedSec` into the scene.
 *
 * Continuity: every shot eases from the pose the PREVIOUS shot ended on, so the
 * whole scene is one continuous path with no snap, and the final shot lands
 * exactly on its `to` (which the host sets to the live gameplay pose, so handing
 * control back is invisible).
 */
export function scenePose(elapsedSec: number, scene: Scene): ScenePose {
  let t = Math.max(0, elapsedSec);
  let from = scene.open;

  for (let i = 0; i < scene.shots.length; i++) {
    const shot = scene.shots[i];
    if (t < shot.durationSec || i === scene.shots.length - 1) {
      const done = i === scene.shots.length - 1 && t >= shot.durationSec;
      if (shot.hold) {
        return { eye: from.eye, target: from.target, done, shotIndex: done ? -1 : i };
      }
      const p = shot.durationSec <= 0 ? 1 : clamp01(t / shot.durationSec);
      const e = easeInOutSine(p);
      return {
        eye: lerp3(from.eye, shot.to.eye, e),
        target: lerp3(from.target, shot.to.target, e),
        done,
        shotIndex: done ? -1 : i,
      };
    }
    t -= shot.durationSec;
    // A hold does not move the camera, so the next shot still eases from where the
    // last MOVING shot left it.
    if (!shot.hold) from = shot.to;
  }

  // A scene with no shots is already over.
  return { ...scene.open, done: true, shotIndex: -1 };
}

/** The cue names whose shots START at or before `elapsedSec` but AFTER `prevSec`.
 *  The host polls this each frame and fires each cue exactly once. */
export function cuesBetween(prevSec: number, nowSec: number, scene: Scene): string[] {
  const out: string[] = [];
  let at = 0;
  for (const shot of scene.shots) {
    if (shot.cue !== undefined && at > prevSec && at <= nowSec) out.push(shot.cue);
    at += shot.durationSec;
  }
  return out;
}

/** The eye position that frames `subject` from `dist` yards away, looking in from
 *  bearing `yaw` (radians) and `height` yards up. The workhorse for authoring a
 *  push-in on a thing rather than hand-writing eye coordinates. */
export function frameSubject(
  subject: Vec3Like,
  yaw: number,
  dist: number,
  height: number,
): ShotPose {
  return {
    eye: {
      x: subject.x + Math.sin(yaw) * dist,
      y: subject.y + height,
      z: subject.z + Math.cos(yaw) * dist,
    },
    target: { ...subject },
  };
}

/** The eye/target pair the normal chase camera is sitting at right now. A scene
 *  opens on this and lands back on it, so entering and leaving a cinematic is a
 *  glide rather than a cut. Mirrors the renderer's own orbit math exactly (see
 *  the camera placement in renderer.ts); `tests/tutorial_cinematic.test.ts` pins
 *  the two against each other. */
export function chasePose(
  player: Vec3Like,
  cam: { yaw: number; pitch: number; dist: number },
): ShotPose {
  const eyeY = player.y + CHASE_EYE_HEIGHT;
  return {
    eye: {
      x: player.x - Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      y: eyeY + Math.sin(cam.pitch) * cam.dist,
      z: player.z - Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    },
    target: { x: player.x, y: eyeY, z: player.z },
  };
}

/** The renderer frames the chase camera on a point this far above the player's
 *  feet. Kept in lockstep with renderer.ts's `eyeY`. */
export const CHASE_EYE_HEIGHT = 2.0;

function lerp3(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function easeInOutSine(p: number): number {
  return -(Math.cos(Math.PI * p) - 1) / 2;
}
