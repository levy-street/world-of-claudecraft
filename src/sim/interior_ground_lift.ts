// The instanced interiors that stand on their own floor rather than the flat room
// floor plus its boss dais (dungeon_floor.ts): the open fields' sculpted heights
// (Wildheart Basin, the Fire and Fly arena) and the authored per-room lifts of the
// Last Keep and Dawnhold Castle, whose risers and stairs the renderer builds from the
// same functions. Each lift is instance-local, above DUNGEON_FLOOR_Y. Pure leaf.

import { dawnholdKeepLiftAt, lastKeepLiftAt } from './dungeon_layout';
import { fireAndFlyFieldHeight } from './fire_and_fly_field';
import type { DungeonDef } from './types';
import { wildheartFieldHeight } from './wildheart_field';

type InteriorGroundLift = (localX: number, localZ: number) => number;

const LIFTS: Readonly<Partial<Record<DungeonDef['interior'], InteriorGroundLift>>> = {
  wildheart: wildheartFieldHeight,
  fire_and_fly: fireAndFlyFieldHeight,
  lastkeep: lastKeepLiftAt,
  dawnhold: dawnholdKeepLiftAt,
};

/** The interior's own ground lift, or undefined for a flat room floor. */
export function interiorGroundLift(
  interior: DungeonDef['interior'],
): InteriorGroundLift | undefined {
  return Object.hasOwn(LIFTS, interior) ? LIFTS[interior] : undefined;
}
