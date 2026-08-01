// Shared pure predicates and thresholds for cinematic mechanical checks.
// Hosts provide terrain and current ship-frame queries so this module stays
// independent of the DOM, Three.js, and any concrete world implementation.

import {
  HARBORS,
  type HarborDeck,
  type HarborDef,
  type HarborShipBlocker,
  harborRampHeight,
  harborShipLocalBounds,
  harborShipParkedPose,
} from '../harbor_layout';
import type { SceneAttachFrame, SceneRigPoint } from '../types';

export { MIN_PERCEPTUAL_FADE_SECONDS } from './fade_timing';

// Twenty samples per second match the authoring report without tying the gate to render frame rate.
export const SHOT_SAMPLE_RATE_HZ = 20;
// Cameras must keep this vertical distance above the terrain surface.
export const CAMERA_TERRAIN_CLEARANCE_YARDS = 0.75;
// Cameras over submerged terrain must also keep this distance above the water surface.
export const CAMERA_WATER_CLEARANCE_YARDS = 0.75;
// Fixed pier and ramp geometry occupies this much space above its walkable surface.
export const PIER_KEEP_OUT_HEIGHT_YARDS = 3.5;
// Camera collision has a small horizontal radius around fixed pier and ramp footprints.
export const PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS = 0.75;
// Sight lines sample terrain at this fixed world-space interval.
export const SIGHT_LINE_STEP_YARDS = 1;
// Ignore this short segment so a camera resting against geometry does not occlude itself.
export const SIGHT_LINE_NEAR_CAMERA_CLEARANCE_YARDS = 0.25;
// A sight line needs this much room above sampled terrain to avoid grazing the surface.
export const SIGHT_LINE_TERRAIN_MARGIN_YARDS = 0.1;
// A two-yard subject is the shared actor-scale proxy for framing checks.
export const NOMINAL_SUBJECT_HEIGHT_YARDS = 2;
// The lower framing bound prevents subjects from reading as indistinct scenery.
export const MIN_SUBJECT_FRAME_HEIGHT_PERCENT = 5;
// The upper framing bound prevents a nominal actor from filling an unusable amount of the frame.
export const MAX_SUBJECT_FRAME_HEIGHT_PERCENT = 45;
// Look direction may turn no faster than this between consecutive shot samples.
export const MAX_PAN_RATE_DEG_PER_SEC = 60;
// Camera translation may move no faster than this between consecutive shot samples.
export const MAX_DOLLY_SPEED_YARDS_PER_SEC = 30;
// A single 10 Hz position step above this is a pose discontinuity.
export const MAX_POSE_POSITION_STEP_YARDS = 3.5;
// A single 10 Hz orientation step above this is a pose discontinuity.
export const MAX_POSE_ORIENTATION_STEP_DEG = 10;
// A held shot shorter than this reads as an accidental camera twitch.
export const MIN_HELD_SHOT_SECONDS = 1.5;
// A held shot longer than this stalls the cinematic grammar.
export const MAX_HELD_SHOT_SECONDS = 8;
// A visible release may land at most this far from the gameplay camera.
export const MAX_RELEASE_POSITION_DELTA_YARDS = 20;
// A visible release may turn at most this far toward the gameplay camera.
export const MAX_RELEASE_ORIENTATION_DELTA_DEG = 75;
// Screen motion below this normalized-frame rate is treated as stationary.
export const MIN_SHIP_SCREEN_VELOCITY_PER_SEC = 0.01;
// Opposing screen vectors make a vessel appear to travel against its projected world velocity.
export const MIN_SHIP_SCREEN_DIRECTION_DOT = 0;
// A vessel under way below this speed reads as stopped while it remains on camera.
export const MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC = 0.5;
// One hundredth of a yard distinguishes an authored voyage from a stationary prop cue.
export const MIN_PROP_PATH_TRAVEL_YARDS = 0.01;
// Vessel acceleration above this cap reads as a visible lurch.
export const MAX_ON_CAMERA_PROP_ACCELERATION_YARDS_PER_SEC_SQUARED = 4;
// One percent of a normalized half-frame is the minimum meaningful subject travel.
export const MIN_SHOT_SUBJECT_SCREEN_MOTION = 0.01;
// A quarter-yard camera move is the minimum meaningful positional pose change.
export const MIN_SHOT_CAMERA_POSITION_DELTA_YARDS = 0.25;
// Half a degree is the minimum meaningful camera orientation change.
export const MIN_SHOT_CAMERA_ORIENTATION_DELTA_DEG = 0.5;
// Half a percent of a normalized half-frame is the minimum meaningful parallax.
export const MIN_SHOT_PARALLAX = 0.005;
// The parallax probe sits beyond the first visible subject along its view ray.
export const SHOT_PARALLAX_REFERENCE_DEPTH_YARDS = 40;
// The cinematic renderer's default vertical field of view is 60 degrees.
export const CINEMATIC_VERTICAL_FOV_DEG = 60;
// The gate protects the standard widescreen composition used for cinematic review.
export const CINEMATIC_FRAME_ASPECT = 16 / 9;
// Overlay opacity must reach this value before a camera jump is hidden.
export const FULL_BLACK_OPACITY = 1;
// Authored times within this tolerance are treated as lying on a scene boundary.
export const SCENE_TIME_EPSILON_SECONDS = 1e-7;
// The authoritative player collider is a 0.5-yard radius, and the visual is about 2.6 yards tall.
export const PLAYER_BODY_RADIUS_YARDS = 0.5;
export const PLAYER_BODY_HEIGHT_YARDS = 2.6;
// Capture aborts at this duration so a malformed registry entry cannot hang the suite.
export const MAX_SCENE_CAPTURE_SECONDS = 180;
// Arrival paths must begin materially beyond the berth on its layout-derived seaward side.
export const MIN_ARRIVAL_SEAWARD_START_YARDS = 12;
// Arrival travel and the ship's bow must align closely with the direct course to the berth.
export const MIN_ARRIVAL_DIRECTION_DOT = 0.95;
// The final arrival pose must land on the destination berth before the hidden park cue.
export const MAX_ARRIVAL_BERTH_DISTANCE_YARDS = 0.5;
// A berth-anchored glide endpoint must meet the rendered parked position within this tolerance.
export const BERTH_POSE_POSITION_EPSILON_YARDS = 0.01;
// Equivalent berth yaws may differ only by this wrapped angular tolerance.
export const BERTH_POSE_YAW_EPSILON_RADIANS = 0.001;
// Hull terrain probes are close enough to catch a narrow shoreline ridge without slowing watch mode.
export const HULL_TERRAIN_SAMPLE_STEP_YARDS = 2;
// Contact within this tolerance is accepted as a berth seam, not solid penetration.
export const HULL_INTERSECTION_EPSILON_YARDS = 0.01;
// The generated lower-hull blocker straddles the visual skin, so the fixed
// boarding bridge (which deliberately lands ON the hull skin line) may share
// this much of its mating edge while the ship is parked.
export const HULL_GANGWAY_MATING_EPSILON_YARDS = 0.15;
// Feet must remain this close to an authored presentation support surface.
export const ENTITY_SUPPORT_EPSILON_YARDS = 0.1;
// Rider centers may cross a deck edge only by this numerical transform tolerance.
export const RIDER_DECK_EDGE_EPSILON_YARDS = 0.01;
// A captured player delta below this tolerance is treated as stationary.
export const RIDER_WALK_STEP_EPSILON_YARDS = 1e-4;
// A subjectRef must resolve this close to the authored look-at in the horizontal world plane.
export const SUBJECT_REFERENCE_RADIUS_YARDS = 3;
// Subtitle duration floors use this readability ceiling: minimum seconds equals chars divided by CPS.
export const SUBTITLE_READ_TIME_FLOOR_CHARACTERS_PER_SECOND = 20;

