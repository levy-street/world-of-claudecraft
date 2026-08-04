// Where a damage sweep should stand its test character.
//
// The row-build sweep used to walk EVERY class to melee reach. That is harmless
// for a caster (no damaging spell in the game has a minimum range) but it silently
// broke the hunter, whose whole ranged kit carries `minRange: 8`: Auto Shot, Fell
// Shot, Venom Barb, Long Draw, Splitshot and Hushing Shot all refuse to fire inside
// eight yards, so the sweep was measuring a hunter as a bad melee class and
// reporting the result as its DPS.
//
// The rule below is deliberately narrow: a class stands at melee reach unless its
// own damaging kit declares a minimum range, so every class whose numbers were
// already correct keeps standing exactly where it stood.

/** Where a class with no minimum-range ability stands. */
export const MELEE_REACH = 2.25;

/**
 * Yards of clearance kept beyond the largest minimum range, so a small positional
 * jitter cannot drop the character back inside its own dead zone mid-run.
 */
export const DEAD_ZONE_MARGIN = 2;

/**
 * The distance a sweep should hold against its dummy.
 *
 * @param {Array<{ minRange?: number, range?: number }>} abilityDefs
 *   the damaging ability definitions the class knows at the tested level
 * @param {{ maxRange?: number } | null | undefined} rangedProfile
 *   the class `ranged` block, when it has one
 * @returns {number} yards from the dummy
 */
export function engagementDistance(abilityDefs, rangedProfile) {
  let floor = 0;
  for (const def of abilityDefs ?? []) {
    const min = def?.minRange ?? 0;
    if (min > floor) floor = min;
  }
  // No dead zone anywhere in the kit: melee reach, exactly as before.
  if (floor <= 0) return MELEE_REACH;

  const stand = floor + DEAD_ZONE_MARGIN;
  // Never step past the shortest ceiling the kit can actually reach at: the class
  // ranged cap and the shortest range among the abilities that declared the floor.
  let ceiling = rangedProfile?.maxRange ?? Number.POSITIVE_INFINITY;
  for (const def of abilityDefs ?? []) {
    if ((def?.minRange ?? 0) > 0 && typeof def?.range === 'number' && def.range > 0) {
      if (def.range < ceiling) ceiling = def.range;
    }
  }
  if (!Number.isFinite(ceiling)) return stand;
  // A kit whose ceiling sits under its own floor cannot be stood in at all; hold at
  // the floor rather than returning something inside the dead zone.
  return ceiling <= floor ? stand : Math.min(stand, ceiling);
}
