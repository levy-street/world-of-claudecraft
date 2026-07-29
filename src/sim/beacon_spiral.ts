// The Old Beacon's outside stair: two flights of stone treads butted
// straight against the tower column (no gap between stair and drum), each
// topping out onto a wide C balcony that keeps hugging the tower: the
// first partway up, the second higher still. The whole climb lays out
// around ONE turn of unwrapped angle (the lift field is single-valued), so
// flight one, balcony one, flight two, and balcony two share the circle,
// with the mouth left open over the stair foot. WALKABLE raised ground,
// the Sowfield grandstand idiom: groundHeight ADDS beaconSpiralLift, and
// render/gale_features.ts draws the slab geometry from the same samples,
// so the deck the player stands on is exactly the deck they see. The
// tower's own column is an unwalkable core plug (a sheer terrain riser the
// climb gate refuses), which is also what keeps players from walking
// through the lighthouse at ground level. Pure leaf: deterministic, no
// SimContext, tested directly by tests/beacon_spiral.test.ts.

export const BEACON_SPIRAL = {
  x: 498,
  z: 308,
  /** the tower column: an unwalkable plug out to this radius */
  coreR: 2.9,
  /** the plug's sheer height (never stood on, only refused) */
  coreH: 45,
  /** stair outer radius; the inner edge is the column itself (coreR) */
  stairOut: 6.5,
  /** where the stair leaves the lawn (radians, atan2(dx, dz) convention) */
  a0: 2.4,
  /** deck heights of the two balconies (flight tops) */
  deck1: 9.5,
  deck2: 19,
  /** the climb's angular plan, unwrapped from the foot (fractions of 2PI);
   * the top balcony takes the largest share, wrapping far around the tower,
   * but stops well short of the full turn: the mouth over the stair foot
   * must stay wide, or the balcony's rim stands as an invisible wall right
   * beside the first treads and pinches the approach */
  flight1End: Math.PI * 2 * 0.3,
  balcony1End: Math.PI * 2 * 0.42,
  flight2End: Math.PI * 2 * 0.76,
  balcony2End: Math.PI * 2 * 0.94,
  /** balcony outer radius (both balconies reach wider than the stair) */
  balconyOut: 7.2,
} as const;

/**
 * Deck height at unwrapped angle a in [0, balcony2End] (0 = the stair
 * foot on the lawn); 0 for any angle past the balcony-two mouth. Both
 * flights climb as plain even ramps (the climb gate leaves no headroom
 * for an eased profile's steeper middle), landing flat a hair early so
 * each meets its balcony level.
 */
export function beaconDeckHeightAt(a: number): number {
  const s = BEACON_SPIRAL;
  if (a <= s.flight1End) {
    const t = a / s.flight1End;
    return s.deck1 * Math.min(1, t / 0.98);
  }
  if (a <= s.balcony1End) return s.deck1;
  if (a <= s.flight2End) {
    const t = (a - s.balcony1End) / (s.flight2End - s.balcony1End);
    return s.deck1 + (s.deck2 - s.deck1) * Math.min(1, t / 0.98);
  }
  if (a <= s.balcony2End) return s.deck2;
  return 0;
}

/**
 * The raised-deck lift at (x, z): 0 away from the Beacon, the plug height
 * over the tower column, and the two-flight climb profile on the stair
 * bands and balconies.
 */
export function beaconSpiralLift(x: number, z: number): number {
  const s = BEACON_SPIRAL;
  const dx = x - s.x;
  const dz = z - s.z;
  const gate = s.balconyOut + 0.6;
  const d2 = dx * dx + dz * dz;
  if (d2 >= gate * gate) return 0;
  const d = Math.sqrt(d2);
  if (d < s.coreR) return s.coreH; // the tower column
  // unwrapped angle from the foot, 0..2PI
  let a = Math.atan2(dx, dz) - s.a0;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a > s.balcony2End) return 0; // the mouth over the stair foot
  const onBalcony =
    (a > s.flight1End && a <= s.balcony1End) || (a > s.flight2End && a <= s.balcony2End);
  if (d > (onBalcony ? s.balconyOut : s.stairOut)) return 0;
  return beaconDeckHeightAt(a);
}
