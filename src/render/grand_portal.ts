// Procedural Grand Portal prop (content/grand_teleports.ts): a blue-violet
// oval swirl on a stone base with a pulsing point light, behind the Soulwell
// build/sync/dispose seam and registered through summoned_objects.ts.

import * as THREE from 'three';
import {
  additiveMaterial,
  addSwirlRings,
  disposeOwnedMaterials,
  emissiveMaterial,
  OWNED_MATERIALS_KEY,
  spinSwirlRings,
  stoneMaterial,
} from './summoned_prop_kit';

export const GRAND_PORTAL_VISUAL_SPEC = { height: 3.1, ringRadius: 1.05, runeCount: 6 } as const;
const OVAL = { x: 0.82, y: 1.18 } as const;

export function buildGrandPortal(entityId: number): { group: THREE.Group; height: number } {
  const root = new THREE.Group();
  root.name = `grand_portal_${entityId}`;
  const baseMat = stoneMaterial(0x1d1b2e, 0.95, 0.06);
  const trimMat = stoneMaterial(0x3b3557, 0.72, 0.06);
  const runeMat = emissiveMaterial(0x4f6cff, 0x6f8dff, 2.2, 0.3);
  const owned: THREE.Material[] = [];

  for (const [radiusTop, radiusBottom, h, y, mat] of [
    [1.12, 1.28, 0.2, 0.1, baseMat],
    [0.72, 0.9, 0.16, 0.28, trimMat],
  ] as const) {
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, 10), mat);
    slab.position.y = y;
    slab.castShadow = true;
    slab.receiveShadow = true;
    root.add(slab);
  }
  // Rune stones around the rim, tilted outward.
  for (let i = 0; i < GRAND_PORTAL_VISUAL_SPEC.runeCount; i++) {
    const angle = (i / GRAND_PORTAL_VISUAL_SPEC.runeCount) * Math.PI * 2;
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), runeMat);
    rune.position.set(Math.sin(angle), 0.3, Math.cos(angle));
    rune.rotation.set(0.3, angle, 0);
    root.add(rune);
  }
  // The standing arcane frame: an oval torus of trim stone, then the swirl.
  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(GRAND_PORTAL_VISUAL_SPEC.ringRadius, 0.1, 6, 28),
    trimMat,
  );
  frame.scale.set(OVAL.x, OVAL.y, 1);
  frame.position.y = 1.7;
  frame.castShadow = true;
  root.add(frame);

  const swirl = new THREE.Group();
  swirl.position.y = 1.7;
  swirl.scale.set(OVAL.x, OVAL.y, 1);
  swirl.add(
    new THREE.Mesh(
      new THREE.CircleGeometry(GRAND_PORTAL_VISUAL_SPEC.ringRadius - 0.08, 28),
      additiveMaterial(0x3e5cff, 0.55, owned, { side: THREE.DoubleSide }),
    ),
  );
  addSwirlRings(
    swirl,
    [
      [0.82, 0.5, 0x8f7bff],
      [0.56, 0.62, 0xb08cff],
      [0.3, 0.78, 0xe6dcff],
    ],
    0.03,
    owned,
  );
  root.add(swirl);

  const light = new THREE.PointLight(0x6d7dff, 3.6, 8, 2);
  light.position.set(0, 1.7, 0);
  root.add(light);

  root.userData.grandPortalSwirl = swirl;
  root.userData.grandPortalLight = light;
  root.userData[OWNED_MATERIALS_KEY] = owned;
  return { group: root, height: GRAND_PORTAL_VISUAL_SPEC.height };
}

export const disposeGrandPortalVisual = disposeOwnedMaterials;

export function syncGrandPortalVisual(root: THREE.Object3D, time: number, entityId: number): void {
  const swirl = root.userData.grandPortalSwirl as THREE.Object3D | undefined;
  const light = root.userData.grandPortalLight as THREE.PointLight | undefined;
  if (swirl) {
    spinSwirlRings(swirl, time * 1.4 + entityId * 0.23, 1);
    const pulse = 1 + Math.sin(time * 2.6 + entityId) * 0.03;
    swirl.scale.set(OVAL.x * pulse, OVAL.y * pulse, 1);
  }
  if (light) light.intensity = 3.2 + Math.sin(time * 2.6 + entityId) * 0.6;
}