export type MechanicalCheck =
  | 'clearance.terrain'
  | 'clearance.water'
  | 'clearance.volume'
  | 'visibility.occlusion'
  | 'framing.size'
  | 'framing.direction'
  | 'motion.panRate'
  | 'motion.dollySpeed'
  | 'motion.poseContinuity'
  | 'motion.cutJump'
  | 'motion.propWay'
  | 'motion.propAcceleration'
  | 'motion.visualFloor'
  | 'cut.heldDuration'
  | 'cut.bracketing'
  | 'cut.firstTransition'
  | 'cut.finalRelease'
  | 'cut.releaseDelta'
  | 'cut.fadeSlack'
  | 'fade.symmetry'
  | 'timing.opWithinDuration'
  | 'cut.teardown'
  | 'continuity.berthPose'
  | 'continuity.shipScreenDirection'
  | 'continuity.standInHandoff'
  | 'prop.segment'
  | 'prop.speed'
  | 'prop.arrivalDirection'
  | 'collision.hull'
  | 'support.entity'
  | 'containment.rider'
  | 'reference.music'
  | 'reference.orphan'
  | 'reference.subject'
  | 'reference.lineKey'
  | 'reference.subtitleReadTime';

export const MECHANICAL_CHECKS = [
  'clearance.terrain',
  'clearance.water',
  'clearance.volume',
  'visibility.occlusion',
  'framing.size',
  'framing.direction',
  'motion.panRate',
  'motion.dollySpeed',
  'motion.poseContinuity',
  'motion.cutJump',
  'motion.propWay',
  'motion.propAcceleration',
  'motion.visualFloor',
  'cut.heldDuration',
  'cut.bracketing',
  'cut.firstTransition',
  'cut.finalRelease',
  'cut.releaseDelta',
  'cut.fadeSlack',
  'fade.symmetry',
  'timing.opWithinDuration',
  'cut.teardown',
  'continuity.berthPose',
  'continuity.shipScreenDirection',
  'continuity.standInHandoff',
  'prop.segment',
  'prop.speed',
  'prop.arrivalDirection',
  'collision.hull',
  'support.entity',
  'containment.rider',
  'reference.music',
  'reference.orphan',
  'reference.subject',
  'reference.lineKey',
  'reference.subtitleReadTime',
] as const satisfies readonly MechanicalCheck[];

