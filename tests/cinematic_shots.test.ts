import { describe, expect, it } from 'vitest';
import {
  applySceneOp,
  createSceneDirectorState,
  type SceneLivePose,
  type ScenePose,
  scenePose,
} from '../src/game/scene_director_core';
import {
  sceneRigCameraPosition,
  sceneRigLocalToWorld,
  sceneRigLookAtPosition,
} from '../src/game/scene_rig_core';
import { type PropPathSegment, propPathPoseAt } from '../src/render/prop_path_core';
import { LAST_BELL_PROP_PATH_SEGMENTS } from '../src/sim/content/last_bell_cinematics';
import {
  HARBORS,
  type HarborDeck,
  type HarborDef,
  harborRampHeight,
} from '../src/sim/harbor_layout';
import type { Sim } from '../src/sim/sim';
import type {
  SceneAttachFrame,
  SceneCameraShot,
  SceneRigPoint,
  SceneWireOp,
  SimEvent,
} from '../src/sim/types';
import {
  createSceneOverlayState,
  overlayApplyOp,
  sceneOverlayView,
} from '../src/ui/hud/scene/scene_overlay_view';

// Ten samples per second catch visible motion errors without tying the gate to render frame rate.
const SHOT_SAMPLE_RATE_HZ = 10;
// Cameras must keep this vertical distance above the terrain surface.
const CAMERA_TERRAIN_CLEARANCE_YARDS = 0.75;
// Cameras over submerged terrain must also keep this distance above the water surface.
const CAMERA_WATER_CLEARANCE_YARDS = 0.75;
// Sight lines sample terrain at this fixed world-space interval.
const SIGHT_LINE_STEP_YARDS = 1;
// A sight line needs this much room above sampled terrain to avoid grazing the surface.
const SIGHT_LINE_TERRAIN_MARGIN_YARDS = 0.1;
// A two-yard subject is the shared actor-scale proxy for framing checks.
const NOMINAL_SUBJECT_HEIGHT_YARDS = 2;
// The lower framing bound prevents subjects from reading as indistinct scenery.
const MIN_SUBJECT_FRAME_HEIGHT_PERCENT = 5;
// The upper framing bound prevents a nominal actor from filling an unusable amount of the frame.
const MAX_SUBJECT_FRAME_HEIGHT_PERCENT = 45;
// Look direction may turn no faster than this between consecutive shot samples.
const MAX_PAN_RATE_DEG_PER_SEC = 60;
// Camera translation may move no faster than this between consecutive shot samples.
const MAX_DOLLY_SPEED_YARDS_PER_SEC = 30;
// A single 10 Hz position step above this is a pose discontinuity.
const MAX_POSE_POSITION_STEP_YARDS = 3.5;
// A single 10 Hz orientation step above this is a pose discontinuity.
const MAX_POSE_ORIENTATION_STEP_DEG = 10;
// A held shot shorter than this reads as an accidental camera twitch.
const MIN_HELD_SHOT_SECONDS = 1.5;
// A held shot longer than this stalls the cinematic grammar.
const MAX_HELD_SHOT_SECONDS = 8;
// A visible release may land at most this far from the gameplay camera.
const MAX_RELEASE_POSITION_DELTA_YARDS = 20;
// A visible release may turn at most this far toward the gameplay camera.
const MAX_RELEASE_ORIENTATION_DELTA_DEG = 75;
// Screen motion below this normalized-frame rate is treated as stationary.
const MIN_SHIP_SCREEN_VELOCITY_PER_SEC = 0.01;
// The cinematic renderer's default vertical field of view is 60 degrees.
const CINEMATIC_VERTICAL_FOV_DEG = 60;
// The gate protects the standard widescreen composition used for cinematic review.
const CINEMATIC_FRAME_ASPECT = 16 / 9;
// Overlay opacity must reach this value before a camera jump is hidden.
const FULL_BLACK_OPACITY = 1;
// Capture aborts at this duration so a malformed registry entry cannot hang the suite.
const MAX_SCENE_CAPTURE_SECONDS = 180;
// The linter uses a stable built-in world seed for every registered scene.
const LINTER_WORLD_SEED = 4242;

type MechanicalCheck =
  | 'clearance.terrain'
  | 'clearance.water'
  | 'clearance.volume'
  | 'visibility.terrain'
  | 'framing.size'
  | 'framing.direction'
  | 'motion.panRate'
  | 'motion.dollySpeed'
  | 'motion.poseContinuity'
  | 'motion.cutJump'
  | 'cut.heldDuration'
  | 'cut.bracketing'
  | 'cut.finalRelease'
  | 'cut.releaseDelta'
  | 'continuity.shipScreenDirection'
  | 'prop.segment';

interface LegacyExemption {
  readonly sceneId: string;
  readonly check: MechanicalCheck;
  readonly reason: string;
}

