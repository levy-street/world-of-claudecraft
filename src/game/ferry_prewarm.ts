// Which ferry destination is worth streaming in ahead of time.
//
// The Proving Shore crossing is a CLICKED bell (sim/interactions/ferry_bell.ts):
// click and you are on the far shore, and the crossing ALWAYS rides the
// blocking loading screen (main.ts's isIslandFerryTeleport arm; the town side
// is the whole harbor kit, whose building programs link across the first
// frames even when the zone is resident, so the curtain holds through the
// reveal settle instead of hitching in front of the player). Warming the far
// shore while the player is still walking up to the bell is what keeps that
// screen SHORT: the structural prepare is already done and the curtain only
// pays the link settle.
//
// The destination pairing is READ from the same content the sim rings: a bell
// on the island column sails to town, a bell in town sails to the island,
// exactly as tryRingFerryBell decides. There is no second copy of the rule.
//
// Pure and host-agnostic: no DOM, no renderer, no clock. The caller owns the
// once-per-destination latch and the actual prewarm call.

import { PROVING_SHORE_ARRIVAL, PROVING_SHORE_OBJECTS } from '../sim/content/proving_shore';
import { FERRY_BELL_OBJECT_ID, FERRY_BELL_TOWN_LANDING } from '../sim/interactions/ferry_bell';

/** How close the player must be to a bell before its far shore is warmed.
 *  Comfortably wider than the bell's own interaction reach, so an ordinary
 *  walk up to it leaves time for the stream to land. */
export const FERRY_PREWARM_RADIUS_YD = 45;

export interface FerryPrewarmTarget {
  /** A stable key for the caller's once-per-destination latch. */
  id: 'proving_shore' | 'eastbrook_town';
  x: number;
  z: number;
}

const BELLS: readonly { bellX: number; bellZ: number; target: FerryPrewarmTarget }[] =
  PROVING_SHORE_OBJECTS.filter((o) => o.itemId === FERRY_BELL_OBJECT_ID).flatMap((o) =>
    o.positions.map((p) => ({
      bellX: p.x,
      bellZ: p.z,
      // The sim's own side test: a bell west of the strait sails to town.
      target:
        p.x < -180
          ? ({
              id: 'eastbrook_town',
              x: FERRY_BELL_TOWN_LANDING.x,
              z: FERRY_BELL_TOWN_LANDING.z,
            } as const)
          : ({
              id: 'proving_shore',
              x: PROVING_SHORE_ARRIVAL.x,
              z: PROVING_SHORE_ARRIVAL.z,
            } as const),
    })),
  );

/** The far shore to warm for a player at (x, z), or null when no ferry bell is
 *  near enough to be worth the stream. */
export function ferryPrewarmTargetFor(x: number, z: number): FerryPrewarmTarget | null {
  for (const bell of BELLS) {
    if (Math.hypot(x - bell.bellX, z - bell.bellZ) <= FERRY_PREWARM_RADIUS_YD) return bell.target;
  }
  return null;
}
