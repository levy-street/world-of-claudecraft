import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  measureArrivalApproach,
  measureSegment,
  worldToLocal,
} from '../scripts/lib/cinematic_trajectory_geometry.mjs';
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
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import { type PropPathSegment, propPathPoseAt } from '../src/render/prop_path_core';
import {
  LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC,
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  LB_PROP_CUE_PARK,
} from '../src/sim/content/last_bell_cinematics';
import {
  GULLHAVEN_HARBOR,
  HARBORS,
  type HarborDeck,
  type HarborDef,
  harborShipLocalBounds,
  harborShipLocalPointInside,
} from '../src/sim/harbor_layout';
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
import { WORLD_SEED } from '../src/world_seed.mjs';

// Twenty samples per second match the authoring report without tying the gate to render frame rate.
const SHOT_SAMPLE_RATE_HZ = 20;
// Cameras must keep this vertical distance above the terrain surface.
const CAMERA_TERRAIN_CLEARANCE_YARDS = 0.75;
// Cameras over submerged terrain must also keep this distance above the water surface.
const CAMERA_WATER_CLEARANCE_YARDS = 0.75;
// Fixed pier and ramp geometry occupies this much space above its walkable surface.
const PIER_KEEP_OUT_HEIGHT_YARDS = 3.5;
// Camera collision has a small horizontal radius around fixed pier and ramp footprints.
const PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS = 0.75;
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
// Every camera cut needs one full sim tick of black leading into the cut.
const MIN_FULL_BLACK_CUT_SLACK_SECONDS = 1 / 20;
// Authored times within this tolerance are treated as lying on a scene boundary.
const SCENE_TIME_EPSILON_SECONDS = 1e-7;
// The authoritative player collider is a 0.5-yard radius, and the visual is about 2.6 yards tall.
const PLAYER_BODY_RADIUS_YARDS = 0.5;
const PLAYER_BODY_HEIGHT_YARDS = 2.6;
// Capture aborts at this duration so a malformed registry entry cannot hang the suite.
const MAX_SCENE_CAPTURE_SECONDS = 180;
// Arrival paths must begin materially beyond the berth on its layout-derived seaward side.
const MIN_ARRIVAL_SEAWARD_START_YARDS = 12;
// Arrival travel and the ship's bow must align closely with the direct course to the berth.
const MIN_ARRIVAL_DIRECTION_DOT = 0.95;
// The final arrival pose must land on the destination berth before the hidden park cue.
const MAX_ARRIVAL_BERTH_DISTANCE_YARDS = 0.5;

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
  | 'cut.fadeSlack'
  | 'fade.symmetry'
  | 'timing.opWithinDuration'
  | 'cut.teardown'
  | 'continuity.shipScreenDirection'
  | 'continuity.standInHandoff'
  | 'prop.segment'
  | 'prop.speed'
  | 'prop.arrivalDirection';

interface LegacyExemption {
  readonly sceneId: string;
  readonly check: MechanicalCheck;
  readonly reason: string;
}

// P1.3 must clear every row while re-authoring the voyage fades.
const LEGACY_EXEMPTIONS: readonly LegacyExemption[] = [
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'cut.fadeSlack',
    reason: 'P1.3 must add full-black tick slack to every voyage cut.',
  },
  {
    sceneId: 'scn_lb_ferry_depart_back',
    check: 'fade.symmetry',
    reason: 'P1.3 must author a clear fade before the voyage scene ends.',
  },
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'cut.fadeSlack',
    reason: 'P1.3 must add full-black tick slack to every voyage cut.',
  },
  {
    sceneId: 'scn_lb_ferry_depart_out',
    check: 'fade.symmetry',
    reason: 'P1.3 must author a clear fade before the voyage scene ends.',
  },
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'cut.fadeSlack',
    reason: 'P1.3 must add full-black tick slack to every voyage cut.',
  },
  {
    sceneId: 'scn_lb_q0_ashore',
    check: 'fade.symmetry',
    reason: 'P1.3 must author a clear fade before the voyage scene ends.',
  },
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'cut.fadeSlack',
    reason: 'P1.3 must add full-black tick slack to every voyage cut.',
  },
  {
    sceneId: 'scn_lb_q0_voyage',
    check: 'fade.symmetry',
    reason: 'P1.3 must author a clear fade before the voyage scene ends.',
  },
];

