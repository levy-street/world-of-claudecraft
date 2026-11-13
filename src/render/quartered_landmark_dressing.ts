// The Quartered Isle's landmark set dressing, render-only: a clear-ice sheet
// over every frozen lake with a ring of modeled ice spires round it, more
// spires along the Hoarshelf crevasses, a field of taller glacier spikes
// across the open Hoarshelf, the Drakelands' modeled lava laid in the
// Cinderscar burnways, a molten sheet filling the Cinderscar's shatter
// fissures, and the floating isles (the generated island models, with chains
// and a cloud bank, quartered_floating_isles.ts) trailing north from the Gyre
// over the sea. The layout is the pure cores
// quartered_landmark_dressing_core.ts, quartered_lake_ice_core.ts,
// quartered_fissure_lava_core.ts and quartered_floating_debris_core.ts; this
// module only loads the models and builds the meshes. Cosmetic: no colliders,
// nothing the sim reads (the lakes' slide is the sim's own aura).
//
// The same contract as the two modules it patterns on:
// - frost_ice_fields.ts: the spire is boot-preloaded on every host and
//   normalized through prepareFrostIceParts (so it wears the Frostveil ice
//   material and sheds Standard to Lambert on the same tier knob).
// - ember_features.ts: the three lava pieces ride the Drakelands kit's boot
//   policy (deferred on the iOS memory profile), the zone prepare awaits
//   quarteredLandmarkLoadFor before it builds, and the build refuses to run
//   before every model is resident, so a prepare that raced the load fails and
//   retries instead of silently drawing a bare isle for the session. The
//   fissure melt rides the same lane with the Ignivar moat's lava texture (it
//   wears that moat's lava material, ignivar_lava_moat.ts). The
//   floating island models ride the same lane (quartered_floating_isles.ts
//   registers their boot loads; the zone prepare's load below fetches any
//   still missing).
// - The isles are static: this view has no per-frame hook, and a bob would
//   need a custom vertex shader (a new program key) for a barely seen drift.
// The renderer attaches the view through attachZoneFeature, so its programs
// link behind the world compile gate and the idle zone prepare, never in a live
// frame.
import * as THREE from 'three';
import { ISLE_KIT, QUARTERED_ISLE_SPIRES } from '../sim/content/quartered_spires';
import { QUARTERED_FROZEN_LAKES } from '../sim/quartered_landmarks';
import type { BiomeId } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { drakelandsKitBootThunk } from './drakelands_kit_lane_core';
import { prepareFrostIceParts } from './frost_ice_fields';
import { GFX } from './gfx';
import {
  ensureIgnivarLavaMoatAssets,
  type IgnivarLavaMoatTextures,
  ignivarLavaSurfaceMaterial,
} from './ignivar_lava_moat';
import {
  type FissureLavaTile,
  planFissureLava,
  planVentPools,
} from './quartered_fissure_lava_core';
import { LOW_TIER_DEBRIS_SHARE, shedFloatingIsles } from './quartered_floating_debris_core';
import {
  buildFloatingIsles,
  floatingIsleLoads,
  floatingIslesInternalsForTest,
  floatingIslesResident,
} from './quartered_floating_isles';
import { LAKE_ICE_TEXTURE_SIZE, lakeIceDisc, lakeIceTexels } from './quartered_lake_ice_core';
import {
  planQuarteredLandmarkDressing,
  type QuarteredSpireSite,
} from './quartered_landmark_dressing_core';
import { SCENERY_BACKDROP_FLAG } from './scenery_bands';

const QUARTERED_DRESSING_URLS = {
  spire: '/models/props/frostveil_ice_spire.glb',
} as const satisfies Record<'spire', string>;
type DressingKey = keyof typeof QUARTERED_DRESSING_URLS;
const DRESSING_KEYS = Object.keys(QUARTERED_DRESSING_URLS) as DressingKey[];

