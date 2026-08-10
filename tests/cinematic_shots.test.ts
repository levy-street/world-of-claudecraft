import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  measureArrivalApproach,
  measureSegment,
} from '../scripts/lib/cinematic_trajectory_geometry.mjs';
import {
  applySceneOp,
  createSceneDirectorState,
  SCENE_RIG_ENTRY_SEC,
  type SceneLivePose,
  type ScenePose,
  scenePose,
  sceneShotEasesFromLivePose,
} from '../src/game/scene_director_core';
import {
  evaluateSceneRigPose,
  sceneRigCameraPosition,
  sceneRigLocalToWorld,
  sceneRigLookAtPosition,
} from '../src/game/scene_rig_core';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import {
  type HarborDeckRiderResolution,
  resolveHarborDeckRider,
} from '../src/render/harbor_deck_rider_core';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import { type PropPathSegment, propPathPoseAt } from '../src/render/prop_path_core';
import {
  LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC,
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  LB_PROP_CUE_PARK,
} from '../src/sim/content/last_bell_cinematics';
import { PROPS } from '../src/sim/data';
import {
  HARBORS,
  type HarborDef,
  harborRampHeight,
  harborShipParkedPose,
  MAINLAND_HARBOR,
} from '../src/sim/harbor_layout';
import {
  add,
  BERTH_POSE_POSITION_EPSILON_YARDS,
  BERTH_POSE_YAW_EPSILON_RADIANS,
  CAMERA_TERRAIN_CLEARANCE_YARDS,
  CAMERA_WATER_CLEARANCE_YARDS,
  type CameraGeometry,
  cameraGeometry,
  classifyBerthGlideCues,
  DEG_PER_RAD,
  deckStandInPoint,
  directionAngleDeg,
  ENTITY_SUPPORT_EPSILON_YARDS,
  evaluateBerthPoseContinuity,
  evaluateEntitySupport,
  evaluateFraming,
  FULL_BLACK_OPACITY,
  HORIZONTAL_HALF_FOV_RAD,
  HULL_GANGWAY_MATING_EPSILON_YARDS,
  HULL_INTERSECTION_EPSILON_YARDS,
  HULL_TERRAIN_SAMPLE_STEP_YARDS,
  hullWorldCollision,
  length,
  MAX_ARRIVAL_BERTH_DISTANCE_YARDS,
  MAX_ARRIVAL_YAW_SWING_RADIANS,
  MAX_DOLLY_SPEED_YARDS_PER_SEC,
  MAX_HELD_SHOT_SECONDS,
  MAX_ON_CAMERA_PROP_ACCELERATION_YARDS_PER_SEC_SQUARED,
  MAX_PAN_RATE_DEG_PER_SEC,
  MAX_POSE_ORIENTATION_STEP_DEG,
  MAX_POSE_POSITION_STEP_YARDS,
  MAX_RELEASE_ORIENTATION_DELTA_DEG,
  MAX_RELEASE_POSITION_DELTA_YARDS,
  MAX_SCENE_CAPTURE_SECONDS,
  MAX_SUBJECT_FRAME_HEIGHT_PERCENT,
  MECHANICAL_CHECKS,
  type MechanicalCheck,
  MIN_ARRIVAL_DIRECTION_DOT,
  MIN_ARRIVAL_SEAWARD_START_YARDS,
  MIN_HELD_SHOT_SECONDS,
  MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC,
  MIN_PERCEPTUAL_FADE_SECONDS,
  MIN_PROP_PATH_TRAVEL_YARDS,
  MIN_SHIP_SCREEN_DIRECTION_DOT,
  MIN_SHIP_SCREEN_VELOCITY_PER_SEC,
  MIN_SHOT_CAMERA_ORIENTATION_DELTA_DEG,
  MIN_SHOT_CAMERA_POSITION_DELTA_YARDS,
  MIN_SHOT_PARALLAX,
  MIN_SHOT_SUBJECT_SCREEN_MOTION,
  MIN_SUBJECT_FRAME_HEIGHT_PERCENT,
  NOMINAL_SUBJECT_HEIGHT_YARDS,
  normalize,
  PIER_KEEP_OUT_HEIGHT_YARDS,
  PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS,
  parkedShipFrame,
  playerCapsuleIntersectsFrame,
  pointInFrame,
  pointInsideDeck,
  RIDER_DECK_EDGE_EPSILON_YARDS,
  RIDER_HARBOR_BY_TEMPLATE,
  RIDER_WALK_STEP_EPSILON_YARDS,
  riderDeckViolation,
  SAMPLE_INTERVAL_SEC,
  SCENE_TIME_EPSILON_SECONDS,
  type ScreenPoint,
  SHOT_PARALLAX_REFERENCE_DEPTH_YARDS,
  SHOT_SAMPLE_RATE_HZ,
  SIGHT_LINE_NEAR_CAMERA_CLEARANCE_YARDS,
  SIGHT_LINE_STEP_YARDS,
  SIGHT_LINE_TERRAIN_MARGIN_YARDS,
  SUBJECT_REFERENCE_RADIUS_YARDS,
  SUBTITLE_READ_TIME_FLOOR_CHARACTERS_PER_SECOND,
  scale,
  screenPoint,
  settledPlayerStartForScene,
  shipDeckLocalBounds,
  shipHullBlockers,
  shipHullPointClearance,
  shipHullVolumes,
  shipTarget,
  subtract,
  supportSurfacesAt,
  VERTICAL_HALF_FOV_RAD,
  type Violation,
} from '../src/sim/scenes/lint_core';
import {
  SCENE_FUTURE_MUSIC_DIRECTIVES,
  SCENE_SAMPLED_MUSIC_DIRECTIVES,
} from '../src/sim/scenes/registry';
import type { SceneDef, SceneOpDef } from '../src/sim/scenes/scenes';
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
import { en } from '../src/ui/i18n.catalog';
import { SUPPORTED_LANGUAGES } from '../src/ui/i18n.resolved.generated/loaders';
import { WORLD_SEED } from '../src/world_seed.mjs';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

interface LegacyExemption {
  readonly sceneId: string;
  readonly check: MechanicalCheck;
  readonly reason: string;
}

// Cleared: P1.3 re-authored the voyage content and P3 landed the engine
// behaviors, so no scene/check pair remains exempt.
const LEGACY_EXEMPTIONS: readonly LegacyExemption[] = [];

interface TimedSceneOp {
  readonly index: number;
  readonly at: number;
  readonly op: SceneWireOp;
}

type TimedCameraOp = TimedSceneOp & {
  readonly op: Extract<SceneWireOp, { kind: 'camera' }>;
};

type TimedPropOp = TimedSceneOp & {
  readonly op: Extract<SceneWireOp, { kind: 'prop' }>;
};

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
  readonly authoredOps: readonly SceneOpDef[];
  readonly frames: ReadonlyMap<number, SceneFrame>;
  readonly entityLabels: ReadonlyMap<number, string>;
  readonly entityReferenceIds: ReadonlyMap<string, readonly number[]>;
  readonly riderHarbors: ReadonlyMap<number, HarborDef['id']>;
  readonly disableDeckRiding?: boolean;
  readonly disableLivePoseEase?: boolean;
}

interface ActiveProp {
  readonly segment: PropPathSegment;
  readonly startedAt: number;
  readonly timedOp: TimedSceneOp;
}

interface ShipScreenSample {
  readonly screen: ScreenPoint;
  readonly world: SceneRigPoint;
  readonly propOpIndex: number | null;
  readonly inFrame: boolean;
}

interface CameraSample {
  readonly time: number;
  readonly timedOp: TimedSceneOp;
  readonly pose: ScenePose;
  readonly geometry: CameraGeometry;
  readonly fullBlack: boolean;
  readonly ships: ReadonlyMap<string, ShipScreenSample>;
  readonly subject: SceneRigPoint | null;
  readonly subjectScreen: ScreenPoint | null;
  readonly entryEase: boolean;
}

interface PropMotionSample {
  readonly time: number;
  readonly target: string;
  readonly active: ActiveProp;
  readonly cameraOp: TimedSceneOp;
  readonly position: SceneRigPoint;
  readonly inFrame: boolean;
  readonly fullBlack: boolean;
}

interface ReleaseDelta {
  readonly timedOp: TimedSceneOp;
  readonly time: number;
  readonly fullBlack: boolean;
  readonly position: number;
  readonly orientationDeg: number;
  /** The gameplay pose the director restores: the authored release pose when
   * one is carried on the wire op, else the captured live pose. */
  readonly restored: ScenePose;
  readonly authoredPose: boolean;
}

interface SyntheticPresentationFixture {
  readonly playerHeightOffset?: number;
  readonly playerStart?: { x: number; z: number };
  readonly disableDeckRiding?: boolean;
  readonly disableLivePoseEase?: boolean;
}

interface SyntheticSceneDef extends SceneDef {
  readonly presentationFixture?: SyntheticPresentationFixture;
}

interface SyntheticControl {
  readonly def: SyntheticSceneDef;
  readonly expectedCheck: MechanicalCheck | null;
  readonly expectedMeasured?: string;
  readonly onlyExpectedCheck?: boolean;
  readonly actorIds?: readonly string[];
  readonly playerStart?: { x: number; z: number };
  readonly orphanSegmentId?: string;
  readonly orphanScene?: boolean;
}

const SYNTHETIC_FAST_PROP_CUE = 'scn_test_lint_prop_speed_bad';
const SYNTHETIC_OFFSET_BERTH_ARRIVAL_CUE = 'scn_test_lint_berth_pose_bad';
const SYNTHETIC_BERTH_DEPARTURE_YAW_CUE = 'scn_test_lint_berth_pose_departure_yaw_bad';
const SYNTHETIC_PARKED_GLIDE_CUE = 'scn_test_lint_berth_pose_parked_pass';
const SYNTHETIC_LANDWARD_ARRIVAL_CUE = 'scn_test_lint_arrival_direction_bad';
const SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE = 'scn_test_lint_arrival_bow_bad';
const SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE = 'scn_test_lint_arrival_berth_bad';
const SYNTHETIC_OVERSWING_ARRIVAL_CUE = 'scn_test_lint_arrival_swing_bad';
const SYNTHETIC_HULL_CLIP_CUE = 'scn_test_lint_hull_clip_bad';
const SYNTHETIC_RIDER_DRIFT_CUE = 'scn_test_lint_rider_drift_bad';
const SYNTHETIC_ATTACH_PASS_CUE = 'scn_test_lint_attach_pass';
const SYNTHETIC_PROP_DEAD_STOP_CUE = 'scn_test_lint_prop_dead_stop_bad';
const SYNTHETIC_PROP_LURCH_CUE = 'scn_test_lint_prop_lurch_bad';
const SYNTHETIC_REVERSED_SCREEN_DIRECTION_CUE = 'scn_test_lint_ship_screen_direction_bad';

type SyntheticSceneOpDef =
  | SceneOpDef
  | { at: number; kind: 'prop'; target: string; cue: string }
  | { at: number; kind: 'music'; directive: string };

interface SyntheticCameraSceneOptions {
  readonly hideRelease?: boolean;
  readonly coverFirstCut?: boolean;
  readonly clearReleaseFade?: boolean;
  readonly includeInitialLock?: boolean;
  readonly includeRelease?: boolean;
  readonly includeUnlock?: boolean;
  readonly includeLetterboxOff?: boolean;
  readonly releasePose?: { yaw: number; pitch: number; dist: number };
  readonly extraOps?: readonly SyntheticSceneOpDef[];
  readonly presentationFixture?: SyntheticPresentationFixture;
}

function syntheticCameraScene(
  id: string,
  duration: number,
  cameraOps: readonly SyntheticSceneOpDef[],
  options: SyntheticCameraSceneOptions = {},
): SyntheticSceneDef {
  const {
    hideRelease = true,
    coverFirstCut = true,
    clearReleaseFade = true,
    includeInitialLock = true,
    includeRelease = true,
    includeUnlock = true,
    includeLetterboxOff = true,
    releasePose,
    extraOps = [],
    presentationFixture,
  } = options;
  const preRollSeconds = MIN_PERCEPTUAL_FADE_SECONDS + SAMPLE_INTERVAL_SEC;
  const shiftedDuration = duration + preRollSeconds;
  const shiftOp = (op: SyntheticSceneOpDef): SyntheticSceneOpDef => {
    const shifted = {
      ...op,
      at: Number.isFinite(op.at) && op.at >= 0 ? op.at + preRollSeconds : op.at,
    };
    // Synthetic controls exercise specific checks, not entry travel: their
    // rig shots snap like the shipped covered cuts unless a control authors
    // entry 'ease' explicitly (the closed-exemption control does). Focus
    // shots keep their authored pan; it is their own linted motion.
    if (
      shifted.kind === 'camera' &&
      (shifted.shot.kind === 'dolly' || shifted.shot.kind === 'attach') &&
      shifted.shot.entry === undefined
    ) {
      return { ...shifted, shot: { ...shifted.shot, entry: 'snap' } };
    }
    return shifted;
  };
  const releaseAt = shiftedDuration - 0.1;
  return {
    id,
    duration: shiftedDuration,
    presentationFixture,
    ops: [
      ...(includeInitialLock
        ? ([{ at: 0, kind: 'inputLock', on: true }] satisfies SceneOpDef[])
        : []),
      { at: 0, kind: 'letterbox', on: true },
      ...(coverFirstCut
        ? ([
            {
              at: 0,
              kind: 'fade',
              to: 'black',
              dur: MIN_PERCEPTUAL_FADE_SECONDS,
            },
          ] satisfies SceneOpDef[])
        : []),
      // Mechanical failure controls deliberately inject test-only prop
      // segments after bypassing the production authoring boundary.
      ...(cameraOps.map(shiftOp) as readonly SceneOpDef[]),
      ...(coverFirstCut
        ? ([
            {
              at: preRollSeconds + SAMPLE_INTERVAL_SEC,
              kind: 'fade',
              to: 'clear',
              dur: MIN_PERCEPTUAL_FADE_SECONDS,
            },
          ] satisfies SceneOpDef[])
        : []),
      ...(hideRelease && includeRelease
        ? ([
            {
              at: releaseAt - preRollSeconds,
              kind: 'fade',
              to: 'black',
              dur: MIN_PERCEPTUAL_FADE_SECONDS,
            },
          ] satisfies SceneOpDef[])
        : []),
      ...(includeRelease
        ? ([
            {
              at: releaseAt,
              kind: 'camera',
              shot: releasePose ? { kind: 'release', pose: releasePose } : { kind: 'release' },
            },
          ] satisfies SceneOpDef[])
        : []),
      ...(includeUnlock
        ? ([{ at: releaseAt, kind: 'inputLock', on: false }] satisfies SceneOpDef[])
        : []),
      ...(includeLetterboxOff
        ? ([{ at: releaseAt, kind: 'letterbox', on: false }] satisfies SceneOpDef[])
        : []),
      ...(hideRelease && clearReleaseFade && includeRelease
        ? ([
            {
              at: releaseAt + SAMPLE_INTERVAL_SEC,
              kind: 'fade',
              to: 'clear',
              dur: MIN_PERCEPTUAL_FADE_SECONDS,
            },
          ] satisfies SceneOpDef[])
        : []),
      ...(extraOps.map(shiftOp) as readonly SceneOpDef[]),
    ],
  };
}

const SYNTHETIC_GRAMMAR_CAMERA_OPS = [
  {
    at: 0,
    kind: 'camera',
    shot: {
      kind: 'dolly',
      points: [
        { x: 0, z: 0, height: 100 },
        { x: 1, z: 0, height: 100 },
      ],
      lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
      dur: 1.6,
    },
  },
] satisfies readonly SceneOpDef[];

function syntheticFadeDurationScene(
  id: string,
  fadeOutDuration: number,
  fadeInDuration: number,
  precedeFadeWithActor = false,
): SceneDef {
  const cutAt = MIN_PERCEPTUAL_FADE_SECONDS + SAMPLE_INTERVAL_SEC;
  return syntheticCameraScene(
    id,
    2.4,
    [
      {
        at: cutAt,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 1, z: 0, height: 100 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
        },
      },
    ],
    {
      coverFirstCut: false,
      extraOps: [
        ...(precedeFadeWithActor
          ? ([{ at: 0, kind: 'actorFace', actorId: 'tam', facing: 0 }] satisfies SceneOpDef[])
          : []),
        { at: 0, kind: 'fade', to: 'black', dur: fadeOutDuration },
        {
          at: cutAt + SAMPLE_INTERVAL_SEC,
          kind: 'fade',
          to: 'clear',
          dur: fadeInDuration,
        },
      ],
    },
  );
}

function syntheticEarlyCutScene(id: string): SceneDef {
  const cutAt = MIN_PERCEPTUAL_FADE_SECONDS - SAMPLE_INTERVAL_SEC;
  return syntheticCameraScene(
    id,
    2.4,
    [
      {
        at: cutAt,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 1, z: 0, height: 100 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
        },
      },
    ],
    {
      coverFirstCut: false,
      extraOps: [
        {
          at: 0,
          kind: 'fade',
          to: 'black',
          dur: MIN_PERCEPTUAL_FADE_SECONDS,
        },
        {
          at: cutAt + SAMPLE_INTERVAL_SEC,
          kind: 'fade',
          to: 'clear',
          dur: MIN_PERCEPTUAL_FADE_SECONDS,
        },
      ],
    },
  );
}