const LEGACY_EXEMPTIONS: readonly LegacyExemption[] = [
  // C5 must clear this by replacing the undersized first return-leg focus transition.
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'framing.size',
    reason: 'The legacy first focus transition begins with the ship below the 5% size floor.',
  },
  // C5 must clear this by keeping the return-leg ship inside the frame from shot start.
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'framing.direction',
    reason: 'The legacy first focus transition begins outside the horizontal frame extent.',
  },
  // C5 must clear this by authoring bounded return-leg camera translation.
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'motion.dollySpeed',
    reason: 'The legacy focus and release moves exceed the 30 yd/s translation cap.',
  },
  // C5 must clear this by removing large return-leg pose steps.
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'motion.poseContinuity',
    reason: 'The legacy focus and release moves exceed the 3.5 yd sample-step limit.',
  },
  // C5 must clear this by authoring a slower return-leg release turn.
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'motion.panRate',
    reason: 'The legacy release turn exceeds the 60 deg/s pan cap.',
  },
  // C5 must clear this by replacing the undersized first outbound focus transition.
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'framing.size',
    reason: 'The legacy first focus transition begins with the ship below the 5% size floor.',
  },
  // C5 must clear this by keeping the outbound ship inside the frame from shot start.
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'framing.direction',
    reason: 'The legacy first focus transition begins behind the camera.',
  },
  // C5 must clear this by authoring bounded outbound camera translation.
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'motion.dollySpeed',
    reason: 'The legacy focus and release moves exceed the 30 yd/s translation cap.',
  },
  // C5 must clear this by removing large outbound pose steps.
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'motion.poseContinuity',
    reason: 'The legacy focus and release moves exceed the 3.5 yd sample-step limit.',
  },
  // C5 must clear this by authoring a slower outbound release turn.
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'motion.panRate',
    reason: 'The legacy release turn exceeds the 60 deg/s pan cap.',
  },
  // C5 must clear this by raising or rerouting the first arrival sight line.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'visibility.terrain',
    reason: 'Terrain blocks the legacy first focus transition sight line.',
  },
  // C5 must clear this by keeping every arrival subject within the size band.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'framing.size',
    reason: 'Legacy arrival transitions cross both undersized and oversized framing.',
  },
  // C5 must clear this by keeping arrival subjects inside the angular frame extents.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'framing.direction',
    reason: 'Legacy arrival transitions place subjects outside the horizontal frame extent.',
  },
  // C5 must clear this by authoring bounded arrival camera translation.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'motion.dollySpeed',
    reason: 'Legacy arrival focus and release moves exceed the 30 yd/s translation cap.',
  },
  // C5 must clear this by removing large arrival pose steps.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'motion.poseContinuity',
    reason: 'Legacy arrival focus and release moves exceed the 3.5 yd sample-step limit.',
  },
  // C5 must clear this by authoring a slower arrival release turn.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'motion.panRate',
    reason: 'The legacy arrival release exceeds the 60 deg/s pan cap.',
  },
  // C5 must clear this by moving arrival cameras outside the live ship deck volume.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'clearance.volume',
    reason: 'Legacy arrival focus shots enter the Gullhaven ship deck clearance margin.',
  },
  // C5 must clear this by handing back near gameplay or under full black.
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'cut.releaseDelta',
    reason: 'The legacy visible release is farther than 20 yd from the gameplay camera.',
  },
  // C5 must clear this by keeping the voyage first focus transition at a sane size.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'framing.size',
    reason: 'Legacy voyage transitions cross both undersized and oversized framing.',
  },
  // C5 must clear this by keeping every voyage subject inside the angular frame extents.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'framing.direction',
    reason: 'Legacy voyage transitions place subjects behind or outside the camera.',
  },
  // C5 must clear this by authoring bounded voyage camera translation.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'motion.dollySpeed',
    reason: 'Legacy voyage focus and release moves exceed the 30 yd/s translation cap.',
  },
  // C5 must clear this by removing large voyage pose steps.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'motion.poseContinuity',
    reason: 'Legacy voyage focus and release moves exceed the 3.5 yd sample-step limit.',
  },
  // C5 must clear this by authoring slower voyage release turns.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'motion.panRate',
    reason: 'Legacy voyage releases exceed the 60 deg/s pan cap.',
  },
  // C5 must clear this by raising or rerouting the arrival-half sight line.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'visibility.terrain',
    reason: 'Terrain blocks the legacy arrival-half first focus transition sight line.',
  },
  // C5 must clear this by moving voyage cameras outside the live ship deck volume.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'clearance.volume',
    reason: 'Legacy arrival-half focus shots enter the Gullhaven ship deck clearance margin.',
  },
  // C5 must clear this by handing back near gameplay or under full black.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'cut.releaseDelta',
    reason: 'The legacy final visible release is farther than 20 yd from gameplay.',
  },
  // C5 must clear this by preserving ship screen direction across visible voyage cuts.
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'continuity.shipScreenDirection',
    reason: 'Legacy arrival cuts reverse the ship screen-velocity sign without a fade.',
  },
];

interface TimedSceneOp {
  readonly index: number;
  readonly at: number;
  readonly op: SceneWireOp;
}

interface EntityPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface SceneFrame {
  readonly live: SceneLivePose;
  readonly entities: ReadonlyMap<number, EntityPoint>;
}

interface CapturedScene {
  readonly id: string;
  readonly seed: number;
  readonly duration: number;
  readonly ops: readonly TimedSceneOp[];
  readonly frames: ReadonlyMap<number, SceneFrame>;
}

interface ActiveProp {
  readonly segment: PropPathSegment;
  readonly startedAt: number;
  readonly timedOp: TimedSceneOp;
}

interface CameraGeometry {
  readonly camera: SceneRigPoint;
  readonly lookAt: SceneRigPoint;
  readonly forward: SceneRigPoint;
  readonly right: SceneRigPoint;
  readonly up: SceneRigPoint;
}

interface CameraSample {
  readonly time: number;
  readonly timedOp: TimedSceneOp;
  readonly pose: ScenePose;
  readonly geometry: CameraGeometry;
  readonly fullBlack: boolean;
  readonly shipScreenX: ReadonlyMap<string, number>;
}

interface ReleaseDelta {
  readonly timedOp: TimedSceneOp;
  readonly time: number;
  readonly fullBlack: boolean;
  readonly position: number;
  readonly orientationDeg: number;
}

interface Violation {
  readonly sceneId: string;
  readonly check: MechanicalCheck;
  readonly opIndex: number;
  readonly opKind: string;
  readonly time: number;
  readonly threshold: string;
  readonly measured: string;
}

