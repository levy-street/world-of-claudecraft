import * as THREE from 'three';
import { GFX, surfaceMat } from './gfx';

export interface HunterFreezingTrapView {
  group: THREE.Group;
  height: number;
}

/** Compact procedural ice bear trap used by the replicated ground entity. */
export function buildHunterFreezingTrap(): HunterFreezingTrapView {
  const group = new THREE.Group();
  // The sim anchors the trap to an exact height sample, while the visible
  // terrain is a triangle interpolated between samples. Sink this low-profile
  // prop slightly so those two surfaces cannot leave daylight under it on a
  // slope. The jaws and teeth remain above the anchor.
  group.position.y = -0.12;
  const metal = surfaceMat({
    color: 0x5e8298,
    roughness: 0.45,
    metalness: 0.58,
    flatShading: !GFX.standardMaterials,
  });
  const ice = surfaceMat({
    color: 0x89ddff,
    roughness: 0.22,
    metalness: 0.08,
    emissive: 0x174a68,
    emissiveIntensity: 0.4,
    flatShading: !GFX.standardMaterials,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.1, 12), metal);
  base.name = 'freezing-trap-base';
  base.position.y = 0.05;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  for (let side = 0; side < 2; side++) {
    const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 6, 16, Math.PI), ice);
    jaw.name = `freezing-trap-jaw-${side}`;
    jaw.rotation.x = Math.PI / 2;
    jaw.rotation.y = side * Math.PI;
    jaw.position.y = 0.15;
    jaw.castShadow = true;
    group.add(jaw);

    for (let tooth = 0; tooth < 5; tooth++) {
      const angle = (tooth / 4) * Math.PI;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), ice);
      spike.name = `freezing-trap-tooth-${side}-${tooth}`;
      spike.position.set(
        Math.cos(angle) * 0.34,
        0.23,
        (side === 0 ? 1 : -1) * Math.sin(angle) * 0.34,
      );
      spike.rotation.z = (side === 0 ? 1 : -1) * 0.45;
      spike.castShadow = true;
      group.add(spike);
    }
  }

  return { group, height: 0.45 };
}
