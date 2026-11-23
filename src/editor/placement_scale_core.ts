// Un-squishing placements whose horizontal axes were fitted independently.
//
// world_prop_placements.ts sizes a promoted world building by FITTING it to the
// plot the world reserved for it: `scale` comes from the target height, then
// scaleX and scaleZ stretch the mesh sideways until its footprint matches the
// building record's w and d. When the kit model's own proportions differ from
// that plot, and across 78 shipped buildings drawn from six kit models they
// usually do, the result is a house squashed along one horizontal axis and
// pulled along the other. SPACEY's report, looking at Eastbrook: "a lot of
// buildings look squished."
//
// This is a document repair, not a render tweak: the bad aspect is baked into
// the saved placement, so only rewriting the placement fixes it.

import type { MapPlacement } from '../sim/map_doc';

/**
 * The kit BUILDINGS. Deliberately narrow.
 *
 * Plenty of other promoted props also carry unequal axis scales, and for most
 * of them that is the POINT: `props/fence` is stretched to span the gap to the
 * next post, a market stall is fitted to its pitch, a ruin column is squashed
 * to look toppled. Equalizing those would open gaps in every fence run in the
 * world. Only the things a maker reads as "a building" belong here.
 */
export const EQUALIZABLE_BUILDING_ASSET_IDS: ReadonlySet<string> = new Set([
  'props/inn',
  'props/house_1',
  'props/house_2',
  'props/house_3',
  'props/blacksmith',
  'props/bell_tower',
]);

/** Below this the axes are already even enough to leave alone. */
const EQUAL_ENOUGH = 0.02;

export type EqualizeMode =
  /**
   * Make the two horizontal axes equal at their geometric mean, so the
   * building keeps its height AND its footprint AREA exactly and only the
   * distortion between width and depth goes. This is "keep the overall scale,
   * just even it out", and it moves each building the least.
   */
  | 'preserve-footprint'
  /**
   * Snap all the way back to the model's authored proportions (every axis
   * multiplier 1). The building then looks exactly like the kit model at its
   * current height, but its footprint changes, which can open a gap against a
   * neighbour or a fence line that was drawn to the fitted size.
   */
  | 'natural';

export interface EqualizePlan {
  index: number;
  assetId: string;
  name?: string;
  from: { scaleX: number; scaleY: number; scaleZ: number };
  to: { scaleX: number; scaleY: number; scaleZ: number };
}

export interface EqualizeOptions {
  mode?: EqualizeMode;
  /** Which placements are eligible. Defaults to the kit buildings. */
  assetIds?: ReadonlySet<string>;
  /** Restrict to these document indexes (a selection). Absent = the whole map. */
  indexes?: Iterable<number>;
}

function axisScales(placement: MapPlacement): { x: number; y: number; z: number } {
  return { x: placement.scaleX ?? 1, y: placement.scaleY ?? 1, z: placement.scaleZ ?? 1 };
}

function isSquished(scales: { x: number; y: number; z: number }): boolean {
  const max = Math.max(scales.x, scales.y, scales.z);
  const min = Math.min(scales.x, scales.y, scales.z);
  return max - min > EQUAL_ENOUGH;
}

/**
 * What equalizing would change, without changing it. Separated so the caller
 * can show a count, push ONE undo step, and skip the work when nothing matches.
 */
export function planScaleEqualize(
  placements: readonly MapPlacement[],
  options: EqualizeOptions = {},
): EqualizePlan[] {
  const mode = options.mode ?? 'preserve-footprint';
  const eligible = options.assetIds ?? EQUALIZABLE_BUILDING_ASSET_IDS;
  const scope =
    options.indexes === undefined
      ? placements.map((_, index) => index)
      : [...options.indexes].filter((index) => index >= 0 && index < placements.length);
  const plans: EqualizePlan[] = [];
  for (const index of scope) {
    const placement = placements[index];
    if (!eligible.has(placement.assetId)) continue;
    const from = axisScales(placement);
    if (!isSquished(from)) continue;
    // The horizontal mean. Sizing both axes to it keeps width*depth, and so
    // the footprint area, and so the volume, since y is untouched, identical.
    const horizontal = Math.sqrt(Math.max(from.x * from.z, 1e-9));
    const to =
      mode === 'natural'
        ? { scaleX: 1, scaleY: 1, scaleZ: 1 }
        : { scaleX: horizontal, scaleY: from.y, scaleZ: horizontal };
    if (
      Math.abs(to.scaleX - from.x) < 1e-6 &&
      Math.abs(to.scaleY - from.y) < 1e-6 &&
      Math.abs(to.scaleZ - from.z) < 1e-6
    ) {
      continue;
    }
    plans.push({
      index,
      assetId: placement.assetId,
      name: placement.name,
      from: { scaleX: from.x, scaleY: from.y, scaleZ: from.z },
      to,
    });
  }
  return plans;
}

/** Apply a plan in place. Returns the number of placements changed. */
export function applyScaleEqualize(
  placements: MapPlacement[],
  plans: readonly EqualizePlan[],
): number {
  for (const plan of plans) {
    const placement = placements[plan.index];
    if (!placement || placement.assetId !== plan.assetId) continue;
    placement.scaleX = plan.to.scaleX;
    placement.scaleY = plan.to.scaleY;
    placement.scaleZ = plan.to.scaleZ;
  }
  return plans.length;
}
