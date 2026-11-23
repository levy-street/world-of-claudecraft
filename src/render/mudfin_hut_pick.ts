// The click volume of a torchable mudfin hut (q_deepfen_purge's `murloc_hut`
// ground objects, one at each Mirefen mudfin hut). The hut ART is the scenery
// model props.ts draws from src/sim/mudfin_huts.ts, so the entity is only an
// invisible cylinder over it (pick_only_objects.ts): a click on the hut's walls
// reaches the object, and no generic quest crate or loot sparkle is built
// inside the hut.

import * as THREE from 'three';
import { MUDFIN_HUT_MODELS } from '../sim/mudfin_huts';

/** One body for both models: the wider wall plus a hand's width, the taller hut. */
export const MUDFIN_HUT_PICK = (() => {
  const specs = Object.values(MUDFIN_HUT_MODELS);
  return {
    radius: Math.max(...specs.map((spec) => spec.radius)) + 0.25,
    height: Math.max(...specs.map((spec) => spec.height)),
  };
})();

export function buildMudfinHutPickBody(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  group.name = 'MudfinHutPick';
  const proxy = new THREE.Mesh(
    new THREE.CylinderGeometry(
      MUDFIN_HUT_PICK.radius,
      MUDFIN_HUT_PICK.radius,
      MUDFIN_HUT_PICK.height,
      12,
      1,
      true,
    ),
    new THREE.MeshBasicMaterial(),
  );
  proxy.position.y = MUDFIN_HUT_PICK.height / 2;
  proxy.visible = false;
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  group.add(proxy);
  return { group, height: MUDFIN_HUT_PICK.height };
}
