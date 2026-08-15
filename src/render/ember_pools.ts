// A warm pool of embers on the ground at every authored campfire in the world,
// lit only after dark.
//
// Why this exists even though campfires already carry a real light: the forward
// renderer keeps only GFX.maxPointLights alive at once (renderer.ts
// budgetFireLights), so of the ~55 campfires in the world the nearest handful
// shine and the rest are unlit props. By day nobody notices. At night it meant
// a hostile camp you could see from a ridge had no light at all. A baked
// additive pool costs one merged draw per zone and is the same trick
// dungeon.ts already uses under its torches for exactly the same reason.
//
// The pool geometry drapes over the terrain (ground_glow_patch.ts) instead of
// lying flat, so a fire on a slope keeps its glow instead of the hillside
// slicing through it. Mob camps WITHOUT an authored campfire are not pooled
// here any more: they get a real fire brazier (camp_braziers.ts), and the
// which-camps split lives in night_accents_core.ts (pure, tested).
import * as THREE from 'three';
import { getActiveWorldContent, zoneAt } from '../sim/data';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { buildDrapedGlowGeometry } from './ground_glow_patch';
import { campfireEmberSites } from './night_accents_core';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
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
/** Night-light-field entries: the punctual cutoff and candela-style level,
 *  calibrated to read as firelight on dark ground (see streetlamps.ts). */
const FIELD_RADIUS = 26;
const FIELD_INTENSITY = 40;
/** Open-fire glow as deep linear ember. */
const FIELD_COLOR = [1.0, 0.42, 0.12] as const;
/** The authored campfires' flame height (props.ts hangs its light at 1.2). */
const FIELD_HEIGHT = 1.2;
/** An open fire wavers hard; this is what sells it as burning. */
const FIELD_FLICKER = 0.22;

export function buildEmberPools(seed = 0): EmberPoolsView {
  const group = new THREE.Group();
  group.name = 'ember-pools';
  const cullGroups: THREE.Group[] = [];

  const content = getActiveWorldContent();
  const sites = campfireEmberSites(content.props.campfires);
  // Bucket by zone so a pool 900 yards away is not submitted every frame.
  const byZone = new Map<number, typeof sites>();
  for (const site of sites) {
    const groundY = terrainHeight(site.x, site.z, seed);
    if (groundY < WATER_LEVEL) continue; // a drowned fire lights nothing
    const zone = zoneAt(site.x, site.z);
    const index = content.zones.indexOf(zone);
    const bucket = byZone.get(index);
    if (bucket) bucket.push(site);
    else byZone.set(index, [site]);
  }
  if (byZone.size === 0) {
    return { group, cullGroups, update: () => undefined };
  }

  // Authored campfires join the night light field where the terrain splices
  // it; the draped pools below are the fallback where it does not.
  registerStaticNightLights(
    'ember-pools',
    [...byZone.values()].flat().map((site) => ({
      x: site.x,
      y: terrainHeight(site.x, site.z, seed) + FIELD_HEIGHT,
      z: site.z,
      radius: FIELD_RADIUS,
      r: FIELD_COLOR[0],
      g: FIELD_COLOR[1],
      b: FIELD_COLOR[2],
      intensity: FIELD_INTENSITY,
      flicker: FIELD_FLICKER,
    })),
  );
  if (hasNightLightField()) {
    return { group, cullGroups, update: () => undefined };
  }

  const material = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: POOL_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const meshes: THREE.Mesh[] = [];
  for (const [zoneIndex, zoneSites] of byZone) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `ember-pools-zone-${zoneIndex}`;
    const mesh = new THREE.Mesh(
      buildDrapedGlowGeometry(zoneSites, (x, z) => terrainHeight(x, z, seed)),
      material,
    );
    mesh.geometry.computeBoundingSphere();
    mesh.renderOrder = 1; // over the ground it drapes on
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
