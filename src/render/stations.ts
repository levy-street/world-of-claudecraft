// Crafting-station scenery (Professions 2.0 Phase 9): static props anchored
// at each STATIONS record (src/sim/content/professions.ts) so the six
// stations read as physical places in their towns. Purely cosmetic,
// render-only: no collision, no interaction, no sim/IWorld state, and
// deliberately NO radius ring or boundary decal (the proximity gate has no
// visual precision by design). Placement specs live in the pure core
// stations_core.ts; this module is the Three half.
//
// Every model is an EXISTING GLB reused by URL (assets/loader.ts caches one
// parse per URL, so the copies props.ts / artisan_row_props.ts load are
// shared). The kitchens anchor replicates the props.ts campfire recipe
// (bonfire base + lathe flame + fire light); the returned flames/fireLights
// join the renderer's campfire flicker + ember pass, the same way
// vale_cup props ride that budget. Rendered identically on every graphics
// tier (pure scenery, no actionable info, so no tier split is needed).
// A primitive fallback keeps the brief pre-load window from showing bare
// ground, mirroring artisan_row_props.ts / gather_nodes.ts.

import * as THREE from 'three';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';
import { type StationPropKind, stationPropPlacements } from './stations_core';

// Half-step (yd) used to finite-difference the local ground slope under each
// prop so furniture-scale props tilt with the terrain (artisan_row idiom).
const PITCH_SAMPLE_STEP = 0.4;

// All EXISTING assets: the props.ts qprops/village kit pieces plus the
// artisan-row Tripo props (already generated, manifested, and preloaded by
// URL elsewhere; reusing the URL costs nothing extra).
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
// artisan_row idiom), so authored-scale differences between kits never leak
// into the placements. Artisan pieces keep their artisan_row_props heights;
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
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedStationGltf.set(kind, gltf.scene);
      }),
    );
  }
}

/** Test-only window into the preload asset set (mirrors artisan_row_props.ts). */
export const stationsPreloadInternalsForTest = {
  assetUrl: STATION_ASSET_URL,
  targetHeight: STATION_TARGET_HEIGHT,
};

function buildFallbackMesh(kind: StationPropKind): THREE.Object3D {
  const h = STATION_TARGET_HEIGHT[kind];
  const geo = new THREE.BoxGeometry(h * 0.7, h, h * 0.7);
  const mesh = new THREE.Mesh(geo, surfaceMat({ color: 0x8a6a4a }));
  mesh.position.y = h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildStationMesh(kind: StationPropKind): THREE.Object3D {
  const loaded = loadedStationGltf.get(kind);
  if (!loaded) return buildFallbackMesh(kind);
  const inst = loaded.clone(true);
  // Normalize to the target height and re-seat the base at y=0 (the GLB's
  // authored origin is not guaranteed to sit on the ground plane).
  const box = new THREE.Box3().setFromObject(inst);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 1e-4 ? STATION_TARGET_HEIGHT[kind] / rawHeight : 1;
  inst.scale.setScalar(scale);
  const scaledBox = new THREE.Box3().setFromObject(inst);
  inst.position.y -= scaledBox.min.y;
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return inst;
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

// Hand-authored landmarks against the built-in towns (the STATIONS pos values
// are Eastbrook/Fenbridge/Highwatch placements), so like artisan_row_props
// this only places against the built-in world: the editor's play-test swaps
// in a custom WorldContent where these fixed spots could land inside a
// building or below water.
export function buildStationProps(seed: number): StationPropsView {
  const group = new THREE.Group();
  group.name = 'stationProps';
  const flames: THREE.Mesh[] = [];
  const fireLights: THREE.PointLight[] = [];
  if (getActiveWorldContent() !== BUILTIN_WORLD) return { group, flames, fireLights };

  const flameGeo = new THREE.LatheGeometry(
    FLAME_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    7,
  );
  const usePbr = GFX.standardMaterials;

  for (const p of stationPropPlacements()) {
    const obj = buildStationMesh(p.kind);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.position.set(p.x, terrainHeight(p.x, p.z, seed), p.z);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, p.rot);
    const tiltQuat = new THREE.Quaternion().setFromUnitVectors(
      WORLD_UP,
      groundNormal(p.x, p.z, seed),
    );
    holder.quaternion.copy(tiltQuat.multiply(yawQuat));
    if (p.kind === 'campfire') {
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshLambertMaterial({
          color: 0xffaa33,
          emissive: 0xff6600,
          emissiveIntensity: usePbr ? 2.2 : 1.4,
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
    }
    group.add(holder);
  }
  return { group, flames, fireLights };
}