const PROP_SEGMENTS: Readonly<Record<string, PropPathSegment | undefined>> =
  LAST_BELL_PROP_PATH_SEGMENTS;
let SimConstructor: typeof import('../src/sim/sim').Sim;
let playRegisteredScene: typeof import('../src/sim/scenes/scenes').playSceneForPlayer;
let readRegisteredSceneIds: typeof import('../src/sim/scenes/scenes').registeredSceneIds;
let sampleTerrainHeight: typeof import('../src/sim/world').terrainHeight;
let runtimeWaterLevel = 0;
const SAMPLE_INTERVAL_SEC = 1 / SHOT_SAMPLE_RATE_HZ;
const DEG_PER_RAD = 180 / Math.PI;
const VERTICAL_HALF_FOV_RAD = (CINEMATIC_VERTICAL_FOV_DEG * Math.PI) / 360;
const HORIZONTAL_HALF_FOV_RAD = Math.atan(Math.tan(VERTICAL_HALF_FOV_RAD) * CINEMATIC_FRAME_ASPECT);

function sceneEvents(events: readonly SimEvent[]): Extract<SimEvent, { type: 'scene' }>[] {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'scene' }> => event.type === 'scene',
  );
}

async function loadLinterRuntime(): Promise<void> {
  const simModule = await import('../src/sim/sim');
  const scenesModule = await import('../src/sim/scenes/scenes');
  const worldModule = await import('../src/sim/world');
  SimConstructor = simModule.Sim;
  playRegisteredScene = scenesModule.playSceneForPlayer;
  readRegisteredSceneIds = scenesModule.registeredSceneIds;
  sampleTerrainHeight = worldModule.terrainHeight;
  runtimeWaterLevel = worldModule.WATER_LEVEL;
}

function trackedEntityId(op: SceneWireOp): number | null {
  if (op.kind !== 'camera') return null;
  if (op.shot.kind === 'focus') return op.shot.entityId;
  if (op.shot.kind === 'dolly' && op.shot.lookAt.kind === 'subject') {
    return op.shot.lookAt.entityId;
  }
  return null;
}

function sceneFrame(sim: Sim, trackedIds: ReadonlySet<number>): SceneFrame {
  const entities = new Map<number, EntityPoint>();
  for (const id of trackedIds) {
    const entity = sim.entities.get(id);
    if (entity) entities.set(id, { ...entity.pos });
  }
  return {
    live: {
      yaw: sim.player.facing,
      pitch: 0.32,
      dist: 12,
      playerX: sim.player.pos.x,
      playerY: sim.player.pos.y,
      playerZ: sim.player.pos.z,
    },
    entities,
  };
}

function captureScene(id: string): CapturedScene {
  const sim = new SimConstructor({
    seed: LINTER_WORLD_SEED,
    playerClass: 'warrior',
    playerName: 'Shot Linter',
  });
  const playbackKey = -sim.playerId;
  expect(
    playRegisteredScene(sim.ctx, sim.playerId, id),
    `failed to start registered scene ${id}`,
  ).toBe(true);
  const startedAt = sim.ctx.scenePlaybacks.get(playbackKey)?.startedAt;
  expect(startedAt, `registered scene ${id} did not create a playback`).toBeDefined();
  const startTime = startedAt ?? sim.time;
  const ops: TimedSceneOp[] = [];
  const trackedIds = new Set<number>();
  const frames = new Map<number, SceneFrame>();
  frames.set(0, sceneFrame(sim, trackedIds));
  let duration: number | null = null;
  let ended = false;
  const maxTicks = Math.ceil(MAX_SCENE_CAPTURE_SECONDS * 20);

  for (let tick = 1; tick <= maxTicks && !ended; tick++) {
    const events = sim.tick();
    const elapsed = sim.time - startTime;
    for (const event of sceneEvents(events)) {
      if (event.sceneId !== id || event.pid !== sim.playerId) continue;
      const at = event.op.kind === 'start' ? 0 : roundTime(elapsed);
      const timedOp = { index: ops.length, at, op: event.op };
      ops.push(timedOp);
      const entityId = trackedEntityId(event.op);
      if (entityId !== null) trackedIds.add(entityId);
      if (event.op.kind === 'start') duration = event.op.duration;
      if (event.op.kind === 'end') ended = true;
    }
    if (tick % 2 === 0) {
      frames.set(Math.round(elapsed * SHOT_SAMPLE_RATE_HZ), sceneFrame(sim, trackedIds));
    }
  }

  expect(ended, `registered scene ${id} exceeded the capture limit`).toBe(true);
  expect(duration, `registered scene ${id} emitted no start duration`).not.toBeNull();
  return {
    id,
    seed: sim.cfg.seed,
    duration: duration ?? 0,
    ops,
    frames,
  };
}

function roundTime(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function frameAt(scene: CapturedScene, time: number): SceneFrame {
  const index = Math.max(0, Math.round(time * SHOT_SAMPLE_RATE_HZ));
  const direct = scene.frames.get(index);
  if (direct) return direct;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const frame = scene.frames.get(cursor);
    if (frame) return frame;
  }
  throw new Error(`scene ${scene.id} has no captured frame at ${time.toFixed(2)}s`);
}

function copyPose(pose: ScenePose): ScenePose {
  return {
    yaw: pose.yaw,
    pitch: pose.pitch,
    dist: pose.dist,
    focusX: pose.focusX,
    focusY: pose.focusY,
    focusZ: pose.focusZ,
  };
}

