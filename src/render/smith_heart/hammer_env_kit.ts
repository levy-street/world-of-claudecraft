// The Hammer vein's painted kit (public/models/props/smith_heart_hammer_env_kit.glb,
// from docs/design/raid/kit/build_smith_heart_hammer_env_kit.py): pieces baked once
// per node and per painting, instanced over the pure plan
// (hammer_env_plan_core.ts). Every painting is one texture on one shared program:
// the paint carries the light, so the triangles stay few.
//
// A kit that has not landed when the interior builds costs the raid its paint,
// never the player the raid: the old kit and the old rock draw in its place until
// the interior is next built, and nothing of it links in a live frame. Everything here sits under
// the interior group the renderer attaches through its compile gate, so its
// programs link and its textures upload before the reveal. No lights.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import { GFX, sharedUniforms } from '../gfx';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { hammerEnvFlameMesh } from './hammer_env_flames';
import { HAMMER_ENV_BRAZIER_TOP, planHammerEnvBraziers } from './hammer_env_plan_core';
import { heartKitPlacementMatrix } from './heart_kit';
import type { HeartKitPlacement } from './heart_kit_core';
import { HEART_ROCK_CUT_FAR, HEART_ROCK_CUT_NEAR } from './heart_rock_plan_core';

export const SMITH_HEART_HAMMER_ENV_KIT_URL = '/models/props/smith_heart_hammer_env_kit.glb';

/** How long the interior waits for the kit before drawing the old look (long: it
 *  is fetched at the raid's door, not at boot). */
const KIT_WAIT_MS = 20000;
/** Rock pieces are big and many: wide culling cells, fewer draws. */
const ENV_CELL = 200;

interface EnvBaked {
  /** Painting name to its merged geometry. */
  parts: Map<string, THREE.BufferGeometry>;
}

const baked = new Map<string, EnvBaked>();
const paintings = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;
let settled = false;

/** The painting a Blender material draws (its name past the routing prefix). */
export function hammerEnvPaintingOf(materialName: string): string {
  if (/^KitGlow/.test(materialName)) return 'glow';
  return materialName.replace(/^tripo_material_env_/, '').replace(/\.\d+$/, '');
}

function mergeParts(list: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  let indices = 0;
  for (const g of list) {
    count += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let o = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) index[io++] = src[k] + o;
    } else {
      for (let k = 0; k < n; k++) index[io++] = o + k;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

function bakeNode(node: THREE.Object3D): EnvBaked {
  node.updateWorldMatrix(true, true);
  const groups = new Map<string, THREE.BufferGeometry[]>();
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = Array.isArray(child.material) ? child.material[0] : child.material;
    const painting = hammerEnvPaintingOf(mat?.name ?? '');
    const map = (mat as THREE.MeshStandardMaterial).map;
    if (map && !paintings.has(painting)) paintings.set(painting, map);
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attr = child.geometry.getAttribute(name);
      if (!attr) continue;
      const values = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < attr.itemSize; j++)
          values[i * attr.itemSize + j] = attr.getComponent(i, j);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
    }
    if (child.geometry.index) geometry.setIndex(child.geometry.index.clone());
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const list = groups.get(painting) ?? [];
    list.push(geometry);
    groups.set(painting, list);
  });
  const parts = new Map<string, THREE.BufferGeometry>();
  for (const [painting, list] of groups) {
    parts.set(painting, markSharedGeometry(mergeParts(list)));
    for (const g of list) g.dispose();
  }
  return { parts };
}

function startLoad(): Promise<void> {
  loading ??= loadGltf(SMITH_HEART_HAMMER_ENV_KIT_URL)
    .then((gltf) => {
      gltf.scene.traverse((node) => {
        if (
          /^(Env|Tex)_/.test(node.name) &&
          !/^(Env|Tex)_/.test(node.parent?.name ?? '') &&
          !baked.has(node.name)
        )
          baked.set(node.name, bakeNode(node));
      });
      releaseGltf(SMITH_HEART_HAMMER_ENV_KIT_URL);
    })
    .catch(() => undefined)
    .then(() => {
      settled = true;
    });
  return loading;
}

