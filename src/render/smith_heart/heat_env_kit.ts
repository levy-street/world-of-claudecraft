// The Heat vein's painted kit (public/models/props/smith_heart_heat_env_kit.glb, from
// docs/design/raid/kit/build_smith_heart_heat_env_kit.py): pieces baked once per node and
// per painting (env_kit_bake.ts), instanced over the pure plan (heat_env_plan_core.ts).
// Every painting is one texture on one shared program: the paint carries the light, so the
// triangles stay few. The first flame's crystal and the molten glow gold.
//
// A kit that has not landed when the interior builds costs the raid its paint, never the
// player the raid: the old kit and the old rock draw in its place until the interior is
// next built, and nothing of it links in a live frame. Everything here sits under the
// interior group the renderer attaches through its compile gate, so its programs link and
// its textures upload before the reveal. No lights.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
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
import { envAreaClip } from './env_area_clip';
import { QUENCH_ENV_ANTI_TILE_GLSL, QUENCH_ENV_ANTI_TILE_MAP } from './quench_env_kit';

export const SMITH_HEART_HEAT_ENV_KIT_URL = '/models/props/smith_heart_heat_env_kit.glb';

/** How long the interior waits for the kit before drawing the old look (long: it is
 *  fetched at the raid's door, not at boot). */
const KIT_WAIT_MS = 20000;
/** Rock pieces are big and many: wide culling cells, fewer draws. */
const ENV_CELL = 200;

/** Every painting casts and takes the sun's shadow (a placement opts out). */
const HEAT_ENV_SHADOW: EnvShadowRule = {
  casts: () => true,
  receives: () => true,
};

const baked = new Map<string, EnvBaked>();
const paintings = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;
let settled = false;
let landed = false;

/** The painting a Blender material draws (its name past the routing prefix). */
export function heatEnvPaintingOf(materialName: string): string {
  return materialName.replace(/^tripo_material_env_/, '').replace(/\.\d+$/, '');
}

function keepPainting(painting: string, map: THREE.Texture): void {
  if (!paintings.has(painting)) paintings.set(painting, map);
}

function startLoad(): Promise<void> {
  if (!loading) {
    loading = loadGltf(SMITH_HEART_HEAT_ENV_KIT_URL)
      .then((gltf) => {
        gltf.scene.traverse((node) => {
          if (isEnvPieceNode(node) && !baked.has(node.name))
            baked.set(node.name, bakeEnvNode(node, heatEnvPaintingOf, keepPainting));
        });
        landed = true;
        releaseGltf(SMITH_HEART_HEAT_ENV_KIT_URL);
      })
      .catch(() => undefined)
      .then(() => {
        settled = true;
      });
  }
  return loading;
}

