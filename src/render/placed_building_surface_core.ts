// Surface tuning for the painted Tidehold buildings every built-in town stands
// (eastbrook_placed_building.ts): how hard their baked relief reads, and a
// small per-building colour variation. Pure and deterministic: no Three, no
// randomness, the same answer on every host.
//
// Why the relief needs lifting. The painted pipeline bakes each building's
// colour, normal and emission atlases (ClaudeCraft Studio, CREDITS.md), and
// the normal atlas ships at a SIXTH of the colour atlas's resolution (the
// bank's walls: colour 3072 x 1536, normal 512 x 256). At the town's 1.3
// stand scale the colour carries about 37 texels a yard and the normals about
// 6, so the mortar and plank relief is a one-texel blur, and it is faint:
// measured over the shipped wall normals, 58 to 71 percent of texels are flat
// (slope under 0.03) and the 90th percentile slope is only 0.16 to 0.22
// (roofs 0.21 to 0.36). At normalScale 1 the walls light as flat cards. These
// scales lift the existing relief; they cannot add detail the bake does not
// hold (that, and the size of the painted stones, is a re-bake).
//
// The factor multiplies BOTH components of the material's normalScale, so
// the loader's derivative-tangent sign flip (GLTFLoader writes (s, -s) for a
// glTF normal map on a mesh without tangents) survives untouched.

/** The part of a painted building a material dresses, read off its name. */
export type PlacedBuildingSurfaceRole = 'walls' | 'roof' | 'props' | 'interior' | 'other';

/** The painted pipeline names its four atlases `painted_<role>@<building>`
 *  (`painted_props_gold@bank`, `painted_props_metal@bank` are props too). */
export function placedBuildingSurfaceRole(materialName: string): PlacedBuildingSurfaceRole {
  const match = /^painted_(walls|roof|props|interior)(?:_[a-z]+)?@/.exec(materialName);
  return match ? (match[1] as PlacedBuildingSurfaceRole) : 'other';
}

/**
 * Normal-map strength multiplier per role (Standard tiers; the Lambert tiers
 * carry no normal map). Walls lift most: their bake is the faintest and the
 * lowest resolution against the area it covers. Roofs already read (their
 * slates are baked deeper). Props and interiors are seen close, where a
 * low-resolution normal pushed hard turns to soft blobs, so they lift least.
 * The shared kit maps (town_gold and the like) keep their authored scale.
 */
export const PLACED_BUILDING_RELIEF_SCALE: Readonly<Record<PlacedBuildingSurfaceRole, number>> =
  Object.freeze({
    walls: 1.8,
    roof: 1.4,
    props: 1.35,
    interior: 1.3,
    other: 1,
  });

export function placedBuildingReliefScale(materialName: string): number {
  return PLACED_BUILDING_RELIEF_SCALE[placedBuildingSurfaceRole(materialName)];
}

/** Value (brightness) spread of one building's walls and roof, and their
 *  warm/cool spread: two buildings off the same model stop reading as copies,
 *  and no building's palette leaves its painted family. */
export const PLACED_BUILDING_TINT = Object.freeze({
  walls: Object.freeze({ valueLow: 0.94, valueHigh: 1.03, warmth: 0.018 }),
  roof: Object.freeze({ valueLow: 0.9, valueHigh: 1.03, warmth: 0.025 }),
});

function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // final avalanche, so keys that differ in their last character spread
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

function unit(key: string): number {
  return fnv1a(key) / 4294967296;
}

/**
 * The colour multiplier [r, g, b] for one role of one standing building, or
 * null when the role keeps its authored colour (props, interiors, kit maps).
 * Seeded by town and building id, so the same building looks the same on every
 * load, and the same model stood twice (two cottages) does not.
 */
export function placedBuildingTint(
  town: string,
  buildingId: string,
  role: PlacedBuildingSurfaceRole,
): readonly [number, number, number] | null {
  if (role !== 'walls' && role !== 'roof') return null;
  const spread = PLACED_BUILDING_TINT[role];
  const key = `${town}:${buildingId}:${role}`;
  const value = spread.valueLow + (spread.valueHigh - spread.valueLow) * unit(`${key}:value`);
  const warmth = (unit(`${key}:warmth`) * 2 - 1) * spread.warmth;
  return [value * (1 + warmth), value, value * (1 - warmth)];
}
