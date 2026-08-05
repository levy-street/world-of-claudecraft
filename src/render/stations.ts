// Crafting-station scenery (Professions 2.0): static props anchored
// at each STATIONS record (src/sim/content/professions.ts) so the six
// stations read as physical places in their towns. Purely cosmetic,
// render-only: no collision, no interaction, no sim/IWorld state, and
// deliberately NO radius ring or boundary decal (the proximity gate has no
// visual precision by design). Placement specs live in the pure core
// stations_core.ts; this module is the Three half.
//
// Every model is an EXISTING GLB reused by URL (assets/loader.ts caches one
// parse per URL, so copies loaded by props.ts are shared). The kitchens
// anchor replicates the props.ts campfire recipe
// (bonfire base + lathe flame + fire light); the returned flames/fireLights
// join the renderer's campfire flicker + ember pass, the same way
// vale_cup props ride that budget. Rendered identically on every graphics
// tier (pure scenery, no actionable info, so no tier split is needed).
// A primitive fallback keeps the brief pre-load window from showing bare
// ground, mirroring gather_nodes.ts.

import * as THREE from 'three';
import type { StationDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { EMISSIVE_LIGHT, GFX, surfaceMat } from './gfx';
import { type StationPropKind, stationPropPlacements } from './stations_core';
import { applySurfaceDetail, wornFamilyFor } from './worn_stone';

// Half-step (yd) used to finite-difference the local ground slope under each
// prop so furniture-scale props tilt with the terrain (artisan_row idiom).
const PITCH_SAMPLE_STEP = 0.4;

// All EXISTING assets: the props.ts qprops/village kit pieces plus the
// former Artisan Row Tripo props (already generated and manifested).
const STATION_ASSET_URL: Record<StationPropKind, string> = {
  anvil: '/models/props/anvil.glb',
  campfire: '/models/props/bonfire.glb',
  cauldron: '/models/props/alchemy_cauldron.glb',
  tanningRack: '/models/props/leatherworking_rack.glb',
  loom: '/models/props/tailoring_loom.glb',
  workbench: '/models/props/engineering_workbench.glb',
  crate: '/models/props/crate_wooden.glb',
  barrel: '/models/props/barrel.glb',
};

// Target height (yd) each GLB is normalized to (Box3 rescale + re-seat, the
// the existing prop idiom), so authored-scale differences between kits never
// leak into the placements. Reused artisan pieces keep their former heights;
// crate matches the props.ts hider-comment footprint (crate 0.65).
const STATION_TARGET_HEIGHT: Record<StationPropKind, number> = {
  anvil: 0.75,
  campfire: 0.45,
  cauldron: 0.9,
  tanningRack: 1.5,
  loom: 1.3,
  workbench: 1.0,
  crate: 0.65,
  barrel: 0.85,
};

// The props.ts campfire flame: lathe profile, warm Lambert, ember-triggering
// color (renderer's flicker pass checks color.r > color.b), byte-matched so a
// kitchens fire is indistinguishable from a town campfire.
const FLAME_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.16, 0.1],
  [0.27, 0.28],
  [0.3, 0.45],
  [0.22, 0.66],
  [0.1, 0.84],
  [0.001, 0.95],
];
const FLAME_Y = 0.16;
const FLAME_BASE_SCALE = 1.15;
const FIRE_LIGHT_COLOR = 0xff8830;
const FIRE_LIGHT_INTENSITY = 12;
const FIRE_LIGHT_RANGE = 16;
const FIRE_LIGHT_DECAY = 2;
const FIRE_LIGHT_Y = 1.2;

const loadedStationGltf = new Map<StationPropKind, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(STATION_ASSET_URL) as [StationPropKind, string][]) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        loadedStationGltf.set(kind, gltf.scene);
      }),
    );
  }
}

/** Test-only window into the preload asset set. */
export const stationsPreloadInternalsForTest = {
  assetUrl: STATION_ASSET_URL,
  targetHeight: STATION_TARGET_HEIGHT,
};

// One template part per mesh primitive of a station model, with the per-kind
// height normalization baked in: normalize = T(0, -scaledMinY, 0) * S(scale),
// exactly the transform the old per-placement clones applied, so instanced
// placement is pixel-identical. That identity assumes the GLB scene ROOT has
// no x/z offset (GLTFLoader always creates a fresh identity root): the old
// clone path applied the scale around the reseated root, which cancels a
// root y offset exactly but would drift x/z by offset*(1-scale).
interface StationTemplatePart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
}

// Loader cache scenes are IMMUTABLE and Object3D.clone shares materials, so
// the surface-detail layer goes on a one-time CLONE cached per source
// material (glass stays clean via the shared skip list; everything else on
// the 'tools' palette atlas reads as workbench wood).
const stationMatCache = new Map<string, THREE.Material>();