const SYNTHETIC_CONTROLS: readonly SyntheticControl[] = [
  {
    def: syntheticCameraScene('scn_test_lint_dolly_pass', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -1, z: -10, height: 6 },
            { x: 1, z: -10, height: 6 },
          ],
          lookAt: {
            kind: 'subject',
            actorId: 'tam',
            offset: { x: 0, y: 2, z: 0 },
            fallback: { x: 0, z: 0, height: 2 },
          },
          dur: 1.6,
          subjectRef: 'tam',
        },
      },
    ]),
    expectedCheck: null,
    actorIds: ['tam'],
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_attach_pass',
      1.7,
      [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: SYNTHETIC_ATTACH_PASS_CUE,
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
            offset: { x: -50, y: 18, z: 0 },
            lookAt: { x: -30, y: 8.6, z: 0 },
          },
        },
      ],
      {
        presentationFixture: { playerStart: MAINLAND_HARBOR.berth },
      },
    ),
    expectedCheck: null,
  },
  {
    // The closed entry-ease exemption (J5 round, owner issues 3 and 7): a
    // covered cut whose shot still EASES sweeps the camera from the old
    // pose while the fade-in is already revealing it. The exemption now
    // applies only under full black, so the visible half of that sweep must
    // trip the motion caps. The 180 degree flip between the two dollies
    // makes the 0.8 s ease an unmissable whip pan.
    def: syntheticCameraScene('scn_test_lint_covered_cut_ease_bad', 3.9, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -1, z: -10, height: 6 },
            { x: 1, z: -10, height: 6 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 0, height: 2 } },
          dur: 1,
        },
      },
      { at: 1.35, kind: 'fade', to: 'black', dur: MIN_PERCEPTUAL_FADE_SECONDS },
      { at: 1.8, kind: 'fade', to: 'black', dur: 0 },
      {
        at: 1.8,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -1, z: 10, height: 6 },
            { x: 1, z: 10, height: 6 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 0, height: 2 } },
          dur: 1,
          entry: 'ease',
        },
      },
      { at: 1.85, kind: 'fade', to: 'clear', dur: MIN_PERCEPTUAL_FADE_SECONDS },
    ]),
    expectedCheck: 'motion.panRate',
  },
  {
    // The snap twin of the control above: the identical covered cut with the
    // shipped snap entry holds the new frame from the first tick, so the
    // same fade-in reveals a composed shot and the closed linter stays green.
    def: syntheticCameraScene('scn_test_lint_covered_cut_snap_pass', 3.9, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -1, z: -10, height: 6 },
            { x: 1, z: -10, height: 6 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 0, height: 2 } },
          dur: 1,
        },
      },
      { at: 1.35, kind: 'fade', to: 'black', dur: MIN_PERCEPTUAL_FADE_SECONDS },
      { at: 1.8, kind: 'fade', to: 'black', dur: 0 },
      {
        at: 1.8,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -1, z: 10, height: 6 },
            { x: 1, z: 10, height: 6 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 0, height: 2 } },
          dur: 1,
        },
      },
      { at: 1.85, kind: 'fade', to: 'clear', dur: MIN_PERCEPTUAL_FADE_SECONDS },
    ]),
    expectedCheck: null,
  },
  {
    // The J3 hand-back guard: the authored release pose parks the restored
    // gameplay camera on the far side of the mainland ship's main mast from
    // the player, so the full-camera-top sight line must report it.
    def: syntheticCameraScene(
      'scn_test_lint_release_sight_bad',
      2.2,
      [
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [
              { x: 252, z: -30, height: 12 },
              { x: 250, z: -32, height: 12 },
            ],
            lookAt: { kind: 'point', point: { x: 247, z: -30, height: 6 } },
            dur: 1.6,
          },
        },
      ],
      {
        releasePose: { yaw: -Math.PI / 2, pitch: 0.6, dist: 10 },
        presentationFixture: { playerStart: { x: 234, z: -40.95 } },
      },
    ),
    expectedCheck: 'cut.releaseSightLine',
  },
  {
    // The other arm of the same check: a scene that WALKS the player and then
    // releases without an authored hand-back pose restores the unknowable
    // pre-scene camera, which is the exact defect class the pose exists for.
    def: syntheticCameraScene('scn_test_lint_release_pose_missing_bad', 2.2, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 170, z: -58, height: 8 },
            { x: 172, z: -58, height: 8 },
          ],
          lookAt: { kind: 'point', point: { x: 173, z: -48, height: 2 } },
          dur: 1.6,
        },
      },
      { at: 0.2, kind: 'playerWalk', to: { x: 176, z: -48 }, speed: 3 },
    ]),
    expectedCheck: 'cut.releaseSightLine',
    expectedMeasured: 'unknowable pre-scene camera pose',
    playerStart: { x: 173, z: -48 },
  },
  {
    def: syntheticCameraScene('scn_test_lint_terrain_clearance_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 0, z: 0, height: 0 }],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 2 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'clearance.terrain',
    expectedMeasured: '0.00 yd',
  },
  {
    def: syntheticCameraScene('scn_test_lint_water_clearance_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 240.5, z: -44, height: 1.75 }],
          lookAt: { kind: 'point', point: { x: 240.5, z: -34, height: 10 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'clearance.water',
  },
  {
    def: syntheticCameraScene('scn_test_lint_pier_occlusion_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 212.5, z: -40, height: 4 }],
          lookAt: { kind: 'point', point: { x: 212.5, z: -56, height: 4 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'visibility.occlusion',
    expectedMeasured: 'mainland deck',
  },
  {
    def: syntheticCameraScene('scn_test_lint_hull_occlusion_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          // The ray crosses the measured MIDSHIP wall: the Tripo hull's
          // lower-hull volumes end short of the bow taper, so a ray at the
          // old z -56 station threads the gap and never occludes.
          points: [{ x: 230.65, z: -52, height: 10 }],
          lookAt: { kind: 'point', point: { x: 250.65, z: -52, height: 10 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'visibility.occlusion',
    expectedMeasured: 'mainland ship hull',
  },
  {
    def: syntheticCameraScene('scn_test_lint_hull_clip_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: SYNTHETIC_HULL_CLIP_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_mainland',
          fallbackFrame: { point: { x: 228.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
          offset: { x: 0, y: 18, z: -24 },
          lookAt: { x: 0, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'collision.hull',
    expectedMeasured: 'mainland deck',
  },
  {
    def: syntheticCameraScene('scn_test_lint_entity_float_bad', 1.7, SYNTHETIC_GRAMMAR_CAMERA_OPS, {
      presentationFixture: { playerHeightOffset: 2 },
    }),
    expectedCheck: 'support.entity',
    expectedMeasured: 'player is 2.00 yd above terrain',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_rider_drift_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: SYNTHETIC_RIDER_DRIFT_CUE,
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -84, height: 8 }, yaw: Math.PI / 2 },
            offset: { x: 0, y: 18, z: -24 },
            lookAt: { x: 0, y: 8, z: 0 },
          },
        },
      ],
      {
        presentationFixture: { disableDeckRiding: true },
      },
    ),
    expectedCheck: 'containment.rider',
    expectedMeasured: 'ferryman_ewald left mainland deck bounds',
    playerStart: MAINLAND_HARBOR.boarding,
  },
  {
    def: syntheticCameraScene('scn_test_lint_framing_direction_bad', 8, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'focus',
          x: 0,
          z: -20,
          dist: 9,
          pitch: 0.32,
          yaw: Math.PI,
          dur: 8,
        },
      },
    ]),
    expectedCheck: 'framing.direction',
  },
  {
    def: syntheticCameraScene('scn_test_lint_framing_size_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 0, z: 0, height: 100 }],
          lookAt: { kind: 'point', point: { x: 0, z: 100, height: 100 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'framing.size',
  },
  {
    def: syntheticCameraScene('scn_test_lint_pan_rate_bad', 2, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 0, z: 0, height: 100 }],
          lookAt: {
            kind: 'spline',
            points: [
              { x: -8.66, z: 5, height: 100 },
              { x: 8.66, z: 5, height: 100 },
            ],
          },
          dur: 1.8,
        },
      },
    ]),
    expectedCheck: 'motion.panRate',
  },
  {
    def: syntheticCameraScene('scn_test_lint_dolly_speed_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: -18, z: 0, height: 100 },
            { x: 18, z: 0, height: 100 },
          ],
          lookAt: {
            kind: 'spline',
            points: [
              { x: -18, z: 10, height: 100 },
              { x: 18, z: 10, height: 100 },
            ],
          },
          dur: 1.4,
        },
      },
    ]),
    expectedCheck: 'motion.dollySpeed',
  },
  {
    def: syntheticCameraScene('scn_test_lint_pose_teleport_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 0, z: 0, height: 100 },
            { x: 0, z: 0, height: 100 },
            { x: 0, z: 0, height: 100 },
            { x: 10, z: 0, height: 100 },
            { x: 10, z: 0, height: 100 },
            { x: 10, z: 0, height: 100 },
            { x: 10, z: 0, height: 100 },
          ],
          lookAt: {
            kind: 'spline',
            points: [
              { x: 0, z: 10, height: 100 },
              { x: 0, z: 10, height: 100 },
              { x: 0, z: 10, height: 100 },
              { x: 0, z: 10, height: 100 },
              { x: 10, z: 10, height: 100 },
              { x: 10, z: 10, height: 100 },
              { x: 10, z: 10, height: 100 },
              { x: 10, z: 10, height: 100 },
            ],
          },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'motion.poseContinuity',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_cut_jump_bad',
      3.2,
      [
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [{ x: 0, z: 0, height: 100 }],
            lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
            dur: 1.6,
          },
        },
        {
          at: 1.6,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [{ x: 10, z: 0, height: 100 }],
            lookAt: { kind: 'point', point: { x: 10, z: 10, height: 100 } },
            dur: 1.6,
            // Authored ease (the fixture disables the live-pose ease): an
            // eased boundary must never jump, unlike a deliberate snap cut.
            entry: 'ease',
          },
        },
      ],
      {
        presentationFixture: { disableLivePoseEase: true },
      },
    ),
    expectedCheck: 'motion.cutJump',
  },
  {
    def: syntheticCameraScene('scn_test_lint_attach_volume_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_mainland',
          fallbackFrame: { point: { x: 240.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
          offset: { x: 10, y: 7, z: 0 },
          lookAt: { x: 20, y: 7, z: 0 },
        },
      },
    ]),
    expectedCheck: 'clearance.volume',
    expectedMeasured: 'mainland live ship model',
  },
  {
    def: syntheticCameraScene('scn_test_lint_fixed_deck_height_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 225, z: -48, height: 2 }],
          lookAt: { kind: 'point', point: { x: 230, z: -48, height: 1 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'clearance.volume',
  },
  {
    def: syntheticCameraScene('scn_test_lint_fixed_deck_margin_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 173, z: -40.5, height: 1 }],
          lookAt: { kind: 'point', point: { x: 173, z: -48, height: 1 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'clearance.volume',
  },
  {
    def: syntheticCameraScene('scn_test_lint_fixed_ramp_height_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 172, z: -57, height: 2 }],
          lookAt: { kind: 'point', point: { x: 172, z: -52, height: 1 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'clearance.volume',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_release_delta_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -44, height: 12 }, yaw: Math.PI / 2 },
            offset: { x: 6.6, y: 12, z: 8 },
            lookAt: { x: 6.6, y: 8, z: 0 },
          },
        },
      ],
      { hideRelease: false },
    ),
    expectedCheck: 'cut.releaseDelta',
  },
  {
    def: syntheticCameraScene('scn_test_lint_prop_speed_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: SYNTHETIC_FAST_PROP_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_mainland',
          fallbackFrame: { point: { x: 240.5, z: -44, height: 12 }, yaw: Math.PI / 2 },
          offset: { x: 6.6, y: 12, z: 8 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.speed',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_prop_segment_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [
          {
            at: 0.2,
            kind: 'prop',
            target: 'harbor_ship_mainland',
            cue: 'scn_test_lint_prop_segment_missing_bad',
          },
        ],
      },
    ),
    expectedCheck: 'prop.segment',
    expectedMeasured: 'missing cue scn_test_lint_prop_segment_missing_bad',
  },
  {
    def: syntheticCameraScene('scn_test_lint_berth_pose_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: SYNTHETIC_OFFSET_BERTH_ARRIVAL_CUE,
      },
      {
        at: SAMPLE_INTERVAL_SEC,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: LB_PROP_CUE_PARK,
      },
      ...SYNTHETIC_GRAMMAR_CAMERA_OPS,
    ]),
    expectedCheck: 'continuity.berthPose',
    expectedMeasured: 'arrival last sample is 0.020 yd',
    onlyExpectedCheck: true,
  },
  {
    def: syntheticCameraScene('scn_test_lint_berth_pose_departure_yaw_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: SYNTHETIC_BERTH_DEPARTURE_YAW_CUE,
      },
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_PARKED_GLIDE_CUE,
      },
      ...SYNTHETIC_GRAMMAR_CAMERA_OPS,
    ]),
    expectedCheck: 'continuity.berthPose',
    expectedMeasured: 'departure first sample is 0.000 yd and 0.002 rad',
    onlyExpectedCheck: true,
  },
  {
    def: syntheticCameraScene('scn_test_lint_ship_screen_direction_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: SYNTHETIC_REVERSED_SCREEN_DIRECTION_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 140, z: -84, height: 50 },
            { x: 140, z: -88, height: 50 },
          ],
          lookAt: {
            kind: 'spline',
            points: [
              { x: 240, z: -84, height: 50 },
              { x: 240, z: -88, height: 50 },
            ],
          },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'continuity.shipScreenDirection',
    expectedMeasured: 'direction dot',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_prop_dead_stop_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: SYNTHETIC_PROP_DEAD_STOP_CUE,
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
            offset: { x: 6.6, y: 18, z: -28 },
            lookAt: { x: 6.6, y: 8.6, z: 0 },
          },
        },
      ],
      {
        presentationFixture: { disableLivePoseEase: true },
      },
    ),
    expectedCheck: 'motion.propWay',
    expectedMeasured: 'way fell from',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_prop_fade_reveal_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: SYNTHETIC_PROP_LURCH_CUE,
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
            offset: { x: 6.6, y: 18, z: -28 },
            lookAt: { x: 6.6, y: 8.6, z: 0 },
          },
        },
      ],
      {
        presentationFixture: { disableLivePoseEase: true },
      },
    ),
    expectedCheck: 'motion.propWay',
    expectedMeasured: 'way at fade-in',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_prop_lurch_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: SYNTHETIC_PROP_LURCH_CUE,
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: { point: { x: 240.5, z: -44, height: 8 }, yaw: Math.PI / 2 },
            offset: { x: 6.6, y: 18, z: -28 },
            lookAt: { x: 6.6, y: 8.6, z: 0 },
          },
        },
      ],
      {
        presentationFixture: { disableLivePoseEase: true },
      },
    ),
    expectedCheck: 'motion.propAcceleration',
    expectedMeasured: 'acceleration',
  },
  {
    def: syntheticCameraScene('scn_test_lint_visual_motion_floor_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 0, z: 0, height: 100 }],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
        },
      },
    ]),
    expectedCheck: 'motion.visualFloor',
    expectedMeasured: 'subject 0.0000',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_first_transition_bad',
      1.7,
      [
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [
              { x: 0, z: 0, height: 100 },
              { x: 1, z: 0, height: 100 },
            ],
            lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
            dur: 1.6,
            // Authored ease with the live-pose ease disabled: an uncovered,
            // non-snap first cut is exactly the unannounced pop this guards.
            entry: 'ease',
          },
        },
      ],
      {
        coverFirstCut: false,
        presentationFixture: { disableLivePoseEase: true },
      },
    ),
    expectedCheck: 'cut.firstTransition',
    expectedMeasured: 'camera/dolly without full black',
  },
  {
    def: syntheticCameraScene('scn_test_lint_arrival_direction_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_LANDWARD_ARRIVAL_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_gullhaven',
          fallbackFrame: { point: { x: 732, z: 132.5, height: 12 }, yaw: Math.PI },
          offset: { x: 6.6, y: 12, z: -8 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.arrivalDirection',
    expectedMeasured: 'seaward -',
  },
  {
    def: syntheticCameraScene('scn_test_lint_arrival_bow_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_gullhaven',
          fallbackFrame: { point: { x: 732, z: 132.5, height: 12 }, yaw: Math.PI },
          offset: { x: 6.6, y: 12, z: -8 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.arrivalDirection',
    expectedMeasured: 'bow dot -1.000',
  },
  {
    def: syntheticCameraScene('scn_test_lint_arrival_swing_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_OVERSWING_ARRIVAL_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_gullhaven',
          fallbackFrame: { point: { x: 732, z: 132.5, height: 12 }, yaw: Math.PI },
          offset: { x: 6.6, y: 12, z: -12 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.arrivalDirection',
    expectedMeasured: 'yaw swing 1.636',
  },
  {
    def: syntheticCameraScene('scn_test_lint_arrival_berth_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_gullhaven',
          fallbackFrame: { point: { x: 732, z: 132.5, height: 12 }, yaw: Math.PI },
          offset: { x: 6.6, y: 12, z: -8 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.arrivalDirection',
    expectedMeasured: 'berth 1.00 yd',
  },
  {
    def: syntheticCameraScene('scn_test_lint_arrival_target_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_mainland',
          fallbackFrame: { point: { x: 240.5, z: -44, height: 12 }, yaw: Math.PI / 2 },
          offset: { x: 6.6, y: 12, z: 8 },
          lookAt: { x: 6.6, y: 8, z: 0 },
        },
      },
    ]),
    expectedCheck: 'prop.arrivalDirection',
    expectedMeasured: 'targeted mainland',
  },
  {
    def: syntheticCameraScene('scn_test_lint_stand_in_handoff_bad', 4.5, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival,
      },
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'harbor_ship_gullhaven',
          fallbackFrame: { point: { x: 732, z: 132.5, height: 12 }, yaw: Math.PI },
          offset: { x: 6.6, y: 14, z: -12 },
          lookAt: { x: -8, y: 8.6, z: 0 },
        },
      },
      {
        at: 2,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: LB_PROP_CUE_PARK,
      },
    ]),
    expectedCheck: 'continuity.standInHandoff',
    expectedMeasured: 'deck stand-in handed off outside full black',
  },
  {
    def: syntheticFadeDurationScene(
      'scn_test_lint_fade_duration_floor_pass',
      MIN_PERCEPTUAL_FADE_SECONDS,
      MIN_PERCEPTUAL_FADE_SECONDS,
    ),
    expectedCheck: null,
  },
  {
    def: syntheticFadeDurationScene(
      'scn_test_lint_fade_out_duration_bad',
      MIN_PERCEPTUAL_FADE_SECONDS - SAMPLE_INTERVAL_SEC,
      MIN_PERCEPTUAL_FADE_SECONDS,
      true,
    ),
    expectedCheck: 'cut.fadeSlack',
    expectedMeasured: 'fade/black',
    onlyExpectedCheck: true,
    playerStart: { x: 0, z: 0 },
  },
  {
    def: syntheticFadeDurationScene(
      'scn_test_lint_fade_in_duration_bad',
      MIN_PERCEPTUAL_FADE_SECONDS,
      MIN_PERCEPTUAL_FADE_SECONDS - SAMPLE_INTERVAL_SEC,
    ),
    expectedCheck: 'cut.fadeSlack',
    expectedMeasured: 'fade/clear',
    onlyExpectedCheck: true,
  },
  {
    // A mid-fade first cut is two defects at once under the pass-three
    // grammar (an early cut AND a bad first transition), so this control
    // pins the fadeSlack arm by substring rather than exclusivity.
    def: syntheticEarlyCutScene('scn_test_lint_fade_cut_early_bad'),
    expectedCheck: 'cut.fadeSlack',
    expectedMeasured: 'after co-timed cut ops',
  },
  {
    def: syntheticCameraScene('scn_test_lint_held_duration_bad', 1.2, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 1, z: 0, height: 100 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.1,
        },
      },
    ]),
    expectedCheck: 'cut.heldDuration',
    expectedMeasured: '1.10s',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_fade_symmetry_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { clearReleaseFade: false },
    ),
    expectedCheck: 'fade.symmetry',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_fade_symmetry_at_end_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        clearReleaseFade: false,
        extraOps: [
          {
            at: 1.7,
            kind: 'fade',
            to: 'clear',
            dur: MIN_PERCEPTUAL_FADE_SECONDS,
          },
        ],
      },
    ),
    expectedCheck: 'fade.symmetry',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_op_timing_at_end_pass',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [{ at: 1.7, kind: 'music', directive: 'silence' }],
      },
    ),
    expectedCheck: null,
    playerStart: { x: 0, z: 0 },
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_op_timing_above_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [{ at: 1.75, kind: 'music', directive: 'silence' }],
      },
    ),
    expectedCheck: 'timing.opWithinDuration',
    playerStart: { x: 0, z: 0 },
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_op_timing_below_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [{ at: -0.05, kind: 'music', directive: 'silence' }],
      },
    ),
    expectedCheck: 'timing.opWithinDuration',
    playerStart: { x: 0, z: 0 },
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_op_timing_nonfinite_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [{ at: Number.NaN, kind: 'music', directive: 'silence' }],
      },
    ),
    expectedCheck: 'timing.opWithinDuration',
    playerStart: { x: 0, z: 0 },
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_music_unknown_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [{ at: 0.2, kind: 'music', directive: 'lb_no_such_directive' }],
      },
    ),
    expectedCheck: 'reference.music',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_music_future_pass',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [
          { at: 0.2, kind: 'music', directive: 'theme:last_bell' },
          { at: 0.3, kind: 'music', directive: 'resume' },
        ],
      },
    ),
    expectedCheck: null,
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_orphan_segment_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
    ),
    expectedCheck: 'reference.orphan',
    orphanSegmentId: 'scn_test_lint_orphan_segment_bad',
  },
  {
    def: syntheticCameraScene('scn_test_lint_orphan_scene_bad', 1.7, SYNTHETIC_GRAMMAR_CAMERA_OPS),
    expectedCheck: 'reference.orphan',
    orphanScene: true,
  },
  {
    def: syntheticCameraScene('scn_test_lint_subject_reference_missing_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 1, z: 0, height: 100 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
          subjectRef: 'missing_cinematic_subject',
        },
      },
    ]),
    expectedCheck: 'reference.subject',
    expectedMeasured: 'no presentation entity or fixture named missing_cinematic_subject',
  },
  {
    def: syntheticCameraScene('scn_test_lint_subject_reference_bad', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 0, z: 0, height: 100 },
            { x: 1, z: 0, height: 100 },
          ],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
          // The TOO-FAR arm (the control above owns the not-found arm), so this
          // must name a prop that really is placed in the world: the lint has to
          // resolve it before it can measure a distance. Repointed from
          // statueBlock when Hale's memorial replaced those reused nature-kit
          // blocks and moved to the berm crest.
          subjectRef: 'wardenHaleStatue',
        },
      },
    ]),
    expectedCheck: 'reference.subject',
    expectedMeasured: 'nearest wardenHaleStatue',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_line_key_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [
          {
            at: 0.2,
            kind: 'line',
            speaker: '',
            key: 'lb.no_such_scene_line',
            dur: 1,
          },
        ],
      },
    ),
    expectedCheck: 'reference.lineKey',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_subtitle_read_time_bad',
      4.8,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [
          {
            at: 0.2,
            kind: 'line',
            speaker: '',
            key: 'lb.q0.scene.harbor',
            dur: 4.4,
          },
        ],
      },
    ),
    expectedCheck: 'reference.subtitleReadTime',
    expectedMeasured: 'ru_RU has',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_subtitle_pending_fallback_bad',
      4,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      {
        extraOps: [
          {
            at: 0.2,
            kind: 'line',
            speaker: '',
            key: 'lb.q0.tam.stretchers',
            dur: 3.5,
          },
        ],
      },
    ),
    expectedCheck: 'reference.subtitleReadTime',
    expectedMeasured: 'es has 72 chars',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_release_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { includeRelease: false },
    ),
    expectedCheck: 'cut.teardown',
    expectedMeasured: 'release=false, inputUnlock=true, letterboxOff=true',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_final_release_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { includeRelease: false },
    ),
    expectedCheck: 'cut.finalRelease',
    expectedMeasured: 'camera/dolly',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_unlock_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { includeUnlock: false },
    ),
    expectedCheck: 'cut.teardown',
    expectedMeasured: 'release=true, inputUnlock=false, letterboxOff=true',
  },
  {
    def: syntheticCameraScene('scn_test_lint_bracketing_bad', 1.7, SYNTHETIC_GRAMMAR_CAMERA_OPS, {
      includeInitialLock: false,
    }),
    expectedCheck: 'cut.bracketing',
    expectedMeasured: 'inputLock=false',
  },
  {
    def: syntheticCameraScene(
      'scn_test_lint_letterbox_off_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { includeLetterboxOff: false },
    ),
    expectedCheck: 'cut.teardown',
    expectedMeasured: 'release=true, inputUnlock=true, letterboxOff=false',
  },
];

