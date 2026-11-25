// The Wind Bridge's look, pure (breath_bridge_fx.ts paints it; the sim is
// encounters/smith_heart/breath_bridge.ts). A walkable path of packed,
// swirling cloud over the chasm, its edges bound by running strands of wind,
// slightly translucent: it reads as a floor, never a beam. It forms over
// BRIDGE_TUNING.form seconds when its object appears and dissolves over
// `dissolve` when it goes (the pull), breaking up from its edges inward;
// nothing of it is drawn once dissolved. The same on every tier.

import {
  BREATH,
  CORNICE_BRIDGE,
  CORNICE_LANDING,
  CORNICE_WEST_CUT,
} from '../../sim/content/smith_heart_layout';
import { BRIDGE_TUNING } from '../../sim/encounters/smith_heart/breath_bridge_ids';

/** The path's look: its deck's opacity at whole, how far its side curtains
 *  hang under the deck (yards), and the deck's cells along and across. */
export const BRIDGE_LOOK = {
  opacity: 0.82,
  curtain: 1.6,
  along: 40,
  across: 6,
} as const;

/** The bridge's deck in instance-local yards: its middle, length (along x)
 *  and width. It is drawn over the chasm alone, a yard onto each rim (the
 *  landing's and the Cornice's own floors carry the rest of its strip). */
export function bridgeDeck(): { x: number; z: number; length: number; width: number } {
  const B = CORNICE_BRIDGE;
  const C = BREATH.cornice;
  const west = CORNICE_LANDING.x + CORNICE_LANDING.r - 1.5;
  const east = C.x - C.rx + CORNICE_WEST_CUT.cut + 1.5;
  return {
    x: (west + east) / 2,
    z: B.from.z,
    length: east - west,
    width: B.halfWidth * 2,
  };
}

/** One frame of the bridge's form (0 gone, 1 whole): toward whole over
 *  `form` seconds while it stands (`up`), toward gone over `dissolve` while
 *  it does not. Pure. */
export function stepBridgeForm(form: number, up: boolean, dt: number): number {
  const T = BRIDGE_TUNING;
  return up ? Math.min(1, form + dt / T.form) : Math.max(0, form - dt / T.dissolve);
}

/** Is anything of it drawn at form `f`? (Nothing once dissolved: no light,
 *  no strand, no mote in the fight.) */
export function bridgeShown(f: number): boolean {
  return f > 0.001;
}
