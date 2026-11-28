// Who may step through the Smith's Heart's door while the raid is a phase 1
// blockout: dev builds only (ALLOW_DEV_COMMANDS, the same flag that gates
// /dev). A production world keeps the door shut with a plain line, so an
// unfinished raid can never be entered by players. Flip
// SMITH_HEART_PLAYABLE when the raid ships (design doc, "Shipping checklist").

import { SMITH_HEART_DUNGEON, SMITH_HEART_PLAYABLE } from '../../content/smith_heart';
import type { SimContext } from '../../sim_context';

export { SMITH_HEART_PLAYABLE };

/** The English refusal (re-localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const SMITH_HEART_CLOSED_TEXT = 'The cleft is choked with fallen rock. It is not open yet.';

/** May this world let anyone into `dungeonId`? True for every other dungeon. */
export function smithHeartEntryOpen(ctx: SimContext, dungeonId: string): boolean {
  if (dungeonId !== SMITH_HEART_DUNGEON) return true;
  return SMITH_HEART_PLAYABLE || ctx.devCommands;
}