type AssertNever<T extends never> = T;
type _EveryMechanicalCheckIsMirrored = AssertNever<
  Exclude<MechanicalCheck, (typeof MECHANICAL_CHECKS)[number]>
>;

export interface Violation {
  readonly sceneId: string;
  readonly check: MechanicalCheck;
  readonly opIndex: number;
  readonly opKind: string;
  readonly time: number;
  readonly threshold: string;
  readonly measured: string;
}

export interface CameraGeometry {
  readonly camera: SceneRigPoint;
  readonly lookAt: SceneRigPoint;
  readonly forward: SceneRigPoint;
  readonly right: SceneRigPoint;
  readonly up: SceneRigPoint;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface FrameProjection {
  readonly horizontal: number;
  readonly vertical: number;
  readonly depth: number;
}

export interface FramingEvaluation {
  readonly frameHeightPercent: number;
  readonly projected: FrameProjection;
  readonly sizePassing: boolean;
  readonly directionPassing: boolean;
}

export const SAMPLE_INTERVAL_SEC = 1 / SHOT_SAMPLE_RATE_HZ;
export const DEG_PER_RAD = 180 / Math.PI;
export const VERTICAL_HALF_FOV_RAD = (CINEMATIC_VERTICAL_FOV_DEG * Math.PI) / 360;
export const HORIZONTAL_HALF_FOV_RAD = Math.atan(
  Math.tan(VERTICAL_HALF_FOV_RAD) * CINEMATIC_FRAME_ASPECT,
);

export function subtract(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(point: SceneRigPoint, factor: number): SceneRigPoint {
  return { x: point.x * factor, y: point.y * factor, z: point.z * factor };
}

export function length(point: SceneRigPoint): number {
  return Math.hypot(point.x, point.y, point.z);
}

export function normalize(point: SceneRigPoint): SceneRigPoint {
  const magnitude = length(point);
  if (magnitude <= 1e-9) return { x: 0, y: 0, z: 0 };
  return scale(point, 1 / magnitude);
}

export function dot(a: SceneRigPoint, b: SceneRigPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: SceneRigPoint, b: SceneRigPoint): SceneRigPoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export function directionAngleDeg(a: SceneRigPoint, b: SceneRigPoint): number {
  return Math.acos(clampUnit(dot(normalize(a), normalize(b)))) * DEG_PER_RAD;
}

export function cameraGeometry(camera: SceneRigPoint, lookAt: SceneRigPoint): CameraGeometry {
  const forward = normalize(subtract(lookAt, camera));
  let right = normalize(cross({ x: 0, y: 1, z: 0 }, forward));
  if (length(right) <= 1e-9) right = { x: 1, y: 0, z: 0 };
  const up = normalize(cross(forward, right));
  return { camera, lookAt, forward, right, up };
}

export function pointInFrame(geometry: CameraGeometry, point: SceneRigPoint): FrameProjection {
  const direction = normalize(subtract(point, geometry.camera));
  const depth = dot(direction, geometry.forward);
  return {
    horizontal: Math.atan2(dot(direction, geometry.right), depth),
    vertical: Math.atan2(dot(direction, geometry.up), depth),
    depth,
  };
}

export function screenPoint(geometry: CameraGeometry, point: SceneRigPoint): ScreenPoint {
  const projected = pointInFrame(geometry, point);
  return {
    x: Math.tan(projected.horizontal) / Math.tan(HORIZONTAL_HALF_FOV_RAD),
    y: Math.tan(projected.vertical) / Math.tan(VERTICAL_HALF_FOV_RAD),
  };
}

export function playerCapsuleIntersectsFrame(
  geometry: CameraGeometry,
  player: { x: number; y: number; z: number },
): boolean {
  const lowerCenterY = player.y + PLAYER_BODY_RADIUS_YARDS;
  const upperCenterY = player.y + PLAYER_BODY_HEIGHT_YARDS - PLAYER_BODY_RADIUS_YARDS;
  const lower = subtract({ x: player.x, y: lowerCenterY, z: player.z }, geometry.camera);
  const upper = subtract({ x: player.x, y: upperCenterY, z: player.z }, geometry.camera);
  const horizontalTan = Math.tan(HORIZONTAL_HALF_FOV_RAD);
  const verticalTan = Math.tan(VERTICAL_HALF_FOV_RAD);
  const inwardPlanes = [
    normalize(add(scale(geometry.forward, horizontalTan), geometry.right)),
    normalize(subtract(scale(geometry.forward, horizontalTan), geometry.right)),
    normalize(add(scale(geometry.forward, verticalTan), geometry.up)),
    normalize(subtract(scale(geometry.forward, verticalTan), geometry.up)),
    geometry.forward,
  ];
  return inwardPlanes.every(
    (normal) => Math.max(dot(lower, normal), dot(upper, normal)) >= -PLAYER_BODY_RADIUS_YARDS,
  );
}

export function evaluateFraming(
  geometry: CameraGeometry,
  subject: SceneRigPoint,
): FramingEvaluation {
  const subjectDistance = length(subtract(subject, geometry.camera));
  const angularHeight =
    2 * Math.atan(NOMINAL_SUBJECT_HEIGHT_YARDS / 2 / Math.max(subjectDistance, 1e-9));
  const frameHeightPercent = (angularHeight / (VERTICAL_HALF_FOV_RAD * 2)) * 100;
  const projected = pointInFrame(geometry, subject);
  return {
    frameHeightPercent,
    projected,
    sizePassing:
      frameHeightPercent >= MIN_SUBJECT_FRAME_HEIGHT_PERCENT &&
      frameHeightPercent <= MAX_SUBJECT_FRAME_HEIGHT_PERCENT,
    directionPassing:
      projected.depth > 0 &&
      Math.abs(projected.horizontal) <= HORIZONTAL_HALF_FOV_RAD &&
      Math.abs(projected.vertical) <= VERTICAL_HALF_FOV_RAD,
  };
}

export interface ShipHullBlocker {
  readonly id: HarborShipBlocker['id'];
  readonly kind: HarborShipBlocker['kind'];
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  readonly rot: number;
  readonly bottomY: number;
  readonly topY: number;
}

const shipHullBlockerCache = new WeakMap<
  HarborDef,
  { readonly waterLevel: number; readonly blockers: readonly ShipHullBlocker[] }
>();
const shipHullVolumeCache = new WeakMap<
  HarborDef,
  { readonly waterLevel: number; readonly volumes: readonly ShipHullBlocker[] }
>();

export interface HullCollision {
  readonly label: string;
  readonly penetration: number;
  readonly volumeId: string;
}

export interface HullWorldQuery {
  readonly waterLevel: number;
  terrainHeight(x: number, z: number, seed: number): number;
}

export interface SupportWorldQuery extends HullWorldQuery {
  shipFrameAt(harbor: HarborDef): SceneAttachFrame;
}

export interface SupportSurface {
  readonly label: string;
  readonly y: number;
}

export interface EntitySupportEvaluation {
  readonly nearest: SupportSurface;
  readonly gap: number;
  readonly passing: boolean;
}

export interface RiderContainmentEvaluation {
  readonly local: SceneRigPoint;
  readonly deckBounds: ReturnType<typeof shipDeckLocalBounds> | null;
  readonly airGap: number | null;
  readonly passing: boolean;
}

export interface BerthPropCue {
  readonly target: string;
  readonly parksTarget: boolean;
}

export type BerthGlideRole = 'departure' | 'arrival';

export interface BerthPoseContinuityEvaluation {
  readonly positionDelta: number;
  readonly yawDelta: number;
  readonly passing: boolean;
}

export const RIDER_HARBOR_BY_TEMPLATE: ReadonlyMap<string, HarborDef['id']> = new Map([
  ['ferryman_ewald', 'mainland'],
  ['ferryman_ewald_gullhaven', 'gullhaven'],
]);

export function settledPlayerHarborForScene(sceneId: string): HarborDef | null {
  const harborId =
    sceneId === 'scn_lb_ferry_depart_back'
      ? 'mainland'
      : sceneId === 'scn_lb_ferry_depart_out' ||
          sceneId === 'scn_lb_q0_ashore' ||
          sceneId === 'scn_lb_q0_voyage'
        ? 'gullhaven'
        : null;
  return harborId === null ? null : (HARBORS.find((harbor) => harbor.id === harborId) ?? null);
}

export function settledPlayerStartForScene(sceneId: string): { x: number; z: number } | null {
  const harbor = settledPlayerHarborForScene(sceneId);
  return harbor ? { ...harbor.deckArrival } : null;
}

export function shipTarget(harbor: HarborDef): string {
  return `harbor_ship_${harbor.id}`;
}

/** Classify chronological harbor cues using the renderer's single-active-ship
 * registry state. An explicit reset makes the latest glide an arrival, while
 * activating another target implicitly returns the prior ship to its berth. */
export function classifyBerthGlideCues(
  cues: readonly BerthPropCue[],
): readonly (BerthGlideRole | null)[] {
  const classifications: (BerthGlideRole | null)[] = cues.map(() => null);
  const activeCueByTarget = new Map<string, number>();
  let activeTarget: string | null = null;

  for (const [cueIndex, cue] of cues.entries()) {
    if (cue.parksTarget) {
      const activeCueIndex = activeCueByTarget.get(cue.target);
      if (activeCueIndex !== undefined) {
        classifications[activeCueIndex] = 'arrival';
        activeCueByTarget.delete(cue.target);
      }
      if (activeTarget === cue.target) activeTarget = null;
      continue;
    }

    if (activeTarget !== null && activeTarget !== cue.target) {
      activeCueByTarget.delete(activeTarget);
    }
    if (!activeCueByTarget.has(cue.target)) {
      classifications[cueIndex] = 'departure';
    }
    activeCueByTarget.set(cue.target, cueIndex);
    activeTarget = cue.target;
  }

  return classifications;
}

export function attachmentLocalToWorld(
  frame: SceneAttachFrame,
  local: SceneRigPoint,
): SceneRigPoint {
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return {
    x: frame.position.x + local.x * cos + local.z * sin,
    y: frame.position.y + local.y,
    z: frame.position.z - local.x * sin + local.z * cos,
  };
}

export function attachmentWorldToLocal(
  frame: SceneAttachFrame,
  point: SceneRigPoint,
): SceneRigPoint {
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

export function parkedShipFrame(harbor: HarborDef, waterLevel: number): SceneAttachFrame {
  const parked = harborShipParkedPose(harbor.berth, waterLevel);
  return {
    position: {
      x: parked.x,
      y: parked.y,
      z: parked.z,
    },
    yaw: parked.yaw,
  };
}

export function evaluateBerthPoseContinuity(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  waterLevel: number,
): BerthPoseContinuityEvaluation {
  const parked = parkedShipFrame(harbor, waterLevel);
  const positionDelta = Math.hypot(
    frame.position.x - parked.position.x,
    frame.position.y - parked.position.y,
    frame.position.z - parked.position.z,
  );
  const yawDelta = Math.abs(
    Math.atan2(Math.sin(frame.yaw - parked.yaw), Math.cos(frame.yaw - parked.yaw)),
  );
  return {
    positionDelta,
    yawDelta,
    passing:
      positionDelta <= BERTH_POSE_POSITION_EPSILON_YARDS &&
      yawDelta <= BERTH_POSE_YAW_EPSILON_RADIANS,
  };
}

export function shipHullBlockers(
  harbor: HarborDef,
  waterLevel: number,
): readonly ShipHullBlocker[] {
  const cached = shipHullBlockerCache.get(harbor);
  if (cached?.waterLevel === waterLevel) return cached.blockers;
  const parked = parkedShipFrame(harbor, waterLevel);
  const bottomY = harborShipLocalBounds(harbor.berth).bottomY;
  const blockers = harbor.shipBlockers.map((blocker) => {
    const center = attachmentWorldToLocal(parked, {
      x: blocker.x,
      y: blocker.cameraTopY,
      z: blocker.z,
    });
    return {
      id: blocker.id,
      kind: blocker.kind,
      x: center.x,
      z: center.z,
      hw: blocker.hw,
      hd: blocker.hd,
      rot: blocker.rot - harbor.berth.rot,
      bottomY,
      topY: center.y,
    };
  });
  shipHullBlockerCache.set(harbor, { waterLevel, blockers });
  return blockers;
}

export function shipHullVolumes(harbor: HarborDef, waterLevel: number): readonly ShipHullBlocker[] {
  const cached = shipHullVolumeCache.get(harbor);
  if (cached?.waterLevel === waterLevel) return cached.volumes;
  const blockers = shipHullBlockers(harbor, waterLevel);
  const lowerHull = blockers.filter((blocker) => blocker.kind === 'lower-hull');
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const blocker of lowerHull) {
    const cos = Math.cos(blocker.rot);
    const sin = Math.sin(blocker.rot);
    for (const along of [-blocker.hw, blocker.hw]) {
      for (const across of [-blocker.hd, blocker.hd]) {
        const x = blocker.x + along * cos + across * sin;
        const z = blocker.z - along * sin + across * cos;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
  }
  if (lowerHull.length === 0) {
    throw new Error(`${harbor.id} generated plan has no lower-hull outline`);
  }
  const body: ShipHullBlocker = {
    id: 'lower-hull-body',
    kind: 'lower-hull',
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    hw: (x1 - x0) / 2,
    hd: (z1 - z0) / 2,
    rot: 0,
    bottomY: Math.min(...lowerHull.map((blocker) => blocker.bottomY)),
    topY: Math.max(...lowerHull.map((blocker) => blocker.topY)),
  };
  const volumes = [...blockers, body];
  shipHullVolumeCache.set(harbor, { waterLevel, volumes });
  return volumes;
}

export function shipHullPointClearance(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  point: SceneRigPoint,
  waterLevel: number,
  horizontalMargin = 0,
  maximumTopY = Number.POSITIVE_INFINITY,
): number {
  const local = attachmentWorldToLocal(frame, point);
  let nearest = Number.POSITIVE_INFINITY;
  for (const blocker of shipHullVolumes(harbor, waterLevel)) {
    const dx = local.x - blocker.x;
    const dz = local.z - blocker.z;
    const cos = Math.cos(blocker.rot);
    const sin = Math.sin(blocker.rot);
    const along = dx * cos - dz * sin;
    const across = dx * sin + dz * cos;
    const clearance = Math.max(
      Math.abs(along) - blocker.hw - horizontalMargin,
      Math.abs(across) - blocker.hd - horizontalMargin,
      blocker.bottomY - local.y,
      local.y - Math.min(blocker.topY, maximumTopY),
    );
    nearest = Math.min(nearest, clearance);
  }
  return nearest;
}

export function shipDeckLocalBounds(
  harbor: HarborDef,
  deck: HarborDeck,
  waterLevel: number,
): { x0: number; x1: number; z0: number; z1: number; centerY: number } {
  const parked = parkedShipFrame(harbor, waterLevel);
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const x of [deck.x - deck.hw, deck.x + deck.hw]) {
    for (const z of [deck.z - deck.hd, deck.z + deck.hd]) {
      const local = attachmentWorldToLocal(parked, { x, y: deck.y, z });
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

function sampledAxis(minimum: number, maximum: number): number[] {
  const span = maximum - minimum;
  const steps = Math.max(1, Math.ceil(span / HULL_TERRAIN_SAMPLE_STEP_YARDS));
  return Array.from({ length: steps + 1 }, (_, index) => minimum + (span * index) / steps);
}

function hullTerrainSamples(
  footprints: readonly ShipHullBlocker[],
): readonly { x: number; z: number; volumeId: string }[] {
  const samples: { x: number; z: number; volumeId: string }[] = [];
  for (const footprint of footprints) {
    const cos = Math.cos(footprint.rot);
    const sin = Math.sin(footprint.rot);
    for (const x of sampledAxis(-footprint.hw, footprint.hw)) {
      for (const z of sampledAxis(-footprint.hd, footprint.hd)) {
        samples.push({
          x: footprint.x + x * cos + z * sin,
          z: footprint.z - x * sin + z * cos,
          volumeId: footprint.id,
        });
      }
    }
  }
  return samples;
}

const hullTerrainSampleCache = new WeakMap<
  HarborDef,
  {
    readonly footprints: readonly ShipHullBlocker[];
    readonly samples: readonly { x: number; z: number; volumeId: string }[];
  }
>();

function cachedHullTerrainSamples(
  harbor: HarborDef,
  footprints: readonly ShipHullBlocker[],
): readonly { x: number; z: number; volumeId: string }[] {
  const cached = hullTerrainSampleCache.get(harbor);
  if (cached?.footprints === footprints) return cached.samples;
  const samples = hullTerrainSamples(footprints);
  hullTerrainSampleCache.set(harbor, { footprints, samples });
  return samples;
}

function hullRectPenetration(
  frame: SceneAttachFrame,
  footprint: ShipHullBlocker,
  rect: { x: number; z: number; hw: number; hd: number },
  tolerance = HULL_INTERSECTION_EPSILON_YARDS,
): number | null {
  const center = attachmentLocalToWorld(frame, {
    x: footprint.x,
    y: 0,
    z: footprint.z,
  });
  const yaw = frame.yaw + footprint.rot;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const localX = { x: cosYaw, z: -sinYaw };
  const localZ = { x: sinYaw, z: cosYaw };
  const delta = { x: rect.x - center.x, z: rect.z - center.z };
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }, localX, localZ];
  let minimumPenetration = Number.POSITIVE_INFINITY;
  for (const axis of axes) {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const hullRadius =
      footprint.hw * Math.abs(localX.x * axis.x + localX.z * axis.z) +
      footprint.hd * Math.abs(localZ.x * axis.x + localZ.z * axis.z);
    const rectRadius = rect.hw * Math.abs(axis.x) + rect.hd * Math.abs(axis.z);
    const penetration = hullRadius + rectRadius - distance;
    if (penetration <= tolerance) return null;
    minimumPenetration = Math.min(minimumPenetration, penetration);
  }
  return minimumPenetration;
}

export function hullWorldCollision(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  seed: number,
  world: HullWorldQuery,
): HullCollision | null {
  const footprints = shipHullVolumes(harbor, world.waterLevel);
  for (const fixedHarbor of HARBORS) {
    for (const [index, deck] of fixedHarbor.decks.entries()) {
      // The harbor's own boarding bridge deliberately mates with the hull
      // skin, so it alone carries the gangway tolerance; every other deck
      // (and any OTHER harbor's bridge) stays a tight seam.
      const tolerance =
        fixedHarbor.id === harbor.id && deck === fixedHarbor.bridge
          ? HULL_GANGWAY_MATING_EPSILON_YARDS
          : HULL_INTERSECTION_EPSILON_YARDS;
      for (const footprint of footprints) {
        const penetration = hullRectPenetration(frame, footprint, deck, tolerance);
        if (penetration !== null) {
          return { label: `${fixedHarbor.id} deck ${index}`, penetration, volumeId: footprint.id };
        }
      }
    }
    for (const [index, ramp] of fixedHarbor.ramps.entries()) {
      for (const footprint of footprints) {
        const penetration = hullRectPenetration(frame, footprint, ramp);
        if (penetration !== null) {
          return { label: `${fixedHarbor.id} ramp ${index}`, penetration, volumeId: footprint.id };
        }
      }
    }
  }

  const bottomY = frame.position.y + Math.min(...footprints.map((footprint) => footprint.bottomY));
  for (const sample of cachedHullTerrainSamples(harbor, footprints)) {
    const point = attachmentLocalToWorld(frame, { x: sample.x, y: 0, z: sample.z });
    const terrainY = world.terrainHeight(point.x, point.z, seed);
    const penetration = terrainY - bottomY;
    if (penetration <= HULL_INTERSECTION_EPSILON_YARDS) continue;
    return {
      label: terrainY < world.waterLevel ? 'water floor' : 'terrain',
      penetration,
      volumeId: sample.volumeId,
    };
  }
  return null;
}

export function pointInsideDeck(deck: HarborDeck, x: number, z: number): boolean {
  return Math.abs(x - deck.x) <= deck.hw && Math.abs(z - deck.z) <= deck.hd;
}

export function supportSurfacesAt(
  point: SceneRigPoint,
  seed: number,
  world: SupportWorldQuery,
): SupportSurface[] {
  const terrainY = world.terrainHeight(point.x, point.z, seed);
  const surfaces: SupportSurface[] = [
    { label: terrainY < world.waterLevel ? 'water floor' : 'terrain', y: terrainY },
  ];
  for (const harbor of HARBORS) {
    for (const deck of harbor.decks) {
      if (pointInsideDeck(deck, point.x, point.z)) {
        surfaces.push({ label: `${harbor.id} pier deck`, y: deck.y });
      }
    }
    const rampY = harborRampHeight(harbor, point.x, point.z);
    if (rampY !== Number.NEGATIVE_INFINITY) {
      surfaces.push({ label: `${harbor.id} ramp`, y: rampY });
    }
    const frame = world.shipFrameAt(harbor);
    const local = attachmentWorldToLocal(frame, point);
    for (const deck of harbor.shipDecks) {
      const bounds = shipDeckLocalBounds(harbor, deck, world.waterLevel);
      if (
        local.x >= bounds.x0 &&
        local.x <= bounds.x1 &&
        local.z >= bounds.z0 &&
        local.z <= bounds.z1
      ) {
        surfaces.push({
          label: `${harbor.id} displaced ship deck`,
          y: frame.position.y + bounds.centerY,
        });
      }
    }
  }
  return surfaces;
}

export function evaluateEntitySupport(
  point: SceneRigPoint,
  surfaces: readonly SupportSurface[],
): EntitySupportEvaluation {
  const nearest = surfaces.reduce((best, candidate) =>
    Math.abs(point.y - candidate.y) < Math.abs(point.y - best.y) ? candidate : best,
  );
  const gap = point.y - nearest.y;
  return {
    nearest,
    gap,
    passing: Math.abs(gap) <= ENTITY_SUPPORT_EPSILON_YARDS,
  };
}

export function deckStandInPoint(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  waterLevel: number,
): SceneRigPoint {
  const bounds = shipDeckLocalBounds(harbor, harbor.shipDecks[0], waterLevel);
  return attachmentLocalToWorld(frame, {
    x: (bounds.x0 + bounds.x1) / 2,
    y: bounds.centerY,
    z: (bounds.z0 + bounds.z1) / 2,
  });
}

export function evaluateRiderContainment(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  point: SceneRigPoint,
  waterLevel: number,
): RiderContainmentEvaluation {
  const local = attachmentWorldToLocal(frame, point);
  for (const deck of harbor.shipDecks) {
    const bounds = shipDeckLocalBounds(harbor, deck, waterLevel);
    const inside =
      local.x >= bounds.x0 - RIDER_DECK_EDGE_EPSILON_YARDS &&
      local.x <= bounds.x1 + RIDER_DECK_EDGE_EPSILON_YARDS &&
      local.z >= bounds.z0 - RIDER_DECK_EDGE_EPSILON_YARDS &&
      local.z <= bounds.z1 + RIDER_DECK_EDGE_EPSILON_YARDS;
    if (!inside) continue;
    const airGap = local.y - bounds.centerY;
    return {
      local,
      deckBounds: bounds,
      airGap,
      passing: Math.abs(airGap) <= ENTITY_SUPPORT_EPSILON_YARDS,
    };
  }
  return {
    local,
    deckBounds: null,
    airGap: null,
    passing: false,
  };
}

export function riderDeckViolation(
  label: string,
  harbor: HarborDef,
  frame: SceneAttachFrame,
  point: SceneRigPoint,
  waterLevel: number,
): string | null {
  const evaluation = evaluateRiderContainment(harbor, frame, point, waterLevel);
  if (evaluation.passing) return null;
  if (evaluation.deckBounds !== null && evaluation.airGap !== null) {
    return `${label} has ${evaluation.airGap.toFixed(2)} yd deck air gap in ${harbor.id}`;
  }
  return `${label} left ${harbor.id} deck bounds at local x ${evaluation.local.x.toFixed(
    2,
  )}, z ${evaluation.local.z.toFixed(2)}`;
}
