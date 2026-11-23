// The FFT ocean: the simulation, the sky it reflects, and the surface
// material every water sheet draws with. See CLAUDE.md in this directory.
export {
  createOceanDepthMaterial,
  createOceanSurfaceMaterial,
  OCEAN_DEBUG_TERM,
  OCEAN_DEPTH_RENDER_ORDER,
  OCEAN_DISP_SCALE,
  OCEAN_LOOK,
  OCEAN_PALETTE_OVERRIDE,
  type OceanSharedUniforms,
  type OceanSheetRects,
  type OceanSkyUniforms,
  oceanFoamTexture,
} from './ocean_material';
export {
  calmOceanUniforms,
  OceanSimulation,
  type OceanSurfaceUniforms,
} from './ocean_simulation';
export {
  DEFAULT_SEA_STATE,
  OCEAN_LOOP_SECONDS,
  type OceanPlan,
  type OceanSeaState,
  oceanPlanForTier,
} from './ocean_spectrum_core';
export { OCEAN_MAX_SHEET_RECTS } from './ocean_surface_glsl';
export { SkyReflectionProbe, supportsSkyProbe } from './sky_probe';
export { rebakeWaterCharacterField } from './water_character_field';
export { advanceWaterLiveness, createWaterLiveness } from './water_liveness_core';
