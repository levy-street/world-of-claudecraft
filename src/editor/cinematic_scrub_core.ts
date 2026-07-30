// Deterministic scene seeking for the editor Cinematic panel. Every result is
// rebuilt from the authored definition, the selected scene time, and an
// injected world snapshot. The runtime camera, overlay, and prop-path pure
// evaluators remain the only owners of interpolation math.

import {
  applySceneOp,
  createSceneDirectorState,
  type SceneLivePose,
  scenePose,
} from '../game/scene_director_core';
import {
  type SceneRigPose,
  sceneRigCameraPosition,
  sceneRigLookAtPosition,
} from '../game/scene_rig_core';
import { composeHarborShipAttachFrame } from '../render/harbor_ship_attach_core';
import { type PropPathSample, propPathPoseAt } from '../render/prop_path_core';
import {
  LAST_BELL_PROP_PATH_SEGMENTS,
  type LastBellPropPathSegmentId,
} from '../sim/content/last_bell_cinematics';
import { HARBORS } from '../sim/harbor_layout';
import { NOMINAL_SUBJECT_HEIGHT_YARDS } from '../sim/scenes/lint_core';
import type { SceneDef, SceneOpDef, SceneRigPointDef } from '../sim/scenes/registry';
import {
  DT,
  type SceneAttachFrame,
  type SceneCameraShot,
  type SceneDollyLookAt,
  type SceneRigCameraShot,
  type SceneRigPoint,
  type SceneWireOp,
} from '../sim/types';
import { WATER_LEVEL } from '../sim/world';
import {
  createSceneOverlayState,
  overlayApplyOp,
  sceneOverlayView,
} from '../ui/hud/scene/scene_overlay_view';

const TIME_EPSILON = 1e-9;

export interface CinematicSceneOption {
  readonly id: string;
  readonly duration: number;
}

export interface CinematicCameraPose {
  readonly position: SceneRigPoint;
  readonly target: SceneRigPoint;
}

export interface CinematicPropCue {
  readonly target: string;
  readonly cue: LastBellPropPathSegmentId;
  readonly startedAt: number;
  readonly pose: PropPathSample;
}

export interface CinematicScrubWorld {
  readonly live: SceneLivePose;
  groundY(x: number, z: number): number;
  actorPoint(actorId: string): SceneRigPoint | null;
  attachmentFrameAt?(target: string, timeSec: number): SceneAttachFrame | null;
}

export interface CinematicScrubFrame {
  readonly timeSec: number;
  readonly camera: CinematicCameraPose | null;
  readonly subject: SceneRigPoint | null;
  readonly propCues: readonly CinematicPropCue[];
  readonly overlay: {
    readonly fadeOpacity: number;
    readonly letterbox: boolean;
    readonly cinematic: boolean;
  };
}

type CameraOp = Extract<SceneOpDef, { kind: 'camera' }>;
type CameraShotDef = CameraOp['shot'];

export function cinematicLivePoseFromCamera(pose: CinematicCameraPose): SceneLivePose {
  const dx = pose.position.x - pose.target.x;
  const dy = pose.position.y - pose.target.y;
  const dz = pose.position.z - pose.target.z;
  const dist = Math.hypot(dx, dy, dz);
  const yaw = dist > 0 ? Math.atan2(-dx, -dz) : 0;
  return {
    yaw: Object.is(yaw, -0) ? 0 : yaw,
    pitch: dist > 0 ? Math.asin(clamp(dy / dist, -1, 1)) : 0,
    dist,
    playerX: pose.target.x,
    playerY: pose.target.y - 2,
    playerZ: pose.target.z,
  };
}

export function cinematicSceneOptions(
  ids: readonly string[],
  sceneForId: (id: string) => SceneDef | undefined,
): CinematicSceneOption[] {
  const options: CinematicSceneOption[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const scene = sceneForId(id);
    if (scene) options.push({ id: scene.id, duration: scene.duration });
  }
  return options;
}

export function advanceCinematicPlayhead(
  currentSec: number,
  deltaSec: number,
  durationSec: number,
): number {
  const current = Number.isFinite(currentSec) ? currentSec : 0;
  const delta = Number.isFinite(deltaSec) ? deltaSec : 0;
  return clamp(current + delta, 0, safeDuration(durationSec));
}

