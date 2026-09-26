// The heading a revived body lands with. A revive that puts the body back where the
// spirit already stands (corpse resurrection, the Spirit Healer, an accepted
// resurrection whose caster stands on the corpse, a dev or moderator revive in place)
// is not a teleport: the player keeps the heading they were running with, so a held
// movement key and the follow camera carry straight on instead of snapping the body to
// face +Z (north). An instance re-entry also lands in place, but the dungeon entry has
// already zeroed the heading before the revive (instances/dungeons.ts), so it keeps
// that 0. Only a revive that actually displaces the body (the /unstuck graveyard revive
// from anywhere but the graveyard itself, a summon to another spot) resets the heading,
// paired with prevFacing so the render-interpolated facing lands cleanly.
//
// Online, the server re-applies the client's own heading on the next input frame
// (server/movement_input_timeline_v2.ts), so the north snap was mostly an offline and
// headless symptom; this rule makes all three hosts land the same way.

/** Two landing points closer than this on the ground plane count as the same spot. */
export const REVIVE_IN_PLACE_EPSILON = 0.01;

export interface ReviveFacing {
  facing: number;
  prevFacing: number;
}

export function reviveFacing(
  current: ReviveFacing,
  from: { x: number; z: number },
  to: { x: number; z: number },
): ReviveFacing {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const inPlace = dx * dx + dz * dz <= REVIVE_IN_PLACE_EPSILON * REVIVE_IN_PLACE_EPSILON;
  if (inPlace && Number.isFinite(current.facing)) {
    return { facing: current.facing, prevFacing: current.facing };
  }
  return { facing: 0, prevFacing: 0 };
}
