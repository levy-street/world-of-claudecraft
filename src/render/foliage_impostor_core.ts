// Pure decisions for the far-foliage sprite impostors: atlas layout, the
// sprite-era swap laws, and the GLSL fragments both shader sides must share
// byte for byte. No Three, no DOM, unit-tested in Node
// (tests/foliage_impostor_core.test.ts, registered in RENDER_PURE_CORES).
//
// THE IMPOSTOR IS NOW A PICTURE OF THE TREE, NOT A PLACEHOLDER. The old far
// stand-ins (a cone for pines, a blob for oaks; see git history of foliage.ts)
// were illegible by design, so a blend law (IMPOSTOR_MIN_FOG_BLEND in
// foliage_lod.ts) had to keep them buried in fog, which in the open realms
// pushed the real-model radius out to ~500u and still left ghostly pyramids
// standing in the haze. A baked sprite of the real model reads as the tree
// itself, so the swap can follow the BUDGET again: real geometry hands off
// as early as the governor allows, sprites carry the picture to the true fog
// wall, and the fog-blend law retires on the sprite arm (the lean arm, which
// has no impostors at all, keeps the old law: foliage_lod.ts).

/** One baked archetype: a model variant that owns one atlas row. */
export interface ImpostorArchetypeSpec {
  /** stable diagnostic id, e.g. 'pine:1' or 'rock:moss:2' */
  id: string;
  /** model-space width the bake camera frames (max horizontal extent) */
  worldWidth: number;
  /** model-space height the bake camera frames (y extent from the base) */
  worldHeight: number;
  /** model-space y where the sprite's bottom edge sits (usually 0, the base) */
  worldBaseY: number;
  /** yaw view count baked around the model */
  views: number;
  /** square cell edge in pixels */
  cellPx: number;
}

export interface ImpostorCellRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ImpostorAtlasPlacement {
  /** per archetype: the row's first-view rect; view v adds v * (u1 - u0). */
  origin: ImpostorCellRect[];
  /** atlas edge actually needed (square, power of two) */
  size: number;
}

/**
 * Shelf-pack one row per archetype (its views side by side). Rows are sorted
 * tallest-first onto shelves; the packer is deterministic in input order for
 * equal heights. Throws when the set cannot fit maxSize, so a grown kit fails
 * the build loudly instead of silently cropping the atlas.
 */
export function packImpostorAtlas(
  specs: readonly ImpostorArchetypeSpec[],
  maxSize: number,
): ImpostorAtlasPlacement {
  const order = specs
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.cellPx - a.s.cellPx || a.i - b.i);
  const rects: ImpostorCellRect[] = new Array(specs.length);
  // grow the square until the shelves fit; sizes stay powers of two so the
  // texture keeps clean mips
  let size = 256;
  while (size <= maxSize) {
    let shelfY = 0;
    let shelfH = 0;
    let x = 0;
    let ok = true;
    for (const { s, i } of order) {
      const w = s.views * s.cellPx;
      if (w > size) {
        ok = false;
        break;
      }
      if (x + w > size) {
        shelfY += shelfH;
        shelfH = 0;
        x = 0;
      }
      if (shelfY + s.cellPx > size) {
        ok = false;
        break;
      }
      shelfH = Math.max(shelfH, s.cellPx);
      rects[i] = {
        u0: x / size,
        v0: shelfY / size,
        u1: (x + s.cellPx) / size,
        v1: (shelfY + s.cellPx) / size,
      };
      x += w;
    }
    if (ok) return { origin: rects, size };
    size *= 2;
  }
  throw new Error(`impostor atlas cannot fit ${specs.length} archetypes inside ${maxSize}px`);
}

// ---------------------------------------------------------------------------
// Swap laws (the sprite arm; the lean arm keeps foliage_lod.treeDetailDistance)
// ---------------------------------------------------------------------------

/**
 * Nearest distance a tree may go 2D in CLEAR air. Inside heavy fog the
 * parallax flatness that motivates this floor is already mush, so the floor
 * yields to the 50 percent blend line in the murk realms (spriteSwapFloor).
 */
export const SPRITE_SWAP_MIN = 150;

/** Fog blend at which a sprite may stand arbitrarily close (murk realms). */
export const SPRITE_MIN_FOG_BLEND = 0.5;

/**
 * The guaranteed sprite band before the fog cull, so short-fog realms still
 * hand their far field to sprites instead of drawing real geometry into the
 * line that drops it. Scales down with a tight cull so it never eats the
 * whole view.
 */
export const IMPOSTOR_MIN_BAND = 48;

/**
 * Per-instance handoff jitter span in world units. Each tree swaps at its own
 * hashed distance inside [swap - fade, swap), so the boundary is never a
 * front that sweeps the forest; an individual swap is a one-frame change
 * between two representations sized and tinted to match. Note the jitter
 * undercuts every documented swap floor by up to this span: the effective
 * clear-air floor is SPRITE_SWAP_MIN minus the fade.
 */
export const IMPOSTOR_SWAP_FADE = 24;

/** The closest swap the blend law allows for this fog pair. */
export function spriteSwapFloor(fogNear: number, fogFar: number): number {
  if (!(fogFar > fogNear)) return SPRITE_SWAP_MIN;
  return Math.min(SPRITE_SWAP_MIN, fogNear + SPRITE_MIN_FOG_BLEND * (fogFar - fogNear));
}

/**
 * Distance where a real tree hands off to its sprite. `fogNear`/`fogFar` are
 * the ATMOSPHERIC fog (the same input contract as treeDetailDistance in
 * foliage_lod.ts: never the residency-clamped live pair). `fogLimit` is the
 * LIVE foliage cull; the final clamp against it is what parks the swap on a
 * residency fog wall (real trees to the wall, no sprites in the camera's lap)
 * while the wall lasts.
 */
