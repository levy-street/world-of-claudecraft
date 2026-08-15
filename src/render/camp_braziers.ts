// Camp fires: a REAL burning fixture at every fire-building mob camp that does
// not already have an authored campfire, so a bandit camp is lit by a fire you
// can walk up to rather than by a bare glow painted on the ground.
//
// Only the camps whose mobs would build one get one (FIRE_BUILDING_FAMILIES in
// night_accents_core.ts: humanoids, trolls, ogres; a wolf pack lights nothing).
// Half the fires are a tall iron BRAZIER, the streetlamp's heavier cousin with
// an open basket; the other half are a low stone FIRE PIT with crossed logs,
// the deterministic 50/50 split riding the shared placement roll. Both burn
// day and night, exactly like the authored campfires they stand in for.
//
// Draw cost per zone: one instanced draw per fixture kind, one per coal bed,
// plus one small flame mesh per fire (the campfire flame idiom, animated by
// the renderer's shared scenery-flame pass, which skips every flame whose zone
// the distance cull has hidden). The point lights join the shared fire-light
// budget; the ground illumination joins the night light field (terrain shader)
// where it exists, with a draped glow pool as the fallback tier's stand-in.
//
// Which camps qualify is night_accents_core.ts (pure, tested).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolvePosition } from '../sim/colliders';
import { CAMPS, getActiveWorldContent, MOBS, zoneAt } from '../sim/data';
import { propPlacementRoll } from '../sim/prop_layout';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../sim/world';
import {
  type BrazierSite,
  type CampFireKind,
  planCampBrazierSites,
} from './camp_brazier_placement_core';
import { EMISSIVE_LIGHT, GFX } from './gfx';
import { buildDrapedGlowGeometry, type GlowPatchSite } from './ground_glow_patch';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
import { radialGlowTexture } from './textures';

export type { BrazierSite, CampFireKind } from './camp_brazier_placement_core';

export interface CampBraziersView {
  group: THREE.Group;
  /** point lights for the renderer's shared fire-light budget */
  glowLights: THREE.PointLight[];
  /** live flame meshes for the renderer's scenery-flame pass */
  flames: THREE.Mesh[];
  /** per-zone subtrees, so the zone-feature distance cull works per zone */
  cullGroups: THREE.Group[];
  /** Drive the fallback ground pools from the frame's lamp glow amount. */
  update(glow: number, time: number): void;
}

const IRON_COLOR = 0x3a3128;
const STONE_COLOR = 0x6b655c;
const COAL_COLOR = 0xff7a30;
const COAL_EMISSIVE = 0xff5a1a;
const FLAME_COLOR = 0xffaa33;
const FLAME_EMISSIVE = 0xff6600;
const LIGHT_COLOR = 0xff8830;
/** Matches the authored campfires: this IS the camp's fire, not a lamp. */
const LIGHT_INTENSITY = 15;
const LIGHT_DISTANCE = 26;
/** The wide faint pool the camp used to get; the fallback tier still does. */
const POOL_RADIUS = 7.5;
const POOL_OPACITY = 0.34;
/** Basket height: bigger than a streetlamp post, the camp's own bonfire mast. */
export const BRAZIER_RIM_HEIGHT = 4.48;
/** How far a brazier may be pushed by a collider before we try another spot. */
const CLEARANCE_EPSILON = 0.05;
const BRAZIER_CLEARANCE = 1.3;
/** Night-light-field entries: the punctual cutoff and candela-style level,
 *  calibrated to read as firelight on dark ground (see streetlamps.ts). */
const FIELD_RADIUS = 26;
const FIELD_INTENSITY = 40;
/** Open-fire glow as deep linear ember. */
const FIELD_COLOR = [1.0, 0.42, 0.12] as const;
/** An open fire wavers hard; this is what sells it as burning. */
const FIELD_FLICKER = 0.22;
/** Where each kind's flame (and field light) sits above the ground. */
const BRAZIER_FIRE_HEIGHT = 4.42;
const FIREPIT_FIRE_HEIGHT = 0.35;

