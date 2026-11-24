// The world scene's per-render hooks, attached once by the renderer: the point
// light carriers pack the live lights (point_light_carriers.ts), then the
// scene-globals stabilizer holds the lights, fog and camera still between
// frames unless they really moved (scene_globals_stabilizer.ts). Order
// matters: the stabilizer chains after the carriers so it sees the values
// this render draws with. Both hook onto the scene itself, so every render
// path (composer, prewarm, census) is covered without a call of its own.

import type * as THREE from 'three';
import {
  attachPointLightCarriers,
  type PointLightCarriers,
  type PointLightSourceList,
} from './point_light_carriers';
import { attachSceneGlobalsStabilizer } from './scene_globals_stabilizer';

export { NO_POINT_LIGHTS } from './point_light_carriers';

export function attachSceneRenderHooks(
  scene: THREE.Scene,
  pointLightCount: number,
  pointLightSources: readonly PointLightSourceList[],
): PointLightCarriers {
  const carriers = attachPointLightCarriers(scene, pointLightCount, pointLightSources);
  attachSceneGlobalsStabilizer(scene);
  return carriers;
}
