// Public surface of the Deepglass arena world's renderer layer (see CLAUDE.md).
export { DeepglassBallFx } from './ball';
export {
  DG_CAM_LEASH_SCALE,
  DG_CAM_STIFFNESS,
  nextCameraFovBase,
} from './deepglass_camera_core';
export {
  advanceDashFlip,
  type DashFlipOffset,
  type DashFlipState,
  DG_FLIP_SECS,
  DG_PITCH_FULL_SPEED,
  DG_PITCH_MAX,
  flightPoseVerticalSpeed,
  resetDashFlip,
} from './deepglass_pose_core';
export { DeepglassScene, type DeepglassSceneHost } from './scene';