// Fetched when the raid's interior is built, never at boot: nobody outside the raid draws
// its paintings.

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap. */
export function ensureHeatEnvKit(): Promise<void> {
  if (settled || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the painted kit landed with its pieces? */
export function heatEnvKitReady(): boolean {
  return settled && landed;
}

/** Has this painted piece baked? A swap whose piece did not keeps the old kit's. */
export function heatEnvHas(piece: string): boolean {
  return baked.has(piece);
}

/** Hidden carriers of every painting the baked pieces draw, one instanced mesh each (the
 *  pieces' own variant), built with the interior: when the old kits land after the
 *  interior was built, their late builds (heart_kit.ts upgradeWhenHeartKitLands) bring
 *  these paintings into a live frame, and their programs and textures were linked and
 *  uploaded behind the curtain. */
export function heatEnvProgramWarmers(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHeatEnvWarmers';
  const drawn = new Set<string>();
  for (const piece of baked.values())
    for (const painting of piece.parts.keys()) drawn.add(painting);
  for (const mesh of envWarmCarriers(
    drawn,
    (painting) => heatEnvMaterial(painting),
    HEAT_ENV_SHADOW,
    'smithHeartHeatEnvWarmer',
  ))
    group.add(mesh);
  // Each rock painting's band and ring variants (`HeatEnvVariant`), their own programs.
  const rock = new Set([...drawn].filter((p) => HEAT_ENV_ROCK_PAINTINGS.has(p)));
  for (const variant of ['band', 'ring', 'heart'] as const)
    for (const mesh of envWarmCarriers(
      rock,
      (painting) => heatEnvMaterial(painting, variant),
      HEAT_ENV_SHADOW,
      `smithHeartHeatEnvWarmer:${variant}`,
    ))
      group.add(mesh);
  return group;
}

// ---- materials ------------------------------------------------------------------

/** The rock paintings (the Tripo basalt plain and seamed, the Hearth's mouth and the
 *  molten fall): cut away round the camera, which can stand in the mountain, and stroked
 *  with the cliff painting up close. */
export const HEAT_ENV_ROCK_PAINTINGS: ReadonlySet<string> = new Set([
  'basalt_tall',
  'basalt_wide',
  'seam_tall',
  'seam_wide',
  'great_fall',
  'cliff_wall',
  'molten_shore',
  'hearth_mouth',
  'molten_fall',
]);

/** The paintings whose fire glows (every Tripo atlas: the first flame's crystal and the
 *  molten seams painted into them). */
export const HEAT_ENV_FIRE_PAINTINGS: ReadonlySet<string> = new Set([
  ...HEAT_ENV_ROCK_PAINTINGS,
  'altar_stone',
  'fire_crystal',
  'ember_boulder',
  'column_bundle',
]);

/** How much of a painting's own colour no shadow takes away: the dusk's shade is a cool
 *  slate, never black. */
export const HEAT_ENV_SHADE_FLOOR = ['0.24', '0.21', '0.22'] as const;

/** How far a painting's value is brought down to sit under the smoky dusk: the hall darker
 *  than the fiery guardian, so it stands out against its own hall. */
export const HEAT_ENV_ALBEDO: readonly [number, number, number] = [0.86, 0.84, 0.84];

/** The fire's glow over its own colour (blooms on the composer tiers): the Hearth's mouth,
 *  the altar's crack and the crystal clusters at this, the backdrop's seams, the basalt
 *  and the far fall at `HEAT_ENV_BACKDROP_GLOW` (the molten an accent, never a wash). */
export const HEAT_ENV_FIRE_GLOW = 1.4;
export const HEAT_ENV_BACKDROP_GLOW = 0.6;

/** The seamed basalt's and the falls' molten (graded a deep orange, darker than the
 *  guardian's fire): lit enough to read as glowing seams from across the hall (the dressed
 *  concept of 2026-11-10), never a wash, since only the thin seams carry it. */
export const HEAT_ENV_SEAM_GLOW = 1.7;
export const HEAT_ENV_SEAM_PAINTINGS: ReadonlySet<string> = new Set([
  'seam_tall',
  'seam_wide',
  'great_fall',
  'cliff_wall',
  'molten_shore',
  'molten_fall',
]);

/** The paintings that keep the full fire light: the hall's own lit pieces (the mouth's
 *  crystal throat, the altar's crack, the crystal clusters). */
export const HEAT_ENV_LIT_PAINTINGS: ReadonlySet<string> = new Set([
  'hearth_mouth',
  'altar_stone',
  'fire_crystal',
]);

/** One painting's fire light (0: no fire layer). */
export function heatEnvGlow(painting: string): number {
  if (!HEAT_ENV_FIRE_PAINTINGS.has(painting)) return 0;
  if (HEAT_ENV_SEAM_PAINTINGS.has(painting)) return HEAT_ENV_SEAM_GLOW;
  return HEAT_ENV_LIT_PAINTINGS.has(painting) ? HEAT_ENV_FIRE_GLOW : HEAT_ENV_BACKDROP_GLOW;
}

/** The cliff painting's strokes over a basalt atlas (the Hammer's two turned scales);
 *  `mean` is the painting's own mean linear value, so the overlay only adds strokes. */
const ROCK_STROKES: Omit<EnvStrokes, 'map'> = {
  tileA: 15,
  tileB: 37,
  strength: 0.16,
  mean: 0.043,
};

const materials = new Map<string, THREE.Material>();

/** The shared material of one painting (one per graphics tier: the low tier draws Lambert,
 *  and a renderer rebuilt on another tier never reuses the other's material), and per
 *  variant for a rock painting (`HeatEnvVariant`). */
/** A rock painting's variant by where it stands: `band`, the Heat's own mountain bands,
 *  opened round the hall seen from the Heat; `ring`, its tiers and concept pieces, drawn
 *  only from the Heat; `heart`, its rock dressing the Heart's crown behind the Heat's
 *  landmark, drawn only from the Heart (env_area_clip.ts). */
export type HeatEnvVariant = 'band' | 'ring' | 'heart';

const HEAT_AREA_CLIP = { band: 'heatBand', ring: 'heatRing', heart: 'heart' } as const;

export function heatEnvMaterial(painting: string, variant?: HeatEnvVariant): THREE.Material {
  const rockVariant = variant && HEAT_ENV_ROCK_PAINTINGS.has(painting) ? variant : undefined;
  const key = `${painting}|${GFX.standardMaterials ? 'std' : 'lambert'}${rockVariant ? `|${rockVariant}` : ''}`;
  const have = materials.get(key);
  if (have) return have;
  const opts = { map: paintings.get(painting) ?? null, name: `SmithHeartHeatEnv:${painting}` };
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.86, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(...HEAT_ENV_ALBEDO);
  const rock = HEAT_ENV_ROCK_PAINTINGS.has(painting);
  applyEnvLook(m, {
    cutaway: rock,
    strokes: rock ? { map: () => paintings.get('cliff') ?? null, ...ROCK_STROKES } : null,
    shade: HEAT_ENV_SHADE_FLOOR,
    crystal: heatEnvGlow(painting),
    crystalHue: 'gold',
    ...(rockVariant ? { clip: envAreaClip(HEAT_AREA_CLIP[rockVariant]) } : {}),
  });
  markSharedMaterial(m);
  materials.set(key, m);
  return m;
}

// ---- the painted floor and the sky --------------------------------------------------

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

/** The Heat's floors' painting: its tile in the field's UV (the `hearth` family lays one
 *  unit every 10 yd, so a repeat of 0.8 lays the painting every 12.5 yd, each column head
 *  about two strides across) and its gain (the dressed concept's floor: dark and calm under
 *  the molten, so the fire round the hall and the guardian carry the light). The field's own vertex paint is left off: it
 *  carries the old floor's joints and its warm cast, which would print a second lattice
 *  over the painted one; the anti-tile read breaks the repeat instead. */
export const HEAT_ENV_FLOOR = { repeat: 0.8, gain: [1.05, 1.0, 1.3], relief: 0.8 } as const;

/** The Heat's painted basalt floors (the field terrain's `topMaterial` seam, `hearth`). */
export function heatEnvFloorMaterial(): THREE.Material {
  const key = `floor|${GFX.standardMaterials ? 'std' : 'lambert'}`;
  const have = materials.get(key);
  if (have) return have;
  const F = HEAT_ENV_FLOOR;
  const map = tiled('floor', F.repeat);
  const relief = tiled('floor_n', F.repeat, true);
  const opts = { map, vertexColors: false, name: 'SmithHeartHeatEnvFloor' };
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: 0.88,
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
  m.customProgramCacheKey = () => 'smith-heart-heat-floor|antiTile';
  markSharedMaterial(m);
  materials.set(key, m);
  return m;
}

/** A painting by name (the rock's and the field cliffs' paint read the cliff). */
export function heatEnvPainting(name: string): THREE.Texture | null {
  return paintings.get(name) ?? null;
}

/** The painted smoky dusk the sky dome wraps over the Heat. */
export function heatEnvSkyTexture(): THREE.Texture | null {
  return paintings.get('sky') ?? null;
}

// ---- the instancer --------------------------------------------------------------

/** Instance a plan over the kit: one InstancedMesh per piece, cell, shadow class and
 *  painting. */
export function instanceHeatEnv(
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
  variant?: HeatEnvVariant,
): THREE.Group {
  const material = variant
    ? (painting: string) => heatEnvMaterial(painting, variant)
    : (painting: string) => heatEnvMaterial(painting);
  return instanceEnvPieces(baked, material, list, lowGfx, name, ENV_CELL, HEAT_ENV_SHADOW);
}