interface TimedSceneOp {
  readonly index: number;
  readonly at: number;
  readonly op: SceneWireOp;
}

type TimedCameraOp = TimedSceneOp & {
  readonly op: Extract<SceneWireOp, { kind: 'camera' }>;
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

interface SyntheticControl {
  readonly def: SceneDef;
  readonly expectedCheck: MechanicalCheck | null;
  readonly expectedMeasured?: string;
  readonly actorIds?: readonly string[];
  readonly playerStart?: { x: number; z: number };
}

const SYNTHETIC_FAST_PROP_CUE = 'scn_test_lint_prop_speed_bad';
const SYNTHETIC_LANDWARD_ARRIVAL_CUE = 'scn_test_lint_arrival_direction_bad';
const SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE = 'scn_test_lint_arrival_bow_bad';
const SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE = 'scn_test_lint_arrival_berth_bad';
const SYNTHETIC_CROSSWIND_ARRIVAL_CUE = 'scn_test_lint_arrival_travel_bad';

interface SyntheticCameraSceneOptions {
  readonly hideRelease?: boolean;
  readonly coverFirstCut?: boolean;
  readonly clearReleaseFade?: boolean;
  readonly includeRelease?: boolean;
  readonly includeUnlock?: boolean;
  readonly includeLetterboxOff?: boolean;
  readonly extraOps?: readonly SceneOpDef[];
}

function syntheticCameraScene(
  id: string,
  duration: number,
  cameraOps: readonly SceneOpDef[],
  options: SyntheticCameraSceneOptions = {},
): SceneDef {
  const {
    hideRelease = true,
    coverFirstCut = true,
    clearReleaseFade = true,
    includeRelease = true,
    includeUnlock = true,
    includeLetterboxOff = true,
    extraOps = [],
  } = options;
  const releaseAt = duration - 0.1;
  return {
    id,
    duration,
    ops: [
      { at: 0, kind: 'inputLock', on: true },
      { at: 0, kind: 'letterbox', on: true },
      ...(coverFirstCut
        ? ([{ at: 0, kind: 'fade', to: 'black', dur: 0 }] satisfies SceneOpDef[])
        : []),
      ...cameraOps,
      ...(coverFirstCut
        ? ([
            {
              // Authored t=0 ops emit on the first tick, so clear on the following tick.
              at: MIN_FULL_BLACK_CUT_SLACK_SECONDS * 2,
              kind: 'fade',
              to: 'clear',
              dur: 0,
            },
          ] satisfies SceneOpDef[])
        : []),
      ...(hideRelease && includeRelease
        ? ([{ at: duration - 0.2, kind: 'fade', to: 'black', dur: 0 }] satisfies SceneOpDef[])
        : []),
      ...(includeRelease
        ? ([{ at: releaseAt, kind: 'camera', shot: { kind: 'release' } }] satisfies SceneOpDef[])
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
              at: releaseAt + MIN_FULL_BLACK_CUT_SLACK_SECONDS,
              kind: 'fade',
              to: 'clear',
              dur: 0,
            },
          ] satisfies SceneOpDef[])
        : []),
      ...extraOps,
    ],
  };
}

const SYNTHETIC_GRAMMAR_CAMERA_OPS = [
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
] satisfies readonly SceneOpDef[];

// These independent fixture values pin the exact 20 Hz tick boundary.
const SYNTHETIC_ONE_TICK_BLACK_SLACK_SECONDS = 0.05;
const SYNTHETIC_SUB_TICK_BLACK_SLACK_SECONDS = 0.04;

