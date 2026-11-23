// Firestorm's wall of flame on screen (Elemental Fusion of the Heat and the
// Breath; the painter is final_firestorm_fx.ts, a part of FinalElementsFx).
// Jose's playtest of 2026-11-23 read the old wall (a row of flat flame cards
// and sprite blobs bobbing as one) as "not AAA". The plan:
//   - the wall: stacked curtains of animated fire standing across the lane at
//     the sim's front, a smoky dark body under them, tongues leaping off it,
//     smoke rolling off its tips, embers swirling up and sparks flung ahead,
//     a heat haze over it; it leans back from the way it runs;
//   - the trail: the lane behind the front keeps burning low (the sim still
//     strikes anyone it has not struck between the lane's start and its
//     front), dying down with distance, and goes out the moment the sim's lane
//     ends, leaving only a char that fades;
//   - the floor: a molten seam at the wall's foot, the floor lit ahead of it,
//     the burnt lane behind with glowing cracks, and one crisp hot line on
//     each of the lane's two edges (the danger edge, on EVERY tier).
//
// Binding (readability): the wall never stands past the sim's front (the sim
// strikes from the lane's start to `front`, `half` either side), its sheets
// span exactly the lane's width, and nothing is drawn off the Anvil's floor.
// Every time and size is the sim's (final_elements_ids.ts ELEMENT_TUNING) or
// the lane's own template; nothing here is tuned against the sim.
//
// Three-free, DOM-free, deterministic.

/** The look's numbers (yards and seconds). */
export const FIRESTORM_LOOK = {
  /** The wall's fire height (about three players), its tongues' reach. */
  height: 7.2,
  tongue: 9.5,
  /** The sheets' depth behind the front (yards): the front sheet stands ON
   *  the front, the rest behind it inside the burnt lane. */
  sheetBack: [0, 1.8, 3.9] as readonly number[],
  /** The low fire still burning down the lane behind the wall: its height at
   *  the wall's heel and the run (yards) over which it dies down to a lick. */
  trailHeight: 2.6,
  trailRun: 34,
  /** The wall's heel: the fire still tall for a few yards behind the front
   *  (the wall's body read from the side), dying away over `heelRun`. */
  heelHeight: 4.6,
  heelRun: 6,
  /** Its least height far behind the front (the lane still burns). */
  trailFloor: 0.45,
  /** The floor lit ahead of the wall (yards), the molten seam's depth. */
  lightAhead: 7,
  seamBack: 3.2,
  /** How fast the wall stands up out of the floor (seconds), and how fast it
   *  goes out once it reaches the lane's end. */
  rise: 0.22,
  fallOut: 0.3,
  /** The char left once the lane goes (seconds to fade). */
  charFade: 2.2,
  /** The ground samples across the lane the sheets stand on. */
  groundSamples: 9,
  /** The burnt lane's floor grid: rows across, yards per step along. */
  floorAcross: 10,
  floorStep: 1.5,
  /** The trail curtains' steps along the lane (yards). */
  trailStep: 1.25,
} as const;

/** The low tier's share of the cosmetic layers (the wall's fire, its dark
 *  body, the trail's fire and the floor with its danger edge stay on every
 *  tier; only richness is shed). */
export function firestormBudget(detail: boolean): {
  sheets: number;
  tongues: number;
  embers: number;
  trailSheets: number;
  smoke: boolean;
  haze: boolean;
} {
  return detail
    ? { sheets: 3, tongues: 56, embers: 520, trailSheets: 3, smoke: true, haze: true }
    : { sheets: 2, tongues: 18, embers: 140, trailSheets: 2, smoke: false, haze: false };
}

/** The wall's state `since` seconds into the sim's burn, on a lane `length`
 *  yards long run in `run` seconds: its front (the sim's own: laneFront),
 *  how far it stands (0..1), how hot. */
export interface FirestormWallLook {
  front: number;
  rise: number;
  heat: number;
  /** The trail's fire (1 while the sim's lane lives, out after it). */
  trail: number;
}

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

export function firestormWall(
  since: number,
  length: number,
  run: number,
  out: FirestormWallLook = { front: 0, rise: 0, heat: 0, trail: 0 },
): FirestormWallLook {
  const L = FIRESTORM_LOOK;
  const r = Math.max(0.1, run);
  out.front = since <= 0 ? 0 : Math.min(length, (length / r) * since);
  const over = since - r;
  const up = smooth(since / L.rise);
  const down = over <= 0 ? 1 : 1 - smooth(over / L.fallOut);
  out.rise = up * down;
  out.heat = 0.85 + 0.15 * up;
  out.trail = down;
  return out;
}

/** The trail's fire height `behind` yards behind the front (0 at the heel):
 *  tall at the wall's heel (its body from the side), dying down along the
 *  run, never quite out while the lane lives. */
export function firestormTrailHeight(behind: number): number {
  const L = FIRESTORM_LOOK;
  if (behind < 0) return 0;
  const k = Math.min(1, behind / L.trailRun);
  return (
    L.trailFloor +
    (L.trailHeight - L.trailFloor) * (1 - k) ** 2 +
    L.heelHeight * Math.exp(-behind / L.heelRun)
  );
}

/** The char's opacity `gone` seconds after the sim's lane went (1 then 0). */
export function firestormChar(gone: number): number {
  if (gone <= 0) return 1;
  return 1 - smooth(gone / FIRESTORM_LOOK.charFade);
}

/** Is (x, z) on the Anvil's floor (the room's disc, `r` round its centre)?
 *  The wall and its floor are clipped to it: a rim-to-rim lane never draws
 *  fire over the chasm. Soft over its last yard: 1 inside, 0 out. */
export function firestormOnFloor(x: number, z: number, cx: number, cz: number, r: number): number {
  const d = Math.hypot(x - cx, z - cz);
  return 1 - smooth((d - (r - 1)) / 1);
}
