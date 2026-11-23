// Per-material texture overrides on a placed model (sim/material_finishes.ts):
// every mesh material whose slot key has a finish is swapped for a clone that
// replaces the surface albedo with the finish texture (tiled in world space,
// triplanar, so it never stretches over the model's own UVs) times its color
// and the placement tint. The wall-finish twin (render/wall_finishes.ts)
// paints only a wall's front and back faces; this paints the whole material.
//
// Like the wall finishes, the clones are staged off-scene and prepared through
// the placed-asset host before a live mesh adopts them, keep the source's
// shader hooks beneath the finish layer, and only the clones and the held
// textures are owned (geometry and loader materials stay shared).

import * as THREE from 'three';
import { type MaterialFinishes, sanitizeMaterialFinishes } from '../sim/material_finishes';
import type { WallFinish } from '../sim/wall_finishes';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { acquireFinishTexture, type WallFinishView } from './wall_finishes';

const FINISHABLE = new Set([
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
  'MeshLambertMaterial',
  'MeshPhongMaterial',
]);

/** The slot key the editor stores a finish under: the material's own name,
 *  or `<mesh>#<index>` when the GLB left it unnamed. */
export function materialSlotKey(meshName: string, materialName: string, index: number): string {
  return materialName.trim() !== '' ? materialName : `${meshName || 'mesh'}#${index}`;
}

export interface MaterialSlot {
  key: string;
  /** The material's name for the panel (the key itself when unnamed). */
  label: string;
}

/** The overridable material slots of a model, in traversal order, once each. */
export function materialSlots(root: THREE.Object3D): MaterialSlot[] {
  const out: MaterialSlot[] = [];
  const seen = new Set<string>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('normal')) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((material, index) => {
      if (!FINISHABLE.has(material.type)) return;
      const key = materialSlotKey(mesh.name, material.name, index);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, label: material.name.trim() !== '' ? material.name : key });
    });
  });
  return out;
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vMatFinishPosition;
varying vec3 vMatFinishWorldNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vMatFinishPosition;
varying vec3 vMatFinishWorldNormal;
uniform float uMatFinishTextured;
uniform float uMatFinishTile;
uniform vec3 uMatFinishColor;
uniform vec3 uMatFinishTint;
uniform sampler2D uMatFinishMap;
vec3 wocMatFinishSample(sampler2D tex, float tile) {
  vec3 weights = pow(abs(normalize(vMatFinishWorldNormal)), vec3(6.0));
  weights /= max(weights.x + weights.y + weights.z, 0.00001);
  return texture2D(tex, vMatFinishPosition.zy / tile).rgb * weights.x
    + texture2D(tex, vMatFinishPosition.xz / tile).rgb * weights.y
    + texture2D(tex, vMatFinishPosition.xy / tile).rgb * weights.z;
}
`;

const FRAGMENT_FINISH = /* glsl */ `
vec3 matFinishColor = uMatFinishColor;
if (uMatFinishTextured > 0.5) matFinishColor *= wocMatFinishSample(uMatFinishMap, uMatFinishTile);
diffuseColor.rgb = matFinishColor * uMatFinishTint;
`;

function finishMaterial(
  source: THREE.Material,
  finish: WallFinish,
  texture: THREE.Texture | null,
  tint: number | undefined,
): THREE.Material {
  const material = cloneMaterialWithHooks(source);
  const previous = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey();
  const uniforms = {
    uMatFinishTextured: { value: texture ? 1 : 0 },
    uMatFinishTile: { value: finish.tileSize ?? 4 },
    uMatFinishColor: { value: new THREE.Color(finish.color ?? 0xffffff) },
    uMatFinishTint: { value: new THREE.Color(tint ?? 0xffffff) },
    uMatFinishMap: { value: texture },
  };
  // Enumerated by the texture-preparation lane before onBeforeCompile runs.
  Object.assign(material, { uniforms });
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vMatFinishPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vMatFinishWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
      `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_FINISH}`);
  };
  material.customProgramCacheKey = () => `${previousKey}:material-finish-v1`;
  material.needsUpdate = true;
  return material;
}

/**
 * Apply a placement's per-material finishes to its live model. `after` lets
 * the host chain this behind another pending material swap (the wall
 * finishes), so this layer clones whatever material the mesh ends up with.
 */
export function applyMaterialFinishes(
  root: THREE.Object3D,
  value: MaterialFinishes,
  prepare?: ((root: THREE.Object3D) => Promise<void>) | null,
  tint?: number,
  after: Promise<unknown> = Promise.resolve(),
): WallFinishView {
  const finishes = sanitizeMaterialFinishes(value);
  const refs = [...new Set(Object.values(finishes ?? {}).map((f) => f.texture ?? ''))];
  const holds = new Map(refs.map((ref) => [ref, acquireFinishTexture(ref || undefined)]));
  let disposed = false;
  let preparing = false;
  const owned: THREE.Material[] = [];
  const replacements: {
    mesh: THREE.Mesh;
    before: THREE.Material | THREE.Material[];
    after: THREE.Material | THREE.Material[];
  }[] = [];
  const release = (): void => {
    for (const material of owned.splice(0)) material.dispose();
    for (const hold of holds.values()) hold.release();
  };
  const ready = after
    .catch(() => undefined)
    .then(() =>
      Promise.all(
        [...holds.entries()].map(async ([ref, hold]) => {
          const texture = await hold.texture.catch(() => null);
          return [ref, texture] as const;
        }),
      ),
    )
    .then(async (loaded) => {
      if (disposed || !finishes) return;
      const textures = new Map(loaded);
      const staged = new THREE.Group();
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry.getAttribute('normal')) return;
        const before = mesh.material;
        const sources = Array.isArray(before) ? before : [before];
        let touched = false;
        const materials = sources.map((source, index) => {
          if (!FINISHABLE.has(source.type)) return source;
          const finish = finishes[materialSlotKey(mesh.name, source.name, index)];
          if (!finish) return source;
          const texture = textures.get(finish.texture ?? '') ?? null;
          // An image-only finish whose art is missing leaves the material as authored.
          if (!texture && finish.color === undefined) return source;
          touched = true;
          const material = finishMaterial(source, finish, texture, tint);
          owned.push(material);
          return material;
        });
        if (!touched) return;
        const next = Array.isArray(before) ? materials : materials[0];
        replacements.push({ mesh, before, after: next });
        const twin = mesh.clone(false);
        twin.material = next;
        twin.matrix.copy(mesh.matrixWorld);
        twin.matrixWorld.copy(mesh.matrixWorld);
        twin.matrixAutoUpdate = false;
        staged.add(twin);
      });
      preparing = true;
      try {
        await prepare?.(staged);
        if (!disposed) for (const entry of replacements) entry.mesh.material = entry.after;
      } finally {
        preparing = false;
        if (disposed) release();
      }
    })
    .catch(() => {
      release();
    });
  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of replacements) {
        if (entry.mesh.material === entry.after) entry.mesh.material = entry.before;
      }
      if (!preparing) release();
    },
  };
}