// Fetched when the raid's interior is built, never at boot: its paintings are the
// biggest of the raid's kits and nobody outside the raid draws them.

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap. */
export function ensureHammerEnvKit(): Promise<void> {
  if (settled || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the painted kit landed with its pieces? */
export function hammerEnvKitReady(): boolean {
  return settled && baked.size > 0;
}

// ---- materials ------------------------------------------------------------------

/** The rock paintings: cut away round the camera (it can stand in the mountain),
 *  a floor under their shade so a turned face keeps its painted colour. */
const ROCK_PAINTINGS: ReadonlySet<string> = new Set([
  'cliff_tall',
  'cliff_wide',
  'outcrop',
  'arcade',
]);

/** How much of a painting's own colour no shadow takes away (the paintings carry
 *  their own light: a turned face stays the art's cool violet, never black). */
const ENV_SHADE_FLOOR = ['0.26', '0.27', '0.32'] as const;

/** How far a painting's value is brought down to sit under the vein's strong sun. */
const ENV_ALBEDO: readonly [number, number, number] = [0.8, 0.79, 0.8];

/** The cliff painting's strokes laid faintly over a rock atlas: a Tripo atlas spread
 *  over a sixty yard stack goes soft up close. Two scales turned off the axes and
 *  off each other, so the painting's own pattern never lines up into a repeat.
 *  `mean` is the painting's mean linear value, so the overlay only adds strokes. */
const ROCK_STROKES = { tileA: 17, tileB: 41, strength: 0.2, mean: 0.16 } as const;
const STROKED: ReadonlySet<string> = new Set(['cliff_tall', 'cliff_wide', 'outcrop']);

const ROCK_KEY = `smith-heart-env-rock|${HEART_ROCK_CUT_NEAR}|${HEART_ROCK_CUT_FAR}|${ENV_SHADE_FLOOR.join(',')}`;
const STONE_KEY = `smith-heart-env-stone|${ENV_SHADE_FLOOR.join(',')}`;

function applyEnvShadeFloor(mat: THREE.Material, cutaway: boolean, strokes: boolean): void {
  mat.onBeforeCompile = (shader) => {
    if (cutaway) {
      if (strokes) shader.uniforms.uEnvStrokes = { value: paintings.get('cliff') ?? null };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEnvCutWorld;\nvarying vec3 vEnvLocal;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 envCut = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              envCut = instanceMatrix * envCut;
            #endif
            vEnvLocal = envCut.xyz;
            vEnvCutWorld = ( modelMatrix * envCut ).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEnvCutWorld;\nvarying vec3 vEnvLocal;',
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            float envCut = ( distance( vEnvCutWorld, cameraPosition ) - ${HEART_ROCK_CUT_NEAR.toFixed(1)} )
              / ${(HEART_ROCK_CUT_FAR - HEART_ROCK_CUT_NEAR).toFixed(1)};
            float envDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
            if ( envCut < envDither ) discard;
          }`,
        );
      if (strokes) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uEnvStrokes;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            {
              // Slot space: at the slot's world coordinates a derivative normal
              // quantises and turns the triplanar weights to speckle.
              vec3 envC = cross( dFdx( vEnvLocal ), dFdy( vEnvLocal ) );
              vec3 envN = dot( envC, envC ) > 1e-12 ? normalize( envC ) : vec3( 0.0, 1.0, 0.0 );
              vec3 envB = pow( abs( envN ), vec3( 4.0 ) );
              envB /= envB.x + envB.y + envB.z;
              vec3 envA = vEnvLocal / ${ROCK_STROKES.tileA.toFixed(1)};
              vec3 envZ = vEnvLocal.yzx / ${ROCK_STROKES.tileB.toFixed(1)};
              const mat2 envTurnA = mat2( 0.8, 0.6, -0.6, 0.8 );
              const mat2 envTurnB = mat2( 0.38, -0.92, 0.92, 0.38 );
              vec3 envS = ( texture2D( uEnvStrokes, envTurnA * envA.zy ).rgb * envB.x
                + texture2D( uEnvStrokes, envTurnA * envA.xz ).rgb * envB.y
                + texture2D( uEnvStrokes, envTurnA * envA.xy ).rgb * envB.z )
                * ( texture2D( uEnvStrokes, envTurnB * envZ.xy ).rgb * envB.x
                + texture2D( uEnvStrokes, envTurnB * envZ.zx ).rgb * envB.y
                + texture2D( uEnvStrokes, envTurnB * envZ.yz ).rgb * envB.z );
              float envL = dot( envS, vec3( 0.3333 ) ) / ${(ROCK_STROKES.mean * ROCK_STROKES.mean).toFixed(4)};
              diffuseColor.rgb *= mix( 1.0, envL, ${ROCK_STROKES.strength.toFixed(2)} );
            }`,
          );
      }
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * vec3( ${ENV_SHADE_FLOOR.join(', ')} );`,
    );
  };
  const key = `${cutaway ? ROCK_KEY : STONE_KEY}${strokes ? '|strokes' : ''}`;
  mat.customProgramCacheKey = () => key;
}

/** The banners stir in the quarry's air (a shallow sway growing down the cloth). */
function applyBannerSway(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float down = clamp( -transformed.y / 8.0, 0.0, 1.0 );
          float seed = 0.0;
          #ifdef USE_INSTANCING
            seed = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
          #endif
          transformed.z += down * down * ( 0.32 * sin( uTime * 1.3 + seed + transformed.x * 0.6 )
            + 0.14 * sin( uTime * 2.9 + seed * 1.7 - transformed.y * 0.5 ) );
        }`,
      );
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|banner-sway`;
}

const materials = new Map<string, THREE.Material>();

/** The shared material of one painting. */
export function hammerEnvMaterial(painting: string): THREE.Material {
  const have = materials.get(painting);
  if (have) return have;
  let m: THREE.Material;
  if (painting === 'glow') {
    m = new THREE.MeshBasicMaterial({
      color: 0xff8a32,
      name: 'SmithHeartEnvCoals',
      toneMapped: false,
    });
  } else {
    const map = paintings.get(painting) ?? null;
    const banner = painting === 'banner';
    const opts = {
      map,
      name: `SmithHeartEnv:${painting}`,
      ...(banner ? { alphaTest: 0.5, side: THREE.DoubleSide } : {}),
    };
    m = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.95, metalness: 0 })
      : new THREE.MeshLambertMaterial(opts);
    // The vein's sun was set for dim vertex paint: full-value paintings clip.
    (m as THREE.MeshStandardMaterial).color.setRGB(...ENV_ALBEDO);
    applyEnvShadeFloor(m, ROCK_PAINTINGS.has(painting), STROKED.has(painting));
    if (banner) applyBannerSway(m);
  }
  markSharedMaterial(m);
  materials.set(painting, m);
  return m;
}

// ---- the painted floors and the sky ---------------------------------------------

/** A floor family's tile in the field's UV (repeat per its family's tile) and the
 *  gain over the field's dim vertex paint: the paintings carry their own value. */
const FLOOR_LOOK = {
  paving: { node: 'Tex_Paving', painting: 'paving', repeat: 0.55, gain: [1.56, 1.62, 1.78] },
  quarry: { node: 'Tex_Arena', painting: 'arena', repeat: 0.5, gain: [1.58, 1.64, 1.8] },
} as const;

/** A painted floor's material (the field terrain's `topMaterial` seam). */
export function hammerEnvFloorMaterial(family: keyof typeof FLOOR_LOOK): THREE.Material {
  const look = FLOOR_LOOK[family];
  const key = `floor:${family}`;
  const have = materials.get(key);
  if (have) return have;
  const map = paintings.get(look.painting) ?? null;
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(look.repeat, look.repeat);
    map.needsUpdate = false;
    map.updateMatrix();
  }
  const opts = { map, vertexColors: true, name: `SmithHeartEnvFloor:${family}` };
  // Relief drawn from the painting's own value: the flags stand up out of their joints
  // under the low sun. Data, never colour; read at the painting's own tile.
  const relief = paintings.get(`${look.painting}_n`) ?? null;
  if (relief) {
    relief.colorSpace = THREE.NoColorSpace;
    relief.repeat.set(look.repeat, look.repeat);
    relief.updateMatrix();
  }
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: 0.92,
        metalness: 0,
        ...(relief ? { normalMap: relief, normalScale: new THREE.Vector2(0.8, 0.8) } : {}),
      })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(look.gain[0], look.gain[1], look.gain[2]);
  markSharedMaterial(m);
  materials.set(key, m);
  return m;
}

/** A painting by name (the mountain's and the field cliffs' paint reads two). */
export function hammerEnvPainting(name: string): THREE.Texture | null {
  return paintings.get(name) ?? null;
}

/** The painted dusk the sky dome wraps in the Hammer vein. */
export function hammerEnvSkyTexture(): THREE.Texture | null {
  return paintings.get('sky') ?? null;
}

// ---- the instancer --------------------------------------------------------------

const tmp = new THREE.Matrix4();

/** Instance a plan over the kit: one InstancedMesh per piece, cell, shadow class
 *  and painting. */
export function instanceHammerEnv(
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const buckets = new Map<string, HeartKitPlacement[]>();
  for (const p of list) {
    if (lowGfx && p.cosmetic) continue;
    if (!baked.has(p.piece)) continue;
    const key = `${p.piece}|${Math.floor(p.x / ENV_CELL)}|${Math.floor(p.z / ENV_CELL)}|${p.noShadow ? 1 : 0}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const piece = baked.get(bucket[0].piece);
    if (!piece) continue;
    const casts = !lowGfx && !bucket[0].noShadow;
    for (const [painting, g] of piece.parts) {
      const mesh = new THREE.InstancedMesh(g, hammerEnvMaterial(painting), bucket.length);
      mesh.name = `${bucket[0].piece}:${painting}`;
      for (const [i, p] of bucket.entries()) mesh.setMatrixAt(i, heartKitPlacementMatrix(p, tmp));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = casts && painting !== 'glow' && painting !== 'banner';
      mesh.receiveShadow = painting !== 'glow';
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}

/** The fire bowls' flames: on every tier the coals, on the rest the flame too. */
export function buildHammerEnvFlames(lowGfx: boolean): THREE.Object3D | null {
  if (lowGfx) return null;
  const spots = planHammerEnvBraziers().filter((p) => p.piece === 'Env_Brazier');
  return hammerEnvFlameMesh(
    spots.map((p) => ({ x: p.x, y: p.y + HAMMER_ENV_BRAZIER_TOP, z: p.z })),
  );
}
