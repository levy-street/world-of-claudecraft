// The Breath vein's painted kit (public/models/props/smith_heart_breath_env_kit.glb, from
// docs/design/raid/kit/build_smith_heart_breath_env_kit.py): pieces baked once per node
// and per painting (env_kit_bake.ts), instanced over the pure plan
// (breath_env_plan_core.ts). Every painting is one texture on one shared program: the
// paint carries the light, so the triangles stay few. The storm's painted crystal glows.
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
import { envAreaClip } from './env_area_clip';
import type { HeartKitPlacement } from './heart_kit_core';

export const SMITH_HEART_BREATH_ENV_KIT_URL = '/models/props/smith_heart_breath_env_kit.glb';

/** How long the interior waits for the kit before drawing the old look (long: it is
 *  fetched at the raid's door, not at boot). */
const KIT_WAIT_MS = 20000;
/** Rock pieces are big and many: wide culling cells, fewer draws. */
const ENV_CELL = 200;

/** Every painting casts and takes the sun's shadow (a placement opts out). */
const BREATH_ENV_SHADOW: EnvShadowRule = { casts: () => true, receives: () => true };

const baked = new Map<string, EnvBaked>();
const paintings = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;
let settled = false;
let landed = false;

/** The painting a Blender material draws (its name past the routing prefix). */
export function breathEnvPaintingOf(materialName: string): string {
  return materialName.replace(/^tripo_material_env_/, '').replace(/\.\d+$/, '');
}

function keepPainting(painting: string, map: THREE.Texture): void {
  if (!paintings.has(painting)) paintings.set(painting, map);
}

