// Build-time dressing of Eastbrook's procedural surfaces (the merged
// stall/bench/fence batch, the Weekly Vault): the thin Three-side consumer of
// three pure cores.
//   - eastbrook_surface_tiling_core.ts: the atlas cells tile at a fixed world
//     size (yards per repeat per cell family) instead of one cell stretched
//     over each mesh's bounding box;
//   - grime and value, baked into the vertex colours the town material
//     already multiplies (so the Lambert tiers wear them too): a soft
//     darkening toward the footing, faded out by a yard or so up, and a small
//     seeded value shift per placement (and per block on the vault);
//   - town_shape_imperfection_core.ts: the settled lean, bow, sag and wobble.
// All of it is deterministic (seeded by placement or building id), render-only
// (no collider, footprint or layout record is read or written) and runs once
// when the view builds; nothing here runs per frame and no material, program
// or texture is added.
import * as THREE from 'three';
import {
  eastbrookAtlasCellOfUv,
  type SurfaceTileMode,
  tileEastbrookSurface,
} from './eastbrook_surface_tiling_core';
import { indexExactVertexTuples } from './exact_index_geometry';
import {
  applyShapeImperfection,
  createShapeImperfection,
  NO_SHAPE_IMPERFECTION,
  type ShapeImperfectionAmplitudes,
  type ShapeImperfectionFrame,
  shapeImperfectionSeed,
  TOWN_PROP_IMPERFECTION,
} from './town_shape_imperfection_core';

/** Grime: the multiplier at the footing, easing to 1 by `height` yards up. */
export interface SurfaceGrime {
  height: number;
  /** Fraction the colour darkens at the base (0.2 = 20 percent). */
  strength: number;
}

/** A stall's legs and a fence's foot darken a little; the canopy never does. */
export const EASTBROOK_PROP_GRIME: Readonly<SurfaceGrime> = Object.freeze({
  height: 0.8,
  strength: 0.14,
});

/** A building's footing: rising damp over the first yard and a half. */
export const EASTBROOK_BUILDING_GRIME: Readonly<SurfaceGrime> = Object.freeze({
  height: 1.6,
  strength: 0.22,
});

/** Seeded value spread of a whole placement (plus or minus this fraction). */
export const EASTBROOK_PLACEMENT_VALUE_SPREAD = 0.04;

/** Seeded value spread of each separately modelled block on a building. */
export const EASTBROOK_BLOCK_VALUE_SPREAD = 0.06;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The grime multiplier at `heightAboveBase` yards (1 at and above the band). */
export function surfaceGrimeFactor(grime: SurfaceGrime, heightAboveBase: number): number {
  return 1 - grime.strength * (1 - smoothstep(0, grime.height, heightAboveBase));
}

/** The seeded value multiplier of a key, in [1 - spread, 1 + spread]. */
export function surfaceValueFactor(key: string, spread: number): number {
  const unit = shapeImperfectionSeed(`${key}:value`) / 4294967296;
  return 1 + (unit * 2 - 1) * spread;
}

export interface EastbrookSurfaceDressing {
  /** Seeds the shape and the value (a placement or building id). */
  key: string;
  /** The footprint frame, in the geometry's coordinates. */
  frame: ShapeImperfectionFrame;
  /** The settled-shape amplitudes, or null for none. */
  shape: Readonly<ShapeImperfectionAmplitudes> | null;
  /** The grime band, or null for none (emissive panes, glass). */
  grime: Readonly<SurfaceGrime> | null;
  /** Whole-placement value spread (0 for none). */
  valueSpread: number;
  /** Retile the atlas: the cell and mapping of each triangle. Null keeps the
   *  geometry's own UVs (emissive parts that bind no atlas). */
  tiling: {
    cellOfTriangle: (index: number) => number;
    modeOfTriangle?: (index: number) => SurfaceTileMode;
    /** Per-block value spread for 'island' faces (see the tiling core). */
    islandValueSpread?: number;
  } | null;
  /** Height above the base of a frame point (default: frame y minus baseY). */
  heightAboveBase?: (x: number, y: number, z: number) => number;
}

/**
 * Dress a NON-INDEXED geometry already in the dressing frame. Returns a new
 * geometry indexed by exact vertex tuples (the town's attribute contract:
 * position, normal, colour and uv, all float). The input is not modified.
 */
