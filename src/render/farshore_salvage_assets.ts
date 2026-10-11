// The live pickups use the exact same pivot and model size as the placer.
// Entity scale/facing carry the exported transform; the body adds no extra yaw.
import * as THREE from 'three';
import {
  FARSHORE_SALVAGE_PLACEMENTS,
  FARSHORE_SALVAGE_VISUAL_KEYS,
} from '../sim/content/farshore_shipwreck_layout';
import {
  FARSHORE_SALVAGE_ENTITY_ID_START,
  FARSHORE_SALVAGE_OBJECT_ITEM_ID,
} from '../sim/content/world_quests';
import { worldQuestSalvageVisualIndex } from '../sim/world_quest_salvage';
import { registerDeferredPreload } from './assets/preload';
import {
  createWorldQuestPlacerModel,
  isWorldQuestPlacerAssetReady,
  prepareWorldQuestPlacerAssets,
  worldQuestPlacerNative,
} from './world_quest_placer_assets';
import { worldQuestPlacerUrl } from './world_quest_placer_catalog';

export const FARSHORE_SALVAGE_URLS = Object.fromEntries(
  FARSHORE_SALVAGE_VISUAL_KEYS.map((key, visual) => [
    `farshore_salvage_${visual}`,
    worldQuestPlacerUrl(key),
  ]),
);

export function salvageVisualItemId(itemId: string, entityId: number): string | null {
  if (itemId !== FARSHORE_SALVAGE_OBJECT_ITEM_ID) return null;
  const visual = worldQuestSalvageVisualIndex(entityId);
  return visual === null ? null : `farshore_salvage_${visual}`;
}

/** Called both for a fresh body and when the renderer reuses a pooled body. */
export function groundQuestObjectYaw(itemId: string, entityId: number): number {
  return salvageVisualItemId(itemId, entityId) === null ? (entityId % 7) * 0.45 : 0;
}

export const farshoreSalvagePrewarmPlan = Object.freeze(
  FARSHORE_SALVAGE_VISUAL_KEYS.flatMap((key, visual) => {
    const index = FARSHORE_SALVAGE_PLACEMENTS.findIndex((placement) => placement.key === key);
    if (index < 0) return []; // Reserved scenery slots have no pickup body to prewarm.
    return [
      Object.freeze({
        visual,
        entityId: FARSHORE_SALVAGE_ENTITY_ID_START + index,
        itemId: FARSHORE_SALVAGE_OBJECT_ITEM_ID,
        poolKey: `object:${FARSHORE_SALVAGE_OBJECT_ITEM_ID}:salvage-${visual}`,
      }),
    ];
  }),
);

export const prepareFarshoreSalvageObjects = prepareWorldQuestPlacerAssets;
registerDeferredPreload(prepareFarshoreSalvageObjects);

export function prewarmFarshoreSalvageObjects<T>(
  build: (itemId: string, entityId: number) => T,
  store: (poolKey: string, object: T) => void,
): T[] {
  return farshoreSalvagePrewarmPlan.map((entry) => {
    const object = build(entry.itemId, entry.entityId);
    store(entry.poolKey, object);
    return object;
  });
}

export function buildFarshoreSalvageObject(
  itemId: string,
  entityId: number,
): { group: THREE.Group; height: number } | null {
  const visualItemId = salvageVisualItemId(itemId, entityId);
  if (visualItemId === null) return null;
  const placement = FARSHORE_SALVAGE_PLACEMENTS[entityId - FARSHORE_SALVAGE_ENTITY_ID_START];
  const group = new THREE.Group();
  group.userData.questObjectVisualItemId = visualItemId;
  if (!isWorldQuestPlacerAssetReady(placement.key)) return { group, height: 1.35 };
  group.add(createWorldQuestPlacerModel(placement.key));
  return { group, height: worldQuestPlacerNative(placement.key).hei };
}