const PROP_SEGMENTS: Readonly<Record<string, PropPathSegment | undefined>> = {
  ...LAST_BELL_PROP_PATH_SEGMENTS,
  [SYNTHETIC_OFFSET_BERTH_ARRIVAL_CUE]: {
    start: { x: BERTH_POSE_POSITION_EPSILON_YARDS * 3, y: 0, z: 0, yaw: 0 },
    end: { x: BERTH_POSE_POSITION_EPSILON_YARDS * 2, y: 0, z: 0, yaw: 0 },
    duration: SAMPLE_INTERVAL_SEC,
    ease: 'linear',
  },
  [SYNTHETIC_BERTH_DEPARTURE_YAW_CUE]: {
    start: { x: 0, y: 0, z: 0, yaw: BERTH_POSE_YAW_EPSILON_RADIANS * 2 },
    end: { x: 0, y: 0, z: 0, yaw: BERTH_POSE_YAW_EPSILON_RADIANS * 2 },
    duration: 1,
    ease: 'linear',
  },
  [SYNTHETIC_PARKED_GLIDE_CUE]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 1,
    ease: 'linear',
  },
  [SYNTHETIC_FAST_PROP_CUE]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 40, y: 0, z: 0, yaw: 0 },
    duration: 1,
    ease: 'linear',
  },
  [SYNTHETIC_LANDWARD_ARRIVAL_CUE]: {
    start: { x: -20, y: 0, z: 0, yaw: 0 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 4,
    ease: 'linear',
  },
  [SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE]: {
    start: { x: 32, y: 0, z: 0, yaw: 0.318748 },
    end: { x: 0, y: 0, z: 0, yaw: 0.318748 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
  [SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE]: {
    start: { x: -32, y: 0, z: 0, yaw: -2.822845 },
    end: { x: -1, y: 0, z: 0, yaw: -2.822845 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
  // The J2-era parking manoeuvre shape: bow-first and seaward, but the hull
  // rotates 1.64 rad on the way in, so ONLY the yaw-swing arm trips.
  [SYNTHETIC_OVERSWING_ARRIVAL_CUE]: {
    start: { x: -41, y: 0, z: 0, yaw: -1.6359 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
  [SYNTHETIC_HULL_CLIP_CUE]: {
    start: { x: 0, y: 0, z: -12, yaw: 0 },
    end: { x: 0, y: 0, z: -12, yaw: 0 },
    duration: 1.6,
    ease: 'linear',
  },
  [SYNTHETIC_RIDER_DRIFT_CUE]: {
    start: { x: 40, y: 0, z: 0, yaw: 0 },
    end: { x: 40, y: 0, z: 0, yaw: 0 },
    duration: 1.6,
    ease: 'linear',
  },
  [SYNTHETIC_ATTACH_PASS_CUE]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 8, y: 0, z: 0, yaw: 0 },
    duration: 4,
    ease: 'linear',
  },
  [SYNTHETIC_PROP_DEAD_STOP_CUE]: {
    start: { x: 159.519453, y: 0, z: -4.456482, yaw: -1.910796 },
    end: { x: 165.519453, y: 0, z: -4.456482, yaw: -1.910796 },
    duration: 0.7,
    ease: 'linear',
  },
  [SYNTHETIC_PROP_LURCH_CUE]: {
    start: { x: 159.519453, y: 0, z: -4.456482, yaw: -1.910796 },
    end: { x: 167.519453, y: 0, z: -4.456482, yaw: -1.910796 },
    duration: 1.6,
    ease: 'easeInQuad',
  },
  [SYNTHETIC_REVERSED_SCREEN_DIRECTION_CUE]: {
    start: { x: 40, y: 0, z: 0, yaw: 0 },
    end: { x: 42, y: 0, z: 0, yaw: 0 },
    duration: 1.6,
    ease: 'linear',
  },
};
const ARRIVAL_HARBOR_BY_CUE = new Map<string, HarborDef['id']>([
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival, 'gullhaven'],
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival, 'mainland'],
  [SYNTHETIC_LANDWARD_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_OVERSWING_ARRIVAL_CUE, 'gullhaven'],
]);
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENE_TRIGGER_FILES = [
  ...tsFilesUnder(path.join(REPO_ROOT, 'src/sim/content')),
  ...tsFilesUnder(path.join(REPO_ROOT, 'src/sim/last_bell')),
];
const LOCALE_OVERLAY_FILES = tsFilesUnder(path.join(REPO_ROOT, 'src/ui/i18n.locales'));
const SCENE_TRIGGER_SOURCES = SCENE_TRIGGER_FILES.map(({ file, full }) => ({
  file,
  source: readFileSync(full, 'utf8'),
}));
const RENDERER_SOURCE = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const SCENE_SFX_SOURCE = readFileSync(new URL('../src/game/scene_sfx.ts', import.meta.url), 'utf8');
const SHIPPED_SFX_KEYS: ReadonlySet<string> = new Set(SFX_FIXED_CATALOG_KEYS);
const RESOLVED_DIRECTOR_MUSIC_DIRECTIVES: ReadonlySet<string> = new Set(['silence', 'resume']);
const FUTURE_MUSIC_DIRECTIVES: ReadonlySet<string> = new Set(SCENE_FUTURE_MUSIC_DIRECTIVES);
let SimConstructor: typeof import('../src/sim/sim').Sim;
let playRegisteredScene: typeof import('../src/sim/scenes/scenes').playSceneForPlayer;
let readRegisteredSceneIds: typeof import('../src/sim/scenes/scenes').registeredSceneIds;
let readRegisteredScene: typeof import('../src/sim/scenes/scenes').sceneById;
let registerSceneForLinter: typeof import('../src/sim/scenes/scenes').registerScene;
let sampleTerrainHeight: typeof import('../src/sim/world').terrainHeight;
let spawnSquadForLinter: typeof import('../src/sim/squad/squad').spawnSquad;
let localeTranslationFills: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
let runtimeWaterLevel = 0;

function sceneEvents(events: readonly SimEvent[]): Extract<SimEvent, { type: 'scene' }>[] {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'scene' }> => event.type === 'scene',
  );
}

async function loadLinterRuntime(): Promise<void> {
  const simModule = await import('../src/sim/sim');
  const scenesModule = await import('../src/sim/scenes/scenes');
  const squadModule = await import('../src/sim/squad/squad');
  const worldModule = await import('../src/sim/world');
  SimConstructor = simModule.Sim;
  playRegisteredScene = scenesModule.playSceneForPlayer;
  readRegisteredSceneIds = scenesModule.registeredSceneIds;
  readRegisteredScene = scenesModule.sceneById;
  registerSceneForLinter = scenesModule.registerScene;
  spawnSquadForLinter = squadModule.spawnSquad;
  sampleTerrainHeight = worldModule.terrainHeight;
  runtimeWaterLevel = worldModule.WATER_LEVEL;
  const lineKeys = new Set<string>();
  for (const id of readRegisteredSceneIds()) {
    for (const op of readRegisteredScene(id)?.ops ?? []) {
      if (op.kind === 'line') lineKeys.add(op.key);
    }
  }
  for (const control of SYNTHETIC_CONTROLS) {
    for (const op of control.def.ops) {
      if (op.kind === 'line') lineKeys.add(op.key);
    }
  }
  localeTranslationFills = readLocaleTranslationFills(lineKeys);
}

function trackedEntityIds(op: SceneWireOp): number[] {
  if (op.kind === 'line') return op.speakerEntityId === null ? [] : [op.speakerEntityId];
  if (op.kind === 'anim') return [op.entityId];
  if (op.kind !== 'camera') return [];
  if (op.shot.kind === 'focus') return op.shot.entityId === null ? [] : [op.shot.entityId];
  if (op.shot.kind === 'dolly' && op.shot.lookAt.kind === 'subject') {
    return op.shot.lookAt.entityId === null ? [] : [op.shot.lookAt.entityId];
  }
  return [];
}

function authoredSceneActorIds(ops: readonly SceneOpDef[]): string[] {
  const actorIds = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'line' && op.speakerActorId !== undefined) {
      actorIds.add(op.speakerActorId);
    }
    if (
      (op.kind === 'actorMove' || op.kind === 'actorFace' || op.kind === 'anim') &&
      op.actorId !== undefined
    ) {
      actorIds.add(op.actorId);
    }
    if (op.kind !== 'camera' || op.shot.kind === 'release' || op.shot.kind === 'attach') {
      continue;
    }
    if (op.shot.kind === 'focus' && op.shot.actorId !== undefined) {
      actorIds.add(op.shot.actorId);
    }
    if (op.shot.kind === 'dolly' && op.shot.lookAt.kind === 'subject') {
      actorIds.add(op.shot.lookAt.actorId);
    }
  }
  return [...actorIds];
}