export function spriteSwapDistance(
  base: number,
  distanceScale: number,
  fogNear: number,
  fogFar: number,
  fogLimit: number,
): number {
  const budgeted = base * distanceScale;
  const band = Math.min(IMPOSTOR_MIN_BAND, 0.25 * fogLimit);
  const swap = Math.max(Math.min(budgeted, fogLimit - band), spriteSwapFloor(fogNear, fogFar));
  return Math.min(swap, fogLimit);
}

/**
 * The near-fill density class needs no law of its own: spriteSwapDistance
 * never exceeds base * distanceScale, and the near-fill numeric cap
 * (treeFillFar) is authored above the detail base in every tier table, so
 * every near-fill instance hands off to its sprite at the shared tree swap
 * before its bucket cap can matter. Pinned in the core test.
 */

// ---------------------------------------------------------------------------
// Shared GLSL (both shader sides must agree byte for byte)
// ---------------------------------------------------------------------------

/**
 * Per-instance handoff jitter, 0..1 from the instance's world origin. The
 * real-model collapse (foliage_collapse.ts) and the sprite material
 * (foliage_impostor.ts) each evaluate this expression in their own vertex
 * shader. One compiler compiling one expression over identical inputs agrees
 * with itself in practice; the GLSL spec does allow per-program contraction
 * differences, and where a driver diverges the failure degrades to a single
 * tree trading representations up to the fade span early or late, never a
 * systematic seam.
 */
export const IMPOSTOR_JITTER_GLSL =
  'fract(sin(dot(collapseOrigin, vec2(127.1, 311.7))) * 43758.5453)';

/** GL_MAX_TEXTURE_SIZE floor is 4096 everywhere WebGL2 runs; stay inside it. */
export const IMPOSTOR_ATLAS_MAX = 4096;

// ---------------------------------------------------------------------------
// The shipped inventory budget (what the atlas is allowed to hold)
// ---------------------------------------------------------------------------

export type ImpostorCategoryName = 'tree' | 'rock' | 'dress' | 'building';

/** Yaw views per category: enough that the two-view blend never smears. */
export const IMPOSTOR_CATEGORY_VIEWS: Record<ImpostorCategoryName, number> = {
  tree: 12,
  rock: 6,
  dress: 8,
  building: 6,
};

/**
 * World-fixed sway amplitude per category: amplitude parity with the real
 * canopies (TREE_WIND_STRENGTH 0.08, bush windMul 1.2) for the things that
 * sway, HARD ZERO for the rigid kit. A building or boulder billboard
 * riding the bush gust reads broken from any distance. Dead trees share
 * the tree category and zero out per archetype instead (registerArchetype
 * windMul).
 */
export const IMPOSTOR_CATEGORY_WIND: Record<ImpostorCategoryName, number> = {
  tree: 0.08,
  dress: 0.096,
  rock: 0,
  building: 0,
};

/**
 * Cell edge per category, sized for the DISPLAY distance, not the model: a
 * 14u tree at its ~300u swap subtends ~45 screen pixels at 1080p, and a
 * village house past the 700u detail horizon under 20, so these cells stay
 * oversampled at every distance a sprite can be seen while the whole
 * inventory packs into IMPOSTOR_ATLAS_BUDGET. Tree and building share one
 * 80px height class on purpose: same-height rows share shelves in the
 * packer, which is what lets the REAL building inventory (44 rows of
 * houses, bell towers and skyline decor, measured live) fit beside the 15
 * tree rows inside 2048.
 */
export const IMPOSTOR_CELL_PX: Record<ImpostorCategoryName, number> = {
  tree: 80,
  rock: 64,
  dress: 64,
  building: 80,
};

/**
 * Row budget per category. Tree, rock and dress counts are exact (the
 * foliage kit's variant lists are fixed); the building count is a cap with
 * headroom over the MEASURED live inventory (44 unique assets: pools,
 * per-kind entries, the bell tower, and every skyline decor prop 7u+).
 * registerArchetype throws past its category's budget, so a grown kit
 * fails the world build loudly instead of silently outgrowing the atlas
 * the capacity test verified. The fail-soft in buildFoliage turns that
 * throw into a sprite-less far field for the player, so treat ANY
 * budget change as unverified until a live boot shows the four impostor
 * meshes standing.
 */
export const IMPOSTOR_ROW_BUDGET: Record<ImpostorCategoryName, number> = {
  tree: 15,
  rock: 8,
  dress: 2,
  building: 48,
};

/**
 * The atlas edge the WHOLE shipped inventory must fit: 2048 keeps the
 * resident mip chain near 21 MiB where 4096 costs 85 MiB, on every desktop
 * tier that bakes at all (constrained-memory profiles never bake, see
 * farFieldPolicy). Pinned exactly in the core test via
 * shippedImpostorInventory().
 */
export const IMPOSTOR_ATLAS_BUDGET = 2048;

/**
 * The worst-case inventory the budget must hold: every category at its full
 * row budget. World dimensions do not affect packing (only views * cellPx
 * does), so the specs carry nominal sizes.
 */
export function shippedImpostorInventory(): ImpostorArchetypeSpec[] {
  const specs: ImpostorArchetypeSpec[] = [];
  for (const category of ['tree', 'rock', 'dress', 'building'] as const) {
    for (let i = 0; i < IMPOSTOR_ROW_BUDGET[category]; i++) {
      specs.push({
        id: `${category}:${i}`,
        worldWidth: 10,
        worldHeight: 10,
        worldBaseY: 0,
        views: IMPOSTOR_CATEGORY_VIEWS[category],
        cellPx: IMPOSTOR_CELL_PX[category],
      });
    }
  }
  return specs;
}
