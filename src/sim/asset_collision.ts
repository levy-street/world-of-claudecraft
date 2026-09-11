// Per-asset baked collision lookup: the bridge between a placement's model
// path and its baked box set. Catalogue assets resolve into the generated
// table (scripts/assets/bake_collision.mjs); imported models ('local/<sha>' /
// 'user/<sha>' ids) resolve into the map document's own bake map, carried on
// WorldContent so playtests and exports keep their collision.

import {
  ASSET_COLLISION,
  ASSET_RAMPS,
  type BakedCollisionBox,
  type BakedCollisionRamp,
} from './asset_collision.generated';
import {
  ASSET_COLLISION_OVERRIDES,
  type AssetCollisionOverride,
} from './asset_collision_overrides.generated';
import {
  type AuthoredCollisionRamp,
  type CollisionMode,
  collideRadiusFor,
  MAX_COLLIDE_RADIUS,
  MIN_COLLIDE_RADIUS,
} from './map_doc';
import {
  type CollisionPrism,
  MAX_ASSET_PRISMS,
  MAX_MESH_PRISMS,
  meshToPrisms,
} from './mesh_prisms';

export type {
  AssetCollisionOverride,
  AuthoredCollisionRamp,
  BakedCollisionBox,
  BakedCollisionRamp,
};

// Collision Master persists its generated module on disk, but the editor keeps
// the current page alive. This tiny overlay lets that page use the just-saved
// value immediately; a normal refresh starts from the generated table again.
// `null` deliberately shadows a generated entry when a session clears it.
const sessionCollisionOverrides = new Map<string, AssetCollisionOverride | null>();

function activeCollisionOverride(assetId: string): AssetCollisionOverride | null {
  if (sessionCollisionOverrides.has(assetId)) return sessionCollisionOverrides.get(assetId) ?? null;
  return ASSET_COLLISION_OVERRIDES[assetId] ?? null;
}

/** Apply one Collision Master save to the live page without reloading the map. */
export function applySessionCollisionOverride(
  assetId: string,
  override: AssetCollisionOverride | null,
): void {
  sessionCollisionOverrides.set(assetId, override);
  footprintCache.delete(assetId);
  // The prism cache keys per (asset, scale bucket): sweep every bucket.
  for (const key of [...prismCache.keys()]) {
    if (key === assetId || key.startsWith(`${assetId}|`)) prismCache.delete(key);
  }
}

// ---- authored volumes -> sim prisms ---------------------------------------
// The override carries the maker's MESH volumes (the editor's editable truth,
// and what the editor draws as the blue collision outline). Those volumes are
// the collision contract, so the sim slices them itself rather than colliding
// with a rectangle fitted to them: `boxes` stays in the table as the fallback
// for entries authored before the meshes were persisted, and as the shape the
// footprint canvas / import pipeline still read.
const prismCache = new Map<string, readonly CollisionPrism[]>();
const NO_PRISMS: readonly CollisionPrism[] = [];

/** Placement scales quantize to power-of-two buckets for the prism cache:
 *  fidelity only has to track the ORDER of the world scale, and buckets keep
 *  the cache from re-slicing per placement. */
function scaleBucket(worldScale: number): number {
  const s = Math.min(16, Math.max(0.5, worldScale));
  return 2 ** Math.round(Math.log2(s));
}

/**
 * Banded convex prisms for a catalogue asset id, sliced from its Collision
 * Master volumes ([] when the asset has none). Cached per (asset, scale
 * bucket): the slice is pure, but its tolerances are in WORLD yards, so a
 * placement scaled 8x slices finer than the same asset at natural size.
 *
 * The asset budget is DISTRIBUTED across the meshes, never truncated: every
 * authored volume gets bands (dropping one is a walk-through wall), and a
 * many-volume asset simply gets fewer bands per volume.
 */