function subtract(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(point: SceneRigPoint, factor: number): SceneRigPoint {
  return { x: point.x * factor, y: point.y * factor, z: point.z * factor };
}

function length(point: SceneRigPoint): number {
  return Math.hypot(point.x, point.y, point.z);
}

function normalize(point: SceneRigPoint): SceneRigPoint {
  const magnitude = length(point);
  if (magnitude <= 1e-9) return { x: 0, y: 0, z: 0 };
  return scale(point, 1 / magnitude);
}

function dot(a: SceneRigPoint, b: SceneRigPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function directionAngleDeg(a: SceneRigPoint, b: SceneRigPoint): number {
  return Math.acos(clampUnit(dot(normalize(a), normalize(b)))) * DEG_PER_RAD;
}

function geometryForPose(pose: ScenePose): CameraGeometry {
  const camera = sceneRigCameraPosition(pose);
  const lookAt = sceneRigLookAtPosition(pose);
  const forward = normalize(subtract(lookAt, camera));
  let right = normalize(cross({ x: 0, y: 1, z: 0 }, forward));
  if (length(right) <= 1e-9) right = { x: 1, y: 0, z: 0 };
  const up = normalize(cross(forward, right));
  return { camera, lookAt, forward, right, up };
}

function pointInFrame(
  geometry: CameraGeometry,
  point: SceneRigPoint,
): { horizontal: number; vertical: number; depth: number } {
  const direction = normalize(subtract(point, geometry.camera));
  const depth = dot(direction, geometry.forward);
  return {
    horizontal: Math.atan2(dot(direction, geometry.right), depth),
    vertical: Math.atan2(dot(direction, geometry.up), depth),
    depth,
  };
}

function screenX(geometry: CameraGeometry, point: SceneRigPoint): number {
  const projected = pointInFrame(geometry, point);
  return Math.tan(projected.horizontal) / Math.tan(HORIZONTAL_HALF_FOV_RAD);
}

function subjectForShot(
  shot: Exclude<SceneCameraShot, { kind: 'release' }>,
  pose: ScenePose,
  resolveEntity: (id: number) => EntityPoint | null,
): SceneRigPoint {
  if (shot.kind !== 'focus') return sceneRigLookAtPosition(pose);
  const focus = (shot.entityId !== null ? resolveEntity(shot.entityId) : null) ?? shot;
  return {
    x: focus.x,
    y: focus.y + NOMINAL_SUBJECT_HEIGHT_YARDS,
    z: focus.z,
  };
}

function propPose(
  target: string,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): { x: number; y: number; z: number; yaw: number } {
  const active = activeProps.get(target);
  if (!active) return { x: 0, y: 0, z: 0, yaw: 0 };
  return propPathPoseAt(active.segment, time - active.startedAt);
}

function worldToLocal(frame: SceneAttachFrame, point: SceneRigPoint): SceneRigPoint {
  const dx = point.x - frame.position.x;
  const dz = point.z - frame.position.z;
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return {
    x: dx * cos - dz * sin,
    y: point.y - frame.position.y,
    z: dx * sin + dz * cos,
  };
}

function shipTarget(harbor: HarborDef): string {
  return `harbor_ship_${harbor.id}`;
}

function shipFrameAt(
  harbor: HarborDef,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): SceneAttachFrame {
  const pose = propPose(shipTarget(harbor), time, activeProps);
  const yaw = harbor.berth.rot + pose.yaw;
  const translated = sceneRigLocalToWorld(
    {
      position: {
        x: harbor.berth.x,
        y: runtimeWaterLevel - harbor.berth.draft,
        z: harbor.berth.z,
      },
      yaw,
    },
    { x: pose.x, y: pose.y, z: pose.z },
    { x: 0, y: 0, z: 0 },
  );
  return { position: translated, yaw };
}

function parkedShipFrame(harbor: HarborDef): SceneAttachFrame {
  return {
    position: {
      x: harbor.berth.x,
      y: runtimeWaterLevel - harbor.berth.draft,
      z: harbor.berth.z,
    },
    yaw: harbor.berth.rot,
  };
}

function shipDeckLocalBounds(
  harbor: HarborDef,
  deck: HarborDeck,
): { x0: number; x1: number; z0: number; z1: number; centerY: number } {
  const parked = parkedShipFrame(harbor);
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const x of [deck.x - deck.hw, deck.x + deck.hw]) {
    for (const z of [deck.z - deck.hd, deck.z + deck.hd]) {
      const local = worldToLocal(parked, { x, y: deck.y, z });
      x0 = Math.min(x0, local.x);
      x1 = Math.max(x1, local.x);
      z0 = Math.min(z0, local.z);
      z1 = Math.max(z1, local.z);
    }
  }
  return {
    x0,
    x1,
    z0,
    z1,
    centerY: deck.y - parked.position.y,
  };
}

function shipDeckCenterAt(
  harbor: HarborDef,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): SceneRigPoint {
  const deck = harbor.shipDecks[0];
  const bounds = shipDeckLocalBounds(harbor, deck);
  return sceneRigLocalToWorld(
    shipFrameAt(harbor, time, activeProps),
    {
      x: (bounds.x0 + bounds.x1) / 2,
      y: bounds.centerY,
      z: (bounds.z0 + bounds.z1) / 2,
    },
    { x: 0, y: 0, z: 0 },
  );
}

function cameraVolumeIntrusion(
  camera: SceneRigPoint,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): { label: string; clearance: number } | null {
  for (const harbor of HARBORS) {
    for (const deck of harbor.decks) {
      if (Math.abs(camera.x - deck.x) > deck.hw || Math.abs(camera.z - deck.z) > deck.hd) {
        continue;
      }
      const clearance = camera.y - deck.y;
      if (clearance < CAMERA_TERRAIN_CLEARANCE_YARDS) {
        return { label: `${harbor.id} deck`, clearance };
      }
    }
    const rampY = harborRampHeight(harbor, camera.x, camera.z);
    if (rampY !== Number.NEGATIVE_INFINITY) {
      const clearance = camera.y - rampY;
      if (clearance < CAMERA_TERRAIN_CLEARANCE_YARDS) {
        return { label: `${harbor.id} ramp`, clearance };
      }
    }
    const liveFrame = shipFrameAt(harbor, time, activeProps);
    const localCamera = worldToLocal(liveFrame, camera);
    for (const deck of harbor.shipDecks) {
      const bounds = shipDeckLocalBounds(harbor, deck);
      if (
        localCamera.x < bounds.x0 ||
        localCamera.x > bounds.x1 ||
        localCamera.z < bounds.z0 ||
        localCamera.z > bounds.z1
      ) {
        continue;
      }
      const clearance = localCamera.y - bounds.centerY;
      if (clearance < CAMERA_TERRAIN_CLEARANCE_YARDS) {
        return { label: `${harbor.id} live ship deck`, clearance };
      }
    }
  }
  return null;
}

function sightLineClearance(camera: SceneRigPoint, subject: SceneRigPoint, seed: number): number {
  const delta = subtract(subject, camera);
  const distance = length(delta);
  let minimum = Number.POSITIVE_INFINITY;
  for (
    let traveled = SIGHT_LINE_STEP_YARDS;
    traveled < distance - SIGHT_LINE_STEP_YARDS * 0.5;
    traveled += SIGHT_LINE_STEP_YARDS
  ) {
    const point = add(camera, scale(delta, traveled / distance));
    const clearance =
      point.y - sampleTerrainHeight(point.x, point.z, seed) - SIGHT_LINE_TERRAIN_MARGIN_YARDS;
    minimum = Math.min(minimum, clearance);
  }
  return minimum;
}

function opKind(op: SceneWireOp): string {
  return op.kind === 'camera' ? `camera/${op.shot.kind}` : op.kind;
}

function violationMessage(violation: Violation): string {
  return `${violation.sceneId} op ${violation.opIndex} (${violation.opKind}) at ${violation.time.toFixed(
    2,
  )}s: ${violation.check} requires ${violation.threshold}, measured ${violation.measured}`;
}

function lintScene(scene: CapturedScene, report: (violation: Violation) => void): CameraSample[] {
  const director = createSceneDirectorState();
  const overlay = createSceneOverlayState();
  const activeProps = new Map<string, ActiveProp>();
  const propTargets = new Set<string>();
  for (const timed of scene.ops) {
    if (timed.op.kind === 'prop') propTargets.add(timed.op.target);
  }
  const cameraOps = scene.ops.filter(
    (timed): timed is TimedSceneOp & { op: Extract<SceneWireOp, { kind: 'camera' }> } =>
      timed.op.kind === 'camera',
  );
  const shotOps = cameraOps.filter((timed) => timed.op.shot.kind !== 'release');
  const finalRelease = cameraOps.at(-1);
  const endOp =
    [...scene.ops].reverse().find((timed) => timed.op.kind === 'end') ?? scene.ops.at(-1);
  const releases: ReleaseDelta[] = [];
  const samples: CameraSample[] = [];

  for (const shot of shotOps) {
    const nextCamera = cameraOps.find(
      (candidate) => candidate.index > shot.index && candidate.at >= shot.at,
    );
    const held = (nextCamera?.at ?? scene.duration) - shot.at;
    if (held < MIN_HELD_SHOT_SECONDS) {
      report({
        sceneId: scene.id,
        check: 'cut.heldDuration',
        opIndex: shot.index,
        opKind: opKind(shot.op),
        time: shot.at,
        threshold: `at least ${MIN_HELD_SHOT_SECONDS.toFixed(2)}s held`,
        measured: `${held.toFixed(2)}s`,
      });
    }
    if (held > MAX_HELD_SHOT_SECONDS) {
      report({
        sceneId: scene.id,
        check: 'cut.heldDuration',
        opIndex: shot.index,
        opKind: opKind(shot.op),
        time: shot.at,
        threshold: `at most ${MAX_HELD_SHOT_SECONDS.toFixed(2)}s held`,
        measured: `${held.toFixed(2)}s`,
      });
    }
  }

  if (shotOps.length > 0 && finalRelease?.op.shot.kind !== 'release') {
    const context = finalRelease ?? shotOps.at(-1);
    if (context) {
      report({
        sceneId: scene.id,
        check: 'cut.finalRelease',
        opIndex: context.index,
        opKind: opKind(context.op),
        time: context.at,
        threshold: 'the final camera op to be camera/release',
        measured: opKind(context.op),
      });
    }
  }

  let opCursor = 0;
  let currentCameraOp: TimedSceneOp | null = null;
  let firstShotBracketChecked = false;
  let previous: CameraSample | null = null;
  const sampleCount = Math.ceil(scene.duration * SHOT_SAMPLE_RATE_HZ);

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
    const time = Math.min(scene.duration, sampleIndex * SAMPLE_INTERVAL_SEC);
    while (opCursor < scene.ops.length && scene.ops[opCursor].at <= time + 1e-7) {
      const timed = scene.ops[opCursor++];
      if (timed.op.kind === 'camera' && timed.op.shot.kind !== 'release') {
        if (!firstShotBracketChecked) {
          const overlayModel = sceneOverlayView(overlay, timed.at);
          if (!overlayModel.cinematic || !overlayModel.letterbox || !director.inputLocked) {
            report({
              sceneId: scene.id,
              check: 'cut.bracketing',
              opIndex: timed.index,
              opKind: opKind(timed.op),
              time: timed.at,
              threshold: 'cinematic HUD mode, letterbox, and input lock before the first shot',
              measured: `cinematic=${overlayModel.cinematic}, letterbox=${overlayModel.letterbox}, inputLock=${director.inputLocked}`,
            });
          }
          firstShotBracketChecked = true;
        }
      }
      if (timed.op.kind === 'camera' && timed.op.shot.kind === 'release' && director.hasLast) {
        const live = frameAt(scene, timed.at).live;
        const fromPose = copyPose(director.last);
        const gameplayPose: ScenePose = {
          yaw: live.yaw,
          pitch: live.pitch,
          dist: live.dist,
          focusX: live.playerX,
          focusY: live.playerY,
          focusZ: live.playerZ,
        };
        const fromGeometry = geometryForPose(fromPose);
        const gameplayGeometry = geometryForPose(gameplayPose);
        releases.push({
          timedOp: timed,
          time: timed.at,
          fullBlack: sceneOverlayView(overlay, timed.at).fadeOpacity >= FULL_BLACK_OPACITY,
          position: length(subtract(fromGeometry.camera, gameplayGeometry.camera)),
          orientationDeg: directionAngleDeg(fromGeometry.forward, gameplayGeometry.forward),
        });
      }
      if (timed.op.kind === 'prop') {
        const segment = PROP_SEGMENTS[timed.op.cue];
        if (!segment) {
          report({
            sceneId: scene.id,
            check: 'prop.segment',
            opIndex: timed.index,
            opKind: opKind(timed.op),
            time: timed.at,
            threshold: 'a registered pure prop path segment',
            measured: `missing cue ${timed.op.cue}`,
          });
        } else {
          activeProps.set(timed.op.target, {
            segment,
            startedAt: timed.at,
            timedOp: timed,
          });
        }
      }
      overlayApplyOp(overlay, timed.op, timed.at);
      applySceneOp(director, timed.op, timed.at);
      if (timed.op.kind === 'camera') currentCameraOp = timed;
    }

    for (const active of activeProps.values()) {
      const evaluated = propPathPoseAt(active.segment, time - active.startedAt);
      if (
        !Number.isFinite(evaluated.x) ||
        !Number.isFinite(evaluated.y) ||
        !Number.isFinite(evaluated.z) ||
        !Number.isFinite(evaluated.yaw)
      ) {
        report({
          sceneId: scene.id,
          check: 'prop.segment',
          opIndex: active.timedOp.index,
          opKind: opKind(active.timedOp.op),
          time,
          threshold: 'finite x, y, z, and yaw from the pure prop evaluator',
          measured: `x=${evaluated.x}, y=${evaluated.y}, z=${evaluated.z}, yaw=${evaluated.yaw}`,
        });
      }
    }

    const frame = frameAt(scene, time);
    const resolveEntity = (id: number): EntityPoint | null => frame.entities.get(id) ?? null;
    const resolveAttachment = (target: string): SceneAttachFrame | null => {
      const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
      return harbor ? shipFrameAt(harbor, time, activeProps) : null;
    };
    const pose = scenePose(director, time, frame.live, resolveEntity, resolveAttachment);
    const overlayModel = sceneOverlayView(overlay, time);
    if (!pose || !currentCameraOp) {
      previous = null;
      continue;
    }
    const poseCopy = copyPose(pose);
    const geometry = geometryForPose(poseCopy);
    const fullBlack = overlayModel.fadeOpacity >= FULL_BLACK_OPACITY;
    const shipScreenPositions = new Map<string, number>();
    for (const target of propTargets) {
      const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
      if (!harbor) continue;
      shipScreenPositions.set(
        target,
        screenX(geometry, shipDeckCenterAt(harbor, time, activeProps)),
      );
    }
    const sample: CameraSample = {
      time,
      timedOp: currentCameraOp,
      pose: poseCopy,
      geometry,
      fullBlack,
      shipScreenX: shipScreenPositions,
    };
    samples.push(sample);

    const terrainY = sampleTerrainHeight(geometry.camera.x, geometry.camera.z, scene.seed);
    const terrainClearance = geometry.camera.y - terrainY;
    if (terrainClearance < CAMERA_TERRAIN_CLEARANCE_YARDS) {
      report({
        sceneId: scene.id,
        check: 'clearance.terrain',
        opIndex: currentCameraOp.index,
        opKind: opKind(currentCameraOp.op),
        time,
        threshold: `${CAMERA_TERRAIN_CLEARANCE_YARDS.toFixed(2)} yd above terrain`,
        measured: `${terrainClearance.toFixed(2)} yd`,
      });
    }
    if (terrainY < runtimeWaterLevel) {
      const waterClearance = geometry.camera.y - runtimeWaterLevel;
      if (waterClearance < CAMERA_WATER_CLEARANCE_YARDS) {
        report({
          sceneId: scene.id,
          check: 'clearance.water',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `${CAMERA_WATER_CLEARANCE_YARDS.toFixed(2)} yd above WATER_LEVEL`,
          measured: `${waterClearance.toFixed(2)} yd`,
        });
      }
    }
    const intrusion = cameraVolumeIntrusion(geometry.camera, time, activeProps);
    if (intrusion) {
      report({
        sceneId: scene.id,
        check: 'clearance.volume',
        opIndex: currentCameraOp.index,
        opKind: opKind(currentCameraOp.op),
        time,
        threshold: `${CAMERA_TERRAIN_CLEARANCE_YARDS.toFixed(2)} yd outside or above harbor volumes`,
        measured: `${intrusion.clearance.toFixed(2)} yd over ${intrusion.label}`,
      });
    }

    const activeShot = director.shot;
    if (activeShot) {
      const subject = subjectForShot(activeShot, poseCopy, resolveEntity);
      const sightClearance = sightLineClearance(geometry.camera, subject, scene.seed);
      if (sightClearance < 0) {
        report({
          sceneId: scene.id,
          check: 'visibility.terrain',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `${SIGHT_LINE_TERRAIN_MARGIN_YARDS.toFixed(2)} yd terrain margin at ${SIGHT_LINE_STEP_YARDS.toFixed(2)} yd steps`,
          measured: `${sightClearance.toFixed(2)} yd minimum clearance`,
        });
      }
      const subjectDistance = length(subtract(subject, geometry.camera));
      const angularHeight =
        2 * Math.atan(NOMINAL_SUBJECT_HEIGHT_YARDS / 2 / Math.max(subjectDistance, 1e-9));
      const frameHeightPercent = (angularHeight / (VERTICAL_HALF_FOV_RAD * 2)) * 100;
      if (
        frameHeightPercent < MIN_SUBJECT_FRAME_HEIGHT_PERCENT ||
        frameHeightPercent > MAX_SUBJECT_FRAME_HEIGHT_PERCENT
      ) {
        report({
          sceneId: scene.id,
          check: 'framing.size',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `${MIN_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(1)}% to ${MAX_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(1)}% of frame height`,
          measured: `${frameHeightPercent.toFixed(2)}%`,
        });
      }
      const projected = pointInFrame(geometry, subject);
      if (
        projected.depth <= 0 ||
        Math.abs(projected.horizontal) > HORIZONTAL_HALF_FOV_RAD ||
        Math.abs(projected.vertical) > VERTICAL_HALF_FOV_RAD
      ) {
        report({
          sceneId: scene.id,
          check: 'framing.direction',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `subject direction within horizontal ${(
            HORIZONTAL_HALF_FOV_RAD * DEG_PER_RAD
          ).toFixed(1)} deg and vertical ${(VERTICAL_HALF_FOV_RAD * DEG_PER_RAD).toFixed(
            1,
          )} deg half extents`,
          measured: `horizontal ${(projected.horizontal * DEG_PER_RAD).toFixed(1)} deg, vertical ${(
            projected.vertical * DEG_PER_RAD
          ).toFixed(1)} deg, depth ${projected.depth.toFixed(3)}`,
        });
      }
    }

    if (previous) {
      const dt = time - previous.time;
      const positionStep = length(subtract(geometry.camera, previous.geometry.camera));
      const orientationStep = directionAngleDeg(geometry.forward, previous.geometry.forward);
      if (previous.timedOp.index === currentCameraOp.index) {
        const dollySpeed = positionStep / dt;
        const panRate = orientationStep / dt;
        if (dollySpeed > MAX_DOLLY_SPEED_YARDS_PER_SEC) {
          report({
            sceneId: scene.id,
            check: 'motion.dollySpeed',
            opIndex: currentCameraOp.index,
            opKind: opKind(currentCameraOp.op),
            time,
            threshold: `at most ${MAX_DOLLY_SPEED_YARDS_PER_SEC.toFixed(1)} yd/s`,
            measured: `${dollySpeed.toFixed(2)} yd/s`,
          });
        }
        if (panRate > MAX_PAN_RATE_DEG_PER_SEC) {
          report({
            sceneId: scene.id,
            check: 'motion.panRate',
            opIndex: currentCameraOp.index,
            opKind: opKind(currentCameraOp.op),
            time,
            threshold: `at most ${MAX_PAN_RATE_DEG_PER_SEC.toFixed(1)} deg/s`,
            measured: `${panRate.toFixed(2)} deg/s`,
          });
        }
        if (
          !Number.isFinite(positionStep) ||
          !Number.isFinite(orientationStep) ||
          positionStep > MAX_POSE_POSITION_STEP_YARDS ||
          orientationStep > MAX_POSE_ORIENTATION_STEP_DEG
        ) {
          report({
            sceneId: scene.id,
            check: 'motion.poseContinuity',
            opIndex: currentCameraOp.index,
            opKind: opKind(currentCameraOp.op),
            time,
            threshold: `steps at most ${MAX_POSE_POSITION_STEP_YARDS.toFixed(
              1,
            )} yd and ${MAX_POSE_ORIENTATION_STEP_DEG.toFixed(1)} deg`,
            measured: `${positionStep.toFixed(2)} yd and ${orientationStep.toFixed(2)} deg`,
          });
        }
      } else if (
        (positionStep > MAX_POSE_POSITION_STEP_YARDS ||
          orientationStep > MAX_POSE_ORIENTATION_STEP_DEG) &&
        !fullBlack
      ) {
        report({
          sceneId: scene.id,
          check: 'motion.cutJump',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `full black for a jump above ${MAX_POSE_POSITION_STEP_YARDS.toFixed(
            1,
          )} yd or ${MAX_POSE_ORIENTATION_STEP_DEG.toFixed(1)} deg`,
          measured: `${positionStep.toFixed(2)} yd, ${orientationStep.toFixed(
            2,
          )} deg, fade ${overlayModel.fadeOpacity.toFixed(3)}`,
        });
      }
    }
    previous = sample;
  }

  if (shotOps.length > 0 && endOp) {
    const finalOverlay = sceneOverlayView(overlay, scene.duration);
    if (director.inputLocked || finalOverlay.letterbox || finalOverlay.cinematic) {
      report({
        sceneId: scene.id,
        check: 'cut.bracketing',
        opIndex: endOp.index,
        opKind: opKind(endOp.op),
        time: scene.duration,
        threshold: 'input lock, letterbox, and cinematic HUD mode cleared by end',
        measured: `cinematic=${finalOverlay.cinematic}, letterbox=${finalOverlay.letterbox}, inputLock=${director.inputLocked}`,
      });
    }
  }

  const finalReleaseDelta = [...releases]
    .reverse()
    .find((release) => release.timedOp.index === finalRelease?.index);
  if (finalReleaseDelta && !finalReleaseDelta.fullBlack) {
    if (finalReleaseDelta.position > MAX_RELEASE_POSITION_DELTA_YARDS) {
      report({
        sceneId: scene.id,
        check: 'cut.releaseDelta',
        opIndex: finalReleaseDelta.timedOp.index,
        opKind: opKind(finalReleaseDelta.timedOp.op),
        time: finalReleaseDelta.time,
        threshold: `${MAX_RELEASE_POSITION_DELTA_YARDS.toFixed(
          1,
        )} yd release position delta or full black`,
        measured: `${finalReleaseDelta.position.toFixed(2)} yd at fade 0`,
      });
    }
    if (finalReleaseDelta.orientationDeg > MAX_RELEASE_ORIENTATION_DELTA_DEG) {
      report({
        sceneId: scene.id,
        check: 'cut.releaseDelta',
        opIndex: finalReleaseDelta.timedOp.index,
        opKind: opKind(finalReleaseDelta.timedOp.op),
        time: finalReleaseDelta.time,
        threshold: `${MAX_RELEASE_ORIENTATION_DELTA_DEG.toFixed(
          1,
        )} deg release orientation delta or full black`,
        measured: `${finalReleaseDelta.orientationDeg.toFixed(2)} deg at fade 0`,
      });
    }
  }

  lintShipScreenContinuity(scene, cameraOps, samples, report);
  return samples;
}

