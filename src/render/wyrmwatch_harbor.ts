// The Wyrmwatch cliff harbor on screen: the one Blender-authored model
// (public/models/props/wyrmwatch_harbor.glb, scripts/assets/wyrmwatch_harbor/) placed on
// the waterline at the harbor origin (sim/content/wyrmwatch_harbor.ts), and the path to
// Wyrmwatch laid from its three flagstones along the content's centre line, each stone
// seated on the terrain (the terrain drawn IS the sim's terrainHeight).
//
// Which parts a graphics tier keeps is the pure core's call (wyrmwatch_harbor_core.ts):
// the walkable structure, rails, gate, cargo, lanterns, the Harbormaster's House and the
// path on every tier; the iron trim from medium, the loose dressing from high. The house's
// four walls and roof are kept apart from the merge (wyrmwatch_harbor_house.ts fades them
// for the camera); the rest of it merges with the harbor. The tier is the static effects
// tier (GFX.effectsTier), never the frame-rate governor, and a graphics-profile change
// rebuilds the props (the resetter below, registered in assets/graphics_profile.ts).
//
// GPU work: the harbor is built into the props root at world build (props.ts), so the
// world-entry compile links it with the rest of the props, and its distinct (geometry,
// material) programs join the props material prewarm (wyrmwatchHarborPrewarmParts), so
// a harbor first seen after the curtain links nothing in a live frame. The materials are
// the surface family's vertex-coloured standard/lambert (vertex_colour_glb_parts.ts,
// shared with the route markers: the same programs). Nothing here runs per frame.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  WYRMWATCH_HARBOR_ORIGIN,
  WYRMWATCH_HARBOR_PATH,
  WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
} from '../sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
} from '../sim/content/wyrmwatch_harbor_house';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX } from './gfx';
import {
  addToBucket,
  mergeVertexColourBuckets,
  type VertexColourPart,
  vertexColourMaterialConverter,
  vertexColourMeshGeometry,
} from './vertex_colour_glb_parts';
import {
  WYRMWATCH_PATH_STONE_PARTS,
  wyrmwatchHarborParts,
  wyrmwatchPathStones,
} from './wyrmwatch_harbor_core';
import {
  buildHarborHouseLights,
  buildHarborHouseShell,
  clearHarborHouseShell,
  harborHouseShellParts,
  setHarborHouseAnchor,
} from './wyrmwatch_harbor_house';
import { HOUSE_SHELL_PARTS, type HouseShellPart } from './wyrmwatch_harbor_house_core';

const HARBOR_URL = '/models/props/wyrmwatch_harbor.glb';

let loaded: GLTF | null = null;
let loadTask: Promise<void> | null = null;

export function prepareWyrmwatchHarborAssets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadTask) return loadTask;
  loadTask = loadGltf(HARBOR_URL)
    .then((gltf) => {
      loaded = gltf;
      loadTask = null;
    })
    .catch((err) => {
      loadTask = null;
      throw err;
    });
  return loadTask;
}

if (typeof window !== 'undefined') registerDeferredPreload(prepareWyrmwatchHarborAssets);

type HarborPart = VertexColourPart;

interface HarborTemplate {
  /** The kept parts merged into one geometry per material, in the model's frame. */
  parts: HarborPart[];
  /** The house's shell parts, each merged per material on its own, in the model's frame. */
  shell: Map<HouseShellPart, HarborPart[]>;
  /** The three flagstones, each in its own frame (origin at its centre). */
  stones: HarborPart[];
}

/** Templates by `effectsTier|standard`: a preset change converts anew. */
const templates = new Map<string, HarborTemplate>();
let lastParts: HarborPart[] = [];
const materials = vertexColourMaterialConverter();

/** Drop the prepared templates (graphics-profile rebuilds convert materials anew;
 *  the parsed source survives). Registered in assets/graphics_profile.ts. */
export function resetWyrmwatchHarborCaches(): void {
  templates.clear();
  materials.clear();
  lastParts = [];
  clearHarborHouseShell();
}

function buildTemplate(gltf: GLTF, keep: readonly string[]): HarborTemplate {
  // loader cache results are immutable: read a clone
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shellBuckets = new Map<HouseShellPart, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const shellNames = new Set<string>(HOUSE_SHELL_PARTS);
  for (const name of keep) {
    const part = root.getObjectByName(name);
    if (!part) continue;
    let into = buckets;
    if (shellNames.has(name)) {
      into = new Map();
      shellBuckets.set(name as HouseShellPart, into);
    }
    part.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const frame = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      addToBucket(
        into,
        materials.convert(mesh.material as THREE.Material),
        vertexColourMeshGeometry(mesh, frame),
      );
    });
  }
  const shell = new Map<HouseShellPart, HarborPart[]>();
  for (const [name, b] of shellBuckets) shell.set(name, mergeVertexColourBuckets(b));
  // the flagstones keep their own frame (the path places each one)
  const stones: HarborPart[] = [];
  for (const name of WYRMWATCH_PATH_STONE_PARTS) {
    const node = root.getObjectByName(name);
    const stoneBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    node?.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const frame = new THREE.Matrix4().multiplyMatrices(
        new THREE.Matrix4().copy(node.matrixWorld).invert(),
        mesh.matrixWorld,
      );
      addToBucket(
        stoneBuckets,
        materials.convert(mesh.material as THREE.Material),
        vertexColourMeshGeometry(mesh, frame),
      );
    });
    const merged = mergeVertexColourBuckets(stoneBuckets);
    if (merged.length === 1) stones.push(merged[0]);
  }
  return { parts: mergeVertexColourBuckets(buckets), shell, stones };
}

