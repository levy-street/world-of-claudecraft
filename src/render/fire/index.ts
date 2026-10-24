// The 3D fluid fire subsystem: the shared GPU Navier-Stokes + combustion
// simulation, per-realm fire character, liveness and budget shedding, and the
// volumetric ray-marched surface material. See CLAUDE.md in this directory.

export {
  FIRE_CHARACTERS,
  type FireCharacter,
  fireBlackbodyLinearRgb,
  fireCharacterFor,
  HEARTH_FIRE,
} from './fire_character_core';
export {
  advanceFireLiveness,
  createFireLiveness,
  FIRE_CAPTURE_HOLD_SECONDS,
  FIRE_WORK_HOLD_SECONDS,
  type FireLivenessState,
  type FireLivenessStep,
} from './fire_liveness_core';
export {
  createFireVolumeMaterial,
  disposeActiveFireSimulation,
  FIRE_DEBUG_TERM,
  type FireMaterialOptions,
  fireForSurfaces,
  fireVolumeGeometry,
  isFireSimulationMounted,
  mountFireSimulation,
  stepActiveFireSimulation,
  syncFlameVolumeLod,
} from './fire_material';
export { fireShedStepScale, setFireShedRung } from './fire_shed';
export {
  calmFireUniforms,
  FireSimulation,
  type FireVolumeUniforms,
  supportsFireSimulation,
} from './fire_simulation';
export {
  FIRE_LOOP_SECONDS,
  FIRE_VOLUME_ENTER_PIXELS,
  FIRE_VOLUME_EXIT_PIXELS,
  type FireCombustParams,
  type FireCombustState,
  type FirePlan,
  type FireTier,
  fireAtlasTexelToVoxel,
  fireCombustStep,
  fireDraftPulse,
  firePlanForTier,
  fireVoxelToAtlasTexel,
  shouldUseFireVolume,
} from './fire_solver_core';
export {
  FIRE_HULL_HEIGHT,
  FIRE_HULL_RADIUS,
  type FireSurfaceShaderOptions,
  fireSurfaceFragment,
  fireSurfaceVertex,
} from './fire_surface_glsl';
