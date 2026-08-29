// kit_uv_surface_core: which surface-detail family each TRIANGLE of a kit prop
// takes, decided from the atlas swatch its UVs sample.
//
// The KayKit hexagon kit ships every model as ONE mesh with ONE material
// ('hexagons_medieval') over one shared 512x512 palette atlas, byte-identical
// across all 65 khex files. Material-name routing therefore cannot tell a
// ship's plank hull from its canvas sails from a stone footing pad: they are
// all the same material. The kit-wide 'stone' entry in worn_stone.ts made that
// visible as masonry tiled across hulls and sails alike, because the detail
// layer projects in WORLD space and ignores UVs entirely.
//
// What DOES separate them is the atlas cell each triangle samples. Every part
// of a model reads one flat palette swatch, so a triangle's UV is a reliable
// label for its material. Measured on the shipped meshes, the partition is
// exact: hex_ship_blue splits 774 wood / 764 cloth / 42 stone and
// hex_watchtower 1144 / 226 / 120, with ZERO triangles straddling a boundary
// and none unmapped, so this needs no tolerance tuning or tie-breaking.
//
// Rectangles are tested on BOTH axes on purpose. The light-wood swatch and the
// sail-cloth swatch share a u column and are separated only in v, so a u-only
// test would paint the tower's ladder as canvas.

/** The families this router can assign; a superset lives in worn_stone.ts. */
export type KitSurfaceFamily = 'wood' | 'cloth' | 'stone';

export interface UvSwatchRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Measured swatch blocks, padded by ~0.01 in each direction so a re-export
 *  that nudges a UV by a texel still lands inside its own cell. The pads stay
 *  far short of the gaps between blocks (the nearest pair is 0.28 apart). */
const KHEX_SWATCHES: Readonly<Record<KitSurfaceFamily, readonly UvSwatchRect[]>> = Object.freeze({
  wood: Object.freeze([
    // dark plank block: ship hull, masts, spars, crow's nest, tower frame
    { u0: 0.757, u1: 0.865, v0: 0.012, v1: 0.23 },
    // light plank block: the tower ladder, stake tips, arrow shafts
    { u0: 0.64, u1: 0.712, v0: 0.011, v1: 0.252 },
  ]),
  cloth: Object.freeze([
    // cream canvas: sail bodies, the tower's fletching flags
    { u0: 0.64, u1: 0.725, v0: 0.529, v1: 0.753 },
    // blue canvas: sail stripes and masthead pennants
    { u0: 0.022, u1: 0.113, v0: 0.787, v1: 0.97 },
    // green canvas: the tower's hanging banners
    { u0: 0.385, u1: 0.49, v0: 0.789, v1: 0.981 },
  ]),
  stone: Object.freeze([
    // grey masonry/metal: the ship's deck plate, the tower's footing pads and
    // its iron hoop band. Deliberately kept as stone, see resolveKitSurface.
    { u0: 0.275, u1: 0.353, v0: 0.053, v1: 0.235 },
  ]),
});

/** Kits whose atlas this router knows. Others get no per-triangle routing. */
const SWATCHES_BY_KIT: Readonly<
  Record<string, Readonly<Record<KitSurfaceFamily, readonly UvSwatchRect[]>>>
> = Object.freeze({ khex: KHEX_SWATCHES });

export function kitHasUvSurfaceRouting(kit: string): boolean {
  return kit in SWATCHES_BY_KIT;
}

function inRect(u: number, v: number, rect: UvSwatchRect): boolean {
  return u >= rect.u0 && u <= rect.u1 && v >= rect.v0 && v <= rect.v1;
}

/** The family for one uv sample, or null when it lands in no known swatch. */
export function familyForUv(kit: string, u: number, v: number): KitSurfaceFamily | null {
  const table = SWATCHES_BY_KIT[kit];
  if (!table) return null;
  for (const family of ['wood', 'cloth', 'stone'] as const) {
    for (const rect of table[family]) if (inRect(u, v, rect)) return family;
  }
  return null;
}

export interface KitSurfaceSplit {
  /** triangle index lists, keyed by family; empty families are omitted */
  groups: Partial<Record<KitSurfaceFamily, number[]>>;
  /** triangles whose three corners disagreed, or that matched no swatch */
  unresolved: number;
  /** total triangles considered */
  triangles: number;
}

/**
 * Sort a primitive's triangles into per-family index runs.
 *
 * A triangle counts for a family only when ALL THREE corners agree, so a
 * triangle spanning two swatches is reported unresolved rather than guessed
 * at. On the shipped kit meshes `unresolved` is 0; a nonzero count means the
 * asset changed and the table above needs re-measuring, which the paired test
 * asserts rather than tolerating.
 */
export function splitKitSurfacesByUv(
  kit: string,
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
): KitSurfaceSplit {
  const groups: Partial<Record<KitSurfaceFamily, number[]>> = {};
  let unresolved = 0;
  const triangles = Math.floor(indices.length / 3);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const fa = familyForUv(kit, uvs[a * 2], uvs[a * 2 + 1]);
    if (fa === null) {
      unresolved++;
      continue;
    }
    const fb = familyForUv(kit, uvs[b * 2], uvs[b * 2 + 1]);
    const fc = familyForUv(kit, uvs[c * 2], uvs[c * 2 + 1]);
    if (fb !== fa || fc !== fa) {
      unresolved++;
      continue;
    }
    const bucket = groups[fa] ?? [];
    groups[fa] = bucket;
    bucket.push(a, b, c);
  }
  return { groups, unresolved, triangles };
}