/**
 * Foot, post, collar, basket skirt, and rim, merged into one instanced draw.
 * All CylinderGeometry/ConeGeometry, for the same reason as the streetlamp
 * fixture: mergeGeometries refuses a mixed indexed/non-indexed set, and a null
 * merge fails the scene build. Pinned by `tests/camp_braziers.test.ts`.
 */
export function buildBrazierFixtureGeometry(): THREE.BufferGeometry {
  const foot = new THREE.CylinderGeometry(0.5, 0.62, 0.35, 6);
  foot.translate(0, 0.175, 0);
  const post = new THREE.CylinderGeometry(0.15, 0.24, 3.35, 6);
  post.translate(0, 0.35 + 1.675, 0);
  const collar = new THREE.CylinderGeometry(0.3, 0.36, 0.18, 6);
  collar.translate(0, 3.75, 0);
  // the open basket: a flared skirt under a heavy rim
  const skirt = new THREE.ConeGeometry(0.72, 0.5, 6);
  skirt.rotateX(Math.PI);
  skirt.translate(0, 4.1, 0);
  const rim = new THREE.CylinderGeometry(0.78, 0.74, 0.16, 6);
  rim.translate(0, 4.4, 0);
  const parts = [foot, post, collar, skirt, rim];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('camp_braziers: brazier fixture geometry failed to merge');
  merged.computeVertexNormals();
  return merged;
}

/** The bed of coals sitting inside the basket, emissive above the rim. */
export function buildBrazierCoalsGeometry(): THREE.BufferGeometry {
  const coals = new THREE.CylinderGeometry(0.52, 0.58, 0.2, 6);
  coals.translate(0, 4.38, 0);
  return coals;
}

/**
 * The ground fire: a ring of field stones around two crossed logs. All
 * cylinders, same merge contract as the brazier.
 */
export function buildFirePitGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stones = 7;
  for (let i = 0; i < stones; i++) {
    const angle = (i / stones) * Math.PI * 2;
    const stone = new THREE.CylinderGeometry(0.14, 0.2, 0.26, 5);
    stone.rotateY(angle * 1.7); // varied facets so the ring is not a gear
    stone.translate(Math.cos(angle) * 0.82, 0.12, Math.sin(angle) * 0.82);
    parts.push(stone);
  }
  for (let i = 0; i < 3; i++) {
    const log = new THREE.CylinderGeometry(0.07, 0.09, 1.15, 5);
    log.rotateZ(Math.PI / 2 - 0.35);
    log.rotateY((i / 3) * Math.PI * 2 + 0.4);
    log.translate(0, 0.2, 0);
    parts.push(log);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('camp_braziers: fire pit geometry failed to merge');
  merged.computeVertexNormals();
  return merged;
}

/** The pit's own coal bed, low inside the stone ring. */
export function buildFirePitCoalsGeometry(): THREE.BufferGeometry {
  const coals = new THREE.CylinderGeometry(0.42, 0.5, 0.14, 6);
  coals.translate(0, 0.1, 0);
  return coals;
}

/** The campfire flame profile (props.ts), scaled per kind. */
function flameProfile(mult: number): THREE.BufferGeometry {
  const points = [
    [0, 0],
    [0.16, 0.1],
    [0.27, 0.28],
    [0.3, 0.45],
    [0.22, 0.66],
    [0.1, 0.84],
    [0.001, 0.95],
  ].map(([r, y]) => new THREE.Vector2(r * mult, y * mult));
  return new THREE.LatheGeometry(points, 7);
}

/** A third bigger than a campfire's flame, licking out of the basket. */
export function buildBrazierFlameGeometry(): THREE.BufferGeometry {
  return flameProfile(1.35);
}

/** The pit burns wider still: this is the camp's hearth on the ground. */
export function buildFirePitFlameGeometry(): THREE.BufferGeometry {
  return flameProfile(1.55);
}

/**
 * The wired plan: the pure layout (camp_brazier_placement_core.ts, where the
 * ring-slide and kind-split rules live and are tested) against the real world
 * content and the sim's own probes.
 */
