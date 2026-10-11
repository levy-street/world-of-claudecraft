// Shared by the live shipwreck and its placer. Preserve the same ground pivot,
// authored dimensions and textures so exported transforms render unchanged.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import {
  WORLD_QUEST_PLACER_KEYS,
  type WorldQuestPlacerKey,
  worldQuestPlacerUrl,
} from './world_quest_placer_catalog';

interface PlacerModel {
  root: THREE.Group;
  native: { len: number; hei: number; dep: number };
}

const models = new Map<WorldQuestPlacerKey, PlacerModel>();
let pending: Promise<void> | null = null;

/** Center X/Z and ground Y without flattening away children or material slots. */
export function normalizeWorldQuestPlacerModel(source: THREE.Object3D): PlacerModel {
  const root = new THREE.Group();
  const model = source.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error('World quest placer asset has no geometry');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      markSharedGeometry(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        markSharedMaterial(material);
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  root.add(model);
  return { root, native: { len: size.x, hei: size.y, dep: size.z } };
}

export function prepareWorldQuestPlacerAssets(): Promise<void> {
  if (!pending) {
    pending = Promise.all(
      WORLD_QUEST_PLACER_KEYS.map(async (key) => {
        if (models.has(key)) return;
        const gltf = await loadGltf(worldQuestPlacerUrl(key));
        models.set(key, normalizeWorldQuestPlacerModel(gltf.scene));
      }),
    ).then(
      () => undefined,
      (error) => {
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}

function preparedModel(key: WorldQuestPlacerKey): PlacerModel {
  const model = models.get(key);
  if (!model) throw new Error(`World quest placer asset is not ready: ${key}`);
  return model;
}

export function isWorldQuestPlacerAssetReady(key: WorldQuestPlacerKey): boolean {
  return models.has(key);
}

export function worldQuestPlacerNative(key: WorldQuestPlacerKey): PlacerModel['native'] {
  return preparedModel(key).native;
}

export function createWorldQuestPlacerModel(key: WorldQuestPlacerKey): THREE.Group {
  const root = preparedModel(key).root.clone(true);
  root.name = key;
  return root;
}

/** Prepare the same mesh/material variants before the picker admits placements.
 *  The loading chat message is the authoring-tool stand-in; no world entity is hidden. */
export async function warmWorldQuestPlacerAssets(
  compile: ((target: THREE.Object3D) => Promise<unknown>) | undefined,
): Promise<void> {
  if (!compile) return;
  for (const key of WORLD_QUEST_PLACER_KEYS) await compile(preparedModel(key).root);
}
