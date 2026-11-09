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
import { markSharedMaterial } from '../shared_resource';
import {
  bakeEnvNode,
  type EnvBaked,
  type EnvShadowRule,
  envWarmCarriers,
  instanceEnvPieces,
  isEnvPieceNode,
} from './env_kit_bake';
import { applyEnvLook } from './env_kit_look';
import { hammerEnvFlameMesh } from './hammer_env_flames';
import { HAMMER_ENV_BRAZIER_TOP, planHammerEnvBraziers } from './hammer_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';

export const SMITH_HEART_HAMMER_ENV_KIT_URL = '/models/props/smith_heart_hammer_env_kit.glb';
/** The Quarry's three colossi (Tripo from the vein's turnaround sheets), their own small kit:
 *  baked into the same pieces and paintings, so a statue draws like the rest of the vein. */
export const SMITH_HEART_HAMMER_COLOSSI_URL = '/models/props/smith_heart_hammer_colossi.glb';

/** How long the interior waits for the kit before drawing the old look (long: it
 *  is fetched at the raid's door, not at boot). */
const KIT_WAIT_MS = 20000;
/** Rock pieces are big and many: wide culling cells, fewer draws. */
const ENV_CELL = 200;

/** The coals' glow takes no shadow; it and the banners' cloth cast none. */
const HAMMER_ENV_SHADOW: EnvShadowRule = {
  casts: (painting) => painting !== 'glow' && painting !== 'banner',
  receives: (painting) => painting !== 'glow',
};

const baked = new Map<string, EnvBaked>();
const paintings = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;
let settled = false;

/** The painting a Blender material draws (its name past the routing prefix). */
export function hammerEnvPaintingOf(materialName: string): string {
  if (/^KitGlow/.test(materialName)) return 'glow';
  return materialName.replace(/^tripo_material_env_/, '').replace(/\.\d+$/, '');
}

/** Keep the first map seen for each painting. */
function keepPainting(painting: string, map: THREE.Texture): void {
  if (!paintings.has(painting)) paintings.set(painting, map);
}

/** The kits that landed (the colossi's can fail alone and cost only the colossi). */
const landed = new Set<string>();

function bakeKit(url: string): Promise<void> {
  return loadGltf(url)
    .then((gltf) => {
      // A file landing after the kit settled is dropped: the vein was built without it,
      // and baking it now would cost a live frame and change what a later build draws.
      if (!settled) {
        gltf.scene.traverse((node) => {
          if (isEnvPieceNode(node) && !baked.has(node.name))
            baked.set(node.name, bakeEnvNode(node, hammerEnvPaintingOf, keepPainting));
        });
        landed.add(url);
      }
      releaseGltf(url);
    })
    .catch(() => undefined);
}

function startLoad(): Promise<void> {
  if (!loading) {
    // The kit settles with its own file. The colossi's, a seventh of its size and fetched
    // beside it, ride along if they landed first and are dropped if they trail it: a slow
    // statue file costs only the statues, never the vein's paint or its arrival.
    void bakeKit(SMITH_HEART_HAMMER_COLOSSI_URL);
    loading = bakeKit(SMITH_HEART_HAMMER_ENV_KIT_URL).then(() => {
      settled = true;
    });
  }
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
  return settled && landed.has(SMITH_HEART_HAMMER_ENV_KIT_URL);
}

/** Has this painted piece baked? A swap whose piece did not keeps the old kit's. */
export function hammerEnvHas(piece: string): boolean {
  return baked.has(piece);
}

/** Hidden carriers of every painting the baked pieces draw, one instanced mesh each (the
 *  pieces' own variant), built with the interior beside the old kit's slot warmers: when the
 *  old kit or the rock kit lands after the interior was built, its late build
 *  (heart_kit.ts upgradeWhenHeartKitLands) brings these paintings into a live frame, and
 *  their programs and textures were linked and uploaded behind the curtain. The fire bowls'
 *  flames too, on the tiers that draw them. */
export function hammerEnvProgramWarmers(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHammerEnvWarmers';
  const drawn = new Set<string>();
  for (const piece of baked.values())
    for (const painting of piece.parts.keys()) drawn.add(painting);
  if (drawn.size === 0) return group;
  if (!lowGfx) {
    const flames = hammerEnvFlameMesh([{ x: 0, y: 0, z: 0 }]);
    flames.visible = false;
    flames.frustumCulled = false;
    flames.name = 'smithHeartHammerEnvWarmer:flames';
    group.add(flames);
  }
  for (const mesh of envWarmCarriers(
    drawn,
    hammerEnvMaterial,
    HAMMER_ENV_SHADOW,
    'smithHeartHammerEnvWarmer',
  ))
    group.add(mesh);
  return group;
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
    applyEnvLook(m, {
      cutaway: ROCK_PAINTINGS.has(painting),
      strokes: STROKED.has(painting)
        ? { map: () => paintings.get('cliff') ?? null, ...ROCK_STROKES }
        : null,
      shade: ENV_SHADE_FLOOR,
    });
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

/** Instance a plan over the kit: one InstancedMesh per piece, cell, shadow class
 *  and painting. */
export function instanceHammerEnv(
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
): THREE.Group {
  return instanceEnvPieces(
    baked,
    hammerEnvMaterial,
    list,
    lowGfx,
    name,
    ENV_CELL,
    HAMMER_ENV_SHADOW,
  );
}

/** The fire bowls' flames: on every tier the coals, on the rest the flame too. */
export function buildHammerEnvFlames(lowGfx: boolean): THREE.Object3D | null {
  if (lowGfx) return null;
  const spots = planHammerEnvBraziers().filter((p) => p.piece === 'Env_Brazier');
  return hammerEnvFlameMesh(
    spots.map((p) => ({ x: p.x, y: p.y + HAMMER_ENV_BRAZIER_TOP, z: p.z })),
  );
}
