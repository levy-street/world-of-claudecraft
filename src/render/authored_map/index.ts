// Public surface of the authored-map (Studio) presentation layer (see CLAUDE.md).
export {
  authoredChaseGroundY,
  createChaseBoomScratch,
  solveChaseBoom,
} from './chase_boom_core';
export { type EditorBirdsConfig, rebuildBirdFlock } from './editor_birds';
export { applyOrthographicLens, setRaycasterFromOrthographicLens } from './editor_lens';
export { EditorSkybox } from './editor_skybox';
export {
  clampToGameplayFogBand,
  type EditorVisibility,
  requestOutdoorFog,
} from './gameplay_fog_core';
export { AuthoredSceneLayers } from './layers';
export { AuthoredLightingRig, type LightingRigTargets } from './lighting_rig';
export { MapWeatherLayers } from './map_weather';
export { updatePlacedAssetsFrame } from './placed_frame';
export { EditorShadowCache } from './shadow_cache';
export { UnderworldMask } from './underworld';
export { ZoneAtmosphere } from './zone_atmosphere';
export { type ZoneResidencyRect, zoneAllowedByResidencyFilter } from './zone_residency_core';