// The loaded scenes. loadGltf caches by url, so on a host that has the
// Drakelands kit (or the Frostveil spire) resident these are the same parsed
// scenes those modules hold, never a second download. Never mutated here: the
// bakes below clone geometry before transforming it.
const sources: Partial<Record<DressingKey, THREE.Group>> = {};
// The Ignivar moat's lava texture, which the fissure melt's material samples.
let lavaTextures: IgnivarLavaMoatTextures | null = null;

function loadSource(key: DressingKey): Promise<void> {
  return loadGltf(QUARTERED_DRESSING_URLS[key]).then((gltf) => {
    sources[key] = gltf.scene;
  });
}

function loadLavaTextures(): Promise<void> {
  return ensureIgnivarLavaMoatAssets().then((textures) => {
    lavaTextures = textures;
  });
}

// The spire loads at boot everywhere, as frost_ice_fields.ts loads it.
registerDeferredPreload(() => loadSource('spire'));
// The fissure lava's textures too, except on the iOS memory profile (the
// isles' rule, quartered_floating_isles.ts): without this they were resident
// only if the Ignivar raid had loaded first, so every approach fetched them.
registerDeferredPreload(
  drakelandsKitBootThunk(
    () => loadLavaTextures(),
    () => GFX,
  ),
);

/** Every model and texture buildQuarteredLandmarks reads is resident. */
export function quarteredLandmarkAssetsResident(): boolean {
  return (
    lavaTextures !== null &&
    floatingIslesResident() &&
    DRESSING_KEYS.every((key) => sources[key] !== undefined)
  );
}

let inFlight: Promise<void> | null = null;

/** The load a zone prepare must await before building this biome's features,
 *  or null when there is nothing to wait for (the drakelandsKitLoadFor twin).
 *  A failed load rejects that prepare, so the zone stays unprepared and the
 *  next prepare retries only the models still missing. */
export function quarteredLandmarkLoadFor(biome: BiomeId): Promise<void> | null {
  if (biome !== 'quartered' || quarteredLandmarkAssetsResident()) return null;
  if (inFlight) return inFlight;
  const loads = DRESSING_KEYS.filter((key) => !sources[key]).map(loadSource);
  if (!lavaTextures) loads.push(loadLavaTextures());
  loads.push(...floatingIsleLoads());
  const task = Promise.all(loads).then(() => undefined);
  inFlight = task;
  // Observed here, so a load that fails while the terrain build is still
  // running is never an unhandled rejection; its awaiters still receive it.
  const settle = (): void => {
    if (inFlight === task) inFlight = null;
  };
  task.then(settle, settle);
  return task;
}

function finishInstances(mesh: THREE.InstancedMesh, group: THREE.Group): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
}

function instanceSpires(
  parts: ReturnType<typeof prepareFrostIceParts>,
  sites: readonly QuarteredSpireSite[],
  group: THREE.Group,
): void {
  if (sites.length === 0) return;
  const matrix = new THREE.Matrix4();
  const yaw = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, sites.length);
    mesh.userData.quarteredIceSpire = true;
    sites.forEach((site, i) => {
      yaw.setFromAxisAngle(up, site.yaw);
      axis.set(Math.sin(site.tiltAxisYaw), 0, Math.cos(site.tiltAxisYaw));
      tilt.setFromAxisAngle(axis, site.tilt);
      yaw.premultiply(tilt);
      position.set(site.x, site.y, site.z);
      scale.set(site.sx, site.sy, site.sz);
      mesh.setMatrixAt(i, matrix.compose(position, yaw, scale));
      mesh.setColorAt(i, tint.setHex(site.tint));
    });
    finishInstances(mesh, group);
  }
}

function lakeIceMaterial(): THREE.Material {
  const size = LAKE_ICE_TEXTURE_SIZE;
  const texture = new THREE.DataTexture(lakeIceTexels(size), size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const common = {
    map: texture,
    vertexColors: true,
    transparent: true,
    // a sheet a few centimetres over level ground: never write depth (so feet
    // on it are never clipped) and pull it toward the camera so it never
    // fights the terrain at range
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    emissive: new THREE.Color(0x0c2a40),
    emissiveIntensity: 0.3,
  };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...common, roughness: 0.06, metalness: 0.2 })
    : new THREE.MeshLambertMaterial(common);
  material.name = 'quartered-lake-ice';
  attachBiomeHaze(material);
  return material;
}