function authoredSubjectRefs(ops: readonly SceneOpDef[]): string[] {
  const refs = new Set<string>();
  for (const op of ops) {
    if (op.kind !== 'camera' || op.shot.kind === 'release') continue;
    if (op.shot.subjectRef) refs.add(op.shot.subjectRef);
  }
  return [...refs];
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

function captureScene(
  id: string,
  actorIds: readonly string[] = [],
  playerStart?: { x: number; z: number },
): CapturedScene {
  const authored = readRegisteredScene(id);
  expect(authored, `registered scene ${id} has no authored definition`).toBeDefined();
  const sim = new SimConstructor({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    playerName: 'Shot Linter',
  });
  const entityLabels = new Map<number, string>();
  const entityReferenceIds = new Map<string, number[]>();
  const riderHarbors = new Map<number, HarborDef['id']>();
  for (const entity of sim.entities.values()) {
    const harborId = RIDER_HARBOR_BY_TEMPLATE.get(entity.templateId);
    if (harborId === undefined) continue;
    entityLabels.set(entity.id, entity.templateId);
    riderHarbors.set(entity.id, harborId);
  }
  const settledStart = playerStart ?? settledPlayerStartForScene(id);
  if (settledStart) {
    sim.player.pos = sim.groundPos(settledStart.x, settledStart.z);
    sim.player.prevPos = { ...sim.player.pos };
    sim.rebucket(sim.player);
  }
  const playbackKey = -sim.playerId;
  const requestedActorIds = [
    ...new Set([...actorIds, ...authoredSceneActorIds(authored?.ops ?? [])]),
  ];
  if (requestedActorIds.length > 0) {
    const squad = spawnSquadForLinter(sim.ctx, {
      claimId: playbackKey,
      dungeonId: '',
      anchor: { x: 0, z: 3 },
      actorIds: requestedActorIds,
      humanCount: 1,
    });
    expect(squad, `failed to spawn synthetic scene subjects for ${id}`).not.toBeNull();
    expect(
      [...(squad?.actorIds.keys() ?? [])].sort(),
      `scene ${id} must resolve every authored actor`,
    ).toEqual([...requestedActorIds].sort());
    for (const [actorId, entityId] of squad?.actorIds ?? []) {
      entityLabels.set(entityId, `scene actor ${actorId}`);
    }
  }
  for (const subjectRef of authoredSubjectRefs(authored?.ops ?? [])) {
    const matchingIds: number[] = [];
    for (const entity of sim.entities.values()) {
      if (
        entity.templateId !== subjectRef &&
        entity.name !== subjectRef &&
        entity.squadActorId !== subjectRef
      ) {
        continue;
      }
      matchingIds.push(entity.id);
      if (!entityLabels.has(entity.id)) entityLabels.set(entity.id, subjectRef);
    }
    entityReferenceIds.set(subjectRef, matchingIds);
  }
  expect(
    playRegisteredScene(sim.ctx, sim.playerId, id),
    `failed to start registered scene ${id}`,
  ).toBe(true);
  const startedAt = sim.ctx.scenePlaybacks.get(playbackKey)?.startedAt;
  expect(startedAt, `registered scene ${id} did not create a playback`).toBeDefined();
  const startTime = startedAt ?? sim.time;
  const ops: TimedSceneOp[] = [];
  const trackedIds = new Set(entityLabels.keys());
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
      const at =
        event.op.kind === 'start'
          ? 0
          : event.op.kind === 'end' && duration !== null
            ? duration
            : roundTime(elapsed);
      const timedOp = { index: ops.length, at, op: event.op };
      ops.push(timedOp);
      for (const entityId of trackedEntityIds(event.op)) {
        trackedIds.add(entityId);
        const entity = sim.entities.get(entityId);
        entityLabels.set(
          entityId,
          entity?.squadActorId !== undefined
            ? `scene actor ${entity.squadActorId}`
            : (entity?.templateId ?? `scene entity ${entityId}`),
        );
      }
      if (event.op.kind === 'start') duration = event.op.duration;
      if (event.op.kind === 'end') ended = true;
    }
    frames.set(Math.round(elapsed * SHOT_SAMPLE_RATE_HZ), sceneFrame(sim, trackedIds));
  }

  expect(ended, `registered scene ${id} exceeded the capture limit`).toBe(true);
  expect(duration, `registered scene ${id} emitted no start duration`).not.toBeNull();
  return {
    id,
    seed: sim.cfg.seed,
    duration: duration ?? 0,
    ops,
    authoredOps: authored?.ops ?? [],
    frames,
    entityLabels,
    entityReferenceIds,
    riderHarbors,
  };
}

function resolveSyntheticRigPoint(point: { x: number; z: number; height: number }): SceneRigPoint {
  return {
    x: point.x,
    y: sampleTerrainHeight(point.x, point.z, WORLD_SEED) + point.height,
    z: point.z,
  };
}

function syntheticWireOp(op: SceneOpDef): SceneWireOp | null {
  switch (op.kind) {
    case 'camera': {
      if (op.shot.kind === 'release') {
        return {
          kind: 'camera',
          shot: op.shot.pose ? { kind: 'release', pose: op.shot.pose } : { kind: 'release' },
        };
      }
      if (op.shot.kind === 'focus') {
        if (op.shot.actorId !== undefined) {
          throw new Error('actor focus controls require authoritative Sim capture');
        }
        const x = op.shot.x ?? 0;
        const z = op.shot.z ?? 0;
        return {
          kind: 'camera',
          shot: {
            kind: 'focus',
            entityId: null,
            x,
            y: sampleTerrainHeight(x, z, WORLD_SEED),
            z,
            dist: op.shot.dist ?? 8,
            pitch: op.shot.pitch ?? 0.3,
            yaw: op.shot.yaw ?? 0,
            dur: op.shot.dur,
            ...(op.shot.entry ? { entry: op.shot.entry } : {}),
          },
        };
      }
      if (op.shot.kind === 'attach') {
        return {
          kind: 'camera',
          shot: {
            ...op.shot,
            fallbackFrame: {
              position: resolveSyntheticRigPoint(op.shot.fallbackFrame.point),
              yaw: op.shot.fallbackFrame.yaw,
            },
          },
        };
      }
      if (op.shot.lookAt.kind === 'subject') {
        throw new Error('subject controls require authoritative Sim capture');
      }
      return {
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: op.shot.points.map(resolveSyntheticRigPoint),
          lookAt:
            op.shot.lookAt.kind === 'point'
              ? { kind: 'point', point: resolveSyntheticRigPoint(op.shot.lookAt.point) }
              : {
                  kind: 'spline',
                  points: op.shot.lookAt.points.map(resolveSyntheticRigPoint),
                },
          dur: op.shot.dur,
          ...(op.shot.entry ? { entry: op.shot.entry } : {}),
        },
      };
    }
    case 'line':
      if (op.speakerActorId !== undefined) {
        throw new Error('actor line controls require authoritative Sim capture');
      }
      return {
        kind: 'line',
        speaker: op.speaker,
        speakerEntityId: null,
        key: op.key,
        dur: op.dur ?? 4,
      };
    case 'letterbox':
      return { kind: 'letterbox', on: op.on };
    case 'inputLock':
      return { kind: 'inputLock', on: op.on };
    case 'fade':
      return { kind: 'fade', to: op.to, dur: op.dur };
    case 'music':
      return { kind: 'music', directive: op.directive };
    case 'prop':
      return { kind: 'prop', target: op.target, cue: op.cue };
    case 'playerWalk':
    case 'actorMove':
    case 'actorFace':
    case 'anim':
      throw new Error(`${op.kind} controls require authoritative Sim capture`);
  }
}

function captureSyntheticControl(def: SceneDef): CapturedScene {
  const sortedOps = [...def.ops].sort((a, b) => a.at - b.at);
  const resolved = sortedOps.flatMap((op) => {
    const wire = syntheticWireOp(op);
    return wire === null ? [] : [{ at: op.at, op: wire }];
  });
  const ops: TimedSceneOp[] = [
    { index: 0, at: 0, op: { kind: 'start', duration: def.duration } },
    ...resolved.map((timed, index) => ({ index: index + 1, ...timed })),
    { index: resolved.length + 1, at: def.duration, op: { kind: 'end' } },
  ];
  const playerY = sampleTerrainHeight(0, 0, WORLD_SEED);
  const live: SceneLivePose = {
    yaw: 0,
    pitch: 0.32,
    dist: 12,
    playerX: 0,
    playerY,
    playerZ: 0,
  };
  const frames = new Map<number, SceneFrame>();
  for (let sample = 0; sample <= Math.ceil(def.duration * SHOT_SAMPLE_RATE_HZ); sample++) {
    frames.set(sample, { live, entities: new Map() });
  }
  return {
    id: def.id,
    seed: WORLD_SEED,
    duration: def.duration,
    ops,
    authoredOps: sortedOps,
    frames,
    entityLabels: new Map(),
    entityReferenceIds: new Map(),
    riderHarbors: new Map(),
  };
}

