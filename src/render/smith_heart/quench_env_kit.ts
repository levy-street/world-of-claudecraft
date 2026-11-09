// The Quench vein's painted kit (public/models/props/smith_heart_quench_env_kit.glb, from
// docs/design/raid/kit/build_smith_heart_quench_env_kit.py): pieces baked once per node
// and per painting (env_kit_bake.ts), instanced over the pure plan
// (quench_env_plan_core.ts). Every painting is one texture on one shared program: the
// paint carries the light, so the triangles stay few. The glacier's painted crystal
// glows cyan.
//
// A kit that has not landed when the interior builds costs the raid its paint, never the
// player the raid: the old kit and the old rock draw in its place until the interior is
// next built, and nothing of it links in a live frame. Everything here sits under the
// interior group the renderer attaches through its compile gate, so its programs link and
// its textures upload before the reveal. No lights.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import type { DetailPair } from '../authored_field/field_textures';
import { GFX } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import {
  bakeEnvNode,
  type EnvBaked,
  type EnvShadowRule,
  envWarmCarriers,
  instanceEnvPieces,
  isEnvPieceNode,
} from './env_kit_bake';
import { applyEnvLook, type EnvStrokes } from './env_kit_look';
import type { HeartKitPlacement } from './heart_kit_core';
import { LAKE_ICE_PAINTED } from './quench_lake_ice';

export const SMITH_HEART_QUENCH_ENV_KIT_URL = '/models/props/smith_heart_quench_env_kit.glb';

/** How long the interior waits for the kit before drawing the old look (long: it is
 *  fetched at the raid's door, not at boot). */
const KIT_WAIT_MS = 20000;
/** Rock pieces are big and many: wide culling cells, fewer draws. */
const ENV_CELL = 200;

/** Every painting casts and takes the sun's shadow (a placement opts out), but the fight's
 *  fuller strips, which are light. */
const QUENCH_ENV_SHADOW: EnvShadowRule = {
  casts: (p) => p !== 'glow',
  receives: (p) => p !== 'glow',
};

const baked = new Map<string, EnvBaked>();
const paintings = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;
let settled = false;
let landed = false;
/** Who waits for the kit to land without asking for it (the fight's blades). */
const landedListeners = new Set<() => void>();

/** The painting a Blender material draws (its name past the routing prefix). */
export function quenchEnvPaintingOf(materialName: string): string {
  return materialName.replace(/^tripo_material_env_/, '').replace(/\.\d+$/, '');
}

function keepPainting(painting: string, map: THREE.Texture): void {
  if (!paintings.has(painting)) paintings.set(painting, map);
}

function startLoad(): Promise<void> {
  if (!loading) {
    loading = loadGltf(SMITH_HEART_QUENCH_ENV_KIT_URL)
      .then((gltf) => {
        gltf.scene.traverse((node) => {
          if (isEnvPieceNode(node) && !baked.has(node.name))
            baked.set(node.name, bakeEnvNode(node, quenchEnvPaintingOf, keepPainting));
        });
        landed = true;
        releaseGltf(SMITH_HEART_QUENCH_ENV_KIT_URL);
      })
      .catch(() => undefined)
      .then(() => {
        settled = true;
        if (!landed) return;
        for (const cb of [...landedListeners]) cb();
        landedListeners.clear();
      });
  }
  return loading;
}