function lakeIceMesh(lakeIndex: number, material: THREE.Material): THREE.Mesh {
  const disc = lakeIceDisc(QUARTERED_FROZEN_LAKES[lakeIndex]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(disc.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(disc.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(disc.colors, 4));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(
      new Float32Array(disc.positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  geometry.setIndex(new THREE.BufferAttribute(disc.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `quartered-lake-ice-${lakeIndex}`;
  mesh.userData.quarteredLakeIce = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// The fissure melt: one mesh per tile of the pure core's sheet, all wearing
// the Ignivar moat's shared lava material (its UVs are the mesh's own xz, so
// the world-placed sheet gets world-anchored, seamless lava across tiles).
function fissureLavaMesh(tile: FissureLavaTile, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(tile.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(tile.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `quartered-fissure-lava-mesh-${tile.ti}-${tile.tj}`;
  mesh.userData.quarteredFissureLava = true;
  // the Ignivar moat's shared lava material: never this view's to dispose
  mesh.userData[BORROWED_MATERIAL_FLAG] = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** The fixed cull clusters, in attach order after the lakes (each a child
 *  group of the view). */
const CLUSTER_NAMES = {
  crevasse: 'quartered-crevasse-spires',
  shelfWest: 'quartered-hoarshelf-spires-west',
  shelfEast: 'quartered-hoarshelf-spires-east',
  vents: 'quartered-lava-vent-pools',
  near: 'quartered-floating-isles-near',
  mid: 'quartered-floating-isles-mid',
  far: 'quartered-floating-isles-far',
} as const;
type ClusterKey = keyof typeof CLUSTER_NAMES;

/** Set on a mesh whose material belongs to someone else (a cached GLB's, the
 *  Ignivar moat's shared lava): dispose() frees its geometry and nothing more. */
export const BORROWED_MATERIAL_FLAG = 'quarteredBorrowedMaterial';

/** Free what one build allocated: every geometry in the view (all cloned or
 *  procedural), and each material the view made with its procedural
 *  DataTexture. A borrowed material, and any texture that is not a
 *  DataTexture (a cached GLB's map on an ice material), is left alone. */
function disposeDressing(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    if (mesh.userData[BORROWED_MATERIAL_FLAG] === true) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    const map = (material as THREE.MeshStandardMaterial).map;
    if (map instanceof THREE.DataTexture) map.dispose();
    material.dispose();
  }
  group.clear();
}

export interface QuarteredLandmarkDressingView {
  group: THREE.Group;
  /** one per landmark cluster (and one per frozen lake and per lava tile):
   *  the isle spans ~370yd, and one footprint that wide could never be
   *  distance-culled (attachZoneFeature registers these) */
  cullGroups: THREE.Group[];
  /** Free the view's own GPU resources (the renderer's teardown; idempotent). */
  dispose(): void;
}

export function buildQuarteredLandmarks(seed: number): QuarteredLandmarkDressingView {
  // Built once per session: refuse to build before every model is resident,
  // so the zone prepare (which awaits quarteredLandmarkLoadFor first) fails
  // and retries rather than caching a view with the dressing missing.
  const spireSource = sources.spire;
  if (!spireSource || !lavaTextures || !quarteredLandmarkAssetsResident()) {
    throw new Error('buildQuarteredLandmarks: the landmark models are not resident');
  }
  const groundAt = (x: number, z: number) => terrainHeight(x, z, seed);
  const plan = planQuarteredLandmarkDressing(groundAt);
  const group = new THREE.Group();
  group.name = 'quartered-landmark-dressing';
  const clusters = {} as Record<ClusterKey, THREE.Group>;
  for (const key of Object.keys(CLUSTER_NAMES) as ClusterKey[]) {
    clusters[key] = new THREE.Group();
    clusters[key].name = CLUSTER_NAMES[key];
  }
  // the floating isles are a backdrop seen from across the sea: Low's
  // full-detail cutoff (scenery_bands) would erase them past 60yd
  for (const key of ['near', 'mid', 'far'] as const) {
    clusters[key].userData[SCENERY_BACKDROP_FLAG] = true;
  }

  const spireParts = prepareFrostIceParts(spireSource);
  // each frozen lake is one cull group: its ice sheet (its rim is the
  // generated snow outcrops and floes, decorProps in content/quartered_spires.ts)
  const iceMaterial = lakeIceMaterial();
  const lakeGroups = QUARTERED_FROZEN_LAKES.map((_, li) => {
    const lake = new THREE.Group();
    lake.name = li === 0 ? 'quartered-rimeglass' : `quartered-frozen-lake-${li}`;
    lake.add(lakeIceMesh(li, iceMaterial));
    return lake;
  });
  for (const cluster of ['crevasse', 'shelfWest', 'shelfEast'] as const) {
    instanceSpires(
      spireParts,
      plan.spires.filter((site) => site.cluster === cluster),
      clusters[cluster],
    );
  }
  // the molten fissures, one group per tile so the sweep sheds the far ones
  const lavaMaterial = ignivarLavaSurfaceMaterial(lavaTextures, !GFX.standardMaterials);
  const lavaTiles = planFissureLava({ groundAt }).map((tile) => {
    const tileGroup = new THREE.Group();
    tileGroup.name = `quartered-fissure-lava-${tile.ti}-${tile.tj}`;
    tileGroup.add(fissureLavaMesh(tile, lavaMaterial));
    return tileGroup;
  });
  // the lava vents' pools: one merged mesh of melt discs in the vents' rings
  const pools = planVentPools(
    groundAt,
    QUARTERED_ISLE_SPIRES.filter((d) => d.key === 'cinderLavaVent').map((d) => ({
      x: d.x,
      z: d.z,
      w: ISLE_KIT.cinderLavaVent.w * (d.scale ?? 1),
    })),
  );
  if (pools.indices.length > 0) {
    const poolMesh = fissureLavaMesh(
      { ti: -1, tj: -1, positions: pools.positions, indices: pools.indices },
      lavaMaterial,
    );
    poolMesh.name = 'quartered-lava-vent-pools-mesh';
    poolMesh.userData.quarteredFissureLava = false;
    poolMesh.userData.quarteredVentPool = true;
    clusters.vents.add(poolMesh);
  }
  // The isles are the one piece a lower tier may thin: they are cosmetic sky
  // dressing with nothing a player reacts to (the graphics fairness rule), and
  // they key off the same build-time knob the spires' material shed reads.
  buildFloatingIsles(
    shedFloatingIsles(plan.debris, GFX.standardMaterials ? 1 : LOW_TIER_DEBRIS_SHARE),
    { near: clusters.near, mid: clusters.mid, far: clusters.far },
  );

  const cullGroups = [
    ...lakeGroups,
    ...(['crevasse', 'shelfWest', 'shelfEast', 'vents'] as const).map((k) => clusters[k]),
    ...lavaTiles,
    ...(['near', 'mid', 'far'] as const).map((k) => clusters[k]),
  ].filter((cluster) => cluster.children.length > 0);
  for (const cluster of cullGroups) group.add(cluster);
  let disposed = false;
  return {
    group,
    cullGroups,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeDressing(group);
    },
  };
}

export const quarteredLandmarkDressingInternalsForTest = {
  urls: QUARTERED_DRESSING_URLS,
  installSources(next: Partial<Record<DressingKey, THREE.Group>>): void {
    Object.assign(sources, next);
  },
  installLavaTextures(next: IgnivarLavaMoatTextures | null): void {
    lavaTextures = next;
  },
  reset(): void {
    for (const key of DRESSING_KEYS) delete sources[key];
    lavaTextures = null;
    inFlight = null;
    floatingIslesInternalsForTest.reset();
  },
};
