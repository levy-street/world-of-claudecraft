// The authored towns' square dressing as editable placements: Eastbrook
// Vale's market stalls, benches and yard fences, and Fenbridge's Mirelight
// cistern, provision stall, muster board and boardwalks
// (promotedScenery.authoredTownDressing; the town views stand their copies
// down and sim/authored_town_dressing.ts stands the record colliders down).
//
// Each placement reproduces the town view's own transform exactly. The town
// views (render/eastbrook_town.ts, render/fenbridge_town.ts) fit a model into
// a width x height x depth box with its base centred at the anchor; a placement
// normalizes the GLB to targetHeightFor(path) / largest dimension. So the
// uniform scale is set to undo that normalization (natural units) and the
// per-axis scales carry the box fit. Every model here is centred on its own
// origin with its base at y = 0 (measured below), so the two pivots agree.
// Long thin pieces (fences, boardwalk planks) ride the shared pitched-segment
// fit (sim/pitched_segment.ts): the same slope, the same sink, as a rotZ tilt.

import { targetHeightFor } from '../render/asset_scale';
import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT, localToWorld } from '../sim/fenbridge_layout';
import type { MapPlacement } from '../sim/map_doc';
import { pitchedSegmentPlacement } from '../sim/pitched_segment';
import { terrainHeight } from '../sim/world';

/** Bounding size of each model at scale 1, in the GLB's own units, measured
 *  from the files (POSITION accessor bounds through the node hierarchy, the
 *  gen_prop_natural_size.mjs method). tests/authored_town_dressing.test.ts
 *  re-measures the GLBs, so a remodel fails there instead of drifting here. */
export const TOWN_DRESSING_NATURAL: Readonly<Record<string, { x: number; y: number; z: number }>> =
  {
    'props/eastbrook_market_stall': { x: 2.8, y: 2.7, z: 2.2001 },
    'dungeon/bench': { x: 1.75, y: 0.4999, z: 0.7499 },
    'props/fence': { x: 0.791, y: 0.326, z: 0.0259 },
    'props/fenbridge_mirelight_cistern': { x: 3.6, y: 2.6001, z: 3.6 },
    'props/fenbridge_provision_stall': { x: 3.2, y: 2.8, z: 1.5998 },
    'props/fenbridge_muster_board': { x: 2.4, y: 2.6, z: 0.5999 },
    'props/fenbridge_boardwalk': { x: 4, y: 0.1499, z: 1.4001 },
  };

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function assetIdOf(url: string): string {
  return url.replace(/^\/models\//, '').replace(/\.glb$/i, '');
}

function readableName(id: string): string {
  const spaced = id.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The uniform scale that draws the GLB at its own units (undoing the
 *  placed-asset normalization), so the per-axis scales are the box fit. */
function naturalScale(assetId: string): {
  natural: { x: number; y: number; z: number };
  scale: number;
} {
  const natural = TOWN_DRESSING_NATURAL[assetId];
  if (!natural) throw new Error(`No measured size for town dressing model ${assetId}`);
  const maxDim = Math.max(natural.x, natural.y, natural.z);
  return { natural, scale: maxDim / targetHeightFor(`/models/${assetId}.glb`) };
}

/** A ground-seated box fit: the town draws the base at the terrain under the anchor. */
function boxPlacement(
  url: string,
  id: string,
  x: number,
  z: number,
  rotation: number,
  width: number,
  height: number,
  depth: number,
  collide: boolean,
): MapPlacement {
  const assetId = assetIdOf(url);
  const { natural, scale } = naturalScale(assetId);
  const placement: MapPlacement = {
    assetId,
    name: readableName(id),
    x,
    z,
    y: 0,
    rotY: cleanZero(rotation),
    scale,
    scaleX: width / natural.x,
    scaleY: height / natural.y,
    scaleZ: depth / natural.z,
    collide,
  };
  if (collide) placement.collisionMode = 'baked';
  return placement;
}

/** A pitched run between two ends: the town's slope and sink, as rotZ and y. */
function segmentPlacement(
  url: string,
  id: string,
  start: { x: number; z: number },
  end: { x: number; z: number },
  height: number,
  width: number,
  seed: number,
): MapPlacement {
  const assetId = assetIdOf(url);
  const { natural, scale } = naturalScale(assetId);
  const groundAt = (x: number, z: number) => terrainHeight(x, z, seed);
  const fit = pitchedSegmentPlacement(start, end, width, groundAt);
  return {
    assetId,
    name: readableName(id),
    x: fit.centerX,
    z: fit.centerZ,
    y: fit.centerY - groundAt(fit.centerX, fit.centerZ),
    rotY: cleanZero(fit.rotation),
    rotZ: cleanZero(fit.pitch),
    scale,
    scaleX: fit.spatialLength / natural.x,
    scaleY: height / natural.y,
    scaleZ: width / natural.z,
    collide: false,
  };
}

/** Eastbrook Vale's benches, market stalls and yard fences. */
function eastbrookDressing(seed: number): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const bench of EASTBROOK_LAYOUT.civic.benches) {
    const { natural } = naturalScale(assetIdOf(bench.assetId));
    // The town keeps the bench's proportions: one horizontal fit drives height.
    const fit = Math.min(bench.width / natural.x, bench.depth / natural.z);
    // Benches never collide in a custom world (custom_world_props.ts), so the
    // promoted copy stays walk-through too.
    out.push(
      boxPlacement(
        bench.assetId,
        bench.id,
        bench.position.x,
        bench.position.z,
        bench.rotation,
        bench.width,
        natural.y * fit,
        bench.depth,
        false,
      ),
    );
  }
  for (const stall of EASTBROOK_LAYOUT.market.stalls) {
    out.push(
      boxPlacement(
        stall.assetId,
        stall.id,
        stall.position.x,
        stall.position.z,
        stall.rotation,
        stall.width,
        stall.height,
        stall.depth,
        true,
      ),
    );
  }
  for (const fence of EASTBROOK_LAYOUT.fences) {
    const placement = segmentPlacement(
      fence.assetId,
      fence.id,
      fence.start,
      fence.end,
      fence.height,
      fence.width,
      seed,
    );
    // A rail, like every promoted world fence: the isFence OBB collider and the
    // jump-aware crossing read worldPropWidth/Depth at scale 1 (normalized).
    const { natural, scale } = naturalScale(placement.assetId);
    placement.collide = true;
    placement.collisionMode = 'baked';
    placement.worldPropKind = 'fence';
    placement.worldPropWidth = natural.x / scale;
    placement.worldPropDepth = natural.z / scale;
    out.push(placement);
  }
  return out;
}

