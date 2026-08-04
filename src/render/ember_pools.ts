// A warm pool of embers on the ground at every authored campfire and mob camp
// in the world, lit only after dark.
//
// Why this exists even though campfires already carry a real light: the forward
// renderer keeps only GFX.maxPointLights alive at once (renderer.ts
// budgetFireLights), so of the ~55 campfires in the world the nearest handful
// shine and the rest are unlit props. By day nobody notices. At night it meant
// a hostile camp you could see from a ridge had no light at all. A baked
// additive pool costs one instanced draw per zone and is the same trick
// dungeon.ts already uses under its torches for exactly the same reason.
//
// Camps without a campfire get a wider, fainter pool: the read is "people live
// here", not one fire. The dedupe that keeps the two from stacking is in
// night_accents_core.ts (pure, tested).
import * as THREE from 'three';
import { CAMPS, getActiveWorldContent, zoneAt } from '../sim/data';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { emberSites } from './night_accents_core';
import { radialGlowTexture } from './textures';

export interface EmberPoolsView {
  group: THREE.Group;
  /** per-zone subtrees, so the zone-feature distance cull works per zone */
  cullGroups: THREE.Group[];
  /** Drive from the frame's ember glow amount (0 = out, 1 = full). */
  update(glow: number, time: number): void;
}

const POOL_COLOR = 0xff8c3c;
const POOL_OPACITY = 0.34;
const POOL_LIFT = 0.1;
/** Unit disc; each instance scales it to the site's own radius. */
const POOL_SEGMENTS = 16;

export function buildEmberPools(seed = 0): EmberPoolsView {
  const group = new THREE.Group();
  group.name = 'ember-pools';
  const cullGroups: THREE.Group[] = [];

  const content = getActiveWorldContent();
  const sites = emberSites(content.props.campfires, CAMPS);
  // Bucket by zone so a pool 900 yards away is not submitted every frame.
  const byZone = new Map<number, typeof sites>();
  for (const site of sites) {
    const groundY = terrainHeight(site.x, site.z, seed);
    if (groundY < WATER_LEVEL) continue; // a drowned camp lights nothing
    const zone = zoneAt(site.x, site.z);
    const index = content.zones.indexOf(zone);
    const bucket = byZone.get(index);
    if (bucket) bucket.push(site);
    else byZone.set(index, [site]);
  }
  if (byZone.size === 0) {
    return { group, cullGroups, update: () => undefined };
  }

  const geometry = new THREE.CircleGeometry(1, POOL_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: POOL_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const meshes: THREE.InstancedMesh[] = [];

  for (const [zoneIndex, zoneSites] of byZone) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `ember-pools-zone-${zoneIndex}`;
    const mesh = new THREE.InstancedMesh(geometry, material, zoneSites.length);
    for (let i = 0; i < zoneSites.length; i++) {
      const site = zoneSites[i];
      position.set(site.x, terrainHeight(site.x, site.z, seed) + POOL_LIFT, site.z);
      scale.set(site.radius, 1, site.radius);
      mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = 1; // over the ground it floats on
    mesh.visible = false; // nothing until the embers light
    meshes.push(mesh);
    zoneGroup.add(mesh);
    group.add(zoneGroup);
    cullGroups.push(zoneGroup);
  }

  let shown = false;
  return {
    group,
    cullGroups,
    update(glow: number, time: number): void {
      const lit = glow > 0.001;
      if (lit !== shown) {
        shown = lit;
        for (const mesh of meshes) mesh.visible = lit;
      }
      if (!lit) {
        material.opacity = 0;
        return;
      }
      // Embers breathe slower and shallower than a flame: this is the bed of
      // coals, not the fire on top of it.
      const breathe = 1 + Math.sin(time * 1.3) * 0.07;
      material.opacity = POOL_OPACITY * glow * breathe;
    },
  };
}
