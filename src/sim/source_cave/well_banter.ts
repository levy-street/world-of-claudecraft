// The Source Cave well's interaction gate: the well does not teleport the
// player in on the first touch. It banters instead, one line per interaction,
// and only opens on the interaction past the last line. Session-only (the tap
// count lives on PlayerMeta, never serialized/persisted, per D-well below), so
// every fresh login gets the full sequence again, but once a player has run it
// once THIS session the well opens immediately from then on (no replay).
//
// The banter itself carries no gameplay meaning (no gating of level/lockout):
// the real enterSourceCave() check (level 20, daily lockout) still runs on the
// interaction that finally opens the well, so an ineligible player can "waste"
// the whole sequence and still be denied at the end, same as walking up to any
// other dungeon door under-level.

import type { SimContext } from '../sim_context';
import { enterSourceCave } from './dungeon';
import { SOURCE_CAVE_DOOR_ID } from './runtime';

/** One line per interaction, in order; the interaction AFTER the last line opens the well. */
export const SOURCE_CAVE_WELL_BANTER_LINES: readonly string[] = [
  "It's a well. It holds water. Move along.",
  'Why are you looking at my bricks like that?',
  "I'm an ordinary well! Look, I even have a bucket!",
  'Still just a well. Nothing magical to see.',
  'Who told you about the source? Was it Claude?',
  "Oh, you definitely don't want to go down there.",
  'Security! The player is trying to break into the source code!',
  "That's a source of conflict down there, you know.",
  'If I open, will you finally leave me alone?',
  'Alright, step inside. Wipe your boots first.',
];

/**
 * Handle one interaction with the Source Cave's overworld well. Bumps the
 * player's session-only tap count and banters until it passes the line count,
 * then defers to the real entry check every time after (no re-arming this
 * session, per the user's decision).
 *
 * Emitted as a personal (`pid`-scoped) `log` event carrying the well's own
 * `entityId`, the exact shape the Nythraxis quest-vision lines already use
 * (encounters/nythraxis.ts's emitQuestObjectVision) to hang a speech bubble
 * over a specific entity for one player only: hud.ts recognizes each banter
 * line by its raw English text and shows it as a chat bubble over the well
 * instead of (or ahead of) the small chat-log line, with no "X yells, ..."
 * wrapper and no broadcast to nearby players.
 */
export function interactWithSourceCaveWell(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.meta.sourceCaveWellTaps >= SOURCE_CAVE_WELL_BANTER_LINES.length) {
    enterSourceCave(ctx, pid);
    return;
  }
  const line = SOURCE_CAVE_WELL_BANTER_LINES[r.meta.sourceCaveWellTaps];
  r.meta.sourceCaveWellTaps++;
  ctx.emit({
    type: 'log',
    text: line,
    color: '#b9f',
    pid: r.meta.entityId,
    entityId: SOURCE_CAVE_DOOR_ID,
  });
}