/** Fenbridge's cistern, provision stall, muster board and boardwalk planks. */
function fenbridgeDressing(seed: number): MapPlacement[] {
  const { cistern, provisionStall, musterBoard } = FENBRIDGE_LAYOUT.civic;
  const out: MapPlacement[] = [
    boxPlacement(
      cistern.assetId,
      cistern.id,
      cistern.position.x,
      cistern.position.z,
      0,
      cistern.nativeDimensions.width,
      cistern.nativeDimensions.height,
      cistern.nativeDimensions.depth,
      true,
    ),
    boxPlacement(
      provisionStall.assetId,
      provisionStall.id,
      provisionStall.position.x,
      provisionStall.position.z,
      provisionStall.rotation,
      provisionStall.width,
      provisionStall.height,
      provisionStall.depth,
      true,
    ),
    // The board's collider is its muster SERVICE's, which only the built-in
    // world carries (colliders.ts), so in a document it never blocked: the
    // promoted copy keeps that.
    boxPlacement(
      musterBoard.assetId,
      musterBoard.id,
      musterBoard.position.x,
      musterBoard.position.z,
      musterBoard.rotation,
      musterBoard.nativeDimensions.width,
      musterBoard.nativeDimensions.height,
      musterBoard.nativeDimensions.depth,
      false,
    ),
  ];
  for (const plank of FENBRIDGE_LAYOUT.repeated.boardwalks) {
    // The town lays each plank along its local x between its two ends
    // (fenbridge_town.ts pitchedFootprintPlacement); planks never block.
    const half = plank.nativeDimensions.width / 2;
    out.push(
      segmentPlacement(
        plank.assetId,
        plank.id,
        localToWorld(plank.position, plank.rotation, -half, 0),
        localToWorld(plank.position, plank.rotation, half, 0),
        plank.nativeDimensions.height,
        plank.nativeDimensions.depth,
        seed,
      ),
    );
  }
  return out;
}

/** Every piece of both towns' square dressing, as editable placements. */
export function authoredTownDressingPlacements(seed: number): MapPlacement[] {
  return [...eastbrookDressing(seed), ...fenbridgeDressing(seed)];
}