function templateFor(): HarborTemplate {
  const key = `${GFX.effectsTier}|${GFX.standardMaterials ? 's' : 'l'}`;
  let template = templates.get(key);
  if (!template) {
    if (!loaded) throw new Error(`wyrmwatch harbor model was not preloaded: ${HARBOR_URL}`);
    template = buildTemplate(loaded, wyrmwatchHarborParts(GFX.effectsTier));
    templates.set(key, template);
  }
  lastParts = [...template.parts, ...[...template.shell.values()].flat(), ...template.stones];
  return template;
}

const up = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();
const tilt = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const place = new THREE.Matrix4();
const scaleV = new THREE.Vector3();
const posV = new THREE.Vector3();

/** The path to Wyrmwatch: every flagstone merged into one mesh per material, its
 *  geometry re-centred on the path so its bounds stay path-sized. */
export function buildWyrmwatchHarborPath(template: HarborTemplate, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wyrmwatchHarborPath';
  if (template.stones.length === 0) return group;
  const stones = wyrmwatchPathStones(
    WYRMWATCH_HARBOR_PATH,
    WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
    (x, z) => terrainHeight(x, z, seed),
  );
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const s of stones) {
    const stone = template.stones[s.variant % template.stones.length];
    normal.set(s.nx, s.ny, s.nz);
    tilt.setFromUnitVectors(up, normal);
    spin.setFromAxisAngle(up, s.yaw);
    tilt.multiply(spin);
    place.compose(posV.set(s.x, s.y, s.z), tilt, scaleV.set(s.scale, 1, s.scale));
    const geo = stone.geometry.clone();
    geo.applyMatrix4(place);
    addToBucket(buckets, stone.material, geo);
  }
  const centre = new THREE.Vector3();
  for (const part of mergeVertexColourBuckets(buckets)) {
    part.geometry.computeBoundingBox();
    part.geometry.boundingBox?.getCenter(centre);
    part.geometry.translate(-centre.x, -centre.y, -centre.z);
    part.geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.position.copy(centre);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** The harbor, built once into the props root (built-in world only). */
export function buildWyrmwatchHarbor(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wyrmwatchHarbor';
  if (!loaded) {
    console.warn(`wyrmwatch harbor skipped: ${HARBOR_URL} was not preloaded`);
    clearHarborHouseShell();
    return group;
  }
  const template = templateFor();
  const model = new THREE.Group();
  model.name = 'wyrmwatchHarborModel';
  for (const part of template.parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
  }
  // the house's walls and roof, each its own fading part (wyrmwatch_harbor_house.ts), whose
  // cloned materials join the prewarm list in place of the shared ones
  model.add(buildHarborHouseShell(template.shell));
  setHarborHouseAnchor(HARBOR_HOUSE.x, HARBOR_HOUSE.z);
  lastParts = [...template.parts, ...harborHouseShellParts(), ...template.stones];
  model.position.set(WYRMWATCH_HARBOR_ORIGIN.x, WATER_LEVEL, WYRMWATCH_HARBOR_ORIGIN.z);
  model.userData.assetUrl = HARBOR_URL;
  group.add(model);
  group.add(buildWyrmwatchHarborPath(template, seed));
  return group;
}

/** The house's firelight (the hearth and two lanterns), world-positioned (props.ts adds
 *  them to the props root and the fire-light budget, like a campfire's). Empty until the
 *  harbor model is loaded. */
export function wyrmwatchHarborHouseLights(): THREE.PointLight[] {
  return loaded ? buildHarborHouseLights(WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER) : [];
}

/** The harbor's distinct (geometry, material) programs at the live tier, for the props
 *  material prewarm (props.ts). Empty until buildProps has built the harbor. */
export function wyrmwatchHarborPrewarmParts(): readonly HarborPart[] {
  return lastParts;
}

export const wyrmwatchHarborInternalsForTest = {
  assetUrl: HARBOR_URL,
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest(gltf: GLTF | null): void {
    loaded = gltf;
    resetWyrmwatchHarborCaches();
  },
};
