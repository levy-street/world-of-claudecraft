// The progression gate for the one-time Ravenpost welcome letter (#3560
// follow-up). The letter used to book at character creation, which minted an
// immortal letter for every rolled-and-abandoned character; the design rule
// now is that system letters trigger on progression or attendance, never on
// account existence. The welcome books the first time a character stands at
// WELCOME_LETTER_LEVEL or above with the flag unset, whichever path got them
// there:
//   - the natural ding (combat/damage.ts grantXp),
//   - a dev/GM level jump (Sim.setPlayerLevel),
//   - joining with a restored save already past the gate (Sim.addPlayer):
//     this is what keeps the letter doubling as the service announcement for
//     characters saved before mail existed, exactly as the creation-time send
//     did.
// Bots never reach the send: addPlayer pre-flips meta.mailWelcomed for them.
// The flag flips BEFORE the send (the established re-entrancy idiom), and the
// booking draws no rng, so the gate cannot fork the shared draw stream.

import { WELCOME_LETTER } from '../content/letters';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

export const WELCOME_LETTER_LEVEL = 6;

/** Book the welcome letter if this character just became eligible. Returns
 *  whether the letter was booked (callers do not branch on it; tests do). */
export function maybeSendLevelWelcome(
  ctx: Pick<SimContext, 'mailAuthoredLetter'>,
  meta: PlayerMeta,
  level: number,
): boolean {
  if (meta.mailWelcomed || level < WELCOME_LETTER_LEVEL) return false;
  meta.mailWelcomed = true;
  ctx.mailAuthoredLetter(meta, WELCOME_LETTER);
  return true;
}
