// Finish materials are staged off-scene and prepared through the placed-asset
// host before a live mesh adopts them. Geometry and loader materials stay shared.
import * as THREE from 'three';
import { sanitizeWallFinishes, type WallFinishes } from '../sim/wall_finishes';
import { groundImageFor } from './assets/ground_textures';
import { acquireTexture } from './assets/loader';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { terrainTexturePath } from './terrain_texture_sets';

interface TextureHold {
  texture: Promise<THREE.Texture | null>;
  release(): void;
}

interface ImportedTexture {
  refs: number;
  texture: THREE.Texture | null;
  pending: Promise<THREE.Texture | null>;
}

const importedTextures = new Map<string, ImportedTexture>();

function acquireFinishTexture(ref: string | undefined): TextureHold {
  if (!ref) return { texture: Promise.resolve(null), release() {} };
  if (!ref.startsWith('custom:')) {
    const path = terrainTexturePath(ref, 'color');
    return path
      ? acquireTexture(`/${path}`, { srgb: true, repeat: true })
      : { texture: Promise.resolve(null), release() {} };
  }
  const sha = ref.slice('custom:'.length);
  let entry = importedTextures.get(sha);
  if (!entry) {
    const created: ImportedTexture = {
      refs: 0,
      texture: null,
      pending: Promise.resolve(null),
    };
    created.pending = groundImageFor(sha).then((image) => {
      // The image cache owns its bitmap. Only this wrapper texture is ours.
      if (!image || created.refs === 0) return null;
      const texture = new THREE.Texture(image);
      texture.name = `wall-finish:${sha}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      created.texture = texture;
      return texture;
    });
    importedTextures.set(sha, created);
    entry = created;
  }
  const held = entry;
  held.refs++;
  let released = false;
  return {
    texture: held.pending,
    release() {
      if (released) return;
      released = true;
      if (--held.refs > 0) return;
      held.texture?.dispose();
      if (importedTextures.get(sha) === held) importedTextures.delete(sha);
    },
  };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vWallFinishPosition;
varying vec3 vWallFinishWorldNormal;
varying vec3 vWallFinishLocalNormal;
uniform mat3 uWallFinishLocalNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vWallFinishPosition;
varying vec3 vWallFinishWorldNormal;
varying vec3 vWallFinishLocalNormal;
uniform vec2 uWallFinishEnabled;
uniform vec2 uWallFinishTextured;
uniform vec2 uWallFinishTile;
uniform vec3 uWallFinishFrontColor;
uniform vec3 uWallFinishBackColor;
uniform vec3 uWallFinishTint;
uniform vec3 uWallFinishAxis;
uniform sampler2D uWallFinishFrontMap;
uniform sampler2D uWallFinishBackMap;
vec3 wocWallFinishSample(sampler2D tex, float tile) {
  vec3 weights = pow(abs(normalize(vWallFinishWorldNormal)), vec3(6.0));
  weights /= max(weights.x + weights.y + weights.z, 0.00001);
  return texture2D(tex, vWallFinishPosition.zy / tile).rgb * weights.x
    + texture2D(tex, vWallFinishPosition.xz / tile).rgb * weights.y
    + texture2D(tex, vWallFinishPosition.xy / tile).rgb * weights.z;
}
`;

const FRAGMENT_FINISH = /* glsl */ `
vec3 wallFinishNormal = normalize(vWallFinishLocalNormal);
float wallFinishFacing = dot(wallFinishNormal, uWallFinishAxis);
float wallFinishEnd = dot(wallFinishNormal, uWallFinishAxis.zyx);
// The narrow ends, tops and bottoms keep their original authored material.
if (abs(wallFinishFacing) > max(abs(wallFinishEnd), abs(wallFinishNormal.y))) {
  if (wallFinishFacing > 0.0 && uWallFinishEnabled.x > 0.5) {
    vec3 finishColor = uWallFinishFrontColor;
    if (uWallFinishTextured.x > 0.5) finishColor *= wocWallFinishSample(uWallFinishFrontMap, uWallFinishTile.x);
    diffuseColor.rgb = finishColor * uWallFinishTint;
  } else if (wallFinishFacing < 0.0 && uWallFinishEnabled.y > 0.5) {
    vec3 finishColor = uWallFinishBackColor;
    if (uWallFinishTextured.y > 0.5) finishColor *= wocWallFinishSample(uWallFinishBackMap, uWallFinishTile.y);
    diffuseColor.rgb = finishColor * uWallFinishTint;
  }
}
`;

function finishMaterial(
  source: THREE.Material,
  finishes: WallFinishes,
  front: THREE.Texture | null,
  back: THREE.Texture | null,
  normalMatrix: THREE.Matrix3,
  tint: number | undefined,
  axis: 'x' | 'z',
): THREE.Material {
  const material = cloneMaterialWithHooks(source);
  // Preserve producer-owned hooks too (the procedural model's triplanar
  // shader is not one of the global clone-helper layers). Hooks use shared
  // immutable settings/uniforms, never capture or mutate a compiled shader.
  const previous = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey();
  const uniforms = {
    uWallFinishLocalNormal: { value: normalMatrix },
    uWallFinishAxis: { value: new THREE.Vector3(axis === 'x' ? 1 : 0, 0, axis === 'z' ? 1 : 0) },
    // Unavailable image-only finishes leave that face's authored material
    // intact. An explicit color remains a usable fallback, including black.
    uWallFinishEnabled: {
      value: new THREE.Vector2(
        finishes.front && (front || finishes.front.color !== undefined) ? 1 : 0,
        finishes.back && (back || finishes.back.color !== undefined) ? 1 : 0,
      ),
    },
    uWallFinishTextured: { value: new THREE.Vector2(front ? 1 : 0, back ? 1 : 0) },
    uWallFinishTile: {
      value: new THREE.Vector2(finishes.front?.tileSize ?? 4, finishes.back?.tileSize ?? 4),
    },
    uWallFinishFrontColor: { value: new THREE.Color(finishes.front?.color ?? 0xffffff) },
    uWallFinishBackColor: { value: new THREE.Color(finishes.back?.color ?? 0xffffff) },
    uWallFinishTint: { value: new THREE.Color(tint ?? 0xffffff) },
    uWallFinishFrontMap: { value: front },
    uWallFinishBackMap: { value: back },
  };
  // The common texture-preparation lane enumerates this uniform surface even
  // before onBeforeCompile has run. No upload escapes into the reveal frame.
  Object.assign(material, { uniforms });
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWallFinishPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWallFinishWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
        vWallFinishLocalNormal = uWallFinishLocalNormal * objectNormal;
      `,
      );
    // Following color_fragment also composes with procedural materials that
    // replace map_fragment, without painting the original albedo over ours.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_FINISH}`);
  };
  material.customProgramCacheKey = () => `${previousKey}:wall-finishes-v2`;
  material.needsUpdate = true;
  return material;
}

export interface WallFinishView {
  ready: Promise<void>;
  /** Restore original materials and release only the finish's owned resources. */
  dispose(): void;
}

/** Independent finishes for placement-local +axis/-axis, tiled in world space. */
export function applyWallFinishes(
  root: THREE.Object3D,
  value: WallFinishes,
  prepare?: ((root: THREE.Object3D) => Promise<void>) | null,
  tint?: number,
  axis: 'x' | 'z' = 'z',
): WallFinishView {
  const finishes = sanitizeWallFinishes(value);
  const frontHold = acquireFinishTexture(finishes?.front?.texture);
  const backHold = acquireFinishTexture(finishes?.back?.texture);
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
    frontHold.release();
    backHold.release();
  };
  const ready = Promise.all([
    frontHold.texture.catch(() => null),
    backHold.texture.catch(() => null),
  ])
    .then(async ([front, back]) => {
      if (disposed || !finishes) return;
      root.updateWorldMatrix(true, true);
      const rootInverse = root.matrixWorld.clone().invert();
      const staged = new THREE.Group();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry.getAttribute('normal')) return;
        const before = mesh.material;
        const sources = Array.isArray(before) ? before : [before];
        const relative = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
        const normals = new THREE.Matrix3().getNormalMatrix(relative);
        const materials = sources.map((source) => {
          if (
            ![
              'MeshStandardMaterial',
              'MeshPhysicalMaterial',
              'MeshLambertMaterial',
              'MeshPhongMaterial',
            ].includes(source.type)
          )
            return source;
          const material = finishMaterial(source, finishes, front, back, normals, tint, axis);
          owned.push(material);
          return material;
        });
        const after = Array.isArray(before) ? materials : materials[0];
        replacements.push({ mesh, before, after });
        const twin = mesh.clone(false);
        twin.material = after;
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
      // Missing art or failed preparation leaves the authored wall in place.
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
      // A pending gate still reads its materials and textures. Defer freeing
      // until it settles; a cancelled late load never installs its result.
      if (!preparing) release();
    },
  };
}
