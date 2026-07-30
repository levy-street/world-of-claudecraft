// Pure camera-rig math for Last Bell scenes. Authored and resolved inputs are
// plain numbers, time is injected, and the output matches ScenePose without
// importing the director or any render runtime.

import type { SceneAttachFrame, SceneRigCameraShot, SceneRigPoint } from '../sim/types';

export interface SceneRigPose {
  yaw: number;
  pitch: number;
  dist: number;
  focusX: number;
  focusY: number;
  focusZ: number;
}

export type SceneEntityResolver = (id: number) => SceneRigPoint | null;
export type SceneAttachmentResolver = (
  target: string,
  out?: SceneAttachFrame,
  presentationTimeSec?: number,
) => SceneAttachFrame | null;

export interface SceneRigEaseFrom {
  pose: SceneRigPose;
  duration: number;
}

const EPSILON = 1e-8;
// The renderer aims two yards above a ScenePose focus anchor. Rig look-at
// tracks are exact world points, so the handoff removes that renderer offset.
const SCENE_FOCUS_HEIGHT = 2;
const CAMERA_POINT: SceneRigPoint = { x: 0, y: 0, z: 0 };
const LOOK_AT_POINT: SceneRigPoint = { x: 0, y: 0, z: 0 };
const ATTACH_FRAME: SceneAttachFrame = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
};

/**
 * Evaluate one dolly or attach shot at an injected elapsed time. The optional
 * output container keeps the director's per-frame handoff reusable.
 */
export function evaluateSceneRigPose(
  shot: SceneRigCameraShot,
  elapsedSec: number,
  resolveEntity: SceneEntityResolver,
  resolveAttachment: SceneAttachmentResolver,
  out?: SceneRigPose,
  easeFrom?: SceneRigEaseFrom,
  attachmentTimeSec?: number,
): SceneRigPose {
  const pose = out ?? emptyPose();
  if (shot.kind === 'attach') {
    const frame =
      resolveAttachment(shot.target, ATTACH_FRAME, attachmentTimeSec) ?? shot.fallbackFrame;
    const camera = localToWorld(frame, shot.offset, CAMERA_POINT);
    const lookAt = localToWorld(frame, shot.lookAt, LOOK_AT_POINT);
    poseFromWorldPoints(camera, lookAt, pose);
    return easeRigPoseFrom(pose, elapsedSec, easeFrom);
  }

  const t = shot.dur > 0 ? clamp01(elapsedSec / shot.dur) : 1;
  const eased = sceneCameraEase(t);
  const camera = sampleCatmullRom(shot.points, eased, CAMERA_POINT);
  let lookAt: SceneRigPoint;
  switch (shot.lookAt.kind) {
    case 'point':
      lookAt = shot.lookAt.point;
      break;
    case 'spline':
      lookAt = sampleCatmullRom(shot.lookAt.points, eased, LOOK_AT_POINT);
      break;
    case 'subject': {
      const subject = shot.lookAt.entityId !== null ? resolveEntity(shot.lookAt.entityId) : null;
      if (!subject) {
        lookAt = shot.lookAt.fallback;
        break;
      }
      LOOK_AT_POINT.x = subject.x + shot.lookAt.offset.x;
      LOOK_AT_POINT.y = subject.y + shot.lookAt.offset.y;
      LOOK_AT_POINT.z = subject.z + shot.lookAt.offset.z;
      lookAt = LOOK_AT_POINT;
      break;
    }
  }
  poseFromWorldPoints(camera, lookAt, pose);
  return easeRigPoseFrom(pose, elapsedSec, easeFrom);
}

/**
 * Sample a piecewise centripetal Catmull-Rom spline. Normalized progress is
 * divided evenly between authored spans, while square-root chord knots shape each
 * cubic span and repeated points remain finite.
 */
export function sampleCatmullRom(
  points: readonly SceneRigPoint[],
  progress: number,
  out?: SceneRigPoint,
): SceneRigPoint {
  const point = out ?? { x: 0, y: 0, z: 0 };
  if (points.length === 0) {
    point.x = 0;
    point.y = 0;
    point.z = 0;
    return point;
  }
  if (points.length === 1 || progress <= 0) return copyPoint(points[0], point);
  if (progress >= 1) return copyPoint(points[points.length - 1], point);

  const scaled = clamp01(progress) * (points.length - 1);
  const segment = Math.min(Math.floor(scaled), points.length - 2);
  const localT = scaled - segment;
  const p0 = points[Math.max(0, segment - 1)];
  const p1 = points[segment];
  const p2 = points[segment + 1];
  const p3 = points[Math.min(points.length - 1, segment + 2)];
  const t0 = 0;
  const t1 = t0 + knotInterval(p0, p1);
  const t2 = t1 + knotInterval(p1, p2);
  const t3 = t2 + knotInterval(p2, p3);
  const t = t1 + (t2 - t1) * localT;

  point.x = catmullCoordinate(p0.x, p1.x, p2.x, p3.x, t0, t1, t2, t3, t);
  point.y = catmullCoordinate(p0.y, p1.y, p2.y, p3.y, t0, t1, t2, t3, t);
  point.z = catmullCoordinate(p0.z, p1.z, p2.z, p3.z, t0, t1, t2, t3, t);
  return point;
}

