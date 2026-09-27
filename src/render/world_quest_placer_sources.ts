import * as THREE from 'three';
import { FARSHORE_SALVAGE_OBJECT_ITEM_ID } from '../sim/content/world_quests';
import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { Entity } from '../sim/types';
import { worldQuestSalvageLayout, worldQuestSalvageVisualIndex } from '../sim/world_quest_salvage';
import type { WorldQuestObjectReader } from './quest_object_gate_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

export const CURRENT_QUEST_ASSETS = {
  wq_existing_ship: 'Current shipwreck',
  wq_existing_debris_0: 'Current broken planks',
  wq_existing_debris_1: 'Current barrel',
  wq_existing_debris_2: 'Current crate',
  wq_existing_debris_3: 'Current anchor',
  wq_existing_debris_4: 'Current hull fragment',
  wq_existing_debris_5: 'Current rowboat',
} as const;
export type CurrentQuestAssetKey = keyof typeof CURRENT_QUEST_ASSETS;
export interface CurrentQuestPlacement {
  key: CurrentQuestAssetKey;
  x: number;
  y: number;
  z: number;
  rot: number;
  pitch?: number;
  roll?: number;
  scale: number;
  sourceId: string;
}
export interface QuestPlacerWorld extends WorldQuestObjectReader {
  entities: ReadonlyMap<number, Entity>;
}
interface Model {
  root: THREE.Group;
  native: { len: number; hei: number; dep: number };
}
const models = new Map<CurrentQuestAssetKey, Model>();
let landmarks: CurrentQuestPlacement[] = [];
let pending: Promise<void> | null = null;

export function isCurrentQuestAssetKey(key: string): key is CurrentQuestAssetKey {
  return Object.hasOwn(CURRENT_QUEST_ASSETS, key);
}

function storeModel(key: CurrentQuestAssetKey, source: THREE.Object3D): void {
  const root = new THREE.Group();
  const model = source.clone(true);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  model.traverse((node) => {
    delete node.userData.entityId;
    if (node instanceof THREE.Mesh) {
      markSharedGeometry(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        markSharedMaterial(material);
    }
  });
  root.add(model);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if (size.lengthSq() === 0) throw new Error(`Current quest model is empty: ${key}`);
  models.set(key, { root, native: { len: size.x, hei: size.y, dep: size.z } });
}

export function prepareCurrentQuestAssets(): Promise<void> {
  if (!pending)
    pending = (async () => {
      const [
        { buildFarshoreShipwreck, prepareFarshoreShipwreck },
        { buildGroundQuestObject, farshoreSalvagePrewarmPlan, prepareFarshoreSalvageObjects },
      ] = await Promise.all([import('./farshore_shipwreck'), import('./quest_objects')]);
      await Promise.all([prepareFarshoreShipwreck(), prepareFarshoreSalvageObjects()]);
      const wreck = buildFarshoreShipwreck();
      if (!wreck) throw new Error('Current shipwreck is not ready');
      landmarks = (
        [
          { part: 'ship', key: 'wq_existing_ship', sourceId: 'shipwreck:ship' },
          { part: 'hull', key: 'wq_existing_debris_4', sourceId: 'salvage:2147100100' },
        ] as const
      ).map(({ part, key, sourceId }) => {
        const name = `farshore-broken-${part}`;
        const node = wreck.getObjectByName(name);
        if (!node) throw new Error(`Missing current shipwreck part: ${name}`);
        storeModel(key, node);
        return {
          key,
          sourceId,
          x: node.position.x,
          y: node.position.y,
          z: node.position.z,
          rot: THREE.MathUtils.radToDeg(node.rotation.y),
          pitch: THREE.MathUtils.radToDeg(node.rotation.x),
          roll: THREE.MathUtils.radToDeg(node.rotation.z),
          scale: node.scale.x,
        };
      });
      for (const { visual, entityId } of farshoreSalvagePrewarmPlan) {
        storeModel(
          `wq_existing_debris_${visual}` as CurrentQuestAssetKey,
          buildGroundQuestObject(FARSHORE_SALVAGE_OBJECT_ITEM_ID, entityId).group,
        );
      }
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}

export function currentQuestPlacements(world: QuestPlacerWorld): CurrentQuestPlacement[] {
  const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
  const ids = worldQuestSalvageLayout(
    quest,
    world.worldQuestLog.get(quest.id),
    world.worldQuestCycle,
  );
  const rows = landmarks.map((row) => ({ ...row }));
  for (const id of ids) {
    const entity = world.entities.get(id);
    const visual = worldQuestSalvageVisualIndex(id);
    if (!entity || visual === null) continue;
    rows.push({
      key: `wq_existing_debris_${visual}` as CurrentQuestAssetKey,
      sourceId: `salvage:${id}`,
      x: entity.pos.x,
      y: entity.pos.y,
      z: entity.pos.z,
      rot: THREE.MathUtils.radToDeg(entity.facing),
      scale: entity.scale,
    });
  }
  return rows;
}

function prepared(key: CurrentQuestAssetKey): Model {
  const model = models.get(key);
  if (!model) throw new Error(`Current quest model is not ready: ${key}`);
  return model;
}
export const currentQuestAssetNative = (key: CurrentQuestAssetKey): Model['native'] =>
  prepared(key).native;
export function createCurrentQuestModel(key: CurrentQuestAssetKey): THREE.Group {
  const model = prepared(key).root.clone(true);
  model.name = key;
  return model;
}

/** Free per-copy instance buffers, preserving the shared templates and materials. */
export function disposeQuestPlacerInstances(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.InstancedMesh) node.dispose();
  });
}
export async function warmCurrentQuestAssets(
  compile?: (target: THREE.Object3D) => Promise<unknown>,
): Promise<void> {
  if (compile) for (const model of models.values()) await compile(model.root);
}