function applySyntheticPresentationFixture(
  scene: CapturedScene,
  fixture: SyntheticPresentationFixture | undefined,
): CapturedScene {
  if (
    fixture?.playerHeightOffset === undefined &&
    fixture?.playerStart === undefined &&
    fixture?.disableDeckRiding === undefined &&
    fixture?.disableLivePoseEase === undefined
  ) {
    return scene;
  }
  const frames = new Map<number, SceneFrame>();
  for (const [sample, frame] of scene.frames) {
    const playerX = fixture.playerStart?.x ?? frame.live.playerX;
    const playerZ = fixture.playerStart?.z ?? frame.live.playerZ;
    const basePlayerY =
      fixture.playerStart === undefined
        ? frame.live.playerY
        : sampleTerrainHeight(playerX, playerZ, scene.seed);
    frames.set(sample, {
      ...frame,
      live: {
        ...frame.live,
        playerX,
        playerY: basePlayerY + (fixture.playerHeightOffset ?? 0),
        playerZ,
      },
    });
  }
  return {
    ...scene,
    frames,
    disableDeckRiding: fixture?.disableDeckRiding,
    disableLivePoseEase: fixture?.disableLivePoseEase,
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

const PRESENTED_RIDER: HarborDeckRiderResolution = {
  entityId: 0,
  target: '',
  mode: 'none',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
};

function presentationFrameAt(
  scene: CapturedScene,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): SceneFrame {
  const frame = frameAt(scene, time);
  if (scene.disableDeckRiding) return frame;
  let entities: Map<number, EntityPoint> | null = null;
  for (const [entityId, harborId] of scene.riderHarbors) {
    const point = frame.entities.get(entityId);
    const harbor = HARBORS.find((candidate) => candidate.id === harborId);
    if (!point || !harbor || !activeProps.has(shipTarget(harbor))) continue;
    const resolution = resolveHarborDeckRider(
      {
        entityId,
        x: point.x,
        y: point.y,
        z: point.z,
        yaw: 0,
        midInteraction: false,
      },
      [
        {
          target: shipTarget(harbor),
          baseX: harbor.berth.x,
          baseY: runtimeWaterLevel - harbor.berth.draft,
          baseZ: harbor.berth.z,
          baseRot: harbor.berth.rot,
          frame: shipFrameAt(harbor, time, activeProps),
          shipDecks: harbor.shipDecks,
          displaced: true,
        },
      ],
      PRESENTED_RIDER,
    );
    if (resolution.mode !== 'ride') continue;
    entities ??= new Map(frame.entities);
    entities.set(entityId, {
      x: resolution.x,
      y: resolution.y,
      z: resolution.z,
    });
  }
  return entities ? { ...frame, entities } : frame;
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

function geometryForPose(pose: ScenePose): CameraGeometry {
  return cameraGeometry(sceneRigCameraPosition(pose), sceneRigLookAtPosition(pose));
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

function shipFrameAt(
  harbor: HarborDef,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): SceneAttachFrame {
  const pose = propPose(shipTarget(harbor), time, activeProps);
  return shipFrameForPose(harbor, pose);
}

function shipFrameForPose(
  harbor: HarborDef,
  pose: { x: number; y: number; z: number; yaw: number },
): SceneAttachFrame {
  const parked = parkedShipFrame(harbor, runtimeWaterLevel);
  return composeHarborShipAttachFrame(
    {
      baseX: parked.position.x,
      baseY: parked.position.y,
      baseZ: parked.position.z,
      baseRot: parked.yaw,
    },
    { ...pose, done: false },
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  );
}

function maximumPropSegmentSpeed(harbor: HarborDef, segment: PropPathSegment): number {
  return measureSegment(
    (elapsed) => shipFrameForPose(harbor, propPathPoseAt(segment, elapsed)).position,
    segment.duration,
    SHOT_SAMPLE_RATE_HZ,
  ).maximumSpeed;
}

function arrivalDirectionMetrics(
  harbor: HarborDef,
  segment: PropPathSegment,
): {
  seawardStart: number;
  yawSwing: number;
  bowFirst: number;
  berthDistance: number;
} {
  const startFrame = shipFrameForPose(harbor, propPathPoseAt(segment, 0));
  const endFrame = shipFrameForPose(harbor, propPathPoseAt(segment, segment.duration));
  const bow = { x: Math.cos(startFrame.yaw), y: 0, z: -Math.sin(startFrame.yaw) };
  return measureArrivalApproach({
    berth: harbor.berth,
    landward: harbor.arrival,
    start: startFrame.position,
    end: endFrame.position,
    bow,
    startYaw: startFrame.yaw,
    endYaw: endFrame.yaw,
  });
}

function shipDeckCenterAt(
  harbor: HarborDef,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): SceneRigPoint {
  const deck = harbor.shipDecks[0];
  const bounds = shipDeckLocalBounds(harbor, deck, runtimeWaterLevel);
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

function subjectReferencePointsAt(
  scene: CapturedScene,
  subjectRef: string,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
  frame: SceneFrame,
): SceneRigPoint[] {
  const candidates: SceneRigPoint[] = [];
  for (const fixture of PROPS.decorProps ?? []) {
    if (
      fixture.key !== subjectRef &&
      !(fixture.parts ?? []).some((part) => part.key === subjectRef)
    ) {
      continue;
    }
    candidates.push({
      x: fixture.x,
      y:
        sampleTerrainHeight(fixture.x, fixture.z, scene.seed) +
        (fixture.h ?? NOMINAL_SUBJECT_HEIGHT_YARDS) / 2,
      z: fixture.z,
    });
  }
  for (const entityId of scene.entityReferenceIds.get(subjectRef) ?? []) {
    const point = frame.entities.get(entityId);
    if (point) {
      candidates.push({ ...point, y: point.y + NOMINAL_SUBJECT_HEIGHT_YARDS });
    }
  }
  const harbor = HARBORS.find((candidate) => shipTarget(candidate) === subjectRef);
  if (harbor) {
    const deckCenter = shipDeckCenterAt(harbor, time, activeProps);
    candidates.push({ ...deckCenter, y: deckCenter.y + NOMINAL_SUBJECT_HEIGHT_YARDS / 2 });
  }
  return candidates;
}

function cameraVolumeIntrusion(
  camera: SceneRigPoint,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
): { label: string; clearance: number } | null {
  for (const harbor of HARBORS) {
    for (const deck of harbor.decks) {
      if (
        Math.abs(camera.x - deck.x) > deck.hw + PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS ||
        Math.abs(camera.z - deck.z) > deck.hd + PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS
      ) {
        continue;
      }
      const clearance = camera.y - deck.y - PIER_KEEP_OUT_HEIGHT_YARDS;
      if (clearance < 0) {
        return { label: `${harbor.id} deck`, clearance };
      }
    }
    for (const ramp of harbor.ramps) {
      if (
        Math.abs(camera.x - ramp.x) > ramp.hw + PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS ||
        Math.abs(camera.z - ramp.z) > ramp.hd + PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS
      ) {
        continue;
      }
      const clearance = camera.y - Math.max(ramp.highY, ramp.lowY) - PIER_KEEP_OUT_HEIGHT_YARDS;
      if (clearance < 0) return { label: `${harbor.id} ramp`, clearance };
    }
    const clearance = shipHullPointClearance(
      harbor,
      shipFrameAt(harbor, time, activeProps),
      camera,
      runtimeWaterLevel,
      PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS,
    );
    if (clearance < 0) return { label: `${harbor.id} live ship model`, clearance };
  }
  return null;
}

interface SightLineOcclusion {
  readonly label: string;
  readonly clearance: number;
  readonly point: SceneRigPoint;
  readonly distanceFromCamera: number;
}

function sightLineOcclusion(
  camera: SceneRigPoint,
  subject: SceneRigPoint,
  seed: number,
  time: number,
  activeProps: ReadonlyMap<string, ActiveProp>,
  // 'deck' caps hull volumes at deck height (a shot may look across the deck);
  // 'camera' keeps their full authored camera tops, so masts and rigging count
  // as the solid structure a restored gameplay camera must not sit behind.
  hullTops: 'deck' | 'camera' = 'deck',
): SightLineOcclusion | null {
  const delta = subtract(subject, camera);
  const distance = length(delta);
  let worst: SightLineOcclusion | null = null;
  const consider = (label: string, clearance: number, point: SceneRigPoint, traveled: number) => {
    if (clearance >= 0 || (worst !== null && clearance >= worst.clearance)) return;
    worst = { label, clearance, point, distanceFromCamera: traveled };
  };
  for (
    let traveled = SIGHT_LINE_NEAR_CAMERA_CLEARANCE_YARDS;
    traveled < distance - SIGHT_LINE_STEP_YARDS * 0.5;
    traveled += SIGHT_LINE_STEP_YARDS
  ) {
    const point = add(camera, scale(delta, traveled / distance));
    const terrainClearance =
      point.y - sampleTerrainHeight(point.x, point.z, seed) - SIGHT_LINE_TERRAIN_MARGIN_YARDS;
    consider('terrain', terrainClearance, point, traveled);
    for (const harbor of HARBORS) {
      for (const [index, deck] of harbor.decks.entries()) {
        if (!pointInsideDeck(deck, point.x, point.z)) continue;
        const clearance = point.y - deck.y - SIGHT_LINE_TERRAIN_MARGIN_YARDS;
        consider(`${harbor.id} deck ${index}`, clearance, point, traveled);
      }
      const rampY = harborRampHeight(harbor, point.x, point.z);
      if (rampY !== Number.NEGATIVE_INFINITY) {
        const clearance = point.y - rampY - SIGHT_LINE_TERRAIN_MARGIN_YARDS;
        consider(`${harbor.id} ramp`, clearance, point, traveled);
      }
      const hullTopY =
        hullTops === 'camera'
          ? Number.POSITIVE_INFINITY
          : Math.max(
              ...harbor.shipDecks.map(
                (deck) => shipDeckLocalBounds(harbor, deck, runtimeWaterLevel).centerY,
              ),
            );
      const clearance = shipHullPointClearance(
        harbor,
        shipFrameAt(harbor, time, activeProps),
        point,
        runtimeWaterLevel,
        0,
        hullTopY,
      );
      consider(`${harbor.id} ship hull`, clearance, point, traveled);
    }
  }
  return worst;
}

// A cut counts as fully clear only below this overlay opacity: mid-fade cuts
// (any visible veil) are never a legitimate transition.
const FADE_OPACITY_EPSILON = 0.001;

function opKind(op: SceneWireOp): string {
  return op.kind === 'camera' ? `camera/${op.shot.kind}` : op.kind;
}

function authoredOpKind(op: SceneOpDef): string {
  return op.kind === 'camera' ? `camera/${op.shot.kind}` : op.kind;
}

function violationMessage(violation: Violation): string {
  return `${violation.sceneId} op ${violation.opIndex} (${violation.opKind}) at ${violation.time.toFixed(
    2,
  )}s: ${violation.check} requires ${violation.threshold}, measured ${violation.measured}`;
}

function fadeOpacityAfterSceneOps(
  scene: CapturedScene,
  time: number,
  beforeIndex = Number.POSITIVE_INFINITY,
): number {
  const overlay = createSceneOverlayState();
  const precedingOps = scene.ops
    .filter((timed) => timed.index < beforeIndex && timed.at <= time + SCENE_TIME_EPSILON_SECONDS)
    .sort((a, b) => a.at - b.at || a.index - b.index);
  for (const timed of precedingOps) {
    sceneOverlayView(overlay, timed.at);
    overlayApplyOp(overlay, timed.op, timed.at);
  }
  return sceneOverlayView(overlay, time).fadeOpacity;
}

function fadeOpacityAfterAuthoredFades(
  scene: CapturedScene,
  time: number,
  beforeIndex: number,
): number {
  const overlay = createSceneOverlayState();
  const precedingFades: {
    index: number;
    op: Extract<SceneOpDef, { kind: 'fade' }>;
  }[] = [];
  for (const [index, op] of scene.authoredOps.entries()) {
    if (index < beforeIndex && op.kind === 'fade' && op.at <= time + SCENE_TIME_EPSILON_SECONDS) {
      precedingFades.push({ index, op });
    }
  }
  precedingFades.sort((a, b) => a.op.at - b.op.at || a.index - b.index);
  for (const timed of precedingFades) {
    sceneOverlayView(overlay, timed.op.at);
    overlayApplyOp(overlay, timed.op, timed.op.at);
  }
  return sceneOverlayView(overlay, time).fadeOpacity;
}

function lintFilmGrammar(
  scene: CapturedScene,
  cameraOps: readonly TimedCameraOp[],
  report: (violation: Violation) => void,
): void {
  for (const [index, op] of scene.authoredOps.entries()) {
    if (
      !Number.isFinite(op.at) ||
      op.at < -SCENE_TIME_EPSILON_SECONDS ||
      op.at > scene.duration + SCENE_TIME_EPSILON_SECONDS
    ) {
      report({
        sceneId: scene.id,
        check: 'timing.opWithinDuration',
        opIndex: index + 1,
        opKind: authoredOpKind(op),
        time: op.at,
        threshold: `an authored at from 0.00s through ${scene.duration.toFixed(2)}s`,
        measured: `${op.at.toFixed(2)}s`,
      });
    }
  }

  for (const [index, op] of scene.authoredOps.entries()) {
    if (op.kind !== 'fade') continue;
    const opacityBefore = fadeOpacityAfterAuthoredFades(scene, op.at, index);
    const targetOpacity = op.to === 'black' ? FULL_BLACK_OPACITY : 0;
    const changesOpacity = Math.abs(opacityBefore - targetOpacity) > SCENE_TIME_EPSILON_SECONDS;
    if (
      changesOpacity &&
      (!Number.isFinite(op.dur) ||
        op.dur < MIN_PERCEPTUAL_FADE_SECONDS - SCENE_TIME_EPSILON_SECONDS)
    ) {
      report({
        sceneId: scene.id,
        check: 'cut.fadeSlack',
        opIndex: index + 1,
        opKind: authoredOpKind(op),
        time: op.at,
        threshold: `fade-out and fade-in transitions lasting at least ${MIN_PERCEPTUAL_FADE_SECONDS.toFixed(
          2,
        )}s`,
        measured: `fade/${op.to} from ${opacityBefore.toFixed(3)} over ${op.dur.toFixed(2)}s`,
      });
    }
    if (op.to !== 'black') continue;
    const hasLaterClear = scene.authoredOps
      .slice(index + 1)
      .some(
        (candidate) =>
          candidate.kind === 'fade' && candidate.to === 'clear' && candidate.at < scene.duration,
      );
    if (!hasLaterClear) {
      report({
        sceneId: scene.id,
        check: 'fade.symmetry',
        opIndex: index + 1,
        opKind: authoredOpKind(op),
        time: op.at,
        threshold: 'a later authored fade/clear before scene end',
        measured: `fade/black has no later clear before ${scene.duration.toFixed(2)}s`,
      });
    }
  }

  const firstShot = cameraOps.find((timed) => timed.op.shot.kind !== 'release');
  for (const cut of cameraOps) {
    const cutOpacity = fadeOpacityAfterSceneOps(scene, cut.at);
    const easesFromLivePose =
      cut.op.shot.kind !== 'release' &&
      sceneShotEasesFromLivePose(cut.op.shot) &&
      !scene.disableLivePoseEase;
    // A cut is legitimate at FULL BLACK (covered), or FULLY CLEAR when the
    // transition is authored: a snap shot is a deliberate hard cut, an
    // easing shot glides in continuously, and a release eases to gameplay
    // by construction (cut.releaseDelta and cut.releaseSightLine own its
    // quality). A cut MID-FADE is never legitimate, and an uncovered cut
    // with no authored intent is the unreviewed pop this check exists for.
    const snapCut = cut.op.shot.kind !== 'release' && cut.op.shot.entry === 'snap';
    const clearCut =
      cutOpacity <= FADE_OPACITY_EPSILON &&
      (snapCut || easesFromLivePose || cut.op.shot.kind === 'release');
    if (
      cut.index === firstShot?.index &&
      cutOpacity < FULL_BLACK_OPACITY &&
      !easesFromLivePose &&
      !(snapCut && cutOpacity <= FADE_OPACITY_EPSILON)
    ) {
      report({
        sceneId: scene.id,
        check: 'cut.firstTransition',
        opIndex: cut.index,
        opKind: opKind(cut.op),
        time: cut.at,
        threshold:
          'full black at the first cut, an authored snap cut at fully clear, or a shot eased from the live camera pose',
        measured: `${opKind(cut.op)} without full black, fade ${cutOpacity.toFixed(3)}`,
      });
    }
    if (cutOpacity < FULL_BLACK_OPACITY && !clearCut) {
      report({
        sceneId: scene.id,
        check: 'cut.fadeSlack',
        opIndex: cut.index,
        opKind: opKind(cut.op),
        time: cut.at,
        threshold:
          'full black at the camera cut, or a fully clear cut with an authored snap, ease, or release',
        measured: `fade ${cutOpacity.toFixed(3)} after co-timed cut ops`,
      });
    }
  }

  const hasAuthoredShot = scene.authoredOps.some(
    (op) => op.kind === 'camera' && op.shot.kind !== 'release',
  );
  if (!hasAuthoredShot) return;
  const hasRelease = scene.authoredOps.some(
    (op) => op.kind === 'camera' && op.shot.kind === 'release',
  );
  const hasUnlock = scene.authoredOps.some((op) => op.kind === 'inputLock' && !op.on);
  const hasLetterboxOff = scene.authoredOps.some((op) => op.kind === 'letterbox' && !op.on);
  if (hasRelease && hasUnlock && hasLetterboxOff) return;
  const context =
    [...scene.ops].reverse().find((timed) => timed.op.kind === 'end') ?? scene.ops.at(-1);
  report({
    sceneId: scene.id,
    check: 'cut.teardown',
    opIndex: context?.index ?? scene.authoredOps.length,
    opKind: context ? opKind(context.op) : 'scene',
    time: scene.duration,
    threshold: 'authored camera/release, input unlock, and letterbox off ops',
    measured: `release=${hasRelease}, inputUnlock=${hasUnlock}, letterboxOff=${hasLetterboxOff}`,
  });
}

interface CollisionSupportState {
  readonly hullOps: Set<number>;
  readonly unsupportedEntities: Set<string>;
  readonly uncontainedRiders: Set<string>;
}

function lintCollisionAndSupportSample(
  scene: CapturedScene,
  time: number,
  frame: SceneFrame,
  context: TimedSceneOp,
  activeProps: ReadonlyMap<string, ActiveProp>,
  state: CollisionSupportState,
  report: (violation: Violation) => void,
): void {
  const activeShips: {
    harbor: HarborDef;
    active: ActiveProp;
    frame: SceneAttachFrame;
  }[] = [];
  for (const [target, active] of activeProps) {
    const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
    if (!harbor) continue;
    const liveFrame = shipFrameAt(harbor, time, activeProps);
    activeShips.push({ harbor, active, frame: liveFrame });
    if (!state.hullOps.has(active.timedOp.index)) {
      const collision = hullWorldCollision(harbor, liveFrame, scene.seed, {
        terrainHeight: sampleTerrainHeight,
        waterLevel: runtimeWaterLevel,
      });
      if (collision) {
        state.hullOps.add(active.timedOp.index);
        report({
          sceneId: scene.id,
          check: 'collision.hull',
          opIndex: active.timedOp.index,
          opKind: opKind(active.timedOp.op),
          time,
          threshold: `no penetration beyond ${HULL_INTERSECTION_EPSILON_YARDS.toFixed(
            2,
          )} yd into pier decks, ramps, terrain, or the water floor`,
          measured: `${harbor.id} hull penetrates ${collision.label} by ${collision.penetration.toFixed(
            2,
          )} yd`,
        });
      }
    }
  }

  const previousFrame =
    time <= SAMPLE_INTERVAL_SEC / 2
      ? frame
      : frameAt(scene, Math.max(0, time - SAMPLE_INTERVAL_SEC));
  const playerPoint = {
    x: frame.live.playerX,
    y: frame.live.playerY,
    z: frame.live.playerZ,
  };
  const playerMoved =
    Math.hypot(
      playerPoint.x - previousFrame.live.playerX,
      playerPoint.y - previousFrame.live.playerY,
      playerPoint.z - previousFrame.live.playerZ,
    ) > RIDER_WALK_STEP_EPSILON_YARDS;
  const supportEntities: {
    key: string;
    label: string;
    point: EntityPoint;
    context: TimedSceneOp;
  }[] = [];
  if (activeShips.length === 0 || playerMoved) {
    supportEntities.push({ key: 'player', label: 'player', point: playerPoint, context });
  }
  for (const [entityId, point] of frame.entities) {
    const riderHarborId = scene.riderHarbors.get(entityId);
    const riderShip = activeShips.find(({ harbor }) => harbor.id === riderHarborId);
    supportEntities.push({
      key: `entity:${entityId}`,
      label: scene.entityLabels.get(entityId) ?? `scene entity ${entityId}`,
      point,
      context: riderShip?.active.timedOp ?? context,
    });
  }
  for (const activeShip of activeShips) {
    supportEntities.push({
      key: `stand-in:${activeShip.harbor.id}`,
      label: `${activeShip.harbor.id} deck stand-in`,
      point: deckStandInPoint(activeShip.harbor, activeShip.frame, runtimeWaterLevel),
      context: activeShip.active.timedOp,
    });
  }

  for (const entity of supportEntities) {
    if (state.unsupportedEntities.has(entity.key)) continue;
    const support = evaluateEntitySupport(
      entity.point,
      supportSurfacesAt(entity.point, scene.seed, {
        terrainHeight: sampleTerrainHeight,
        waterLevel: runtimeWaterLevel,
        shipFrameAt: (harbor) => shipFrameAt(harbor, time, activeProps),
      }),
    );
    if (support.passing) continue;
    state.unsupportedEntities.add(entity.key);
    report({
      sceneId: scene.id,
      check: 'support.entity',
      opIndex: entity.context.index,
      opKind: opKind(entity.context.op),
      time,
      threshold: `every presentation entity within ${ENTITY_SUPPORT_EPSILON_YARDS.toFixed(
        2,
      )} yd of terrain, a pier or ramp, or a displaced ship deck`,
      measured: `${entity.label} is ${Math.abs(support.gap).toFixed(2)} yd ${
        support.gap >= 0 ? 'above' : 'below'
      } ${support.nearest.label}`,
    });
  }

  const checkRider = (
    key: string,
    label: string,
    point: EntityPoint,
    activeShip: (typeof activeShips)[number],
  ): void => {
    if (state.uncontainedRiders.has(key)) return;
    const measured = riderDeckViolation(
      label,
      activeShip.harbor,
      activeShip.frame,
      point,
      runtimeWaterLevel,
    );
    if (measured === null) return;
    state.uncontainedRiders.add(key);
    report({
      sceneId: scene.id,
      check: 'containment.rider',
      opIndex: activeShip.active.timedOp.index,
      opKind: opKind(activeShip.active.timedOp.op),
      time,
      threshold: `rider centers inside displaced deck bounds within ${RIDER_DECK_EDGE_EPSILON_YARDS.toFixed(
        2,
      )} yd and feet within ${ENTITY_SUPPORT_EPSILON_YARDS.toFixed(2)} yd of deck`,
      measured,
    });
  };

  for (const activeShip of activeShips) {
    checkRider(
      `stand-in:${activeShip.harbor.id}`,
      'deck stand-in',
      deckStandInPoint(activeShip.harbor, activeShip.frame, runtimeWaterLevel),
      activeShip,
    );
    for (const [entityId, harborId] of scene.riderHarbors) {
      if (harborId !== activeShip.harbor.id) continue;
      const point = frame.entities.get(entityId);
      if (!point) continue;
      checkRider(
        `entity:${entityId}`,
        scene.entityLabels.get(entityId) ?? `scene entity ${entityId}`,
        point,
        activeShip,
      );
    }
    if (playerMoved) checkRider('walking-player', 'walking player', playerPoint, activeShip);
  }
}

function propMotionVelocity(
  previous: PropMotionSample,
  current: PropMotionSample,
): SceneRigPoint | null {
  const dt = current.time - previous.time;
  if (dt <= SCENE_TIME_EPSILON_SECONDS || dt > SAMPLE_INTERVAL_SEC * 1.5) return null;
  return scale(subtract(current.position, previous.position), 1 / dt);
}

function samePropCameraWindow(previous: PropMotionSample, current: PropMotionSample): boolean {
  return (
    previous.active.timedOp.index === current.active.timedOp.index &&
    previous.cameraOp.index === current.cameraOp.index
  );
}

function propVisible(sample: PropMotionSample): boolean {
  return sample.inFrame && !sample.fullBlack;
}

function lintPropMotionQuality(
  scene: CapturedScene,
  samples: readonly PropMotionSample[],
  report: (violation: Violation) => void,
): void {
  const byCue = new Map<number, PropMotionSample[]>();
  for (const sample of samples) {
    const cueSamples = byCue.get(sample.active.timedOp.index);
    if (cueSamples) cueSamples.push(sample);
    else byCue.set(sample.active.timedOp.index, [sample]);
  }
  const reportedWay = new Set<number>();
  const reportedAcceleration = new Set<number>();

  for (const cueSamples of byCue.values()) {
    const context = cueSamples[0];
    if (!context) continue;
    const harbor = HARBORS.find((candidate) => shipTarget(candidate) === context.target);
    if (!harbor) continue;
    const start = shipFrameForPose(harbor, propPathPoseAt(context.active.segment, 0)).position;
    const end = shipFrameForPose(
      harbor,
      propPathPoseAt(context.active.segment, context.active.segment.duration),
    ).position;
    const vesselUnderWay = length(subtract(end, start)) > MIN_PROP_PATH_TRAVEL_YARDS;
    if (!vesselUnderWay) continue;

    for (let index = 1; index < cueSamples.length; index++) {
      const previous = cueSamples[index - 1];
      const current = cueSamples[index];
      if (
        !previous ||
        !current ||
        !samePropCameraWindow(previous, current) ||
        !previous.fullBlack ||
        current.fullBlack ||
        !current.inFrame ||
        current.time - current.active.startedAt >= current.active.segment.duration ||
        reportedWay.has(current.active.timedOp.index)
      ) {
        continue;
      }
      const velocity = propMotionVelocity(previous, current);
      if (!velocity) continue;
      const way = length(velocity);
      if (way >= MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC) continue;
      reportedWay.add(current.active.timedOp.index);
      report({
        sceneId: scene.id,
        check: 'motion.propWay',
        opIndex: current.active.timedOp.index,
        opKind: opKind(current.active.timedOp.op),
        time: current.time,
        threshold: `at least ${MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC.toFixed(
          2,
        )} yd/s way when a fade reveals a vessel under way`,
        measured: `${way.toFixed(2)} yd/s way at fade-in for ${current.target}`,
      });
    }

    for (let index = 2; index < cueSamples.length; index++) {
      const first = cueSamples[index - 2];
      const middle = cueSamples[index - 1];
      const current = cueSamples[index];
      if (
        !first ||
        !middle ||
        !current ||
        !samePropCameraWindow(first, middle) ||
        !samePropCameraWindow(middle, current) ||
        !propVisible(first) ||
        !propVisible(middle) ||
        !propVisible(current)
      ) {
        continue;
      }
      const previousVelocity = propMotionVelocity(first, middle);
      const currentVelocity = propMotionVelocity(middle, current);
      if (!previousVelocity || !currentVelocity) continue;
      const previousWay = length(previousVelocity);
      const currentWay = length(currentVelocity);

      if (
        !reportedWay.has(current.active.timedOp.index) &&
        previousWay >= MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC &&
        currentWay < MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC
      ) {
        reportedWay.add(current.active.timedOp.index);
        report({
          sceneId: scene.id,
          check: 'motion.propWay',
          opIndex: current.active.timedOp.index,
          opKind: opKind(current.active.timedOp.op),
          time: current.time,
          threshold: `at least ${MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC.toFixed(
            2,
          )} yd/s while a vessel under way remains on camera`,
          measured: `way fell from ${previousWay.toFixed(2)} to ${currentWay.toFixed(
            2,
          )} yd/s for ${current.target}`,
        });
      }

      if (reportedAcceleration.has(current.active.timedOp.index)) continue;
      const dt = (current.time - first.time) / 2;
      if (dt <= SCENE_TIME_EPSILON_SECONDS) continue;
      const acceleration = length(subtract(currentVelocity, previousVelocity)) / dt;
      if (acceleration <= MAX_ON_CAMERA_PROP_ACCELERATION_YARDS_PER_SEC_SQUARED) continue;
      reportedAcceleration.add(current.active.timedOp.index);
      report({
        sceneId: scene.id,
        check: 'motion.propAcceleration',
        opIndex: current.active.timedOp.index,
        opKind: opKind(current.active.timedOp.op),
        time: current.time,
        threshold: `at most ${MAX_ON_CAMERA_PROP_ACCELERATION_YARDS_PER_SEC_SQUARED.toFixed(
          2,
        )} yd/s^2 on-camera vessel acceleration`,
        measured: `${acceleration.toFixed(2)} yd/s^2 acceleration for ${current.target}`,
      });
    }
  }
}

function lintMinimumVisualMotion(
  scene: CapturedScene,
  shotOps: readonly TimedCameraOp[],
  samples: readonly CameraSample[],
  report: (violation: Violation) => void,
): void {
  for (const shot of shotOps) {
    const visible = samples.filter(
      (sample) =>
        sample.timedOp.index === shot.index &&
        !sample.entryEase &&
        !sample.fullBlack &&
        sample.subject !== null &&
        sample.subjectScreen !== null,
    );
    const first = visible[0];
    if (!first?.subject || !first.subjectScreen) continue;
    const subjectRay = normalize(subtract(first.subject, first.geometry.camera));
    const background = add(first.subject, scale(subjectRay, SHOT_PARALLAX_REFERENCE_DEPTH_YARDS));
    const firstBackgroundScreen = screenPoint(first.geometry, background);
    let maximumSubjectMotion = 0;
    let maximumCameraPositionDelta = 0;
    let maximumCameraOrientationDelta = 0;
    let maximumParallax = 0;

    for (const sample of visible.slice(1)) {
      if (!sample.subjectScreen) continue;
      const subjectDelta = {
        x: sample.subjectScreen.x - first.subjectScreen.x,
        y: sample.subjectScreen.y - first.subjectScreen.y,
      };
      maximumSubjectMotion = Math.max(
        maximumSubjectMotion,
        Math.hypot(subjectDelta.x, subjectDelta.y),
      );
      maximumCameraPositionDelta = Math.max(
        maximumCameraPositionDelta,
        length(subtract(sample.geometry.camera, first.geometry.camera)),
      );
      maximumCameraOrientationDelta = Math.max(
        maximumCameraOrientationDelta,
        directionAngleDeg(sample.geometry.forward, first.geometry.forward),
      );
      const backgroundScreen = screenPoint(sample.geometry, background);
      const backgroundDelta = {
        x: backgroundScreen.x - firstBackgroundScreen.x,
        y: backgroundScreen.y - firstBackgroundScreen.y,
      };
      maximumParallax = Math.max(
        maximumParallax,
        Math.hypot(subjectDelta.x - backgroundDelta.x, subjectDelta.y - backgroundDelta.y),
      );
    }

    if (
      maximumSubjectMotion > MIN_SHOT_SUBJECT_SCREEN_MOTION ||
      maximumCameraPositionDelta > MIN_SHOT_CAMERA_POSITION_DELTA_YARDS ||
      maximumCameraOrientationDelta > MIN_SHOT_CAMERA_ORIENTATION_DELTA_DEG ||
      maximumParallax > MIN_SHOT_PARALLAX
    ) {
      continue;
    }
    report({
      sceneId: scene.id,
      check: 'motion.visualFloor',
      opIndex: shot.index,
      opKind: opKind(shot.op),
      time: first.time,
      threshold: `subject screen motion above ${MIN_SHOT_SUBJECT_SCREEN_MOTION.toFixed(
        3,
      )}, camera pose delta above ${MIN_SHOT_CAMERA_POSITION_DELTA_YARDS.toFixed(
        2,
      )} yd or ${MIN_SHOT_CAMERA_ORIENTATION_DELTA_DEG.toFixed(
        2,
      )} deg, or parallax above ${MIN_SHOT_PARALLAX.toFixed(3)}`,
      measured: `subject ${maximumSubjectMotion.toFixed(
        4,
      )}, camera ${maximumCameraPositionDelta.toFixed(
        2,
      )} yd and ${maximumCameraOrientationDelta.toFixed(
        2,
      )} deg, parallax ${maximumParallax.toFixed(4)}`,
    });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sampledDirectiveSfxKey(directive: string): string | null {
  const escaped = escapeRegExp(directive);
  const property = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(directive) ? escaped : `['"]${escaped}['"]`;
  const match = SCENE_SFX_SOURCE.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*['"]([^'"]+)['"]`));
  return match?.[1] ?? null;
}

function translationText(table: unknown, key: string): string | null {
  let current = table;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object' || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

function readLocaleTranslationFills(
  lineKeys: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const fills = new Map<string, Map<string, string>>();
  for (const lang of SUPPORTED_LANGUAGES) fills.set(lang, new Map());
  for (const { file, full } of LOCALE_OVERLAY_FILES) {
    const lang = path.basename(file, '.ts');
    const source = readFileSync(full, 'utf8');
    if (![...lineKeys].some((key) => source.includes(`'${key}'`) || source.includes(`"${key}"`))) {
      continue;
    }
    const sourceFile = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, false);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) {
        const key = node.name.text;
        if (lineKeys.has(key)) {
          if (!ts.isStringLiteralLike(node.initializer)) {
            throw new Error(`${file}: scene line fill ${key} must be a string literal`);
          }
          fills.get(lang)?.set(key, node.initializer.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return fills;
}

function subtitleCharacterCount(text: string): number {
  return Array.from(text.trim()).length;
}

function lintSceneReferences(scene: CapturedScene, report: (violation: Violation) => void): void {
  const sampledDirectives: ReadonlySet<string> = new Set(SCENE_SAMPLED_MUSIC_DIRECTIVES);
  for (const timed of scene.ops) {
    if (timed.op.kind === 'music') {
      const directive = timed.op.directive;
      const sampledKey = sampledDirectives.has(directive)
        ? sampledDirectiveSfxKey(directive)
        : null;
      const resolved =
        RESOLVED_DIRECTOR_MUSIC_DIRECTIVES.has(directive) ||
        FUTURE_MUSIC_DIRECTIVES.has(directive) ||
        (sampledKey !== null && SHIPPED_SFX_KEYS.has(sampledKey));
      if (!resolved) {
        report({
          sceneId: scene.id,
          check: 'reference.music',
          opIndex: timed.index,
          opKind: opKind(timed.op),
          time: timed.at,
          threshold:
            'a director directive, shipped sampled mapping, or explicit future-phase directive',
          measured: `unresolved directive ${directive}`,
        });
      }
      continue;
    }
    if (timed.op.kind !== 'line') continue;
    const english = translationText(en, timed.op.key);
    if (english === null) {
      report({
        sceneId: scene.id,
        check: 'reference.lineKey',
        opIndex: timed.index,
        opKind: opKind(timed.op),
        time: timed.at,
        threshold: 'a leaf in the generated i18n catalog registry',
        measured: `missing key ${timed.op.key}`,
      });
      continue;
    }
    for (const lang of SUPPORTED_LANGUAGES) {
      // Sparse overlays contain real fills only. An omitted pending row deliberately uses English.
      const localized = localeTranslationFills.get(lang)?.get(timed.op.key) ?? english;
      const chars = subtitleCharacterCount(localized);
      const minimumSeconds = chars / SUBTITLE_READ_TIME_FLOOR_CHARACTERS_PER_SECOND;
      if (timed.op.dur + SCENE_TIME_EPSILON_SECONDS >= minimumSeconds) continue;
      const measuredCps = timed.op.dur > 0 ? (chars / timed.op.dur).toFixed(2) : 'infinite';
      report({
        sceneId: scene.id,
        check: 'reference.subtitleReadTime',
        opIndex: timed.index,
        opKind: opKind(timed.op),
        time: timed.at,
        threshold: `at least ${minimumSeconds.toFixed(2)}s for ${lang} at ${SUBTITLE_READ_TIME_FLOOR_CHARACTERS_PER_SECOND} chars/s`,
        measured: `${lang} has ${chars} chars in ${timed.op.dur.toFixed(2)}s (${measuredCps} chars/s)`,
      });
    }
  }
}

function activePropsAt(scene: CapturedScene, time: number): Map<string, ActiveProp> {
  const activeProps = new Map<string, ActiveProp>();
  for (const timed of scene.ops) {
    if (timed.at > time + SCENE_TIME_EPSILON_SECONDS || timed.op.kind !== 'prop') continue;
    if (timed.op.cue === LB_PROP_CUE_PARK) {
      activeProps.delete(timed.op.target);
      continue;
    }
    const segment = PROP_SEGMENTS[timed.op.cue];
    if (segment) {
      activeProps.set(timed.op.target, {
        segment,
        startedAt: timed.at,
        timedOp: timed,
      });
    }
  }
  return activeProps;
}

function lintSubjectReferences(
  scene: CapturedScene,
  samples: readonly CameraSample[],
  report: (violation: Violation) => void,
): void {
  const authoredCameras = scene.authoredOps.filter(
    (op): op is Extract<SceneOpDef, { kind: 'camera' }> => op.kind === 'camera',
  );
  const timedCameras = scene.ops.filter(
    (timed): timed is TimedCameraOp => timed.op.kind === 'camera',
  );
  for (let index = 0; index < authoredCameras.length; index++) {
    const authored = authoredCameras[index];
    if (authored.shot.kind === 'release' || !authored.shot.subjectRef) continue;
    const subjectRef = authored.shot.subjectRef;
    const timed = timedCameras[index];
    const sample = timed
      ? samples.find((candidate) => candidate.timedOp.index === timed.index && !candidate.entryEase)
      : undefined;
    const lookAt = sample?.geometry.lookAt;
    const candidates = sample
      ? subjectReferencePointsAt(
          scene,
          subjectRef,
          sample.time,
          activePropsAt(scene, sample.time),
          frameAt(scene, sample.time),
        )
      : [];
    const nearest =
      lookAt === undefined
        ? Number.POSITIVE_INFINITY
        : Math.min(
            ...candidates.map((candidate) =>
              Math.hypot(candidate.x - lookAt.x, candidate.z - lookAt.z),
            ),
          );
    if (nearest <= SUBJECT_REFERENCE_RADIUS_YARDS) continue;
    report({
      sceneId: scene.id,
      check: 'reference.subject',
      opIndex: timed?.index ?? -1,
      opKind: timed ? opKind(timed.op) : 'camera',
      time: timed?.at ?? authored.at,
      threshold: `${subjectRef} within ${SUBJECT_REFERENCE_RADIUS_YARDS.toFixed(1)} yd of the shot look-at`,
      measured:
        candidates.length === 0
          ? `no presentation entity or fixture named ${subjectRef}`
          : `nearest ${subjectRef} is ${nearest.toFixed(2)} yd away`,
    });
  }
}

interface SceneTriggerSource {
  readonly file: string;
  readonly source: string;
}

function expressionSceneIds(
  expression: ts.Expression,
  registeredIds: ReadonlySet<string>,
  bindings: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  if (ts.isStringLiteralLike(expression)) {
    return registeredIds.has(expression.text) ? new Set([expression.text]) : new Set();
  }
  if (ts.isIdentifier(expression)) return new Set(bindings.get(expression.text) ?? []);
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return expressionSceneIds(expression.expression, registeredIds, bindings);
  }
  if (ts.isConditionalExpression(expression)) {
    return new Set([
      ...expressionSceneIds(expression.whenTrue, registeredIds, bindings),
      ...expressionSceneIds(expression.whenFalse, registeredIds, bindings),
    ]);
  }
  if (ts.isBinaryExpression(expression)) {
    return new Set([
      ...expressionSceneIds(expression.left, registeredIds, bindings),
      ...expressionSceneIds(expression.right, registeredIds, bindings),
    ]);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return new Set(
      expression.elements.flatMap((element) =>
        ts.isSpreadElement(element)
          ? []
          : [...expressionSceneIds(element, registeredIds, bindings)],
      ),
    );
  }
  return new Set();
}

function sourceSceneTriggers(
  triggerSource: SceneTriggerSource,
  registeredIds: ReadonlySet<string>,
): Set<string> {
  const sourceFile = ts.createSourceFile(
    triggerSource.file,
    triggerSource.source,
    ts.ScriptTarget.Latest,
    true,
  );
  const initializers: Array<{ name: string; expression: ts.Expression }> = [];
  const collectInitializers = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      initializers.push({ name: node.name.text, expression: node.initializer });
    }
    ts.forEachChild(node, collectInitializers);
  };
  collectInitializers(sourceFile);

  const bindings = new Map<string, Set<string>>();
  for (let pass = 0; pass <= initializers.length; pass++) {
    let changed = false;
    for (const initializer of initializers) {
      const resolved = expressionSceneIds(initializer.expression, registeredIds, bindings);
      const current = bindings.get(initializer.name) ?? new Set<string>();
      const next = new Set([...current, ...resolved]);
      if (next.size === current.size) continue;
      bindings.set(initializer.name, next);
      changed = true;
    }
    if (!changed) break;
  }

  const triggered = new Set<string>();
  const addExpression = (expression: ts.Expression | undefined): void => {
    if (!expression) return;
    for (const sceneId of expressionSceneIds(expression, registeredIds, bindings)) {
      triggered.add(sceneId);
    }
  };
  const visitTriggers = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : null;
      if (name === 'sceneId') addExpression(node.initializer);
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'sceneId') {
      addExpression(node.name);
    } else if (ts.isCallExpression(node)) {
      const calleeName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : null;
      if (calleeName === 'playScene' || calleeName === 'playSceneForPlayer') {
        addExpression(node.arguments[2]);
      }
    }
    ts.forEachChild(node, visitTriggers);
  };
  visitTriggers(sourceFile);
  return triggered;
}

function registeredSceneTriggerIds(
  triggerSources: readonly SceneTriggerSource[],
  registeredIds: ReadonlySet<string>,
): Set<string> {
  const triggered = new Set<string>();
  for (const triggerSource of triggerSources) {
    for (const sceneId of sourceSceneTriggers(triggerSource, registeredIds)) {
      triggered.add(sceneId);
    }
  }
  return triggered;
}

function lintReferenceOrphans(
  scenes: readonly SceneDef[],
  segmentIds: readonly string[],
  triggerSources: readonly SceneTriggerSource[],
  report: (violation: Violation) => void,
): void {
  const cuedSegments = new Set<string>(
    scenes.flatMap((scene) => scene.ops.flatMap((op) => (op.kind === 'prop' ? [op.cue] : []))),
  );
  for (const segmentId of segmentIds) {
    if (segmentId === LB_PROP_CUE_PARK || cuedSegments.has(segmentId)) continue;
    report({
      sceneId: segmentId,
      check: 'reference.orphan',
      opIndex: -1,
      opKind: 'prop/registry',
      time: 0,
      threshold: 'at least one registered scene cue',
      measured: `registered prop segment ${segmentId} is never cued`,
    });
  }

  const registeredIds = new Set(scenes.map((scene) => scene.id));
  const triggeredIds = registeredSceneTriggerIds(triggerSources, registeredIds);
  for (const scene of scenes) {
    if (triggeredIds.has(scene.id)) continue;
    report({
      sceneId: scene.id,
      check: 'reference.orphan',
      opIndex: -1,
      opKind: 'scene/registry',
      time: 0,
      threshold: 'at least one campaign trigger reference outside registerScene',
      measured: `registered scene ${scene.id} has no classified trigger`,
    });
  }
}

function lintScene(scene: CapturedScene, report: (violation: Violation) => void): CameraSample[] {
  const director = createSceneDirectorState();
  const overlay = createSceneOverlayState();
  const activeProps = new Map<string, ActiveProp>();
  const propTargets = new Set<string>();
  for (const timed of scene.ops) {
    if (timed.op.kind === 'prop') propTargets.add(timed.op.target);
  }
  const harborShipTargets = new Set(HARBORS.map(shipTarget));
  const berthPropOps = scene.ops.filter(
    (timed): timed is TimedPropOp =>
      timed.op.kind === 'prop' && harborShipTargets.has(timed.op.target),
  );
  const berthPropCues = berthPropOps.map((timed) => ({
    target: timed.op.target,
    parksTarget: timed.op.cue === LB_PROP_CUE_PARK,
  }));
  const berthGlideRoles = new Map<number, 'departure' | 'arrival'>();
  for (const [cueIndex, classification] of classifyBerthGlideCues(berthPropCues).entries()) {
    if (classification) {
      berthGlideRoles.set(berthPropOps[cueIndex].index, classification);
    }
  }
  const cameraOps = scene.ops.filter((timed): timed is TimedCameraOp => timed.op.kind === 'camera');
  const shotOps = cameraOps.filter((timed) => timed.op.shot.kind !== 'release');
  const authoredCameraOps = scene.authoredOps.filter(
    (op): op is Extract<SceneOpDef, { kind: 'camera' }> => op.kind === 'camera',
  );
  const subjectRefByCameraIndex = new Map<number, string>();
  for (const [index, timed] of cameraOps.entries()) {
    const authored = authoredCameraOps[index];
    if (authored?.shot.kind !== 'release' && authored.shot.subjectRef) {
      subjectRefByCameraIndex.set(timed.index, authored.shot.subjectRef);
    }
  }
  const finalRelease = cameraOps.at(-1);
  const endOp =
    [...scene.ops].reverse().find((timed) => timed.op.kind === 'end') ?? scene.ops.at(-1);
  const releases: ReleaseDelta[] = [];
  const samples: CameraSample[] = [];
  const propMotionSamples: PropMotionSample[] = [];
  const collisionSupportState: CollisionSupportState = {
    hullOps: new Set(),
    unsupportedEntities: new Set(),
    uncontainedRiders: new Set(),
  };

  lintFilmGrammar(scene, cameraOps, report);
  lintSceneReferences(scene, report);

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
        const authoredPose = timed.op.shot.pose;
        const gameplayPose: ScenePose = {
          yaw: authoredPose?.yaw ?? live.yaw,
          pitch: authoredPose?.pitch ?? live.pitch,
          dist: authoredPose?.dist ?? live.dist,
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
          restored: gameplayPose,
          authoredPose: authoredPose !== undefined,
        });
      }
      if (timed.op.kind === 'prop') {
        const target = timed.op.target;
        if (timed.op.cue === LB_PROP_CUE_PARK) {
          if (activeProps.has(target)) {
            const fullBlack = sceneOverlayView(overlay, timed.at).fadeOpacity >= FULL_BLACK_OPACITY;
            // A park cue that lands with the displaced ship EXACTLY at its
            // parked pose swaps stand-in for real rig pixel-identically, so
            // it needs no cover; anything short of the berth pose still does.
            const handoffHarbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
            const atParkedPose =
              handoffHarbor !== undefined &&
              evaluateBerthPoseContinuity(
                handoffHarbor,
                shipFrameAt(handoffHarbor, timed.at, activeProps),
                runtimeWaterLevel,
              ).passing;
            if (!fullBlack && !atParkedPose) {
              report({
                sceneId: scene.id,
                check: 'continuity.standInHandoff',
                opIndex: timed.index,
                opKind: opKind(timed.op),
                time: timed.at,
                threshold:
                  'the moving deck stand-in hands back to the real player under full black',
                measured: 'deck stand-in handed off outside full black',
              });
            }
          }
          activeProps.delete(target);
          continue;
        }
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
          const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
          if (harbor) {
            for (const candidate of HARBORS) {
              if (candidate.id !== harbor.id) activeProps.delete(shipTarget(candidate));
            }
          }
          activeProps.set(target, {
            segment,
            startedAt: timed.at,
            timedOp: timed,
          });
          if (harbor) {
            const berthGlideRole = berthGlideRoles.get(timed.index);
            if (berthGlideRole) {
              const endpointLabel = berthGlideRole === 'departure' ? 'first sample' : 'last sample';
              const endpointTime = berthGlideRole === 'departure' ? 0 : segment.duration;
              const endpointFrame = shipFrameForPose(harbor, propPathPoseAt(segment, endpointTime));
              const continuity = evaluateBerthPoseContinuity(
                harbor,
                endpointFrame,
                runtimeWaterLevel,
              );
              if (!continuity.passing) {
                report({
                  sceneId: scene.id,
                  check: 'continuity.berthPose',
                  opIndex: timed.index,
                  opKind: opKind(timed.op),
                  time: timed.at,
                  threshold: `${berthGlideRole} ${endpointLabel} within ${BERTH_POSE_POSITION_EPSILON_YARDS.toFixed(
                    3,
                  )} yd and ${BERTH_POSE_YAW_EPSILON_RADIANS.toFixed(
                    3,
                  )} rad of the ${harbor.id} rendered parked pose`,
                  measured: `${berthGlideRole} ${endpointLabel} is ${continuity.positionDelta.toFixed(
                    3,
                  )} yd and ${continuity.yawDelta.toFixed(3)} rad from the parked pose`,
                });
              }
            }
            const maximumSpeed = maximumPropSegmentSpeed(harbor, segment);
            if (maximumSpeed > LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC) {
              report({
                sceneId: scene.id,
                check: 'prop.speed',
                opIndex: timed.index,
                opKind: opKind(timed.op),
                time: timed.at,
                threshold: `at most ${LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC.toFixed(
                  1,
                )} yd/s world-space ship speed`,
                measured: `${maximumSpeed.toFixed(2)} yd/s from cue ${timed.op.cue}`,
              });
            }
            const arrivalHarborId = ARRIVAL_HARBOR_BY_CUE.get(timed.op.cue);
            if (arrivalHarborId !== undefined) {
              if (harbor.id !== arrivalHarborId) {
                report({
                  sceneId: scene.id,
                  check: 'prop.arrivalDirection',
                  opIndex: timed.index,
                  opKind: opKind(timed.op),
                  time: timed.at,
                  threshold: `arrival cue targeting ${arrivalHarborId}`,
                  measured: `targeted ${harbor.id}`,
                });
              } else {
                const approach = arrivalDirectionMetrics(harbor, segment);
                if (
                  approach.seawardStart < MIN_ARRIVAL_SEAWARD_START_YARDS ||
                  approach.yawSwing > MAX_ARRIVAL_YAW_SWING_RADIANS ||
                  approach.bowFirst < MIN_ARRIVAL_DIRECTION_DOT ||
                  approach.berthDistance > MAX_ARRIVAL_BERTH_DISTANCE_YARDS
                ) {
                  report({
                    sceneId: scene.id,
                    check: 'prop.arrivalDirection',
                    opIndex: timed.index,
                    opKind: opKind(timed.op),
                    time: timed.at,
                    threshold: `start at least ${MIN_ARRIVAL_SEAWARD_START_YARDS.toFixed(
                      1,
                    )} yd seaward, yaw swing at most ${MAX_ARRIVAL_YAW_SWING_RADIANS.toFixed(
                      2,
                    )} rad, bow dot at least ${MIN_ARRIVAL_DIRECTION_DOT.toFixed(
                      2,
                    )}, end within ${MAX_ARRIVAL_BERTH_DISTANCE_YARDS.toFixed(1)} yd of berth`,
                    measured: `seaward ${approach.seawardStart.toFixed(
                      2,
                    )} yd, yaw swing ${approach.yawSwing.toFixed(
                      3,
                    )} rad, bow dot ${approach.bowFirst.toFixed(
                      3,
                    )}, berth ${approach.berthDistance.toFixed(2)} yd`,
                  });
                }
              }
            }
          }
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

    const frame = presentationFrameAt(scene, time, activeProps);
    const supportContext = scene.ops[Math.max(0, opCursor - 1)] ?? scene.ops[0];
    if (supportContext) {
      lintCollisionAndSupportSample(
        scene,
        time,
        frame,
        supportContext,
        activeProps,
        collisionSupportState,
        report,
      );
    }
    const resolveEntity = (id: number): EntityPoint | null => frame.entities.get(id) ?? null;
    const resolveAttachment = (target: string): SceneAttachFrame | null => {
      const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
      return harbor ? shipFrameAt(harbor, time, activeProps) : null;
    };
    const directedPose = scenePose(director, time, frame.live, resolveEntity, resolveAttachment);
    const activeShot = director.shot;
    const pose =
      scene.disableLivePoseEase && currentCameraOp && activeShot && activeShot.kind !== 'focus'
        ? evaluateSceneRigPose(
            activeShot,
            time - currentCameraOp.at,
            resolveEntity,
            resolveAttachment,
          )
        : directedPose;
    const overlayModel = sceneOverlayView(overlay, time);
    if (!pose || !currentCameraOp) {
      previous = null;
      continue;
    }
    const poseCopy = copyPose(pose);
    const geometry = geometryForPose(poseCopy);
    const fullBlack = overlayModel.fadeOpacity >= FULL_BLACK_OPACITY;
    // A snap-entry shot never eases, so nothing is exempt for it; an easing
    // shot's entry window is exempt ONLY while the overlay is at full black.
    // The old unconditional exemption was the hole that hid the covered-cut
    // sweep: the fade-in revealed a camera still traveling and every check
    // skipped those samples.
    const rigEntryEase =
      activeShot !== null &&
      activeShot.kind !== 'focus' &&
      activeShot.entry !== 'snap' &&
      !scene.disableLivePoseEase &&
      time - currentCameraOp.at < SCENE_RIG_ENTRY_SEC;
    const subject = activeShot ? subjectForShot(activeShot, poseCopy, resolveEntity) : null;
    const ships = new Map<string, ShipScreenSample>();
    for (const target of propTargets) {
      const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
      if (!harbor) continue;
      const shipCenter = shipDeckCenterAt(harbor, time, activeProps);
      const active = activeProps.get(target);
      const projected = pointInFrame(geometry, shipCenter);
      const inFrame =
        projected.depth > 0 &&
        Math.abs(projected.horizontal) <= HORIZONTAL_HALF_FOV_RAD &&
        Math.abs(projected.vertical) <= VERTICAL_HALF_FOV_RAD;
      ships.set(target, {
        screen: screenPoint(geometry, shipCenter),
        world: shipCenter,
        propOpIndex: active?.timedOp.index ?? null,
        inFrame,
      });
      if (!active) continue;
      propMotionSamples.push({
        time,
        target,
        active,
        cameraOp: currentCameraOp,
        position: shipFrameAt(harbor, time, activeProps).position,
        inFrame,
        fullBlack,
      });
    }
    const sample: CameraSample = {
      time,
      timedOp: currentCameraOp,
      pose: poseCopy,
      geometry,
      fullBlack,
      ships,
      subject,
      subjectScreen: subject ? screenPoint(geometry, subject) : null,
      entryEase: rigEntryEase && fullBlack,
    };
    samples.push(sample);
    if (rigEntryEase && fullBlack) {
      previous = null;
      continue;
    }

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
        threshold: `${PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS.toFixed(
          2,
        )} yd horizontal margin, ${PIER_KEEP_OUT_HEIGHT_YARDS.toFixed(
          2,
        )} yd above fixed harbor surfaces, or outside the measured live ship model bounds`,
        measured: `${intrusion.clearance.toFixed(2)} yd above ${intrusion.label} keep-out top`,
      });
    }

    if (activeShot) {
      if (!subject) throw new Error(`scene ${scene.id} has an active shot without a subject`);
      const subjectRef = subjectRefByCameraIndex.get(currentCameraOp.index);
      const referencedSubjects = subjectRef
        ? subjectReferencePointsAt(scene, subjectRef, time, activeProps, frame)
        : [];
      const sightTarget = referencedSubjects.reduce(
        (nearest, candidate) =>
          length(subtract(candidate, geometry.lookAt)) < length(subtract(nearest, geometry.lookAt))
            ? candidate
            : nearest,
        subject,
      );
      const occlusion = sightLineOcclusion(
        geometry.camera,
        sightTarget,
        scene.seed,
        time,
        activeProps,
      );
      if (occlusion) {
        report({
          sceneId: scene.id,
          check: 'visibility.occlusion',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `no terrain, ship hull, or pier structure after ${SIGHT_LINE_NEAR_CAMERA_CLEARANCE_YARDS.toFixed(
            2,
          )} yd of near-camera clearance, sampled every ${SIGHT_LINE_STEP_YARDS.toFixed(2)} yd`,
          measured: `${occlusion.label} with ${occlusion.clearance.toFixed(
            2,
          )} yd clearance at (${occlusion.point.x.toFixed(2)}, ${occlusion.point.y.toFixed(
            2,
          )}, ${occlusion.point.z.toFixed(
            2,
          )}), ${occlusion.distanceFromCamera.toFixed(2)} yd from camera`,
        });
      }
      const framing = evaluateFraming(geometry, subject);
      if (!framing.sizePassing) {
        report({
          sceneId: scene.id,
          check: 'framing.size',
          opIndex: currentCameraOp.index,
          opKind: opKind(currentCameraOp.op),
          time,
          threshold: `${MIN_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(1)}% to ${MAX_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(1)}% of frame height`,
          measured: `${framing.frameHeightPercent.toFixed(2)}%`,
        });
      }
      if (!framing.directionPassing) {
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
          measured: `horizontal ${(framing.projected.horizontal * DEG_PER_RAD).toFixed(
            1,
          )} deg, vertical ${(framing.projected.vertical * DEG_PER_RAD).toFixed(
            1,
          )} deg, depth ${framing.projected.depth.toFixed(3)}`,
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
        !fullBlack &&
        // An authored snap boundary is a deliberate hard cut; the check
        // guards eased or unannotated boundaries, which must never jump.
        activeShot?.entry !== 'snap'
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

  // The restored gameplay camera must have a clear line to the player. The
  // release pose is authored (SceneReleasePose): a scene that WALKED the
  // player somewhere must carry one, and the pose it carries must not leave
  // the camera behind a mast, hull, pier, or terrain at the destination.
  // (cut.releaseDelta only measures pose deltas; this is the occlusion arm
  // the J2 voyage shipped without.)
  if (finalReleaseDelta) {
    const walked = scene.authoredOps.some((op) => op.kind === 'playerWalk');
    if (!finalReleaseDelta.authoredPose && walked) {
      report({
        sceneId: scene.id,
        check: 'cut.releaseSightLine',
        opIndex: finalReleaseDelta.timedOp.index,
        opKind: opKind(finalReleaseDelta.timedOp.op),
        time: finalReleaseDelta.time,
        threshold:
          'an authored release hand-back pose whenever a scene walks the player to a new spot',
        measured: 'playerWalk scene releases to the unknowable pre-scene camera pose',
      });
    }
    if (finalReleaseDelta.authoredPose) {
      const geometry = geometryForPose(finalReleaseDelta.restored);
      const occlusion = sightLineOcclusion(
        geometry.camera,
        geometry.lookAt,
        scene.seed,
        finalReleaseDelta.time,
        activePropsAt(scene, finalReleaseDelta.time),
        'camera',
      );
      if (occlusion) {
        report({
          sceneId: scene.id,
          check: 'cut.releaseSightLine',
          opIndex: finalReleaseDelta.timedOp.index,
          opKind: opKind(finalReleaseDelta.timedOp.op),
          time: finalReleaseDelta.time,
          threshold:
            'a clear sight line from the restored gameplay camera to the player, with ship structure solid to its full camera tops',
          measured: `${occlusion.label} with ${occlusion.clearance.toFixed(
            2,
          )} yd clearance at (${occlusion.point.x.toFixed(2)}, ${occlusion.point.y.toFixed(
            2,
          )}, ${occlusion.point.z.toFixed(2)})`,
        });
      }
    }
  }

  lintShipScreenDirection(scene, samples, report);
  lintPropMotionQuality(scene, propMotionSamples, report);
  lintMinimumVisualMotion(scene, shotOps, samples, report);
  lintSubjectReferences(scene, samples, report);
  return samples;
}

function lintShipScreenDirection(
  scene: CapturedScene,
  samples: readonly CameraSample[],
  report: (violation: Violation) => void,
): void {
  const reported = new Set<string>();
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (
      previous.timedOp.index !== current.timedOp.index ||
      previous.entryEase ||
      current.entryEase ||
      previous.fullBlack ||
      current.fullBlack
    ) {
      continue;
    }
    const dt = current.time - previous.time;
    if (dt <= SCENE_TIME_EPSILON_SECONDS) continue;
    for (const [target, currentShip] of current.ships) {
      const previousShip = previous.ships.get(target);
      if (
        !previousShip?.inFrame ||
        !currentShip.inFrame ||
        previousShip.propOpIndex === null ||
        previousShip.propOpIndex !== currentShip.propOpIndex
      ) {
        continue;
      }
      const worldVelocity = scale(subtract(currentShip.world, previousShip.world), 1 / dt);
      if (length(worldVelocity) < MIN_ON_CAMERA_PROP_WAY_YARDS_PER_SEC) continue;
      const screenVelocity = {
        x: (currentShip.screen.x - previousShip.screen.x) / dt,
        y: (currentShip.screen.y - previousShip.screen.y) / dt,
      };
      const screenSpeed = Math.hypot(screenVelocity.x, screenVelocity.y);
      if (screenSpeed < MIN_SHIP_SCREEN_VELOCITY_PER_SEC) continue;
      const previousWorldInCurrentFrame = screenPoint(current.geometry, previousShip.world);
      const projectedWorldVelocity = {
        x: (currentShip.screen.x - previousWorldInCurrentFrame.x) / dt,
        y: (currentShip.screen.y - previousWorldInCurrentFrame.y) / dt,
      };
      const projectedSpeed = Math.hypot(projectedWorldVelocity.x, projectedWorldVelocity.y);
      if (projectedSpeed < MIN_SHIP_SCREEN_VELOCITY_PER_SEC) continue;
      const directionDot =
        (screenVelocity.x * projectedWorldVelocity.x +
          screenVelocity.y * projectedWorldVelocity.y) /
        (screenSpeed * projectedSpeed);
      const reportKey = `${current.timedOp.index}\u0000${target}`;
      if (directionDot >= MIN_SHIP_SCREEN_DIRECTION_DOT || reported.has(reportKey)) continue;
      reported.add(reportKey);
      report({
        sceneId: scene.id,
        check: 'continuity.shipScreenDirection',
        opIndex: current.timedOp.index,
        opKind: opKind(current.timedOp.op),
        time: current.time,
        threshold: `screen travel direction dot at least ${MIN_SHIP_SCREEN_DIRECTION_DOT.toFixed(
          2,
        )} against world velocity projected through the shot camera`,
        measured: `${target} screen velocity (${screenVelocity.x.toFixed(
          3,
        )}, ${screenVelocity.y.toFixed(
          3,
        )}) and projected world velocity (${projectedWorldVelocity.x.toFixed(
          3,
        )}, ${projectedWorldVelocity.y.toFixed(3)}), direction dot ${directionDot.toFixed(3)}`,
      });
    }
  }
}

describe('cinematic shot mechanical gate', () => {
  for (const exemption of LEGACY_EXEMPTIONS) {
    it.skip(`${exemption.sceneId} ${exemption.check}: ${exemption.reason}`, () => {});
  }

  it('covers every MechanicalCheck with a synthetic failing control', () => {
    const controlledChecks = new Set(
      SYNTHETIC_CONTROLS.flatMap((control) =>
        control.expectedCheck === null ? [] : [control.expectedCheck],
      ),
    );
    const missingChecks = MECHANICAL_CHECKS.filter((check) => !controlledChecks.has(check));
    expect(
      missingChecks,
      `MechanicalCheck members without a synthetic failing control: ${missingChecks.join(', ')}`,
    ).toEqual([]);
  });

  it('pins berth continuity tolerances, boundaries, and cross-ship reset classification', () => {
    expect(BERTH_POSE_POSITION_EPSILON_YARDS).toBe(0.01);
    expect(BERTH_POSE_YAW_EPSILON_RADIANS).toBe(0.001);

    const waterLevel = 7;
    expect(
      harborShipParkedPose({ x: 3, z: 4, rot: 0.5, draft: 2, length: 10 }, waterLevel),
    ).toEqual({ x: 3, y: 5, z: 4, yaw: 0.5 });
    const parked = parkedShipFrame(MAINLAND_HARBOR, waterLevel);
    expect(
      evaluateBerthPoseContinuity(
        MAINLAND_HARBOR,
        {
          position: {
            ...parked.position,
            x: parked.position.x + BERTH_POSE_POSITION_EPSILON_YARDS,
          },
          yaw: parked.yaw + BERTH_POSE_YAW_EPSILON_RADIANS,
        },
        waterLevel,
      ).passing,
    ).toBe(true);
    expect(
      evaluateBerthPoseContinuity(
        MAINLAND_HARBOR,
        {
          position: {
            ...parked.position,
            y: parked.position.y + BERTH_POSE_POSITION_EPSILON_YARDS * 0.8,
            z: parked.position.z + BERTH_POSE_POSITION_EPSILON_YARDS * 0.8,
          },
          yaw: parked.yaw,
        },
        waterLevel,
      ).passing,
    ).toBe(false);
    expect(
      evaluateBerthPoseContinuity(
        MAINLAND_HARBOR,
        {
          position: parked.position,
          yaw: parked.yaw + Math.PI * 2,
        },
        waterLevel,
      ).passing,
    ).toBe(true);
    expect(
      evaluateBerthPoseContinuity(
        MAINLAND_HARBOR,
        {
          position: parked.position,
          yaw: parked.yaw + Math.PI * 2 + BERTH_POSE_YAW_EPSILON_RADIANS + 0.000001,
        },
        waterLevel,
      ).passing,
    ).toBe(false);

    expect(
      classifyBerthGlideCues([
        { target: 'mainland', parksTarget: false },
        { target: 'gullhaven', parksTarget: false },
        { target: 'mainland', parksTarget: false },
        { target: 'gullhaven', parksTarget: false },
        { target: 'gullhaven', parksTarget: true },
      ]),
    ).toEqual(['departure', 'departure', 'departure', 'arrival', null]);
    expect(
      classifyBerthGlideCues([
        { target: 'mainland', parksTarget: false },
        { target: 'mainland', parksTarget: false },
        { target: 'mainland', parksTarget: true },
      ]),
    ).toEqual(['departure', 'arrival', null]);
  });

  it('pins generated hull fill, rider negatives, and the gangway mating boundary', async () => {
    await loadLinterRuntime();
    expect(HULL_GANGWAY_MATING_EPSILON_YARDS).toBe(0.15);
    for (const harbor of HARBORS) {
      const parkedFrame = shipFrameForPose(harbor, { x: 0, y: 0, z: 0, yaw: 0 });
      expect(
        hullWorldCollision(harbor, parkedFrame, WORLD_SEED, {
          terrainHeight: sampleTerrainHeight,
          waterLevel: runtimeWaterLevel,
        }),
        `${harbor.id} parked hull clears the world at the gangway tolerance`,
      ).toBeNull();

      const body = shipHullVolumes(harbor, runtimeWaterLevel).find(
        (volume) => volume.id === 'lower-hull-body',
      );
      expect(body, `${harbor.id} generated lower hull fill`).toBeDefined();
      if (!body) continue;
      const bellyLocal = {
        x: body.x,
        y: (body.bottomY + body.topY) / 2,
        z: body.z,
      };
      const bellyWorld = sceneRigLocalToWorld(parkedFrame, bellyLocal, { x: 0, y: 0, z: 0 });
      expect(
        shipHullPointClearance(harbor, parkedFrame, bellyWorld, runtimeWaterLevel),
        `${harbor.id} center belly is solid`,
      ).toBeLessThan(0);
      const bodySampleCoordinate = (halfExtent: number): number => {
        const steps = Math.max(1, Math.ceil((halfExtent * 2) / HULL_TERRAIN_SAMPLE_STEP_YARDS));
        const index = Math.round(steps / 2);
        return -halfExtent + (halfExtent * 2 * index) / steps;
      };
      const bellySampleWorld = sceneRigLocalToWorld(
        parkedFrame,
        {
          x: body.x + bodySampleCoordinate(body.hw),
          y: bellyLocal.y,
          z: body.z + bodySampleCoordinate(body.hd),
        },
        { x: 0, y: 0, z: 0 },
      );
      const raisedFloorY = parkedFrame.position.y + body.bottomY + 0.5;
      expect(
        hullWorldCollision(harbor, parkedFrame, WORLD_SEED, {
          terrainHeight: (x, z) =>
            Math.hypot(x - bellySampleWorld.x, z - bellySampleWorld.z) <= 1e-6
              ? raisedFloorY
              : runtimeWaterLevel - 100,
          waterLevel: runtimeWaterLevel,
        }),
        `${harbor.id} center belly samples the water floor`,
      ).toMatchObject({
        label: 'water floor',
        volumeId: 'lower-hull-body',
      });

      // The boarding bridge is the deck that deliberately mates with the hull
      // skin: shoving the parked hull toward it past the mating tolerance must
      // trip the deck arm on exactly that rect.
      const bridgeIndex = harbor.decks.indexOf(harbor.bridge);
      expect(bridgeIndex, `${harbor.id} bridge sits in decks`).toBeGreaterThanOrEqual(0);
      const towardGangway = {
        x: harbor.bridge.x - parkedFrame.position.x,
        z: harbor.bridge.z - parkedFrame.position.z,
      };
      const gangwayDistance = Math.hypot(towardGangway.x, towardGangway.z);
      const boundaryFrame = {
        position: {
          ...parkedFrame.position,
          x:
            parkedFrame.position.x +
            (towardGangway.x / gangwayDistance) * (HULL_GANGWAY_MATING_EPSILON_YARDS + 0.2),
          z:
            parkedFrame.position.z +
            (towardGangway.z / gangwayDistance) * (HULL_GANGWAY_MATING_EPSILON_YARDS + 0.2),
        },
        yaw: parkedFrame.yaw,
      };
      expect(
        hullWorldCollision(harbor, boundaryFrame, WORLD_SEED, {
          terrainHeight: sampleTerrainHeight,
          waterLevel: runtimeWaterLevel,
        }),
        `${harbor.id} beyond the gangway mating tolerance`,
      ).toMatchObject({
        label: `${harbor.id} deck ${bridgeIndex}`,
      });

      const mainDeckBounds = shipDeckLocalBounds(harbor, harbor.shipDecks[0], runtimeWaterLevel);
      const oldAggregateLocal = {
        x: -25,
        y: mainDeckBounds.centerY,
        z: 0,
      };
      expect(Math.abs(oldAggregateLocal.x)).toBeLessThan(harbor.berth.length / 2);
      const oldAggregateWorld = sceneRigLocalToWorld(parkedFrame, oldAggregateLocal, {
        x: 0,
        y: 0,
        z: 0,
      });
      expect(
        riderDeckViolation(
          'old aggregate probe',
          harbor,
          parkedFrame,
          oldAggregateWorld,
          runtimeWaterLevel,
        ),
      ).toContain(`left ${harbor.id} deck bounds`);

      const airborne = deckStandInPoint(harbor, parkedFrame, runtimeWaterLevel);
      airborne.y += ENTITY_SUPPORT_EPSILON_YARDS + 0.2;
      expect(
        riderDeckViolation('airborne rider', harbor, parkedFrame, airborne, runtimeWaterLevel),
      ).toContain(`deck air gap in ${harbor.id}`);
    }
  });

  it('samples every registered scene at 20 Hz against the mechanical rubric', async () => {
    await loadLinterRuntime();
    expect(MIN_PERCEPTUAL_FADE_SECONDS).toBeGreaterThanOrEqual(0.3);
    expect(MIN_PERCEPTUAL_FADE_SECONDS).toBeLessThanOrEqual(0.5);
    expect(LEGACY_EXEMPTIONS, 'cinematic exemption inventory must stay exact').toEqual([]);
    expect(
      SCENE_TRIGGER_FILES.length,
      'the scene trigger scan must cover the recursive content and campaign source corpus',
    ).toBeGreaterThanOrEqual(80);
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    expect([...localeTranslationFills.keys()]).toEqual([...SUPPORTED_LANGUAGES]);
    expect(LOCALE_OVERLAY_FILES.map(({ file }) => path.basename(file, '.ts')).sort()).toEqual(
      SUPPORTED_LANGUAGES.filter((lang) => lang !== 'en').sort(),
    );
    // A renderer lens change must update the linter's framing calculations.
    expect(RENDERER_SOURCE).toContain('CAMERA_BASE_FOV = 60');
    for (const harbor of HARBORS) {
      const blockers = shipHullBlockers(harbor, runtimeWaterLevel);
      expect(
        blockers.map(({ id, kind }) => ({ id, kind })),
        `${harbor.id} linter hull inventory`,
      ).toEqual(harbor.shipBlockers.map(({ id, kind }) => ({ id, kind })));
      expect(blockers).toHaveLength(harbor.shipBlockers.length);
      const parkedFrame = shipFrameForPose(harbor, { x: 0, y: 0, z: 0, yaw: 0 });
      for (const [index, blocker] of blockers.entries()) {
        const worldCenter = sceneRigLocalToWorld(
          parkedFrame,
          { x: blocker.x, y: blocker.topY, z: blocker.z },
          { x: 0, y: 0, z: 0 },
        );
        expect(worldCenter.x, `${harbor.id} blocker ${blocker.id} x`).toBeCloseTo(
          harbor.shipBlockers[index].x,
          10,
        );
        expect(worldCenter.y, `${harbor.id} blocker ${blocker.id} top`).toBeCloseTo(
          harbor.shipBlockers[index].cameraTopY,
          10,
        );
        expect(worldCenter.z, `${harbor.id} blocker ${blocker.id} z`).toBeCloseTo(
          harbor.shipBlockers[index].z,
          10,
        );
      }
      const standIn = deckStandInPoint(harbor, parkedFrame, runtimeWaterLevel);
      expect(
        riderDeckViolation('deck stand-in', harbor, parkedFrame, standIn, runtimeWaterLevel),
        `${harbor.id} rider containment uses the generated decks`,
      ).toBeNull();
    }
    const testGeometry: CameraGeometry = {
      camera: { x: 0, y: 0, z: 0 },
      lookAt: { x: 0, y: 0, z: 1 },
      forward: { x: 0, y: 0, z: 1 },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    };
    expect(
      playerCapsuleIntersectsFrame(testGeometry, { x: 0.4, y: -1.3, z: 0.3 }),
      'the swept mid-body intersects even though neither endpoint sphere does',
    ).toBe(true);
    expect(playerCapsuleIntersectsFrame(testGeometry, { x: -100, y: -1.3, z: 10 })).toBe(false);
    expect(playerCapsuleIntersectsFrame(testGeometry, { x: 100, y: -1.3, z: 10 })).toBe(false);
    expect(playerCapsuleIntersectsFrame(testGeometry, { x: 0, y: -100, z: 10 })).toBe(false);
    expect(playerCapsuleIntersectsFrame(testGeometry, { x: 0, y: 100, z: 10 })).toBe(false);
    expect(playerCapsuleIntersectsFrame(testGeometry, { x: 0, y: -1.3, z: -100 })).toBe(false);

    const ids = readRegisteredSceneIds();
    expect(ids.length, 'the Last Bell scene registry must not be empty').toBeGreaterThan(0);
    const registeredScenes = ids.flatMap((id) => {
      const scene = readRegisteredScene(id);
      return scene ? [scene] : [];
    });
    expect(registeredScenes).toHaveLength(ids.length);
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

    lintReferenceOrphans(
      registeredScenes,
      Object.keys(LAST_BELL_PROP_PATH_SEGMENTS),
      SCENE_TRIGGER_SOURCES,
      report,
    );
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

    for (const control of SYNTHETIC_CONTROLS) registerSceneForLinter(control.def);
    for (const control of SYNTHETIC_CONTROLS) {
      const violations: Violation[] = [];
      const captured =
        control.actorIds || control.playerStart
          ? captureScene(control.def.id, control.actorIds, control.playerStart)
          : captureSyntheticControl(control.def);
      const scene = applySyntheticPresentationFixture(captured, control.def.presentationFixture);
      if (control.actorIds) {
        const subjectShot = scene.ops.find(
          (
            timed,
          ): timed is TimedSceneOp & {
            op: Extract<SceneWireOp, { kind: 'camera' }> & {
              shot: Extract<SceneCameraShot, { kind: 'dolly' }>;
            };
          } =>
            timed.op.kind === 'camera' &&
            timed.op.shot.kind === 'dolly' &&
            timed.op.shot.lookAt.kind === 'subject',
        );
        expect(subjectShot, `${control.def.id} emitted no subject-look-at dolly`).toBeDefined();
        const entityId =
          subjectShot?.op.shot.lookAt.kind === 'subject'
            ? subjectShot.op.shot.lookAt.entityId
            : null;
        expect(entityId, `${control.def.id} did not resolve its dolly subject`).not.toBeNull();
        expect(
          [...scene.frames.values()].some((frame) =>
            entityId === null ? false : frame.entities.has(entityId),
          ),
          `${control.def.id} did not capture its tracked dolly subject`,
        ).toBe(true);
      }
      if (control.orphanSegmentId !== undefined) {
        lintReferenceOrphans(
          [control.def],
          [control.orphanSegmentId],
          [
            {
              file: 'synthetic_orphan_segment_trigger.ts',
              source: `playSceneForPlayer(ctx, pid, '${control.def.id}');`,
            },
          ],
          (violation) => violations.push(violation),
        );
      }
      if (control.orphanScene) {
        lintReferenceOrphans(
          [control.def],
          [],
          [
            {
              file: 'synthetic_orphan_scene_registration.ts',
              source: [
                `const SYNTHETIC_SCENE_ID = '${control.def.id}';`,
                'registerScene({ id: SYNTHETIC_SCENE_ID });',
                `const unrelatedMetadata = '${control.def.id}';`,
              ].join('\n'),
            },
          ],
          (violation) => violations.push(violation),
        );
      }
      lintScene(scene, (violation) => violations.push(violation));
      if (control.expectedCheck === null) {
        expect(violations, violations.map(violationMessage).join('\n')).toEqual([]);
        continue;
      }
      const expected = violations.find(
        (violation) =>
          violation.sceneId === control.def.id &&
          violation.check === control.expectedCheck &&
          (control.expectedMeasured === undefined ||
            violation.measured.includes(control.expectedMeasured)),
      );
      expect(expected, violations.map(violationMessage).join('\n')).toBeDefined();
      // LOAD-BEARING: several arrival controls trip multiple arms. The expectedMeasured
      // substring keeps per-arm coverage from silently collapsing to whichever arm reports first.
      if (control.expectedMeasured !== undefined) {
        expect(expected?.measured).toContain(control.expectedMeasured);
      }
      if (control.onlyExpectedCheck) {
        expect(
          [...new Set(violations.map((violation) => violation.check))],
          violations.map(violationMessage).join('\n'),
        ).toEqual([control.expectedCheck]);
      }
    }
  }, 120_000);
});