/** Sample the same fixed 20 Hz clock that scene presentation reads at runtime. */
export function sampleCinematicTime(timeSec: number, durationSec: number): number {
  const duration = safeDuration(durationSec);
  const clamped = clamp(Number.isFinite(timeSec) ? timeSec : 0, 0, duration);
  if (clamped >= duration) return duration;
  return Math.floor((clamped + TIME_EPSILON) / DT) * DT;
}

export function evaluateCinematicScrubFrame(
  scene: SceneDef,
  requestedTimeSec: number,
  world: CinematicScrubWorld,
): CinematicScrubFrame {
  const timeSec = sampleCinematicTime(requestedTimeSec, scene.duration);
  const camera = evaluateCamera(scene, timeSec, world);
  return {
    timeSec,
    camera,
    subject: camera?.subject ?? null,
    propCues: activePropCues(scene, timeSec),
    overlay: evaluateOverlay(scene, timeSec),
  };
}

function evaluateOverlay(scene: SceneDef, timeSec: number): CinematicScrubFrame['overlay'] {
  const state = createSceneOverlayState();
  overlayApplyOp(state, { kind: 'start', duration: scene.duration }, 0);
  for (const op of scene.ops) {
    if (op.at > timeSec + TIME_EPSILON) break;
    const wire = overlayWireOp(op);
    if (!wire) continue;
    // An interrupting fade starts from the opacity reached at this exact
    // authored time, matching the runtime overlay's per-frame update order.
    sceneOverlayView(state, op.at);
    overlayApplyOp(state, wire, op.at);
  }
  if (timeSec >= scene.duration) overlayApplyOp(state, { kind: 'end' }, timeSec);
  const model = sceneOverlayView(state, timeSec);
  return {
    fadeOpacity: model.fadeOpacity,
    letterbox: model.letterbox,
    cinematic: model.cinematic,
  };
}

function overlayWireOp(op: SceneOpDef): SceneWireOp | null {
  switch (op.kind) {
    case 'fade':
      return { kind: 'fade', to: op.to, dur: op.dur };
    case 'inputLock':
      return { kind: 'inputLock', on: op.on };
    case 'letterbox':
      return { kind: 'letterbox', on: op.on };
    default:
      return null;
  }
}

function evaluateCamera(
  scene: SceneDef,
  timeSec: number,
  world: CinematicScrubWorld,
): (CinematicCameraPose & { readonly subject: SceneRigPoint | null }) | null {
  if (timeSec >= scene.duration) return null;
  const state = createSceneDirectorState();
  applySceneOp(state, { kind: 'start', duration: scene.duration }, 0);
  const cameraOps = scene.ops.filter((op): op is CameraOp => op.kind === 'camera');
  let cameraIndex = 0;
  let currentTick = 0;
  let pose: SceneRigPose | null = null;
  const tickCount = Math.round(timeSec / DT);
  const resolveAttachment = (target: string, out?: SceneAttachFrame): SceneAttachFrame | null => {
    const frame =
      world.attachmentFrameAt?.(target, currentTick) ??
      harborAttachmentFrameAt(scene, target, currentTick);
    if (!frame) return null;
    if (!out) {
      return {
        position: { ...frame.position },
        yaw: frame.yaw,
      };
    }
    out.position.x = frame.position.x;
    out.position.y = frame.position.y;
    out.position.z = frame.position.z;
    out.yaw = frame.yaw;
    return out;
  };

  for (let tickIndex = 0; tickIndex <= tickCount; tickIndex++) {
    currentTick = tickIndex * DT;
    while (
      cameraIndex < cameraOps.length &&
      cameraOps[cameraIndex].at <= currentTick + TIME_EPSILON
    ) {
      const op = cameraOps[cameraIndex++];
      applySceneOp(
        state,
        {
          kind: 'camera',
          shot: resolveCameraShot(op.shot, world),
        },
        currentTick,
      );
    }
    pose = scenePose(state, currentTick, world.live, () => null, resolveAttachment);
  }

  if (!pose) return null;
  const target = { ...sceneRigLookAtPosition(pose) };
  const subject =
    state.shot?.kind === 'focus'
      ? {
          x: state.shot.x,
          y: state.shot.y + NOMINAL_SUBJECT_HEIGHT_YARDS,
          z: state.shot.z,
        }
      : state.shot
        ? target
        : null;
  return {
    position: { ...sceneRigCameraPosition(pose) },
    target,
    subject,
  };
}

