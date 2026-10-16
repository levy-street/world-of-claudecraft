// Walkable ramp decks from baked stairs/ramp placements: the collision bake
// classifies stair-like catalogue assets and fits a rising deck over their
// steps (scripts/assets/bake_collision.mjs -> ASSET_RAMPS). A colliding
// stairs placement contributes that deck to the walkable ground the same way
// 'collider/plane' volumes do, so the player just WALKS UP stairs; the asset
// bakes no blocking boxes at all (grazing the sides clips - lenient by
// design).
//
// The per-content ramp list is cached (custom maps carry thousands of
// placements; stairs are a handful) and busted alongside the static-collider
// cache whenever placements mutate. It also carries the walk-in town
// buildings' floors (town_walk_in.ts), read off the content's building records
// and its promoted scenery, so an edit to either busts it the same way.

import { authoredRampsForPath } from './asset_collision';
import { ASSET_RAMPS } from './asset_collision.generated';
import { invalidateLadders } from './ladders';
import { nearTownWalkIn, townWalkInPlacements } from './town_walk_in';
import type { WorldContent } from './types';
import { terrainHeight } from './world';

interface WorldRamp {
  x: number; // placement anchor
  z: number;
  rotY: number;
  // Deck footprint in MODEL units (center offset + half extents) and the
  // per-axis world scale to apply.
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  axis: 'x' | 'z';
  // Extra deck yaw WITHIN the model frame (Collision Master authored decks
  // may sit at any angle; the stairs bake's decks are always axis-aligned).
  ry: number;
  yNeg: number;
  yPos: number;
  sx: number;
  sy: number;
  sz: number;
  // World base height of the model's seat (frozen ground when detached).
  detached: boolean;
  groundY: number;
  lift: number;
}

/**
 * How far above a mover's feet a walkable deck or plane still counts as ITS
 * floor. Decks are raised ground, and ground has no height of its own: a
 * 12 yd bridge module whose deck stands 70 yd over the seabed used to make
 * every point under it read as "floor at +70", so a swimmer between the piers
 * met a 70 yd cliff at the footprint edge and stopped dead ("the player cannot
 * go between these pillars"). A body-aware query (world.ts groundHeightAtBody)
 * skips decks higher than this over the feet; it is generous next to the
 * step allowance so a plateau lip a yard under a deck still walks on.
 */
export const WALK_DECK_REACH = 2.5;

