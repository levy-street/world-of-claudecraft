import type * as THREE from 'three';
import { hasWorldQuestDeliveryCargo } from '../sim/world_quest_delivery';
import { buildGroundQuestObject } from './quest_objects';

export { hasWorldQuestDeliveryCargo };

export interface WorldQuestCarryVisual {
  root: THREE.Group;
}

export interface WorldQuestCarryViewState {
  worldQuestCarryVisual?: WorldQuestCarryVisual | null;
}

export function syncWorldQuestCarryVisual(
  current: WorldQuestCarryVisual | null | undefined,
  parent: THREE.Object3D,
  carrying: boolean,
  build: () => { group: THREE.Group } = () => buildGroundQuestObject('eastbrook_freight_crate', 0),
): WorldQuestCarryVisual | null {
  if (!carrying) {
    if (current) parent.remove(current.root);
    return null;
  }
  if (current) return current;

  const built = build();
  if (built.group.children.length === 0) return null;
  built.group.scale.setScalar(0.5);
  built.group.position.set(0, 0.88, 0.48);
  built.group.rotation.set(0.08, 0, 0);
  parent.add(built.group);
  return { root: built.group };
}
