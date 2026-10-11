import * as THREE from 'three';
import {
  FARSHORE_HULL_FRAGMENT_PLACEMENT,
  FARSHORE_SHIPWRECK_PLACEMENT,
} from '../sim/content/farshore_shipwreck_layout';
import { registerDeferredPreload } from './assets/preload';
import {
  createWorldQuestPlacerModel,
  isWorldQuestPlacerAssetReady,
  prepareWorldQuestPlacerAssets,
} from './world_quest_placer_assets';

// Boot and the placer share one asset cache and one normalization convention.
export const prepareFarshoreShipwreck = prepareWorldQuestPlacerAssets;
registerDeferredPreload(prepareFarshoreShipwreck);

export function buildFarshoreShipwreck(): THREE.Group | null {
  const parts = [
    ['farshore-broken-ship', FARSHORE_SHIPWRECK_PLACEMENT],
    ['farshore-broken-hull', FARSHORE_HULL_FRAGMENT_PLACEMENT],
  ] as const;
  if (parts.some(([, placement]) => !isWorldQuestPlacerAssetReady(placement.key))) return null;
  const root = new THREE.Group();
  root.name = 'farshore-shipwreck';
  for (const [name, placement] of parts) {
    const model = createWorldQuestPlacerModel(placement.key);
    model.name = name;
    model.position.set(placement.x, placement.y, placement.z);
    model.rotation.y = THREE.MathUtils.degToRad(placement.rot);
    model.scale.setScalar(placement.scale);
    root.add(model);
  }
  return root;
}