// Fetched when the raid's interior is built, never at boot: nobody outside the raid draws
// its paintings.

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap. */
export function ensureQuenchEnvKit(): Promise<void> {
  if (settled || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the painted kit landed with its pieces? */
export function quenchEnvKitReady(): boolean {
  return settled && landed;
}

/** Run `cb` once the kit has landed, never starting its fetch: whatever is built before
 *  the raid's door (the fight's blades are built with the renderer) waits on the load the
 *  interior starts there. Returns the unsubscribe; a kit already landed runs `cb` now. */
export function onQuenchEnvKitLanded(cb: () => void): () => void {
  if (quenchEnvKitReady()) {
    cb();
    return () => undefined;
  }
  landedListeners.add(cb);
  return () => {
    landedListeners.delete(cb);
  };
}

/** Has this painted piece baked? A swap whose piece did not keeps the old kit's. */
export function quenchEnvHas(piece: string): boolean {
  return baked.has(piece);
}

/** A baked piece's merged geometry per painting (the fight's sword and its collar draw
 *  them on their own meshes); null until the kit has landed. Shared: never disposed or
 *  changed by a caller. */
export function quenchEnvPieceParts(
  piece: string,
): ReadonlyMap<string, THREE.BufferGeometry> | null {
  return baked.get(piece)?.parts ?? null;
}

/** Hidden carriers of every painting the baked pieces draw, one instanced mesh each (the
 *  pieces' own variant), built with the interior: when the old kits land after the
 *  interior was built, their late builds (heart_kit.ts upgradeWhenHeartKitLands) bring
 *  these paintings into a live frame, and their programs and textures were linked and
 *  uploaded behind the curtain. */
export function quenchEnvProgramWarmers(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartQuenchEnvWarmers';
  const drawn = new Set<string>();
  for (const piece of baked.values())
    for (const painting of piece.parts.keys()) if (painting !== 'glow') drawn.add(painting);
  for (const mesh of envWarmCarriers(
    drawn,
    quenchEnvMaterial,
    QUENCH_ENV_SHADOW,
    'smithHeartQuenchEnvWarmer',
  ))
    group.add(mesh);
  return group;
}

// ---- materials ------------------------------------------------------------------

/** The rock paintings (the Tripo glacier and its falls): cut away round the camera, which
 *  can stand in the mountain, and stroked with the cliff painting up close. */
export const QUENCH_ENV_ROCK_PAINTINGS: ReadonlySet<string> = new Set([
  'glacier_tall',
  'glacier_wide',
  'ice_spires',
  'frozen_fall',
]);

/** The paintings whose cyan crystal glows (every Tripo atlas painted with it). */
export const QUENCH_ENV_CRYSTAL_PAINTINGS: ReadonlySet<string> = new Set([
  ...QUENCH_ENV_ROCK_PAINTINGS,
  'ice_plates',
  'chevron_stone',
  'ice_sword',
]);

/** How much of a painting's own colour no shadow takes away: the night's shade is a deep
 *  cold blue, never black. */
export const QUENCH_ENV_SHADE_FLOOR = ['0.16', '0.18', '0.24'] as const;

/** How far a painting's value is brought down to sit under the night's cold moon: the
 *  realm darker and more saturated than the pale frost guardian and its adds. */
export const QUENCH_ENV_ALBEDO: readonly [number, number, number] = [0.62, 0.66, 0.72];

/** The crystal's glow over its own colour (blooms on the composer tiers). The full light
 *  is the fight's swords' alone (QUENCH_ENV_SWORD_PAINTINGS); the backdrop takes
 *  QUENCH_ENV_BACKDROP_GLOW. */
export const QUENCH_ENV_CRYSTAL_GLOW = 2;

/** The paintings whose ice shines from within (every Tripo atlas painted with ice, and the
 *  lake painting the walls' icicles and the swords' heaved plates wear), and how far: the
 *  arena concept's falls, blades and plates luminous cyan over the dark slate. */
export const QUENCH_ENV_ICE_PAINTINGS: ReadonlySet<string> = new Set([
  ...QUENCH_ENV_CRYSTAL_PAINTINGS,
  'lake',
]);
export const QUENCH_ENV_ICE_GLOW = 1.3;

/** How far the painted snow on every ledge lifts past its own colour (the arena concept's
 *  white caps over the dark slate): every Tripo atlas, the walls' copings and the collars'
 *  pillows. */
export const QUENCH_ENV_SNOW_LIFT = 0.9;
const SNOWY: ReadonlySet<string> = new Set([...QUENCH_ENV_CRYSTAL_PAINTINGS, 'snow']);

/** The paintings that keep the full crystal, ice and snow light: the Smith's four blades,
 *  the fight's own pieces (a blade tearing free is a tell). */
export const QUENCH_ENV_SWORD_PAINTINGS: ReadonlySet<string> = new Set(['ice_sword']);

/** The backdrop's light (every other painting: the glacier stacks, the falls, the spires,
 *  the plates, the walls' icicles, the snow): its bright highlights pulled well down so the
 *  guardian and its adds, bright painted ice with glow maps of their own, stand out
 *  against the realm (the owner's note of 2026-11-09: the boss must pop off the
 *  background ice). */
export const QUENCH_ENV_BACKDROP_GLOW = { crystal: 0.35, ice: 0.2, snow: 0.12 } as const;

/** The backdrop's ice and snow brought a step further down than the realm's value (the
 *  owner's second note of 2026-11-09: darker still), the swords and the masonry at
 *  QUENCH_ENV_ALBEDO. */
export const QUENCH_ENV_BACKDROP_ALBEDO: readonly [number, number, number] = [0.5, 0.54, 0.6];

/** One painting's value under the night: the backdrop's ice and snow darker than the rest. */
export function quenchEnvAlbedo(painting: string): readonly [number, number, number] {
  const backdrop =
    !QUENCH_ENV_SWORD_PAINTINGS.has(painting) &&
    (QUENCH_ENV_ICE_PAINTINGS.has(painting) || SNOWY.has(painting));
  return backdrop ? QUENCH_ENV_BACKDROP_ALBEDO : QUENCH_ENV_ALBEDO;
}

/** One painting's crystal, ice and snow light (0: no such layer). */
export function quenchEnvGlow(painting: string): { crystal: number; ice: number; snow: number } {
  const sword = QUENCH_ENV_SWORD_PAINTINGS.has(painting);
  const crystal = sword ? QUENCH_ENV_CRYSTAL_GLOW : QUENCH_ENV_BACKDROP_GLOW.crystal;
  const ice = sword ? QUENCH_ENV_ICE_GLOW : QUENCH_ENV_BACKDROP_GLOW.ice;
  const snow = sword ? QUENCH_ENV_SNOW_LIFT : QUENCH_ENV_BACKDROP_GLOW.snow;
  return {
    crystal: QUENCH_ENV_CRYSTAL_PAINTINGS.has(painting) ? crystal : 0,
    ice: QUENCH_ENV_ICE_PAINTINGS.has(painting) ? ice : 0,
    snow: SNOWY.has(painting) ? snow : 0,
  };
}

/** The cliff painting's strokes over a glacier's atlas (the Hammer's two turned scales);
 *  `mean` is the painting's own mean linear value, so the overlay only adds strokes. */
const ROCK_STROKES: Omit<EnvStrokes, 'map'> = { tileA: 17, tileB: 41, strength: 0.18, mean: 0.2 };

const materials = new Map<string, THREE.Material>();

/** The shared material of one painting. */
export function quenchEnvMaterial(painting: string): THREE.Material {
  const have = materials.get(painting);
  if (have) return have;
  const opts = { map: paintings.get(painting) ?? null, name: `SmithHeartQuenchEnv:${painting}` };
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.82, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(...quenchEnvAlbedo(painting));
  const rock = QUENCH_ENV_ROCK_PAINTINGS.has(painting);
  const glow = quenchEnvGlow(painting);
  applyEnvLook(m, {
    cutaway: rock,
    strokes: rock ? { map: () => paintings.get('cliff') ?? null, ...ROCK_STROKES } : null,
    shade: QUENCH_ENV_SHADE_FLOOR,
    crystal: glow.crystal,
    crystalHue: 'cyan',
    ice: glow.ice,
    snow: glow.snow,
  });
  markSharedMaterial(m);
  materials.set(painting, m);
  return m;
}

// ---- the painted floors and the sky -------------------------------------------------

/** A tiling painting's repeat in the field's UV and its relief's (a painting only a floor
 *  wears: the change is on the shared texture). */
function tiled(name: string, repeat: number, data = false): THREE.Texture | null {
  const map = paintings.get(name) ?? null;
  if (!map) return null;
  if (data) map.colorSpace = THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.updateMatrix();
  return map;
}

/** The frost-bound floors' painting: its tile in the field's UV (the `rime` family lays one
 *  unit every 12 yd, so a repeat of 1.2 tiles the flagstones every 10 yd) and the gain over
 *  the field's pale vertex paint (its broad drifts break the tile's repeat; its blue cast,
 *  a quarter bluer than red, taken back out). */
export const QUENCH_ENV_FLOOR = { repeat: 1.2, gain: [1.62, 1.48, 1.32], relief: 0.7 } as const;

/** A second read of a tiling painting, turned and scaled off the first, blended in over
 *  broad patches, so the floors' repeat never lines up into a grid (`qvAntiTile( map, uv )`,
 *  implicit derivatives: it sits in uniform control flow). */
export const QUENCH_ENV_ANTI_TILE_GLSL = `
float qvHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float qvNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( qvHash( i ), qvHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( qvHash( i + vec2( 0.0, 1.0 ) ), qvHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
vec4 qvAntiTile( sampler2D tex, vec2 uv ) {
  vec4 a = texture2D( tex, uv );
  vec4 b = texture2D( tex, mat2( 0.8, 0.6, -0.6, 0.8 ) * uv * 0.71 + vec2( 0.37, 0.61 ) );
  return mix( a, b, smoothstep( 0.35, 0.65, qvNoise( uv * 0.45 ) ) );
}`;

/** The map read through `qvAntiTile` (three's map chunk with the second read). */
export const QUENCH_ENV_ANTI_TILE_MAP = `#ifdef USE_MAP
  vec4 sampledDiffuseColor = qvAntiTile( map, vMapUv );
  diffuseColor *= sampledDiffuseColor;
#endif`;

/** The Quench's painted rime floors (the field terrain's `topMaterial` seam, `rime`). */
export function quenchEnvFloorMaterial(): THREE.Material {
  const have = materials.get('floor');
  if (have) return have;
  const F = QUENCH_ENV_FLOOR;
  const map = tiled('rime', F.repeat);
  const relief = tiled('rime_n', F.repeat, true);
  const opts = { map, vertexColors: true, name: 'SmithHeartQuenchEnvFloor' };
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: 0.84,
        metalness: 0,
        ...(relief
          ? { normalMap: relief, normalScale: new THREE.Vector2(F.relief, F.relief) }
          : {}),
      })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(F.gain[0], F.gain[1], F.gain[2]);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${QUENCH_ENV_ANTI_TILE_GLSL}`)
      .replace('#include <map_fragment>', QUENCH_ENV_ANTI_TILE_MAP);
  };
  m.customProgramCacheKey = () => 'smith-heart-quench-floor|antiTile';
  markSharedMaterial(m);
  materials.set('floor', m);
  return m;
}

/** The painted lake's pair for the Frozen Lake's and the Singing Ice's material
 *  (quench_lake_ice.ts, painted): the painting and its relief; null until the kit lands.
 *  The painting's own tile is the lake's material's (`LAKE_ICE_PAINTED.repeat`, in its
 *  shader): the walls' icicles and the swords' collars wear the same painting, so its
 *  repeat is never changed here. The relief is the floor's alone. */
export function quenchEnvLakePair(): DetailPair | null {
  const map = paintings.get('lake') ?? null;
  if (!map) return null;
  const normalMap = tiled('lake_n', LAKE_ICE_PAINTED.repeat, true);
  return { map, normalMap } as DetailPair;
}

/** A painting by name (the rock's and the field cliffs' paint read the cliff). */
export function quenchEnvPainting(name: string): THREE.Texture | null {
  return paintings.get(name) ?? null;
}

/** The painted aurora night the sky dome wraps over the Quench. */
export function quenchEnvSkyTexture(): THREE.Texture | null {
  return paintings.get('sky') ?? null;
}

// ---- the instancer --------------------------------------------------------------

/** Instance a plan over the kit: one InstancedMesh per piece, cell, shadow class and
 *  painting. */
export function instanceQuenchEnv(
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
): THREE.Group {
  return instanceEnvPieces(
    baked,
    quenchEnvMaterial,
    list,
    lowGfx,
    name,
    ENV_CELL,
    QUENCH_ENV_SHADOW,
  );
}