// Decks bucketed by world XZ cell: a ground query walks only the decks whose
// footprint reaches its cell instead of every deck on the map (a dressed city
// carries hundreds - wharf, bridges, castle stairs, the mine - and the sim
// asks for ground under every mover every tick; the whole-list scan was
// 3% of the frame in the profile).
interface RampTable {
  ramps: WorldRamp[];
  buckets: Map<string, WorldRamp[]>;
  // Every deck's reach in one world box: a query outside it skips the bucket
  // key, which matters on the built-in world, whose only decks are a town's.
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const RAMP_BUCKET = 32; // yards per cell
const bucketKey = (cx: number, cz: number): string => `${cx}:${cz}`;
const NO_RAMPS: readonly WorldRamp[] = [];

const cache = new WeakMap<WorldContent, Map<number, RampTable>>();

/** Drop the cached ramp list for `content` (placements changed), and the
 *  ladder list that derives from the same placements (ladders.ts). */
export function invalidatePlacementRamps(content: WorldContent): void {
  cache.delete(content);
  invalidateLadders(content);
}

function rampTable(content: WorldContent, seed: number): RampTable {
  let bySeed = cache.get(content);
  if (!bySeed) {
    bySeed = new Map();
    cache.set(content, bySeed);
  }
  const cached = bySeed.get(seed);
  if (cached) return cached;
  const ramps: WorldRamp[] = [];
  for (const p of content.placements ?? []) {
    // Collision OFF is a real choice: no blocker and no raised floor.
    //
    // Note what is NOT gated here: `collideCustom` (the 'basic' simple-footprint
    // mode). It used to be, and that was the "I can't walk up my own ramp" bug ,
    // a stairs placement stamped with a simple circle/square before anyone
    // authored a ramp for the asset kept its solid footprint and silently lost
    // its deck, so the ramp became an invisible block. An asset with authored
    // walkable decks IS walkable; colliders.ts drops the derived footprint to
    // match (a placement cannot be solid and walkable at the same time).
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    const s = p.scale > 0 ? p.scale : 1;
    const base = {
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      sx: s * (p.scaleX ?? 1),
      sy: s * (p.scaleY ?? 1),
      sz: s * (p.scaleZ ?? 1),
      detached: p.detached === true,
      groundY: p.groundY ?? 0,
      lift: p.y ?? 0,
    };
    // Per-placement decks are the live truth (the Collision Master scene
    // derives them from its ramp volumes so a playtest walks unsaved ramps);
    // they REPLACE the asset's authored/generated deck table.
    if (p.ramps && p.ramps.length > 0) {
      for (const r of p.ramps) {
        ramps.push({
          ...base,
          cx: r.x,
          cz: r.z,
          hx: r.hx,
          hz: r.hz,
          axis: 'x',
          ry: r.ry ?? 0,
          yNeg: r.y0,
          yPos: r.y1,
        });
      }
      continue;
    }
    // Collision Master decks REPLACE the generated bake for that asset, the same
    // way authored boxes beat the voxel bake (asset_collision.boxesForAssetId)
    // and per-placement decks beat both. Stacking them was the "I get blocked at
    // the edge and the walk down is not a ramp" bug: placementRampFloorAt takes
    // the MAX over every deck, so a generated FLAT deck (the stairs bake fits one
    // shelf over a whole flight) sat on top of the authored slope and turned its
    // lower half into a plateau with a sheer drop at the rim. The author drew the
    // real shape; nothing generated gets to overrule it.
    const authored = authoredRampsForPath(p.path);
    const m = authored.length === 0 && p.path ? /^\/models\/(.+)\.glb$/.exec(p.path) : null;
    const ramp = m ? ASSET_RAMPS[m[1]] : undefined;
    if (ramp) {
      ramps.push({
        ...base,
        cx: ramp.cx,
        cz: ramp.cz,
        hx: ramp.hx,
        hz: ramp.hz,
        axis: ramp.axis,
        ry: 0,
        yNeg: ramp.yNeg,
        yPos: ramp.yPos,
      });
    }
    // Collision Master authored walkable decks. Deliberately NOT gated on
    // per-placement hitboxes: hand-edited blocker boxes (or a saved hitbox
    // preset auto-copied onto fresh placements) must never silently strip an
    // asset's walkable decks - the deck and the blockers are independent
    // channels.
    for (const r of authored) {
      ramps.push({
        ...base,
        cx: r.x,
        cz: r.z,
        hx: r.hx,
        hz: r.hz,
        axis: 'x',
        ry: r.ry ?? 0,
        yNeg: r.y0,
        yPos: r.y1,
      });
    }
  }
  // A walk-in town building's floor and entry step (town_walk_in.ts): its
  // record stands the model the way a placement would, with the same decks.
  for (const p of townWalkInPlacements(content)) {
    // the model's seat never moves, so its ground is read once here rather
    // than on every ground query inside the town
    const seat = terrainHeight(p.x, p.z, seed);
    for (const r of authoredRampsForPath(p.path)) {
      ramps.push({
        x: p.x,
        z: p.z,
        rotY: p.rotY,
        sx: p.scale,
        sy: p.scale,
        sz: p.scale,
        detached: true,
        groundY: seat,
        lift: p.y ?? 0,
        cx: r.x,
        cz: r.z,
        hx: r.hx,
        hz: r.hz,
        axis: 'x',
        ry: r.ry ?? 0,
        yNeg: r.y0,
        yPos: r.y1,
      });
    }
  }
  // bucket every deck into each cell its (rotated) footprint can reach
  const buckets = new Map<string, WorldRamp[]>();
  let boundMinX = Number.POSITIVE_INFINITY;
  let boundMaxX = Number.NEGATIVE_INFINITY;
  let boundMinZ = Number.POSITIVE_INFINITY;
  let boundMaxZ = Number.NEGATIVE_INFINITY;
  for (const r of ramps) {
    // A true bound: a deck turned within the model (its own ry) reaches its
    // centre's distance plus its half-diagonal, under the larger axis scale.
    const reach = Math.max(r.sx, r.sz) * (Math.hypot(r.cx, r.cz) + Math.hypot(r.hx, r.hz)) + 1;
    boundMinX = Math.min(boundMinX, r.x - reach);
    boundMaxX = Math.max(boundMaxX, r.x + reach);
    boundMinZ = Math.min(boundMinZ, r.z - reach);
    boundMaxZ = Math.max(boundMaxZ, r.z + reach);
    const minX = Math.floor((r.x - reach) / RAMP_BUCKET);
    const maxX = Math.floor((r.x + reach) / RAMP_BUCKET);
    const minZ = Math.floor((r.z - reach) / RAMP_BUCKET);
    const maxZ = Math.floor((r.z + reach) / RAMP_BUCKET);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = bucketKey(cx, cz);
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(r);
      }
    }
  }
  const table = {
    ramps,
    buckets,
    minX: boundMinX,
    maxX: boundMaxX,
    minZ: boundMinZ,
    maxZ: boundMaxZ,
  };
  bySeed.set(seed, table);
  return table;
}