function startLoad(): Promise<void> {
  if (!loading) {
    loading = loadGltf(SMITH_HEART_BREATH_ENV_KIT_URL)
      .then((gltf) => {
        gltf.scene.traverse((node) => {
          if (isEnvPieceNode(node) && !baked.has(node.name))
            baked.set(node.name, bakeEnvNode(node, breathEnvPaintingOf, keepPainting));
        });
        landed = true;
        releaseGltf(SMITH_HEART_BREATH_ENV_KIT_URL);
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
export function ensureBreathEnvKit(): Promise<void> {
  if (settled || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the painted kit landed with its pieces? */
export function breathEnvKitReady(): boolean {
  return settled && landed;
}

/** Has this painted piece baked? A swap whose piece did not keeps the old kit's. */
export function breathEnvHas(piece: string): boolean {
  return baked.has(piece);
}

/** Hidden carriers of every painting the baked pieces draw, one instanced mesh each (the
 *  pieces' own variant), built with the interior: when the old kits land after the
 *  interior was built, their late builds (heart_kit.ts upgradeWhenHeartKitLands) bring
 *  these paintings into a live frame, and their programs and textures were linked and
 *  uploaded behind the curtain. */
export function breathEnvProgramWarmers(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartBreathEnvWarmers';
  const drawn = new Set<string>();
  for (const piece of baked.values())
    for (const painting of piece.parts.keys()) drawn.add(painting);
  for (const mesh of envWarmCarriers(
    drawn,
    (painting: string) => breathEnvMaterial(painting),
    BREATH_ENV_SHADOW,
    'smithHeartBreathEnvWarmer',
  ))
    group.add(mesh);
  // The rock paintings' Heart variant (env_area_clip.ts), its own program.
  for (const mesh of envWarmCarriers(
    new Set([...drawn].filter((p) => BREATH_ENV_ROCK_PAINTINGS.has(p))),
    (painting: string) => breathEnvMaterial(painting, 'heart'),
    BREATH_ENV_SHADOW,
    'smithHeartBreathEnvWarmer:heart',
  ))
    group.add(mesh);
  return group;
}

// ---- materials ------------------------------------------------------------------

/** The rock paintings (the Tripo stacks): cut away round the camera, which can stand in
 *  the mountain, and stroked with the cliff painting up close. */
export const BREATH_ENV_ROCK_PAINTINGS: ReadonlySet<string> = new Set([
  'storm_spire',
  'storm_bluff',
  'storm_arch',
]);

/** The paintings whose crystal glows (every Tripo atlas: each was painted with it). */
export const BREATH_ENV_CRYSTAL_PAINTINGS: ReadonlySet<string> = new Set([
  ...BREATH_ENV_ROCK_PAINTINGS,
  'storm_stone',
]);

/** How much of a painting's own colour no shadow takes away: the storm's shade is a
 *  cool blue-grey, never black. */
export const BREATH_ENV_SHADE_FLOOR = ['0.2', '0.21', '0.25'] as const;

/** How far a painting's value is brought down to sit under the summit's cold key: the
 *  storm's paintings came back about twice the Hammer's value (linear means 0.21 to 0.35
 *  against 0.13 to 0.16), so they sit a value over the quarry, never washed white, and a
 *  breath of their blue is taken back. */
export const BREATH_ENV_ALBEDO: readonly [number, number, number] = [0.58, 0.57, 0.5];

/** The crystal's glow over its own colour (blooms on the composer tiers). */
export const BREATH_ENV_CRYSTAL_GLOW = 1.8;

/** The cliff painting's strokes over a stack's atlas (the Hammer's two turned scales);
 *  `mean` is the painting's own mean linear value, so the overlay only adds strokes. */
const ROCK_STROKES: Omit<EnvStrokes, 'map'> = { tileA: 17, tileB: 41, strength: 0.2, mean: 0.29 };

const materials = new Map<string, THREE.Material>();

/** The shared material of one painting; `area` 'heart': a rock painting's variant dressing
 *  the Heart's crown, drawn only from the Heart (env_area_clip.ts). */
export function breathEnvMaterial(painting: string, area?: 'heart'): THREE.Material {
  const heart = area === 'heart' && BREATH_ENV_ROCK_PAINTINGS.has(painting);
  const key = heart ? `${painting}|heart` : painting;
  const have = materials.get(key);
  if (have) return have;
  const opts = { map: paintings.get(painting) ?? null, name: `SmithHeartBreathEnv:${painting}` };
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.92, metalness: 0 })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(...BREATH_ENV_ALBEDO);
  const rock = BREATH_ENV_ROCK_PAINTINGS.has(painting);
  applyEnvLook(m, {
    cutaway: rock,
    strokes: rock ? { map: () => paintings.get('cliff') ?? null, ...ROCK_STROKES } : null,
    shade: BREATH_ENV_SHADE_FLOOR,
    crystal: BREATH_ENV_CRYSTAL_PAINTINGS.has(painting) ? BREATH_ENV_CRYSTAL_GLOW : 0,
    // Seen from the Heat, the rock round its hall opens; the Heart's dressing is drawn
    // only from the Heart (env_area_clip.ts).
    ...(rock ? { clip: envAreaClip(heart ? 'heart' : 'heatBand') } : {}),
  });
  markSharedMaterial(m);
  materials.set(key, m);
  return m;
}

// ---- the painted floor and the sky ------------------------------------------------

/** The scoured floors' painting: its tile in the field's UV (the `scoured` family lays
 *  one unit every 14 yd, so a repeat of 0.8 tiles the slabs every 17.5 yd) and the gain
 *  over the field's pale vertex paint (its broad drifts break the tile's repeat). */
export const BREATH_ENV_FLOOR = { repeat: 0.8, gain: [1.12, 1.1, 1.0], relief: 0.7 } as const;

/** The Breath's painted floor (the field terrain's `topMaterial` seam, `scoured`). */
export function breathEnvFloorMaterial(): THREE.Material {
  const have = materials.get('floor');
  if (have) return have;
  const F = BREATH_ENV_FLOOR;
  const map = paintings.get('slab') ?? null;
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(F.repeat, F.repeat);
    map.updateMatrix();
  }
  const opts = { map, vertexColors: true, name: 'SmithHeartBreathEnvFloor' };
  // Relief drawn from the painting's own value: the slabs stand up out of their cracks
  // under the low key. Data, never colour; read at the painting's own tile.
  const relief = paintings.get('slab_n') ?? null;
  if (relief) {
    relief.colorSpace = THREE.NoColorSpace;
    relief.wrapS = THREE.RepeatWrapping;
    relief.wrapT = THREE.RepeatWrapping;
    relief.repeat.set(F.repeat, F.repeat);
    relief.updateMatrix();
  }
  const m = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: 0.82,
        metalness: 0,
        ...(relief
          ? { normalMap: relief, normalScale: new THREE.Vector2(F.relief, F.relief) }
          : {}),
      })
    : new THREE.MeshLambertMaterial(opts);
  m.color.setRGB(F.gain[0], F.gain[1], F.gain[2]);
  markSharedMaterial(m);
  materials.set('floor', m);
  return m;
}

/** A painting by name (the rock's and the field cliffs' paint read the cliff). */
export function breathEnvPainting(name: string): THREE.Texture | null {
  return paintings.get(name) ?? null;
}

/** The painted storm the sky dome wraps over the Breath. */
export function breathEnvSkyTexture(): THREE.Texture | null {
  return paintings.get('sky') ?? null;
}

// ---- the instancer --------------------------------------------------------------

/** Instance a plan over the kit: one InstancedMesh per piece, cell, shadow class and
 *  painting. */
export function instanceBreathEnv(
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
  area?: 'heart',
): THREE.Group {
  return instanceEnvPieces(
    baked,
    (painting: string) => breathEnvMaterial(painting, area),
    list,
    lowGfx,
    name,
    ENV_CELL,
    BREATH_ENV_SHADOW,
  );
}
