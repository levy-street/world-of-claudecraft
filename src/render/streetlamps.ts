// Town streetlamps: an iron post with a warm lantern head, standing along the
// roads for a short walk out of every zone hub. Dark by day, lit through the
// night, so a town and its approaches stay readable after dusk without the world
// ceasing to read as night.
//
// Procedural, in the low-poly kit style the rest of the world dressing uses
// (frost_sky.ts's Icemantle lanterns are the nearest sibling): a merged
// six-sided fixture and an octahedral glass, instanced once per town so a town
// costs three draws and the distance cull in attachZoneFeature drops the
// thirteen towns the player is not standing in.
//
// Three layers make the light, in falling cost order:
//   1. a baked additive ground pool under every lamp (the thing that actually
//      paints the road; one instanced draw per town, every tier),
//   2. an HDR emissive lantern head above the bloom threshold, so the lamp reads
//      as a light source on the composer tiers,
//   3. a real THREE.PointLight on every third lamp, riding the renderer's shared
//      fire-light budget (renderer.ts budgetFireLights), which keeps only the
//      nearest GFX.maxPointLights alive.
// Layers 1 and 2 are what a low tier keeps if the budget never reaches a lamp,
// and they are the layers that carry the readability; the point lights only add
// falloff on nearby geometry.
//
// Placement is streetlamp_placement_core.ts (pure, tested). Ground heights come
// from the sim's terrainHeight, per the "terrain height = sim height" invariant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolvePosition } from '../sim/colliders';
import { getActiveWorldContent } from '../sim/data';
import { propPlacementRoll } from '../sim/prop_layout';
import { terrainHeight } from '../sim/world';
import { EMISSIVE_LIGHT, GFX } from './gfx';
import {
  type LampSite,
  lampCarriesLight,
  planStreetlamps,
  type StreetlampPlan,
} from './streetlamp_placement_core';
import { radialGlowTexture } from './textures';

export interface StreetlampsView {
  group: THREE.Group;
  /** point lights for the renderer's shared fire-light budget */
  glowLights: THREE.PointLight[];
  /** per-town subtrees, so the zone-feature distance cull works per town */
  cullGroups: THREE.Group[];
  /** Drive the whole set from the frame's lamp glow amount (0 = out, 1 = full). */
  update(glow: number, time: number): void;
}

const POST_HEIGHT = 2.7;
const IRON_COLOR = 0x3a3128;
const GLASS_COLOR = 0xffe0aa;
const GLASS_EMISSIVE = 0xffb154;
const LIGHT_COLOR = 0xffa848;
const LIGHT_INTENSITY = 7;
const LIGHT_DISTANCE = 17;
const LIGHT_HEIGHT = 3.0;
const POOL_RADIUS = 2.9;
const POOL_LIFT = 0.12;
// Every lamp lays one of these, and a town centre has a dozen lamps in frame:
// what looks right for a single pool stacks into a lit plaza, so this is tuned
// against the crowd of them, not against one.
const POOL_OPACITY = 0.3;
/** How far a lamp may be nudged by a collider before we give up on the spot. */
const CLEARANCE_EPSILON = 0.05;
const LAMP_CLEARANCE = 1.1;

/**
 * Post, collar, lantern housing, and finial, merged into one instanced draw.
 *
 * Every part is a CylinderGeometry/ConeGeometry on purpose: mergeGeometries
 * refuses a mixed set (Three's polyhedra come back NON-indexed while the lathe
 * primitives are indexed), and a null merge here fails the whole scene build.
 * `tests/streetlamps.test.ts` pins the merge rather than leaving it to a boot.
 */
export function buildLampFixtureGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.075, 0.135, POST_HEIGHT, 6);
  post.translate(0, POST_HEIGHT * 0.5, 0);
  const collar = new THREE.CylinderGeometry(0.16, 0.19, 0.13, 6);
  collar.translate(0, POST_HEIGHT + 0.06, 0);
  // the lantern housing: a flared skirt under the glass and a peaked cap over it
  const skirt = new THREE.ConeGeometry(0.25, 0.2, 6);
  skirt.rotateX(Math.PI);
  skirt.translate(0, POST_HEIGHT + 0.22, 0);
  const cap = new THREE.ConeGeometry(0.29, 0.3, 6);
  cap.translate(0, POST_HEIGHT + 0.73, 0);
  const finial = new THREE.ConeGeometry(0.07, 0.16, 4);
  finial.translate(0, POST_HEIGHT + 0.96, 0);
  const parts = [post, collar, skirt, cap, finial];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('streetlamps: lamp fixture geometry failed to merge');
  merged.computeVertexNormals();
  return merged;
}

export function buildLampGlassGeometry(): THREE.BufferGeometry {
  const glass = new THREE.OctahedronGeometry(0.23, 0);
  glass.scale(1, 1.35, 1);
  glass.translate(0, POST_HEIGHT + 0.45, 0);
  return glass;
}

/** Emissive-capable material on every tier (Lambert carries emissive too). */
function glassMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = {
    color: GLASS_COLOR,
    emissive: GLASS_EMISSIVE,
    emissiveIntensity: 0,
    flatShading: true,
  };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.45, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
}

function ironMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = { color: IRON_COLOR, flatShading: true };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.82, metalness: 0.25 })
    : new THREE.MeshLambertMaterial(opts);
}

function buildPlan(seed: number): StreetlampPlan {
  const content = getActiveWorldContent();
  const towns = content.zones.map((zone) => ({
    x: zone.hub.x,
    z: zone.hub.z,
    radius: zone.hub.radius,
  }));
  return planStreetlamps(content.roads, towns, {
    groundAt: (x, z) => terrainHeight(x, z, seed),
    blocked: (x, z) => {
      // A lamp inside a building, stall, well, or fence is worse than no lamp.
      // resolvePosition pushes a body out of whatever it overlaps, so a spot
      // that comes back moved was already occupied.
      const resolved = resolvePosition(seed, x, z, LAMP_CLEARANCE);
      return (
        Math.abs(resolved.x - x) > CLEARANCE_EPSILON || Math.abs(resolved.z - z) > CLEARANCE_EPSILON
      );
    },
    roll: propPlacementRoll,
  });
}

export function buildStreetlamps(seed = 0): StreetlampsView {
  const group = new THREE.Group();
  group.name = 'streetlamps';
  const glowLights: THREE.PointLight[] = [];
  const cullGroups: THREE.Group[] = [];
  const poolMeshes: THREE.InstancedMesh[] = [];

  const plan = buildPlan(seed);
  if (plan.sites.length === 0) {
    return { group, glowLights, cullGroups, update: () => undefined };
  }

  const fixtureGeo = buildLampFixtureGeometry();
  const glassGeo = buildLampGlassGeometry();
  const poolGeo = new THREE.CircleGeometry(POOL_RADIUS, 16);
  poolGeo.rotateX(-Math.PI / 2);
  const ironMat = ironMaterial();
  const glassMat = glassMaterial();
  const poolMat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: LIGHT_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  for (let townIndex = 0; townIndex < plan.townRanges.length; townIndex++) {
    const range = plan.townRanges[townIndex];
    const count = range.end - range.start;
    if (count === 0) continue;
    const townGroup = new THREE.Group();
    townGroup.name = `streetlamps-town-${townIndex}`;
    const fixtures = new THREE.InstancedMesh(fixtureGeo, ironMat, count);
    const glasses = new THREE.InstancedMesh(glassGeo, glassMat, count);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count);

    for (let i = 0; i < count; i++) {
      const site: LampSite = plan.sites[range.start + i];
      const groundY = site.y;
      quaternion.setFromAxisAngle(up, site.yaw);
      position.set(site.x, groundY, site.z);
      fixtures.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      glasses.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      position.set(site.x, groundY + POOL_LIFT, site.z);
      pools.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      if (lampCarriesLight(i)) {
        const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, 2);
        light.position.set(site.x, groundY + LIGHT_HEIGHT, site.z);
        light.userData.baseIntensity = 0;
        // The renderer pins the VISIBLE point-light count at GFX.maxPointLights
        // from the first frame (pad lights fill the rest); a lamp that arrived
        // visible would push the count over and recompile every lit material.
        light.visible = false;
        glowLights.push(light);
        townGroup.add(light);
      }
    }
    fixtures.instanceMatrix.needsUpdate = true;
    glasses.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    fixtures.castShadow = true;
    fixtures.computeBoundingSphere();
    glasses.computeBoundingSphere();
    pools.computeBoundingSphere();
    pools.renderOrder = 1; // over the ground it floats on
    pools.visible = false; // no pool until the lamps light
    poolMeshes.push(pools);
    townGroup.add(fixtures);
    townGroup.add(glasses);
    townGroup.add(pools);
    group.add(townGroup);
    cullGroups.push(townGroup);
  }

  let poolsShown = false;
  return {
    group,
    glowLights,
    cullGroups,
    update(glow: number, time: number): void {
      const lit = glow > 0.001;
      if (lit !== poolsShown) {
        poolsShown = lit;
        for (const pool of poolMeshes) pool.visible = lit;
      }
      if (!lit) {
        glassMat.emissiveIntensity = 0;
        poolMat.opacity = 0;
        for (const light of glowLights) light.userData.baseIntensity = 0;
        return;
      }
      // A lantern flame breathes rather than strobing: two slow out-of-phase
      // sines, the same idiom the Icemantle lanterns use.
      const flicker = 1 + Math.sin(time * 5.7) * 0.05 + Math.sin(time * 1.9) * 0.04;
      glassMat.emissiveIntensity = EMISSIVE_LIGHT * glow * flicker;
      poolMat.opacity = POOL_OPACITY * glow;
      // The budget owns light.intensity (renderer.ts applyPointLightBudget +
      // flickerContributingFireLights read this base), so a lamp out of budget
      // costs nothing and a lit one picks the level up on the next pass.
      const base = LIGHT_INTENSITY * glow;
      for (const light of glowLights) light.userData.baseIntensity = base;
    },
  };
}