export function prismsForAssetId(assetId: string, worldScale = 1): readonly CollisionPrism[] {
  const bucket = scaleBucket(worldScale);
  const key = `${assetId}|${bucket}`;
  const hit = prismCache.get(key);
  if (hit) return hit;
  const o = activeCollisionOverride(assetId);
  let out: readonly CollisionPrism[] = NO_PRISMS;
  // Only 'baked' authoring blocks with its volumes: 'basic' is a deliberate
  // circle/square footprint and 'none' is deliberate walk-through.
  if (o && o.mode === 'baked' && o.meshes && o.meshes.length > 0) {
    // Ramp volumes are WALKABLE decks (placement_ramps.ts), never blockers.
    const solid = o.meshes.filter((m) => !m.ramp);
    // Per-mesh cap at SIX bands, every scale: the loft (polyLo/polyHi)
    // carries lean and taper exactly, so extra bands only chase organic
    // noise - the deep stacks that read as "crazy complicated hitboxes for
    // no reason" against the editor's single authored volume. The slice is
    // tolerance-driven below the cap, so a straight box still spends 1.
    const wanted = solid.map((m) => meshToPrisms(m, MAX_MESH_PRISMS, bucket));
    const totalWanted = wanted.reduce((n, p) => n + Math.max(1, p.length), 0);
    const assetBudget = MAX_ASSET_PRISMS;
    const prisms: CollisionPrism[] = [];
    if (totalWanted <= assetBudget) {
      for (const p of wanted) prisms.push(...p);
    } else {
      // Over budget: allocate the asset budget by NEED, never below 1 band
      // per volume (dropping one is a walk-through wall), and re-slice each
      // mesh to its share so the bands it does get are spent worst-first.
      for (let i = 0; i < solid.length; i++) {
        const share = Math.max(
          1,
          Math.floor((assetBudget * Math.max(1, wanted[i].length)) / totalWanted),
        );
        prisms.push(
          ...(wanted[i].length <= share ? wanted[i] : meshToPrisms(solid[i], share, bucket)),
        );
      }
    }
    if (prisms.length > 0) out = prisms;
  }
  prismCache.set(key, out);
  return out;
}

/** Authored collision prisms for a placement's model path ([] = none). */
export function authoredPrismsForPath(
  path: string | undefined,
  worldScale = 1,
): readonly CollisionPrism[] {
  if (!path) return NO_PRISMS;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  return m ? prismsForAssetId(m[1], worldScale) : NO_PRISMS;
}

/** The Collision Master authored override for a catalogue asset id, or null. */
export function collisionOverrideFor(assetId: string): AssetCollisionOverride | null {
  return activeCollisionOverride(assetId);
}

/** The box set a catalogue asset id resolves to: authored Collision Master
 *  boxes beat the voxel bake; null = no data (legacy circle fallback). */
export function boxesForAssetId(assetId: string): readonly BakedCollisionBox[] | null {
  const o = activeCollisionOverride(assetId);
  const authored = o?.boxes;
  if (authored && authored.length > 0) return authored;
  // A ramps-only authoring means WALKABLE by choice: the deck carries the
  // collision (placement_ramps), so the voxel bake must not resurface as
  // blockers. [] = walk-through, mirroring the stairs bake convention.
  if (o?.ramps && o.ramps.length > 0) return [];
  return ASSET_COLLISION[assetId] ?? null;
}

/** Collision Master authored walkable ramp decks for a catalogue asset id. */
export function rampsForAssetId(assetId: string): readonly AuthoredCollisionRamp[] {
  return activeCollisionOverride(assetId)?.ramps ?? [];
}

/** Authored ramp decks for a placement's model path ([] = none). */
export function authoredRampsForPath(path: string | undefined): readonly AuthoredCollisionRamp[] {
  if (!path) return [];
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  return m ? rampsForAssetId(m[1]) : [];
}

/**
 * The baked boxes for a placement's model path, or null when the asset has no
 * bake (procedural placements, ground-cover foliage, unknown models) - the
 * caller falls back to the legacy collide circle.
 */
export function bakedBoxesForPath(
  path: string | undefined,
  overrides?: Readonly<Record<string, readonly BakedCollisionBox[]>>,
): readonly BakedCollisionBox[] | null {
  if (!path) return null;
  const over = overrides?.[path];
  if (over && over.length > 0) return over;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  // NOTE: stairs-category assets bake an EMPTY box list on purpose (their
  // walkable deck lives in ASSET_RAMPS): [] means walk-through, null means
  // "no bake, fall back to the legacy circle".
  if (m) return boxesForAssetId(m[1]);
  return null;
}

/** The walkable stairs deck for a catalogue model path, or null. */
export function bakedRampForPath(path: string | undefined): BakedCollisionRamp | null {
  if (!path) return null;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  if (m) return ASSET_RAMPS[m[1]] ?? null;
  return null;
}

// ---- baked-footprint analysis --------------------------------------------
// Static geometry facts about an asset's baked box set, used to pick sensible
// simple-collision defaults (box vs circle vs keep-the-bake) without opening
// the GLB. All values are in normalized model space (scale 1, base at y=0).