function lintShipScreenContinuity(
  scene: CapturedScene,
  cameraOps: readonly TimedSceneOp[],
  samples: readonly CameraSample[],
  report: (violation: Violation) => void,
): void {
  interface DirectionSummary {
    firstSign: number;
    lastSign: number;
    firstTime: number;
    lastTime: number;
    timedOp: TimedSceneOp;
  }

  const shotOrder = new Map(
    cameraOps
      .filter((timed) => timed.op.kind === 'camera' && timed.op.shot.kind !== 'release')
      .map((timed, index) => [timed.index, index]),
  );
  const byTarget = new Map<string, Map<number, DirectionSummary>>();

  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous.timedOp.index !== current.timedOp.index) continue;
    const dt = current.time - previous.time;
    for (const [target, currentX] of current.shipScreenX) {
      const previousX = previous.shipScreenX.get(target);
      if (previousX === undefined) continue;
      const velocity = (currentX - previousX) / dt;
      if (Math.abs(velocity) < MIN_SHIP_SCREEN_VELOCITY_PER_SEC) continue;
      const sign = Math.sign(velocity);
      let byShot = byTarget.get(target);
      if (!byShot) {
        byShot = new Map();
        byTarget.set(target, byShot);
      }
      const summary = byShot.get(current.timedOp.index);
      if (summary) {
        summary.lastSign = sign;
        summary.lastTime = current.time;
      } else {
        byShot.set(current.timedOp.index, {
          firstSign: sign,
          lastSign: sign,
          firstTime: current.time,
          lastTime: current.time,
          timedOp: current.timedOp,
        });
      }
    }
  }

  for (const summaries of byTarget.values()) {
    const ordered = [...summaries.values()].sort((a, b) => a.firstTime - b.firstTime);
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousOrder = shotOrder.get(previous.timedOp.index);
      const currentOrder = shotOrder.get(current.timedOp.index);
      if (
        previousOrder === undefined ||
        currentOrder === undefined ||
        currentOrder !== previousOrder + 1
      ) {
        continue;
      }
      const fadeSeparates = samples.some(
        (sample) =>
          sample.time >= previous.lastTime && sample.time <= current.firstTime && sample.fullBlack,
      );
      if (previous.lastSign !== current.firstSign && !fadeSeparates) {
        report({
          sceneId: scene.id,
          check: 'continuity.shipScreenDirection',
          opIndex: current.timedOp.index,
          opKind: opKind(current.timedOp.op),
          time: current.firstTime,
          threshold: 'the same non-zero horizontal ship screen velocity sign across the cut',
          measured: `${previous.lastSign} before and ${current.firstSign} after`,
        });
      }
    }
  }
}

