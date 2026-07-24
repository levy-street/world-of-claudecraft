// Pure playback core for the Last Bell scene director (scene_director.ts is
// the thin wrapper main.ts drives). Consumes the sim's resolved SceneWireOps
// and produces, per frame, the camera override pose the frame loop applies
// over the input camera, in the spawn_cinematic easing style: a focus shot
// eases from the current camera pose to frame its target over shot.dur and
// holds until the next shot; a release (or the end op) eases back to the
// pre-scene gameplay pose over SCENE_RELEASE_SEC. Time is fed in as seconds
// (no wall clock here), so tests/scene_director_core.test.ts drives any moment
// of a scene directly.
//
// Ops can arrive out of order relative to authoring intent (a skip drops
// presentation ops wholesale), so the end op is the unconditional teardown: it
// ALWAYS releases the input lock and the music silence and starts the camera
// release, whatever state the scene was in.

import type { SceneWireOp } from '../sim/types';

export interface ScenePose {
  yaw: number;
  pitch: number;
  dist: number;
  focusX: number;
  focusY: number;
  focusZ: number;
}

/** The live gameplay camera + player position the frame loop reads each frame. */
export interface SceneLivePose {
  yaw: number;
  pitch: number;
  dist: number;
  playerX: number;
  playerY: number;
  playerZ: number;
}

/** A resolved focus shot (the wire shape minus the discriminants). */
interface SceneFocusShot {
  entityId: number | null;
  x: number;
  y: number;
  z: number;
  dist: number;
  pitch: number;
  yaw: number;
  dur: number;
}

/** Ease-back duration when the camera is handed back to the player. */
export const SCENE_RELEASE_SEC = 0.8;

export interface SceneDirectorState {
  sceneActive: boolean;
  inputLocked: boolean;
  /** The active focus shot (held after its ease completes), or null. */
  shot: SceneFocusShot | null;
  shotStartAt: number;
  releasing: boolean;
  releaseStartAt: number;
  /** Pose eased FROM; latched from the live pose on the first frame after a
   *  camera op when no scene pose was produced yet. */
  from: ScenePose | null;
  /** Gameplay pose captured when the scene first took the camera; the release
   *  eases back to it so user zoom/pitch survive the scene. */
  prePose: { yaw: number; pitch: number; dist: number } | null;
  /** Reused output containers (per-frame path: no allocation). */
  readonly pose: ScenePose;
  readonly last: ScenePose;
  hasLast: boolean;
}

export function createSceneDirectorState(): SceneDirectorState {
  return {
    sceneActive: false,
    inputLocked: false,
    shot: null,
    shotStartAt: 0,
    releasing: false,
    releaseStartAt: 0,
    from: null,
    prePose: null,
    pose: { yaw: 0, pitch: 0, dist: 0, focusX: 0, focusY: 0, focusZ: 0 },
    last: { yaw: 0, pitch: 0, dist: 0, focusX: 0, focusY: 0, focusZ: 0 },
    hasLast: false,
  };
}

/** True while the scene camera owns the pose (a shot is live or releasing). */
export function sceneCameraActive(s: SceneDirectorState): boolean {
  return s.shot !== null || s.releasing;
}

/**
 * Apply one scene op to the director's state. Returns the music directive for
 * a music op (the impure wrapper routes it to the music engine), else null.
 * Presentation ops this director does not own (line/letterbox/fade/anim) are
 * the HUD overlay's and are ignored here.
 */
export function applySceneOp(
  s: SceneDirectorState,
  op: SceneWireOp,
  nowSec: number,
): string | null {
  switch (op.kind) {
    case 'start':
      s.sceneActive = true;
      return null;
    case 'end':
      // Unconditional teardown: release the lock and hand the camera back even
      // if the inputLock(off) / camera release ops never arrived (skip path).
      s.sceneActive = false;
      s.inputLocked = false;
      beginRelease(s, nowSec);
      return null;
    case 'inputLock':
      s.inputLocked = op.on;
      return null;
    case 'camera':
      if (op.shot.kind === 'release') {
        beginRelease(s, nowSec);
      } else {
        // A new shot eases from wherever the camera is NOW (the previous
        // shot's held pose, or the live pose latched on the next frame).
        s.from = s.hasLast ? copyPose(s.last) : null;
        s.shot = op.shot;
        s.shotStartAt = nowSec;
        s.releasing = false;
      }
      return null;
    case 'music':
      return op.directive;
    default:
      return null;
  }
}