/** Recover the unclamped world camera position represented by a ScenePose. */
export function sceneRigCameraPosition(pose: SceneRigPose, out?: SceneRigPoint): SceneRigPoint {
  const point = out ?? { x: 0, y: 0, z: 0 };
  const horizontal = Math.cos(pose.pitch) * pose.dist;
  point.x = pose.focusX - Math.sin(pose.yaw) * horizontal;
  point.y = pose.focusY + SCENE_FOCUS_HEIGHT + Math.sin(pose.pitch) * pose.dist;
  point.z = pose.focusZ - Math.cos(pose.yaw) * horizontal;
  return point;
}

/** Recover the world look-at point represented by a ScenePose. */
export function sceneRigLookAtPosition(pose: SceneRigPose, out?: SceneRigPoint): SceneRigPoint {
  const point = out ?? { x: 0, y: 0, z: 0 };
  point.x = pose.focusX;
  point.y = pose.focusY + SCENE_FOCUS_HEIGHT;
  point.z = pose.focusZ;
  return point;
}

/** The established scene-camera ease shared by authored motion and release. */
export function sceneCameraEase(value: number): number {
  return 0.5 - Math.cos(Math.PI * value) / 2;
}

function easeRigPoseFrom(
  authored: SceneRigPose,
  elapsedSec: number,
  easeFrom: SceneRigEaseFrom | undefined,
): SceneRigPose {
  if (!easeFrom) return authored;
  const t = easeFrom.duration > 0 ? clamp01(elapsedSec / easeFrom.duration) : 1;
  if (t >= 1) return authored;
  const g = sceneCameraEase(t);
  const from = easeFrom.pose;
  authored.yaw = lerpAngle(from.yaw, authored.yaw, g);
  authored.pitch = lerp(from.pitch, authored.pitch, g);
  authored.dist = lerp(from.dist, authored.dist, g);
  authored.focusX = lerp(from.focusX, authored.focusX, g);
  authored.focusY = lerp(from.focusY, authored.focusY, g);
  authored.focusZ = lerp(from.focusZ, authored.focusZ, g);
  return authored;
}

function poseFromWorldPoints(
  camera: SceneRigPoint,
  lookAt: SceneRigPoint,
  out: SceneRigPose,
): SceneRigPose {
  const dx = camera.x - lookAt.x;
  const dy = camera.y - lookAt.y;
  const dz = camera.z - lookAt.z;
  const dist = Math.hypot(dx, dy, dz);
  out.dist = dist;
  out.focusX = lookAt.x;
  out.focusY = lookAt.y - SCENE_FOCUS_HEIGHT;
  out.focusZ = lookAt.z;
  if (dist <= EPSILON) {
    out.yaw = 0;
    out.pitch = 0;
    return out;
  }
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.asin(Math.min(1, Math.max(-1, dy / dist)));
  return out;
}

function localToWorld(
  frame: SceneAttachFrame,
  local: SceneRigPoint,
  out: SceneRigPoint,
): SceneRigPoint {
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  out.x = frame.position.x + local.x * cos + local.z * sin;
  out.y = frame.position.y + local.y;
  out.z = frame.position.z - local.x * sin + local.z * cos;
  return out;
}

/** Transform one point from an attachment's local frame into world coordinates. */
export { localToWorld as sceneRigLocalToWorld };

function knotInterval(a: SceneRigPoint, b: SceneRigPoint): number {
  const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return Math.max(EPSILON, Math.sqrt(chord));
}

function catmullCoordinate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): number {
  const a1 = interpolateKnot(p0, p1, t0, t1, t);
  const a2 = interpolateKnot(p1, p2, t1, t2, t);
  const a3 = interpolateKnot(p2, p3, t2, t3, t);
  const b1 = interpolateKnot(a1, a2, t0, t2, t);
  const b2 = interpolateKnot(a2, a3, t1, t3, t);
  return interpolateKnot(b1, b2, t1, t2, t);
}

function interpolateKnot(a: number, b: number, ta: number, tb: number, t: number): number {
  const span = tb - ta;
  return ((tb - t) / span) * a + ((t - ta) / span) * b;
}

function copyPoint(from: SceneRigPoint, to: SceneRigPoint): SceneRigPoint {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  return to;
}

function emptyPose(): SceneRigPose {
  return { yaw: 0, pitch: 0, dist: 0, focusX: 0, focusY: 0, focusZ: 0 };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}
