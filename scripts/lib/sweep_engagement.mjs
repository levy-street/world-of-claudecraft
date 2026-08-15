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

/**
 * The effect types that count as damage. Shared with the sweep so the standoff rule
 * and the sweep's own rotation filter can never disagree about what a damaging
 * ability is (a divergence would silently evaluate the standoff over a different kit
 * than the one being measured).
 */
export const DAMAGE_EFFECTS = new Set([
  'aoeDamage',
  'aoeRoot',
  'directDamage',
  'dot',
  'drainTick',
  'finisherDamage',
  'groundAoE',
  'weaponDamage',
  'weaponStrike',
]);

/** Where a class with no minimum-range ability stands. */
export const MELEE_REACH = 2.25;

/** Yards inside which the mover treats itself as already on station. */
export const STATION_DEAD_BAND = 0.05;

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

/**
 * Move a character toward its engagement distance, closing OR backing off.
 *
 * The sweep's old mover only ever closed, which is what parked a hunter inside its
 * own dead zone. The back-off arm is the new half, so the sign is load-bearing: an
 * inverted sign walks the character to zero range and reproduces the exact defect
 * this rule exists to fix, with every other assertion still green.
 *
 * Mutates `pos` in place, like the sim does.
 *
 * @param {{ pos: { x: number, z: number }, castingAbility?: unknown }} mover
 * @param {{ pos: { x: number, z: number } }} target
 * @param {number} reach desired yards from the target
 * @param {number} speed yards per second
 * @param {number} ticksPerSecond
 */
export function station(mover, target, reach, speed, ticksPerSecond) {
  const dx = target.pos.x - mover.pos.x;
  const dz = target.pos.z - mover.pos.z;
  const dist = Math.hypot(dx, dz);
  // At exactly zero separation there is no direction to move along.
  if (dist === 0 || mover.castingAbility) return;
  const gap = dist - reach;
  // Dead band, so a character on station does not jitter back and forth forever.
  if (Math.abs(gap) < STATION_DEAD_BAND) return;
  const step = Math.sign(gap) * Math.min(Math.abs(gap), speed / ticksPerSecond);
  mover.pos.x += (dx / dist) * step;
  mover.pos.z += (dz / dist) * step;
}

/**
 * Who a sweep damage event belongs to.
 *
 * A controlled pet's damage is its owner's on every real meter, but only for the
 * measured player's OWN pet: crediting any non-player source would fold a third
 * party's pet or an environmental hit into the reading.
 *
 * @returns {'player' | 'pet' | null} null when the event is not the player's
 */
export function attributeSweepDamage(sourceId, pid, source) {
  if (sourceId === pid) return 'player';
  if (source && source.kind === 'mob' && source.ownerId === pid) return 'pet';
  return null;
}
