// Full-rate sun shadows around a ship under way. Under render-budget pressure
// the shadow map sheds to every other frame (shadow_cadence_core.ts), which is
// invisible for a still world but not for the one big caster that moves every
// frame: on the frames between, a sailing ship's own shadows (rigging and
// masts across its sails and deck) sit where the ship was a frame ago, then
// snap back on the next, a 30 Hz flicker over the whole ship. That is only
// resolvable up close, so the hold is narrow: the local player rides a ship
// under way, or one sails within SHIP_SHADOW_REACH of the key light's target
// (the player). A moored ship never holds: nothing moves. The renderer passes
// the answer to the cadence core as its hold input. Reads the deck frame's
// drawn ships (deck_frame.ts), every route.

import { peekDeckFrame } from './deck_frame';

/** How close a ship under way must be to the light's target (the player) to
 *  hold (yards): half the hull's length plus its masts' shadows on the deck
 *  and sails at a readable size. */
export const SHIP_SHADOW_REACH = 60;

/** Whether a ship under way is close enough that a stale shadow map would
 *  flicker its own shadows (see the header). */
export function shipShadowHold(
  world: object,
  light: { target: { position: { x: number; z: number } } },
): boolean {
  const df = peekDeckFrame(world);
  if (!df?.active) return false;
  const at = light.target.position;
  for (let i = 0; i < df.ships.length; i++) {
    const ship = df.ships[i];
    if (!ship.sailing || !ship.clock.ready) continue;
    if (i === df.selfRoute) return true;
    if (Math.hypot(ship.drawn.x - at.x, ship.drawn.z - at.z) <= SHIP_SHADOW_REACH) return true;
  }
  return false;
}