function beginRelease(s: SceneDirectorState, nowSec: number): void {
  if (!sceneCameraActive(s)) return;
  if (!s.hasLast) {
    // The camera op never produced a frame (e.g. skip on the arming tick):
    // there is nothing to ease back from, hand the camera straight back.
    clearCamera(s);
    return;
  }
  s.shot = null;
  s.releasing = true;
  s.releaseStartAt = nowSec;
  s.from = copyPose(s.last);
}

function clearCamera(s: SceneDirectorState): void {
  s.shot = null;
  s.releasing = false;
  s.from = null;
  s.prePose = null;
  s.hasLast = false;
}

/**
 * The per-frame camera override. Returns the pose to apply over the input
 * camera (a state-owned reused container), or null when the scene camera is
 * inactive and the normal follow camera owns the frame. `resolveEntity`
 * supplies the live position of a focus target each frame, so a shot tracks a
 * moving actor.
 */
export function scenePose(
  s: SceneDirectorState,
  nowSec: number,
  live: SceneLivePose,
  resolveEntity: (id: number) => { x: number; y: number; z: number } | null,
): ScenePose | null {
  if (!sceneCameraActive(s)) return null;
  const out = s.pose;
  if (s.releasing) {
    const from = s.from;
    if (!from) {
      clearCamera(s);
      return null;
    }
    const t = clamp01((nowSec - s.releaseStartAt) / SCENE_RELEASE_SEC);
    const g = easeInOutSine(t);
    const target = s.prePose ?? live;
    out.yaw = lerpAngle(from.yaw, target.yaw, g);
    out.pitch = lerp(from.pitch, target.pitch, g);
    out.dist = lerp(from.dist, target.dist, g);
    out.focusX = lerp(from.focusX, live.playerX, g);
    out.focusY = lerp(from.focusY, live.playerY, g);
    out.focusZ = lerp(from.focusZ, live.playerZ, g);
    if (t >= 1) {
      // The eased pose has landed exactly on the gameplay pose, so handing the
      // camera back this frame is seamless.
      clearCamera(s);
      return null;
    }
    saveLast(s, out);
    return out;
  }
  const shot = s.shot;
  if (!shot) return null;
  if (s.from === null) {
    // First frame after the camera was taken: ease from the live pose, and
    // remember the gameplay pose to ease back to at release.
    s.from = {
      yaw: live.yaw,
      pitch: live.pitch,
      dist: live.dist,
      focusX: live.playerX,
      focusY: live.playerY,
      focusZ: live.playerZ,
    };
    if (s.prePose === null) s.prePose = { yaw: live.yaw, pitch: live.pitch, dist: live.dist };
  }
  const focus = (shot.entityId !== null ? resolveEntity(shot.entityId) : null) ?? shot;
  const t = shot.dur > 0 ? clamp01((nowSec - s.shotStartAt) / shot.dur) : 1;
  const g = easeInOutSine(t);
  out.yaw = lerpAngle(s.from.yaw, shot.yaw, g);
  out.pitch = lerp(s.from.pitch, shot.pitch, g);
  out.dist = lerp(s.from.dist, shot.dist, g);
  out.focusX = lerp(s.from.focusX, focus.x, g);
  out.focusY = lerp(s.from.focusY, focus.y, g);
  out.focusZ = lerp(s.from.focusZ, focus.z, g);
  saveLast(s, out);
  return out;
}

/**
 * Map an authored music directive to the client action. Only silence/resume
 * are interpreted today; other directives are authored for later phases (theme
 * swaps, stingers) and deliberately no-op until a client interpretation lands.
 */
export type SceneMusicAction = 'silence' | 'resume' | null;

export function sceneMusicAction(directive: string): SceneMusicAction {
  switch (directive) {
    case 'silence':
      return 'silence';
    case 'resume':
      return 'resume';
    default:
      return null;
  }
}

function saveLast(s: SceneDirectorState, pose: ScenePose): void {
  s.last.yaw = pose.yaw;
  s.last.pitch = pose.pitch;
  s.last.dist = pose.dist;
  s.last.focusX = pose.focusX;
  s.last.focusY = pose.focusY;
  s.last.focusZ = pose.focusZ;
  s.hasLast = true;
}

function copyPose(pose: ScenePose): ScenePose {
  return { ...pose };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Yaw interpolates along the shortest arc so a shot never whips the long way round. */
function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

function easeInOutSine(x: number): number {
  return 0.5 - Math.cos(Math.PI * x) / 2;
}
