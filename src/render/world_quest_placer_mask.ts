// Dev authoring masks are scoped to one scene and never change simulation state.
import type * as THREE from 'three';

const masks = new WeakMap<THREE.Object3D, Set<string>>();
const hiddenLandmarks = new WeakMap<THREE.Object3D, Map<THREE.Object3D, boolean>>();
const landmarkNames = {
  'shipwreck:ship': 'farshore-broken-ship',
  // Preserve the hull's source ID in saved Placer drafts after retiring its pickup.
  'salvage:2147100100': 'farshore-broken-hull',
  'shipwreck:dock': 'farshore-broken-dock',
  'shipwreck:moorings': 'farshore-mooring-lines',
};

export function isWorldQuestPlacerSourceHidden(group: THREE.Object3D): boolean {
  if (!import.meta.env.DEV) return false;
  let scene = group;
  while (scene.parent) scene = scene.parent;
  return masks.get(scene)?.has(`salvage:${group.userData.entityId}`) === true;
}

export function setWorldQuestPlacerMask(scene: THREE.Scene, sources: readonly string[]): void {
  if (!import.meta.env.DEV) return;
  if (sources.length) masks.set(scene, new Set(sources));
  else masks.delete(scene);
  const hidden = hiddenLandmarks.get(scene) ?? new Map<THREE.Object3D, boolean>();
  for (const [node, visible] of hidden) node.visible = visible;
  hidden.clear();
  const landmark = scene.getObjectByName('farshore-shipwreck');
  for (const [id, name] of Object.entries(landmarkNames)) {
    if (!sources.includes(id)) continue;
    const node = landmark?.getObjectByName(name);
    if (node) {
      hidden.set(node, node.visible);
      node.visible = false;
    }
  }
  hiddenLandmarks.set(scene, hidden);
  // Hide existing wrappers immediately; normal visibility sync also honours
  // this mask for wrappers that stream in while the editor is open.
  for (const child of scene.children) {
    if (isWorldQuestPlacerSourceHidden(child)) child.visible = false;
  }
}
