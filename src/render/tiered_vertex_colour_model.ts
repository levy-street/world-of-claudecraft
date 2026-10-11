// One Blender-built, vertex-coloured waterfront model placed once in the props root, its named
// parts kept or shed by the static graphics tier: the painter the Wickharbor ferry wharf
// (wickharbor_wharf.ts) and the rest of Wickharbor's wooden harbor (wickharbor_harbor.ts)
// share. Extracted at the second such model beside the Wyrmwatch harbor (the rule of three:
// wyrmwatch_harbor.ts keeps its own, it also lays path stones and a house shell).
//
// Which parts a tier keeps is the caller's pure core (a `parts(tier)` function, Three- and
// DOM-free); the tier is the STATIC effects tier (GFX.effectsTier), never the frame-rate
// governor, and a graphics-profile change rebuilds the props (each caller registers its
// resetter in assets/graphics_profile.ts).
//
// GPU work: the model is built into the props root at world build (props.ts), so the
// world-entry compile links it with the rest of the props, and its distinct (geometry,
// material) programs join the props material prewarm (prewarmParts), so a model first seen
// after the curtain links nothing in a live frame. The materials are the surface family's
// vertex-coloured standard/lambert (vertex_colour_glb_parts.ts, shared with the route markers
// and the Wyrmwatch harbor: the same programs). Every tiered model converts through ONE
// converter, so models built from the same materials (the wharf and the harbor share all
// five) draw with the same material objects and the props static merge batches them
// together. Nothing here runs per frame.
//
// Residency: the parsed GLB and the per-tier merged templates stay resident for the session
// (the templates also back the prewarm twins), so a graphics-profile rebuild converts
// without a refetch.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { GFX, type GfxTier } from './gfx';
import {
  addToBucket,
  mergeVertexColourBuckets,
  type VertexColourPart,
  vertexColourMaterialConverter,
  vertexColourMeshGeometry,
} from './vertex_colour_glb_parts';

export interface TieredVertexColourModelSpec {
  /** The shipped GLB (public/). */
  url: string;
  /** The group's name; the placed model is `${name}Model`. */
  name: string;
  /** How the model is named in a warning ("wickharbor wharf"). */
  label: string;
  /** The model's named parts a tier draws (the caller's pure core). */
  parts(tier: GfxTier): readonly string[];
  /** Where the model's origin stands, on the waterline. */
  origin: { readonly x: number; readonly z: number };
}

export interface TieredVertexColourModel {
  /** Fetch and parse the GLB once (the deferred preload and the graphics-profile preparer). */
  prepare(): Promise<void>;
  /** Drop the prepared templates (a graphics-profile rebuild converts materials anew; the
   *  parsed source survives). */
  reset(): void;
  /** The model, built once into the props root (built-in world only). */
  build(): THREE.Group;
  /** The distinct (geometry, material) programs at the live tier, for the props material
   *  prewarm (props.ts). Empty until the model has been built. */
  prewarmParts(): readonly VertexColourPart[];
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest(gltf: GLTF | null): void;
}

/** The one converter every tiered model draws through (cleared by any model's reset: the
 *  resetters run together on a graphics-profile rebuild, assets/graphics_profile.ts). */
const materials = vertexColourMaterialConverter();

export function tieredVertexColourModel(
  spec: TieredVertexColourModelSpec,
): TieredVertexColourModel {
  let loaded: GLTF | null = null;
  let loadTask: Promise<void> | null = null;
  /** Kept parts merged into one geometry per material, in the model's frame, by
   *  `effectsTier|standard`: a preset change converts anew. */
  const templates = new Map<string, VertexColourPart[]>();
  let lastParts: VertexColourPart[] = [];

  function reset(): void {
    templates.clear();
    materials.clear();
    lastParts = [];
  }

  function buildTemplate(gltf: GLTF, keep: readonly string[]): VertexColourPart[] {
    // loader cache results are immutable: read a clone
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const name of keep) {
      const part = root.getObjectByName(name);
      if (!part) continue;
      part.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const frame = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        addToBucket(
          buckets,
          materials.convert(mesh.material as THREE.Material),
          vertexColourMeshGeometry(mesh, frame),
        );
      });
    }
    return mergeVertexColourBuckets(buckets);
  }

  function templateFor(gltf: GLTF): VertexColourPart[] {
    const key = `${GFX.effectsTier}|${GFX.standardMaterials ? 's' : 'l'}`;
    let template = templates.get(key);
    if (!template) {
      template = buildTemplate(gltf, spec.parts(GFX.effectsTier));
      templates.set(key, template);
    }
    lastParts = template;
    return template;
  }

  return {
    prepare(): Promise<void> {
      if (loaded) return Promise.resolve();
      if (loadTask) return loadTask;
      loadTask = loadGltf(spec.url)
        .then((gltf) => {
          loaded = gltf;
          loadTask = null;
        })
        .catch((err) => {
          loadTask = null;
          throw err;
        });
      return loadTask;
    },
    reset,
    build(): THREE.Group {
      const group = new THREE.Group();
      group.name = spec.name;
      if (!loaded) {
        console.warn(`${spec.label} skipped: ${spec.url} was not preloaded`);
        return group;
      }
      const model = new THREE.Group();
      model.name = `${spec.name}Model`;
      for (const part of templateFor(loaded)) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        model.add(mesh);
      }
      model.position.set(spec.origin.x, WATER_LEVEL, spec.origin.z);
      model.userData.assetUrl = spec.url;
      group.add(model);
      return group;
    },
    prewarmParts(): readonly VertexColourPart[] {
      return lastParts;
    },
    setLoadedGltfForTest(gltf: GLTF | null): void {
      loaded = gltf;
      reset();
    },
  };
}