export function planCampBraziers(seed = 0): BrazierSite[] {
  const content = getActiveWorldContent();
  return planCampBrazierSites(
    CAMPS,
    content.props.campfires,
    (mobId) => MOBS[mobId]?.family,
    {
      groundAt: (x, z) => terrainHeight(x, z, seed),
      blocked: (x, z) => {
        const resolved = resolvePosition(seed, x, z, BRAZIER_CLEARANCE);
        return (
          Math.abs(resolved.x - x) > CLEARANCE_EPSILON ||
          Math.abs(resolved.z - z) > CLEARANCE_EPSILON
        );
      },
      roadClear: roadDistance,
      roll: propPlacementRoll,
    },
    WATER_LEVEL,
  );
}

function ironMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = { color: IRON_COLOR, flatShading: true };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.82, metalness: 0.25 })
    : new THREE.MeshLambertMaterial(opts);
}

function stoneMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = { color: STONE_COLOR, flatShading: true };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.95, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
}

function coalsMaterial(): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const opts = {
    color: COAL_COLOR,
    emissive: COAL_EMISSIVE,
    emissiveIntensity: EMISSIVE_LIGHT,
    flatShading: true,
  };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.9, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
}

function fireHeight(kind: CampFireKind): number {
  return kind === 'brazier' ? BRAZIER_FIRE_HEIGHT : FIREPIT_FIRE_HEIGHT;
}

/** One kind's instanced fixture + coal bed for one zone bucket. */
function buildKindMeshes(
  sites: readonly BrazierSite[],
  fixtureGeo: THREE.BufferGeometry,
  coalsGeo: THREE.BufferGeometry,
  fixtureMat: THREE.Material,
  coalsMat: THREE.Material,
): [THREE.InstancedMesh, THREE.InstancedMesh] {
  const fixtures = new THREE.InstancedMesh(fixtureGeo, fixtureMat, sites.length);
  const coals = new THREE.InstancedMesh(coalsGeo, coalsMat, sites.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    quaternion.setFromAxisAngle(up, site.yaw);
    position.set(site.x, site.y, site.z);
    matrix.compose(position, quaternion, scale);
    fixtures.setMatrixAt(i, matrix);
    coals.setMatrixAt(i, matrix);
  }
  fixtures.instanceMatrix.needsUpdate = true;
  coals.instanceMatrix.needsUpdate = true;
  fixtures.castShadow = true;
  fixtures.computeBoundingSphere();
  coals.computeBoundingSphere();
  return [fixtures, coals];
}