function syntheticFadeSlackScene(id: string, blackSlackSeconds: number): SceneDef {
  const cutAt = SYNTHETIC_ONE_TICK_BLACK_SLACK_SECONDS * 2;
  return syntheticCameraScene(
    id,
    1.8,
    [
      {
        at: cutAt,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [{ x: 0, z: 0, height: 100 }],
          lookAt: { kind: 'point', point: { x: 0, z: 10, height: 100 } },
          dur: 1.6,
        },
      },
    ],
    {
      coverFirstCut: false,
      extraOps: [
        { at: cutAt - blackSlackSeconds, kind: 'fade', to: 'black', dur: 0 },
        {
          at: cutAt + SYNTHETIC_ONE_TICK_BLACK_SLACK_SECONDS,
          kind: 'fade',
          to: 'clear',
          dur: 0,
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
        },
      },
    ]),
    expectedCheck: null,
    actorIds: ['tam'],
  },
  {
    def: syntheticCameraScene('scn_test_lint_attach_pass', 1.7, [
      {
        at: 0,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'test_ship',
          fallbackFrame: { point: { x: 2, z: -2, height: 0 }, yaw: 0 },
          offset: { x: 0, y: 5.774799, z: -11.390825 },
          lookAt: { x: 0, y: 2, z: 0 },
        },
      },
    ]),
    expectedCheck: null,
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
    def: syntheticCameraScene('scn_test_lint_cut_jump_bad', 3.2, [
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
        },
      },
    ]),
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
          offset: { x: 6.6, y: 20, z: 0 },
          lookAt: { x: 16.6, y: 20, z: 0 },
        },
      },
    ]),
    expectedCheck: 'clearance.volume',
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
    def: syntheticCameraScene('scn_test_lint_arrival_travel_bad', 1.7, [
      {
        at: 0,
        kind: 'prop',
        target: 'harbor_ship_gullhaven',
        cue: SYNTHETIC_CROSSWIND_ARRIVAL_CUE,
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
    expectedMeasured: 'travel dot 0.514',
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
    def: syntheticFadeSlackScene(
      'scn_test_lint_fade_slack_tick_pass',
      SYNTHETIC_ONE_TICK_BLACK_SLACK_SECONDS,
    ),
    expectedCheck: null,
  },
  {
    def: syntheticFadeSlackScene(
      'scn_test_lint_fade_slack_bad',
      SYNTHETIC_SUB_TICK_BLACK_SLACK_SECONDS,
    ),
    expectedCheck: 'cut.fadeSlack',
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
        extraOps: [{ at: 1.7, kind: 'fade', to: 'clear', dur: 0 }],
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
      'scn_test_lint_unlock_missing_bad',
      1.7,
      SYNTHETIC_GRAMMAR_CAMERA_OPS,
      { includeUnlock: false },
    ),
    expectedCheck: 'cut.teardown',
    expectedMeasured: 'release=true, inputUnlock=false, letterboxOff=true',
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
  [SYNTHETIC_CROSSWIND_ARRIVAL_CUE]: {
    start: { x: -23.323808, y: 0, z: 0, yaw: 2.429963 },
    end: { x: 0, y: 0, z: 0, yaw: 2.429963 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
};
const ARRIVAL_HARBOR_BY_CUE = new Map<string, HarborDef['id']>([
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival, 'gullhaven'],
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival, 'mainland'],
  [SYNTHETIC_LANDWARD_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_REVERSED_BOW_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_MISSED_BERTH_ARRIVAL_CUE, 'gullhaven'],
  [SYNTHETIC_CROSSWIND_ARRIVAL_CUE, 'gullhaven'],
]);
const RENDERER_SOURCE = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
let SimConstructor: typeof import('../src/sim/sim').Sim;
let playRegisteredScene: typeof import('../src/sim/scenes/scenes').playSceneForPlayer;
let readRegisteredSceneIds: typeof import('../src/sim/scenes/scenes').registeredSceneIds;
let readRegisteredScene: typeof import('../src/sim/scenes/scenes').sceneById;
let registerSceneForLinter: typeof import('../src/sim/scenes/scenes').registerScene;
let sampleTerrainHeight: typeof import('../src/sim/world').terrainHeight;
let spawnSquadForLinter: typeof import('../src/sim/squad/squad').spawnSquad;
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

function settledPlayerStartForScene(id: string): { x: number; z: number } | null {
  const harborId =
    id === 'scn_lb_ferry_depart_back'
      ? 'mainland'
      : id === 'scn_lb_ferry_depart_out' || id === 'scn_lb_q0_ashore' || id === 'scn_lb_q0_voyage'
        ? 'gullhaven'
        : null;
  if (harborId === null) return null;
  return HARBORS.find((harbor) => harbor.id === harborId)?.deckArrival ?? null;
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
  const settledStart = playerStart ?? settledPlayerStartForScene(id);
  if (settledStart) {
    sim.player.pos = sim.groundPos(settledStart.x, settledStart.z);
    sim.player.prevPos = { ...sim.player.pos };
    sim.rebucket(sim.player);
  }
  const playbackKey = -sim.playerId;
  if (actorIds.length > 0) {
    expect(
      spawnSquadForLinter(sim.ctx, {
        claimId: playbackKey,
        dungeonId: '',
        anchor: { x: 0, z: 3 },
        actorIds,
        humanCount: 1,
      }),
      `failed to spawn synthetic scene subjects for ${id}`,
    ).not.toBeNull();
  }
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
      const at =
        event.op.kind === 'start'
          ? 0
          : event.op.kind === 'end' && duration !== null
            ? duration
            : roundTime(elapsed);
      const timedOp = { index: ops.length, at, op: event.op };
      ops.push(timedOp);
      const entityId = trackedEntityId(event.op);
      if (entityId !== null) trackedIds.add(entityId);
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
      if (op.shot.kind === 'release') return { kind: 'camera', shot: { kind: 'release' } };
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

function playerCapsuleIntersectsFrame(
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

function shipTarget(harbor: HarborDef): string {
  return `harbor_ship_${harbor.id}`;
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
  return composeHarborShipAttachFrame(
    {
      baseX: harbor.berth.x,
      baseY: runtimeWaterLevel - harbor.berth.draft,
      baseZ: harbor.berth.z,
      baseRot: harbor.berth.rot,
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
  towardBerth: number;
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
  });
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
    const localCamera = worldToLocal(shipFrameAt(harbor, time, activeProps), camera);
    const bounds = harborShipLocalBounds(harbor.berth);
    if (harborShipLocalPointInside(bounds, localCamera, PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS)) {
      return { label: `${harbor.id} live ship model`, clearance: localCamera.y - bounds.topY };
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
    if (op.kind !== 'fade' || op.to !== 'black') continue;
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

  const firstAuthoredCamera = scene.authoredOps.find((op) => op.kind === 'camera');
  for (const [cutIndex, cut] of cameraOps.entries()) {
    const isSceneStartCut =
      cutIndex === 0 &&
      firstAuthoredCamera?.kind === 'camera' &&
      firstAuthoredCamera.at <= SCENE_TIME_EPSILON_SECONDS;
    const slackStart = isSceneStartCut
      ? cut.at
      : Math.max(0, cut.at - MIN_FULL_BLACK_CUT_SLACK_SECONDS);
    const startOpacity = fadeOpacityAfterSceneOps(scene, slackStart, cut.index);
    const cutOpacity = fadeOpacityAfterSceneOps(scene, cut.at);
    if (startOpacity < FULL_BLACK_OPACITY || cutOpacity < FULL_BLACK_OPACITY) {
      report({
        sceneId: scene.id,
        check: 'cut.fadeSlack',
        opIndex: cut.index,
        opKind: opKind(cut.op),
        time: cut.at,
        threshold: `${MIN_FULL_BLACK_CUT_SLACK_SECONDS.toFixed(
          2,
        )}s of full black spanning the cut, bounded by scene start`,
        measured: `fade ${startOpacity.toFixed(3)} at ${slackStart.toFixed(
          2,
        )}s and ${cutOpacity.toFixed(3)} after co-timed cut ops`,
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

function lintScene(scene: CapturedScene, report: (violation: Violation) => void): CameraSample[] {
  const director = createSceneDirectorState();
  const overlay = createSceneOverlayState();
  const activeProps = new Map<string, ActiveProp>();
  const propTargets = new Set<string>();
  for (const timed of scene.ops) {
    if (timed.op.kind === 'prop') propTargets.add(timed.op.target);
  }
  const cameraOps = scene.ops.filter((timed): timed is TimedCameraOp => timed.op.kind === 'camera');
  const shotOps = cameraOps.filter((timed) => timed.op.shot.kind !== 'release');
  const finalRelease = cameraOps.at(-1);
  const endOp =
    [...scene.ops].reverse().find((timed) => timed.op.kind === 'end') ?? scene.ops.at(-1);
  const releases: ReleaseDelta[] = [];
  const samples: CameraSample[] = [];

  lintFilmGrammar(scene, cameraOps, report);

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
        const target = timed.op.target;
        if (timed.op.cue === LB_PROP_CUE_PARK) {
          if (activeProps.has(target)) {
            const fullBlack = sceneOverlayView(overlay, timed.at).fadeOpacity >= FULL_BLACK_OPACITY;
            if (!fullBlack) {
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
          activeProps.set(target, {
            segment,
            startedAt: timed.at,
            timedOp: timed,
          });
          const harbor = HARBORS.find((candidate) => shipTarget(candidate) === target);
          if (harbor) {
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
                  approach.towardBerth < MIN_ARRIVAL_DIRECTION_DOT ||
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
                    )} yd seaward, travel and bow dots at least ${MIN_ARRIVAL_DIRECTION_DOT.toFixed(
                      2,
                    )}, end within ${MAX_ARRIVAL_BERTH_DISTANCE_YARDS.toFixed(1)} yd of berth`,
                    measured: `seaward ${approach.seawardStart.toFixed(
                      2,
                    )} yd, travel dot ${approach.towardBerth.toFixed(
                      3,
                    )}, bow dot ${approach.bowFirst.toFixed(
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
        threshold: `${PIER_KEEP_OUT_HORIZONTAL_MARGIN_YARDS.toFixed(
          2,
        )} yd horizontal margin, ${PIER_KEEP_OUT_HEIGHT_YARDS.toFixed(
          2,
        )} yd above fixed harbor surfaces, or outside the measured live ship model bounds`,
        measured: `${intrusion.clearance.toFixed(2)} yd above ${intrusion.label} keep-out top`,
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

  it('samples every registered scene at 20 Hz against the mechanical rubric', async () => {
    await loadLinterRuntime();
    expect(
      MIN_FULL_BLACK_CUT_SLACK_SECONDS,
      'fade slack must stay exactly one 20 Hz sim tick',
    ).toBe(SYNTHETIC_ONE_TICK_BLACK_SLACK_SECONDS);
    expect(LEGACY_EXEMPTIONS, 'P1.3 voyage exemption inventory must stay exact').toEqual([
      {
        sceneId: 'scn_lb_ferry_depart_back',
        check: 'cut.fadeSlack',
        reason: 'P1.3 must add full-black tick slack to every voyage cut.',
      },
      {
        sceneId: 'scn_lb_ferry_depart_back',
        check: 'fade.symmetry',
        reason: 'P1.3 must author a clear fade before the voyage scene ends.',
      },
      {
        sceneId: 'scn_lb_ferry_depart_out',
        check: 'cut.fadeSlack',
        reason: 'P1.3 must add full-black tick slack to every voyage cut.',
      },
      {
        sceneId: 'scn_lb_ferry_depart_out',
        check: 'fade.symmetry',
        reason: 'P1.3 must author a clear fade before the voyage scene ends.',
      },
      {
        sceneId: 'scn_lb_q0_ashore',
        check: 'cut.fadeSlack',
        reason: 'P1.3 must add full-black tick slack to every voyage cut.',
      },
      {
        sceneId: 'scn_lb_q0_ashore',
        check: 'fade.symmetry',
        reason: 'P1.3 must author a clear fade before the voyage scene ends.',
      },
      {
        sceneId: 'scn_lb_q0_voyage',
        check: 'cut.fadeSlack',
        reason: 'P1.3 must add full-black tick slack to every voyage cut.',
      },
      {
        sceneId: 'scn_lb_q0_voyage',
        check: 'fade.symmetry',
        reason: 'P1.3 must author a clear fade before the voyage scene ends.',
      },
    ]);
    // A renderer lens change must update the linter's framing calculations.
    expect(RENDERER_SOURCE).toContain('CAMERA_BASE_FOV = 60');
    const modelBounds = harborShipLocalBounds(GULLHAVEN_HARBOR.berth);
    expect(modelBounds).toEqual({
      x: 0,
      z: 0,
      hw: 30,
      hd: 8.863490707113863,
      bottomY: -0.0004148165653705534,
      topY: 39.56988457001259,
    });
    const modelCenter = { x: 0, y: 20, z: 0 };
    expect(harborShipLocalPointInside(modelBounds, modelCenter)).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: -30 })).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: 30 })).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: -30.01 })).toBe(false);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: 30.01 })).toBe(false);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, z: -modelBounds.hd })).toBe(
      true,
    );
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, z: modelBounds.hd })).toBe(
      true,
    );
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: -modelBounds.hd - 0.01 }),
    ).toBe(false);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: modelBounds.hd + 0.01 }),
    ).toBe(false);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, y: modelBounds.bottomY }),
    ).toBe(true);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, y: modelBounds.bottomY - 0.01 }),
    ).toBe(false);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, y: modelBounds.topY - 0.01 }),
    ).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, y: modelBounds.topY })).toBe(
      false,
    );
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: 30.74 }, 0.75)).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: 30.76 }, 0.75)).toBe(false);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: -30.74 }, 0.75)).toBe(true);
    expect(harborShipLocalPointInside(modelBounds, { ...modelCenter, x: -30.76 }, 0.75)).toBe(
      false,
    );
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: modelBounds.hd + 0.74 }, 0.75),
    ).toBe(true);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: modelBounds.hd + 0.76 }, 0.75),
    ).toBe(false);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: -modelBounds.hd - 0.74 }, 0.75),
    ).toBe(true);
    expect(
      harborShipLocalPointInside(modelBounds, { ...modelCenter, z: -modelBounds.hd - 0.76 }, 0.75),
    ).toBe(false);
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

    for (const control of SYNTHETIC_CONTROLS) registerSceneForLinter(control.def);
    for (const control of SYNTHETIC_CONTROLS) {
      const violations: Violation[] = [];
      const scene =
        control.actorIds || control.playerStart
          ? captureScene(control.def.id, control.actorIds, control.playerStart)
          : captureSyntheticControl(control.def);
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
      lintScene(scene, (violation) => violations.push(violation));
      if (control.expectedCheck === null) {
        expect(violations, violations.map(violationMessage).join('\n')).toEqual([]);
        continue;
      }
      const expected = violations.find(
        (violation) =>
          violation.sceneId === control.def.id && violation.check === control.expectedCheck,
      );
      expect(expected, violations.map(violationMessage).join('\n')).toBeDefined();
      // LOAD-BEARING: several arrival controls trip multiple arms. The expectedMeasured
      // substring keeps per-arm coverage from silently collapsing to whichever arm reports first.
      if (control.expectedMeasured !== undefined) {
        expect(expected?.measured).toContain(control.expectedMeasured);
      }
    }
  }, 120_000);
});
