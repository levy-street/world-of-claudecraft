// New Eastbrook's harbor waterfront geometry: the quay boardwalk and the
// three stilt piers (the long middle one is the ferry berth). Drawn from the
// same EASTBROOK_HARBOR_DECKS rectangles world.ts groundHeight walks, via the
// shared plank-walkway builder (deck_render.ts), so the plank plane underfoot
// is exactly the plank plane on screen. Bollards mark the pier tips for the
// moored hulls. Composed by the renderer beside the town view; empty on
// non-built-in worlds like every authored-town module.

import * as THREE from 'three';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { EASTBROOK_HARBOR_DECKS } from '../sim/eastbrook_harbor';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { buildDeckWood } from './deck_render';

// merge a pile of box geometries into one mesh (position + normal only; the
// gale_features.ts pattern, kept local like the original)
function mergeBoxes(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    norm.set(g.getAttribute('normal').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildEastbrookHarbor(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eastbrookHarbor';
  if (getActiveWorldContent() !== BUILTIN_WORLD) return group;
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
  const postWood = new THREE.MeshStandardMaterial({ color: 0x6b523d, roughness: 0.92 });
  const { planks, posts } = buildDeckWood(
    EASTBROOK_HARBOR_DECKS,
    (x, z) => terrainHeight(x, z, seed),
    WATER_LEVEL,
    { bollards: true },
  );
  group.add(mergeBoxes(planks, wood));
  group.add(mergeBoxes(posts, postWood));
  return group;
}