export function buildCampBraziers(seed = 0): CampBraziersView {
  const group = new THREE.Group();
  group.name = 'camp-braziers';
  const glowLights: THREE.PointLight[] = [];
  const flames: THREE.Mesh[] = [];
  const cullGroups: THREE.Group[] = [];
  const poolMeshes: THREE.Mesh[] = [];

  const sites = planCampBraziers(seed);
  if (sites.length === 0) {
    return { group, glowLights, flames, cullGroups, update: () => undefined };
  }

  // The ground illumination: the night light field where the terrain splices
  // it (real reactive light), the draped pool fallback where it does not.
  registerStaticNightLights(
    'camp-braziers',
    sites.map((site) => ({
      x: site.x,
      y: site.y + fireHeight(site.kind) + 0.4,
      z: site.z,
      radius: FIELD_RADIUS,
      r: FIELD_COLOR[0],
      g: FIELD_COLOR[1],
      b: FIELD_COLOR[2],
      intensity: FIELD_INTENSITY,
      flicker: FIELD_FLICKER,
    })),
  );
  const usePools = !hasNightLightField();

  const content = getActiveWorldContent();
  const byZone = new Map<number, BrazierSite[]>();
  for (const site of sites) {
    const index = content.zones.indexOf(zoneAt(site.x, site.z));
    const bucket = byZone.get(index);
    if (bucket) bucket.push(site);
    else byZone.set(index, [site]);
  }

  const brazierGeo = buildBrazierFixtureGeometry();
  const brazierCoalsGeo = buildBrazierCoalsGeometry();
  const brazierFlameGeo = buildBrazierFlameGeometry();
  const pitGeo = buildFirePitGeometry();
  const pitCoalsGeo = buildFirePitCoalsGeometry();
  const pitFlameGeo = buildFirePitFlameGeometry();
  const ironMat = ironMaterial();
  const stoneMat = stoneMaterial();
  const coalsMat = coalsMaterial();
  // Built only on the fallback tiers: on field tiers no pool mesh exists, and
  // a material attached to nothing would be dead per-frame opacity writes.
  const poolMat = usePools
    ? new THREE.MeshBasicMaterial({
        map: radialGlowTexture(),
        color: LIGHT_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    : null;

  const patchSites: GlowPatchSite[] = [];

  for (const [zoneIndex, zoneSites] of byZone) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `camp-braziers-zone-${zoneIndex}`;
    const braziers = zoneSites.filter((site) => site.kind === 'brazier');
    const pits = zoneSites.filter((site) => site.kind === 'firepit');
    if (braziers.length > 0) {
      const [fixtures, coals] = buildKindMeshes(
        braziers,
        brazierGeo,
        brazierCoalsGeo,
        ironMat,
        coalsMat,
      );
      zoneGroup.add(fixtures);
      zoneGroup.add(coals);
    }
    if (pits.length > 0) {
      const [fixtures, coals] = buildKindMeshes(pits, pitGeo, pitCoalsGeo, stoneMat, coalsMat);
      zoneGroup.add(fixtures);
      zoneGroup.add(coals);
    }

    patchSites.length = 0;
    for (const site of zoneSites) {
      patchSites.push({ x: site.x, z: site.z, radius: POOL_RADIUS });
      // The live flame, one small mesh per fire: the renderer's shared
      // scenery-flame pass owns its flicker and its ember particles, exactly
      // as it does for the authored campfires.
      const flame = new THREE.Mesh(
        site.kind === 'brazier' ? brazierFlameGeo : pitFlameGeo,
        new THREE.MeshLambertMaterial({
          color: FLAME_COLOR,
          emissive: FLAME_EMISSIVE,
          emissiveIntensity: GFX.standardMaterials ? EMISSIVE_LIGHT : 1.4,
          transparent: true,
          opacity: 0.92,
        }),
      );
      flame.position.set(site.x, site.y + fireHeight(site.kind), site.z);
      flames.push(flame);
      zoneGroup.add(flame);

      // Burns day and night like a campfire, so the base is static; the shared
      // budget + flicker pass own the live intensity. Arrives invisible so the
      // pinned point-light count never moves (the recompile freeze rule).
      const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, 2);
      light.position.set(site.x, site.y + fireHeight(site.kind) + 0.5, site.z);
      light.userData.baseIntensity = LIGHT_INTENSITY;
      light.visible = false;
      glowLights.push(light);
      zoneGroup.add(light);
    }
    if (poolMat) {
      const pools = new THREE.Mesh(
        buildDrapedGlowGeometry(patchSites, (x, z) => terrainHeight(x, z, seed)),
        poolMat,
      );
      pools.geometry.computeBoundingSphere();
      pools.renderOrder = 1; // over the ground it drapes on
      pools.visible = false; // no pool until dark
      poolMeshes.push(pools);
      zoneGroup.add(pools);
    }
    group.add(zoneGroup);
    cullGroups.push(zoneGroup);
  }

  let poolsShown = false;
  return {
    group,
    glowLights,
    flames,
    cullGroups,
    update(glow: number, time: number): void {
      const lit = glow > 0.001;
      if (lit !== poolsShown) {
        poolsShown = lit;
        for (const pool of poolMeshes) pool.visible = lit;
      }
      if (poolMat) {
        poolMat.opacity = lit ? POOL_OPACITY * glow * (1 + Math.sin(time * 1.3) * 0.07) : 0;
      }
      // The coals breathe all day: this fire does not wait for dusk.
      coalsMat.emissiveIntensity = EMISSIVE_LIGHT * (0.9 + Math.sin(time * 1.6) * 0.1);
    },
  };
}
