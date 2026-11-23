import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

// Built inside createView's existing entity preparation gate, with no lights
// or shader clock. The untextured rims and anchors share the door family's
// basic-material program. The veil and the vortex wear the door family's
// membrane texture, and a textured additive double-sided basic material is a
// program of its own (the rift gate and the Wildheart door membranes are its
// only other users, and those exist as live views only), so the boot door
// prewarm stages this body too (door_portal.ts buildDoorPrewarmBodies): the
// way out is linked, and its texture uploaded, before Korzul ever falls.
// The renderer animates only the returned circular membrane; its stationary
// oval parent keeps the walk-through opening upright.
let circle: THREE.CircleGeometry | undefined;
let rim: THREE.TorusGeometry | undefined;
let crystal: THREE.OctahedronGeometry | undefined;
// Keyed by role, tier and membrane texture. The colours bake the tier's
// additive gain, so a graphics-profile switch drops them (a RESETTERS row in
// assets/graphics_profile.ts, beside the door family's own).
const materials = new Map<string, THREE.MeshBasicMaterial>();

/** Drop the tier-baked materials on a graphics-profile switch. */
export function resetSanctumExitPortalProfileCaches(): void {
  materials.clear();
}

function glow(
  role: string,
  color: number,
  opacity: number,
  lowGfx: boolean,
  texture: THREE.Texture | null = null,
): THREE.MeshBasicMaterial {
  const key = `${role}:${lowGfx}:${texture?.uuid ?? ''}`;
  let material = materials.get(key);
  if (!material) {
    material = markSharedMaterial(
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    material.name = `sanctum-exit:${role}:${lowGfx ? 'low' : 'standard'}`;
    if (!lowGfx) material.color.multiplyScalar(1.5);
    materials.set(key, material);
  }
  return material;
}

export function buildSanctumExitPortal(
  lowGfx: boolean,
  membraneTexture: THREE.Texture | null,
): { body: THREE.Group; portal: THREE.Mesh } {
  circle ??= markSharedGeometry(new THREE.CircleGeometry(1, 48));
  rim ??= markSharedGeometry(new THREE.TorusGeometry(1, 0.025, 6, 48));
  crystal ??= markSharedGeometry(new THREE.OctahedronGeometry(1));
  const body = new THREE.Group();
  body.name = 'sanctum-exit';
  const opening = new THREE.Group();
  opening.name = 'frost-opening';
  opening.position.y = 2.5;
  opening.scale.set(1.8, 2.35, 1);
  body.add(opening);

  const veil = new THREE.Mesh(circle, glow('veil', 0x727de8, 0.26, lowGfx, membraneTexture));
  veil.name = 'aurora-veil';
  veil.position.z = -0.07;
  veil.scale.setScalar(1.1);
  veil.rotation.z = 0.65;
  opening.add(veil);
  const portal = new THREE.Mesh(circle, glow('vortex', 0x8ef5ed, 0.5, lowGfx, membraneTexture));
  portal.name = 'return-vortex';
  opening.add(portal);

  // Two crisp rims keep the destination readable without bloom, including low
  // tier and reduced motion. Their separation gives the film a shallow throat.
  for (const [radius, z, tint] of [
    [1, 0.05, 0xb9f8ff],
    [1.1, -0.09, 0x8498ed],
  ]) {
    const edge = new THREE.Mesh(rim, glow(`rim-${radius}`, tint, 0.8, lowGfx));
    edge.name = 'frost-rim';
    edge.scale.setScalar(radius);
    edge.position.z = z;
    opening.add(edge);
  }

  // Faceted frost anchors sit outside the traversable aperture. All six share
  // geometry/material; asymmetrical sizes keep the ring from reading as a UI icon.
  const ice = glow('ice', 0x86cfe8, 0.8, lowGfx);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const shard = new THREE.Mesh(crystal, ice);
    shard.name = 'frost-anchor';
    shard.position.set(Math.cos(angle) * 2.15, 2.5 + Math.sin(angle) * 2.35, 0);
    shard.scale.set(0.15, i % 2 === 0 ? 0.48 : 0.32, 0.15);
    shard.rotation.z = angle - Math.PI / 2;
    body.add(shard);
  }
  return { body, portal };
}