describe('cinematic shot mechanical gate', () => {
  for (const exemption of LEGACY_EXEMPTIONS) {
    it.skip(`${exemption.sceneId} ${exemption.check}: ${exemption.reason}`, () => {});
  }

  it('samples every registered scene at 10 Hz against the mechanical rubric', async () => {
    await loadLinterRuntime();
    const ids = readRegisteredSceneIds();
    expect(ids.length, 'the Last Bell scene registry must not be empty').toBeGreaterThan(0);
    const exemptionKeys = new Set(
      LEGACY_EXEMPTIONS.map((row) => `${row.sceneId}\u0000${row.check}`),
    );
    const exercisedExemptions = new Set<string>();
    const failures: Violation[] = [];
    const reportedFailures = new Set<string>();

    const report = (violation: Violation): void => {
      const exemptionKey = `${violation.sceneId}\u0000${violation.check}`;
      if (exemptionKeys.has(exemptionKey)) {
        exercisedExemptions.add(exemptionKey);
        return;
      }
      const failureKey = `${exemptionKey}\u0000${violation.opIndex}`;
      if (reportedFailures.has(failureKey)) return;
      reportedFailures.add(failureKey);
      failures.push(violation);
    };

    for (const id of ids) lintScene(captureScene(id), report);

    const staleExemptions = LEGACY_EXEMPTIONS.filter(
      (row) => !exercisedExemptions.has(`${row.sceneId}\u0000${row.check}`),
    );
    const messages = failures.map(violationMessage);
    for (const stale of staleExemptions) {
      messages.push(
        `${stale.sceneId} legacy exemption ${stale.check} is stale and must be removed`,
      );
    }
    expect(messages, messages.join('\n')).toEqual([]);
  });
});