/** The decks whose footprint can reach (x, z). */
function rampsNear(
  content: WorldContent,
  seed: number,
  x: number,
  z: number,
): readonly WorldRamp[] {
  const table = rampTable(content, seed);
  if (table.ramps.length === 0) return NO_RAMPS;
  if (x < table.minX || x > table.maxX || z < table.minZ || z > table.maxZ) return NO_RAMPS;
  return (
    table.buckets.get(bucketKey(Math.floor(x / RAMP_BUCKET), Math.floor(z / RAMP_BUCKET))) ??
    NO_RAMPS
  );
}

/** One deck's floor at world (x, z), or null outside its footprint. */
function rampFloorAt(r: WorldRamp, x: number, z: number, seed: number): number | null {
  // Into the placement's local (pre-yaw) frame, then to model units.
  const dx = x - r.x;
  const dz = z - r.z;
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const lx = (dx * c - dz * s) / (r.sx || 1);
  const lz = (dx * s + dz * c) / (r.sz || 1);
  let ox = lx - r.cx;
  let oz = lz - r.cz;
  // Authored decks may carry their own yaw within the model frame; rotate
  // into the deck frame (same convention as the placement yaw above).
  if (r.ry !== 0) {
    const rc = Math.cos(r.ry);
    const rs = Math.sin(r.ry);
    const u = ox * rc - oz * rs;
    const v = ox * rs + oz * rc;
    ox = u;
    oz = v;
  }
  if (Math.abs(ox) > r.hx || Math.abs(oz) > r.hz) return null;
  const along = r.axis === 'x' ? ox : oz;
  const half = r.axis === 'x' ? r.hx : r.hz;
  const t = half > 1e-6 ? (along + half) / (2 * half) : 0.5;
  const deckModel = r.yNeg + (r.yPos - r.yNeg) * Math.min(1, Math.max(0, t));
  const base = r.detached ? r.groundY : terrainHeight(r.x, r.z, seed);
  return base + r.lift + deckModel * r.sy;
}

/**
 * Whether a walkable deck or plane could stand at (x, z) in this world at
 * all: a world with no placements and no volumes (the built-in world) has
 * decks only where a walk-in town building stands its floor, so its ground
 * query skips the deck table everywhere else.
 */
export function decksMayStand(content: WorldContent, x: number, z: number): boolean {
  return (
    content.placements !== undefined ||
    (content.colliderVolumes?.length ?? 0) > 0 ||
    nearTownWalkIn(x, z)
  );
}

/**
 * The highest stairs-deck floor under (x, z), or -Infinity when none.
 * groundHeight max()es this in, exactly like plane collider volumes.
 * `deckReach` is how far over `prevY` a deck still counts: the walking reach
 * by default; an airborne landing passes 0 (a deck is a landing only within
 * the mantle reach its caller already added to `prevY`).
 */
export function placementRampFloorAt(
  content: WorldContent,
  seed: number,
  x: number,
  z: number,
  prevY?: number,
  deckReach = WALK_DECK_REACH,
): number {
  const ramps = rampsNear(content, seed, x, z);
  let best = Number.NEGATIVE_INFINITY;
  const reach = prevY === undefined ? Number.POSITIVE_INFINITY : prevY + deckReach;
  for (const r of ramps) {
    const floor = rampFloorAt(r, x, z, seed);
    // A deck far ABOVE the mover is someone else's floor (the bridge span
    // over a swimmer, a gallery over the hall): it never lifts the ground
    // under a body that could not step up onto it.
    if (floor === null || floor > reach) continue;
    if (floor > best) best = floor;
  }
  return best;
}

/** The lowest deck floor strictly above `aboveY` at (x, z), or Infinity: the
 *  storey overhead a rising body bumps its head on (deck_ceiling.ts). */
export function placementRampCeilingAt(
  content: WorldContent,
  seed: number,
  x: number,
  z: number,
  aboveY: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const r of rampsNear(content, seed, x, z)) {
    const floor = rampFloorAt(r, x, z, seed);
    if (floor !== null && floor > aboveY && floor < best) best = floor;
  }
  return best;
}