function stationMaterial(src: THREE.Material): THREE.Material {
  const cached = stationMatCache.get(src.uuid);
  if (cached) return cached;
  let out = src;
  const worn = wornFamilyFor('tools', src.name, { transparent: src.transparent === true });
  if (worn && (src as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    out = src.clone();
    applySurfaceDetail(out as THREE.MeshStandardMaterial, worn.family, {
      strength: worn.strength,
    });
  }
  stationMatCache.set(src.uuid, out);
  return out;
}

function stationTemplateParts(kind: StationPropKind): StationTemplatePart[] {
  const loaded = loadedStationGltf.get(kind);
  if (!loaded) {
    const h = STATION_TARGET_HEIGHT[kind];
    return [
      {
        geo: new THREE.BoxGeometry(h * 0.7, h, h * 0.7),
        mat: surfaceMat({ color: 0x8a6a4a }),
        local: new THREE.Matrix4().makeTranslation(0, h / 2, 0),
      },
    ];
  }
  loaded.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(loaded);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 1e-4 ? STATION_TARGET_HEIGHT[kind] / rawHeight : 1;
  const normalize = new THREE.Matrix4()
    .makeTranslation(0, -box.min.y * scale, 0)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const parts: StationTemplatePart[] = [];
  loaded.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      parts.push({
        geo: child.geometry,
        mat: Array.isArray(child.material)
          ? child.material.map(stationMaterial)
          : stationMaterial(child.material),
        local: new THREE.Matrix4().multiplyMatrices(normalize, child.matrixWorld),
      });
    }
  });
  return parts;
}

export interface StationPropsView {
  group: THREE.Group;
  /** Kitchens fire cones; the renderer re-enables matrixAutoUpdate on these
   *  and pushes them into its campfire flicker + ember pass. */
  flames: THREE.Mesh[];
  /** Kitchens fire lights; ride the renderer's fireLights flicker budget. */
  fireLights: THREE.PointLight[];
}

// Local ground normal at (x, z), from a finite-difference terrainHeight sample.
function groundNormal(x: number, z: number, seed: number): THREE.Vector3 {
  const s = PITCH_SAMPLE_STEP;
  const hPX = terrainHeight(x + s, z, seed);
  const hNX = terrainHeight(x - s, z, seed);
  const hPZ = terrainHeight(x, z + s, seed);
  const hNZ = terrainHeight(x, z - s, seed);
  return new THREE.Vector3(-(hPX - hNX) / (2 * s), 1, -(hPZ - hNZ) / (2 * s)).normalize();
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Station anchors come through the active IWorld. Custom worlds with no
// authored services therefore get no fixed built-in clusters.
export function buildStationProps(seed: number, stations: readonly StationDef[]): StationPropsView {
  const group = new THREE.Group();
  group.name = 'stationProps';
  const flames: THREE.Mesh[] = [];
  const fireLights: THREE.PointLight[] = [];
  if (stations.length === 0) return { group, flames, fireLights };

  const flameGeo = new THREE.LatheGeometry(
    FLAME_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    7,
  );
  const usePbr = GFX.standardMaterials;

  // Group placements per (kind x region cell) and instance one mesh per
  // model part: 18 per-placement GLB clones (a draw per primitive each)
  // become one draw per (kind x part x hub cluster), and the per-cluster
  // bounds keep off-screen hubs frustum-cullable (a single world-spanning
  // batch would draw everywhere, forever).
  const byKind = new Map<string, { kind: StationPropKind; mats: THREE.Matrix4[] }>();
  const holderMatrix = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  for (const p of stationPropPlacements(stations)) {
    pos.set(p.x, terrainHeight(p.x, p.z, seed), p.z);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, p.rot);
    const tiltQuat = new THREE.Quaternion().setFromUnitVectors(
      WORLD_UP,
      groundNormal(p.x, p.z, seed),
    );
    const quat = tiltQuat.multiply(yawQuat);
    holderMatrix.compose(pos, quat, one);
    const clusterKey = `${p.kind}:${Math.floor(p.x / 180)}:${Math.floor(p.z / 180)}`;
    const bucket = byKind.get(clusterKey);
    if (bucket) bucket.mats.push(holderMatrix.clone());
    else byKind.set(clusterKey, { kind: p.kind, mats: [holderMatrix.clone()] });
    if (p.kind === 'campfire') {
      const holder = new THREE.Group();
      holder.position.copy(pos);
      holder.quaternion.copy(quat);
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshLambertMaterial({
          color: 0xffaa33,
          emissive: 0xff6600,
          emissiveIntensity: usePbr ? EMISSIVE_LIGHT : 1.4,
          transparent: true,
          opacity: 0.92,
        }),
      );
      flame.position.y = FLAME_Y;
      flame.scale.setScalar(FLAME_BASE_SCALE);
      holder.add(flame);
      flames.push(flame);
      const light = new THREE.PointLight(
        FIRE_LIGHT_COLOR,
        FIRE_LIGHT_INTENSITY,
        FIRE_LIGHT_RANGE,
        FIRE_LIGHT_DECAY,
      );
      light.position.y = FIRE_LIGHT_Y;
      holder.add(light);
      fireLights.push(light);
      group.add(holder);
    }
  }
  const matrix = new THREE.Matrix4();
  for (const { kind, mats: matrices } of byKind.values()) {
    for (const part of stationTemplateParts(kind)) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, matrices.length);
      im.name = `stationProps:${kind}`;
      matrices.forEach((m, i) => {
        matrix.multiplyMatrices(m, part.local);
        im.setMatrixAt(i, matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  return { group, flames, fireLights };
}
