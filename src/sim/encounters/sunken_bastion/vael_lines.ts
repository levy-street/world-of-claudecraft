// What Vael the Fogbinder says: Death itself, grim and sparse. Sim English,
// re-localized on the client by the EXACT matcher (the log.sunkenBastionVael*
// rows in src/ui/sim_i18n.ts), the boss-yell precedent Morthen's entrance set.
// Each line is a yell to everyone near him (mob/yells.ts).

import { emitMobYell } from '../../mob/yells';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

/** His entrance: one line at each rise round the Fogbeacon, the last at his place. */
export const VAEL_INTRO_LINES: readonly string[] = [
  'More of the living, climbing to my crown.',
  'The sea took this fortress. I took what the sea left.',
  'Every light goes out in the fog. Every voyage ends with me.',
  'Come, then. This crown will be your grave.',
];

/** The short entrance after a wipe: he rises at his place once. */
export const VAEL_RETURN_LINE = 'Back again? Your graves are still open.';

/** Before each Fog Veil, while the fog gathers: the warning that teaches the
 *  beam (the first veil spells it out, the second only reminds). */
export const VAEL_VEIL_LINES: readonly string[] = [
  'Lose me in the fog. Only the beacon will find my face.',
  'The fog again. Follow the light, or drown.',
];

/** A Vael line, loud enough to carry over the whole crown. */
export function vaelSay(ctx: SimContext, boss: Entity, text: string): void {
  emitMobYell(ctx, boss, text, 80);
}