function resolveCameraShot(shot: CameraShotDef, world: CinematicScrubWorld): SceneCameraShot {
  if (shot.kind === 'release') return { kind: 'release' };
  if (shot.kind === 'attach') {
    return {
      kind: 'attach',
      target: shot.target,
      fallbackFrame: {
        position: resolveRigPoint(shot.fallbackFrame.point, world),
        yaw: shot.fallbackFrame.yaw,
      },
      offset: shot.offset,
      lookAt: shot.lookAt,
    };
  }
  if (shot.kind === 'dolly') {
    let lookAt: SceneDollyLookAt;
    switch (shot.lookAt.kind) {
      case 'point':
        lookAt = { kind: 'point', point: resolveRigPoint(shot.lookAt.point, world) };
        break;
      case 'spline':
        lookAt = {
          kind: 'spline',
          points: shot.lookAt.points.map((point) => resolveRigPoint(point, world)),
        };
        break;
      case 'subject': {
        const subject = world.actorPoint(shot.lookAt.actorId);
        lookAt = {
          kind: 'subject',
          entityId: null,
          offset: shot.lookAt.offset,
          fallback: subject
            ? {
                x: subject.x + shot.lookAt.offset.x,
                y: subject.y + shot.lookAt.offset.y,
                z: subject.z + shot.lookAt.offset.z,
              }
            : resolveRigPoint(shot.lookAt.fallback, world),
        };
        break;
      }
    }
    const resolved: SceneRigCameraShot = {
      kind: 'dolly',
      points: shot.points.map((point) => resolveRigPoint(point, world)),
      lookAt,
      dur: shot.dur,
    };
    return resolved;
  }
  const subject = shot.actorId ? world.actorPoint(shot.actorId) : null;
  const x = subject?.x ?? shot.x ?? 0;
  const z = subject?.z ?? shot.z ?? 0;
  return {
    kind: 'focus',
    entityId: null,
    x,
    y: subject?.y ?? world.groundY(x, z),
    z,
    dist: shot.dist ?? 8,
    pitch: shot.pitch ?? 0.3,
    yaw: shot.yaw ?? 0,
    dur: shot.dur,
  };
}

function resolveRigPoint(point: SceneRigPointDef, world: CinematicScrubWorld): SceneRigPoint {
  return {
    x: point.x,
    y: world.groundY(point.x, point.z) + point.height,
    z: point.z,
  };
}

function activePropCues(scene: SceneDef, timeSec: number): CinematicPropCue[] {
  if (timeSec >= scene.duration) return [];
  const active = new Map<
    string,
    { cue: LastBellPropPathSegmentId; startedAt: number; pose: PropPathSample }
  >();
  for (const op of scene.ops) {
    if (op.at > timeSec + TIME_EPSILON) break;
    if (op.kind !== 'prop') continue;
    const cue = op.cue;
    if (!(cue in LAST_BELL_PROP_PATH_SEGMENTS)) {
      active.delete(op.target);
      continue;
    }
    // The runtime harbor cue registry permits one moving ship at a time.
    active.clear();
    const segment = LAST_BELL_PROP_PATH_SEGMENTS[cue as LastBellPropPathSegmentId];
    active.set(op.target, {
      cue: cue as LastBellPropPathSegmentId,
      startedAt: op.at,
      pose: { ...propPathPoseAt(segment, timeSec - op.at) },
    });
  }
  return [...active].map(([target, cue]) => ({ target, ...cue }));
}

function harborAttachmentFrameAt(
  scene: SceneDef,
  target: string,
  timeSec: number,
): SceneAttachFrame | null {
  const harbor = HARBORS.find((candidate) => `harbor_ship_${candidate.id}` === target);
  if (!harbor) return null;
  const active = activePropCues(scene, timeSec).find((cue) => cue.target === target);
  return composeHarborShipAttachFrame(
    {
      baseX: harbor.berth.x,
      baseY: WATER_LEVEL - harbor.berth.draft,
      baseZ: harbor.berth.z,
      baseRot: harbor.berth.rot,
    },
    active?.pose ?? null,
    {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    },
  );
}

function safeDuration(durationSec: number): number {
  return Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