/** Boxes whose base sits at or below this height can block a walking player;
 *  higher boxes (canopies, roof beams) are ignored by the footprint fit. */
const GROUND_REACH_Y = 1.0;

export interface BakedFootprintAnalysis {
  /** Number of baked boxes. */
  boxCount: number;
  /** Tight union of ALL baked boxes as one box (center + half extents). */
  union: BakedCollisionBox;
  /** XZ footprint aspect ratio of the union, always >= 1. */
  aspect: number;
  /** Sum of box XZ areas over the union XZ area, capped at 1. Low values mean
   *  a skeletal / frame-like bake (posts, arches, open structures). */
  coverage: number;
  /** XZ distance from the model origin to the area-weighted center of the
   *  ground-reachable boxes (leaning palms bake their trunk off-origin). */
  groundOffset: number;
  /** Radius of the smallest origin-centered circle covering every
   *  ground-reachable box corner, or 0 when nothing reaches the ground. */
  fitRadius: number;
}

const footprintCache = new Map<string, BakedFootprintAnalysis | null>();

/** Analyze the baked box set of a catalogue asset id (e.g. 'props/well').
 *  Returns null when the asset has no bake entry at all. */
export function analyzeBakedFootprint(assetId: string): BakedFootprintAnalysis | null {
  const hit = footprintCache.get(assetId);
  if (hit !== undefined) return hit;
  const boxes = boxesForAssetId(assetId);
  let out: BakedFootprintAnalysis | null = null;
  if (boxes) {
    if (boxes.length === 0) {
      out = {
        boxCount: 0,
        union: { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0 },
        aspect: 1,
        coverage: 0,
        groundOffset: 0,
        fitRadius: 0,
      };
    } else {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let areaSum = 0;
      let gArea = 0;
      let gx = 0;
      let gz = 0;
      let fit = 0;
      for (const b of boxes) {
        minX = Math.min(minX, b.x - b.hx);
        maxX = Math.max(maxX, b.x + b.hx);
        minY = Math.min(minY, b.y - b.hy);
        maxY = Math.max(maxY, b.y + b.hy);
        minZ = Math.min(minZ, b.z - b.hz);
        maxZ = Math.max(maxZ, b.z + b.hz);
        const area = 4 * b.hx * b.hz;
        areaSum += area;
        if (b.y - b.hy <= GROUND_REACH_Y) {
          gArea += area;
          gx += b.x * area;
          gz += b.z * area;
          const cornerX = Math.abs(b.x) + b.hx;
          const cornerZ = Math.abs(b.z) + b.hz;
          fit = Math.max(fit, Math.hypot(cornerX, cornerZ));
        }
      }
      const spanX = Math.max(0.001, maxX - minX);
      const spanZ = Math.max(0.001, maxZ - minZ);
      out = {
        boxCount: boxes.length,
        union: {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          z: (minZ + maxZ) / 2,
          hx: spanX / 2,
          hy: Math.max(0.001, maxY - minY) / 2,
          hz: spanZ / 2,
        },
        aspect: Math.max(spanX, spanZ) / Math.min(spanX, spanZ),
        coverage: Math.min(1, areaSum / (spanX * spanZ)),
        groundOffset: gArea > 0 ? Math.hypot(gx / gArea, gz / gArea) : 0,
        fitRadius: fit,
      };
    }
  }
  footprintCache.set(assetId, out);
  return out;
}

/** The auto (derived) collision radius for a placement. In 'basic' mode the
 *  baked footprint fit beats the flat per-family factor when the asset has a
 *  usable bake, so the default circle hugs the actual mesh; every other mode
 *  keeps the legacy factor-derived radius (it only gates/falls back there). */
export function autoCollideRadius(
  assetId: string,
  scale: number,
  effectiveMode: CollisionMode,
): number {
  if (effectiveMode === 'basic') {
    const s = scale > 0 ? scale : 1;
    // A Collision Master authored radius is the maker's word.
    const authored = activeCollisionOverride(assetId)?.radius;
    if (authored !== undefined && authored > 0) {
      return Math.max(MIN_COLLIDE_RADIUS, Math.min(MAX_COLLIDE_RADIUS, authored * s));
    }
    const a = analyzeBakedFootprint(assetId);
    if (a && a.fitRadius > 0) {
      return Math.max(MIN_COLLIDE_RADIUS, Math.min(MAX_COLLIDE_RADIUS, a.fitRadius * s));
    }
  }
  return collideRadiusFor(scale, assetId);
}