export function dressEastbrookSurface(
  source: THREE.BufferGeometry,
  dressing: EastbrookSurfaceDressing,
): THREE.BufferGeometry {
  if (source.getIndex()) throw new Error('Eastbrook surface dressing requires a triangle soup');
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const color = source.getAttribute('color');
  const uv = source.getAttribute('uv');
  if (!position) throw new Error('Eastbrook surface dressing requires positions');
  const grime = dressing.grime;
  const heightAboveBase =
    dressing.heightAboveBase ?? ((_x: number, y: number) => y - dressing.frame.baseY);

  let positions: Float32Array;
  let normals: Float32Array | null;
  let colors: Float32Array | null;
  let uvs: Float32Array | null;
  if (dressing.tiling) {
    // One cut through the middle of the grime band gives a tall face a vertex
    // where the gradient bends (its base and the repeat lines give the rest).
    const splits = grime ? [dressing.frame.baseY + grime.height * 0.5] : [];
    const tiled = tileEastbrookSurface({
      positions: position.array as ArrayLike<number>,
      normals: normal ? (normal.array as ArrayLike<number>) : null,
      colors: color ? (color.array as ArrayLike<number>) : null,
      cellOfTriangle: dressing.tiling.cellOfTriangle,
      modeOfTriangle: dressing.tiling.modeOfTriangle,
      islandValueSpread: dressing.tiling.islandValueSpread,
      heightSplits: splits,
    });
    positions = tiled.positions;
    normals = tiled.normals;
    colors = tiled.colors;
    uvs = tiled.uvs;
  } else {
    positions = Float32Array.from(position.array as ArrayLike<number>);
    normals = normal ? Float32Array.from(normal.array as ArrayLike<number>) : null;
    colors = color ? Float32Array.from(color.array as ArrayLike<number>) : null;
    uvs = uv ? Float32Array.from(uv.array as ArrayLike<number>) : null;
  }

  // Grime and value on the undisplaced heights (the footing stays the base).
  if (colors) {
    const value =
      dressing.valueSpread > 0 ? surfaceValueFactor(dressing.key, dressing.valueSpread) : 1;
    const count = positions.length / 3;
    for (let vertex = 0; vertex < count; vertex++) {
      const factor =
        value *
        (grime
          ? surfaceGrimeFactor(
              grime,
              heightAboveBase(
                positions[vertex * 3],
                positions[vertex * 3 + 1],
                positions[vertex * 3 + 2],
              ),
            )
          : 1);
      colors[vertex * 3] *= factor;
      colors[vertex * 3 + 1] *= factor;
      colors[vertex * 3 + 2] *= factor;
    }
  }

  const field = dressing.shape
    ? createShapeImperfection(shapeImperfectionSeed(dressing.key), dressing.frame, dressing.shape)
    : NO_SHAPE_IMPERFECTION;
  applyShapeImperfection(positions, normals, field);

  const dressed = new THREE.BufferGeometry();
  dressed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) dressed.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors) dressed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (uvs) dressed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const indexed = indexExactVertexTuples(dressed);
  indexed.computeBoundingBox();
  indexed.computeBoundingSphere();
  return indexed;
}

/** What a merged-batch placement is, for its shape and its grime. */
export type EastbrookPlacementKind = 'stall' | 'bench' | 'fence';

export interface EastbrookPlacementDressing {
  /** The placement's layout id (seeds its shape and value). */
  key: string;
  kind: EastbrookPlacementKind;
  /** The template's own size (union of its opaque and emissive parts), so
   *  both parts of one placement share one field. */
  size: THREE.Vector3;
  /** Whether this part wears the atlas (false for the emissive panes). */
  surface: boolean;
}

/** Canopy line of the market stall above its base, as a share of its height:
 *  the canvas starts about 2.0 of the 2.7 yards up. */
const STALL_CANOPY_SHARE = 0.74;
/** Rails of a fence sag above this share of its height (the feet stay put). */
const FENCE_RAIL_SHARE = 0.3;

/**
 * Dress one placed copy of a town template: `template` is the template's own
 * (indexed, atlas-celled) geometry with its base at y 0, `matrix` its
 * placement. The atlas retiles in WORLD space (after the placement's scale,
 * so a fence stretched to nine yards wears nine yards of planks), the grime
 * reads the height above the placement's own pitched base, and the field
 * leans, bows and sags it in the placement's frame.
 */
export function dressEastbrookPlacement(
  template: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  placement: EastbrookPlacementDressing,
): THREE.BufferGeometry {
  const placed = template.clone().applyMatrix4(matrix);
  const soup = placed.index ? placed.toNonIndexed() : placed;
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const axisX = new THREE.Vector3().setFromMatrixColumn(matrix, 0);
  const axisY = new THREE.Vector3().setFromMatrixColumn(matrix, 1);
  const axisZ = new THREE.Vector3().setFromMatrixColumn(matrix, 2);
  const width = placement.size.x * axisX.length();
  const height = placement.size.y * axisY.length();
  const depth = placement.size.z * axisZ.length();
  const up = axisY.clone().normalize();
  const yaw = Math.atan2(-axisX.z, axisX.x);
  const eaveShare =
    placement.kind === 'stall'
      ? STALL_CANOPY_SHARE
      : placement.kind === 'fence'
        ? FENCE_RAIL_SHARE
        : null;
  const frame: ShapeImperfectionFrame = {
    centerX: origin.x,
    centerZ: origin.z,
    yaw,
    halfWidth: width / 2,
    halfDepth: depth / 2,
    baseY: origin.y,
    height,
    eaveY: eaveShare === null ? null : origin.y + height * eaveShare,
    ridgeAxis: 'x',
  };
  const uv = soup.getAttribute('uv');
  const dressed = dressEastbrookSurface(soup, {
    key: placement.key,
    frame,
    shape:
      placement.kind === 'bench'
        ? { ...TOWN_PROP_IMPERFECTION, sagYards: 0 }
        : TOWN_PROP_IMPERFECTION,
    grime: placement.surface ? EASTBROOK_PROP_GRIME : null,
    valueSpread: placement.surface ? EASTBROOK_PLACEMENT_VALUE_SPREAD : 0,
    tiling:
      placement.surface && uv
        ? {
            cellOfTriangle: (index) =>
              eastbrookAtlasCellOfUv(uv.getX(index * 3), uv.getY(index * 3)),
          }
        : null,
    // Height along the placement's own (pitched) up axis, from its base.
    heightAboveBase: (x, y, z) =>
      (x - origin.x) * up.x + (y - origin.y) * up.y + (z - origin.z) * up.z,
  });
  placed.dispose();
  if (soup !== placed) soup.dispose();
  return dressed;
}
