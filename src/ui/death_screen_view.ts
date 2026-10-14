// Which death-screen surfaces show for the local player, and when the Release Spirit
// action starts accepting input. A fresh corpse gets the full-screen Release overlay
// (suppressed in arena); a ghost runs freely with a standing hint line, plus the
// corpse prompt once in reach of its body. A battleground ghost gets neither: the
// respawn wave is its only way back.

import { dist2d, type Entity } from '../sim/types';

// Mirrors CORPSE_REZ_RANGE in src/sim/spirit.ts. The server re-validates the range;
// this only decides whether the corpse prompt is shown, so keep the two in sync.
export const GHOST_CORPSE_REZ_RANGE = 35;

// A press already on its way when the player died (a gamepad confirm, whose focus
// lands on Release the moment the overlay opens; a click aimed at the fight behind
// it) would otherwise release the spirit before the death screen is ever seen.
export const DEATH_SCREEN_INPUT_HOLD_MS = 500;

export interface DeathScreenView {
  spiritMode: boolean;
  releaseOverlay: boolean;
  ghostHint: boolean;
  ghostPrompt: boolean;
}

export function createDeathScreenView(): DeathScreenView {
  return { spiritMode: false, releaseOverlay: false, ghostHint: false, ghostPrompt: false };
}

// Rewrites a caller-owned view in place (it runs every painted frame).
export function deathScreenViewInto(
  view: DeathScreenView,
  player: Pick<Entity, 'dead' | 'ghost' | 'pos' | 'corpsePos'>,
  inArenaMatch: boolean,
  inBattlegroundMatch: boolean,
): DeathScreenView {
  const ghost = player.dead && player.ghost;
  const ghostRun = ghost && !inBattlegroundMatch;
  view.spiritMode = ghost;
  view.releaseOverlay = player.dead && !ghost && !inArenaMatch;
  view.ghostHint = ghostRun;
  view.ghostPrompt =
    ghostRun &&
    !!player.corpsePos &&
    dist2d(player.pos, player.corpsePos) <= GHOST_CORPSE_REZ_RANGE;
  return view;
}

export interface DeathScreenInputHold {
  overlayShown: boolean;
  readyAtMs: number;
}

export function createDeathScreenInputHold(): DeathScreenInputHold {
  return { overlayShown: false, readyAtMs: 0 };
}

// Also called on every own-death event: a revive and a second death can land between
// two snapshots, leaving the overlay up the whole time with no new opening.
export function holdDeathScreenInput(hold: DeathScreenInputHold, nowMs: number): void {
  hold.readyAtMs = Math.max(hold.readyAtMs, nowMs + DEATH_SCREEN_INPUT_HOLD_MS);
}

export function noteReleaseOverlayShown(
  hold: DeathScreenInputHold,
  shown: boolean,
  nowMs: number,
): void {
  if (shown && !hold.overlayShown) holdDeathScreenInput(hold, nowMs);
  hold.overlayShown = shown;
}

export function deathScreenInputReady(hold: DeathScreenInputHold, nowMs: number): boolean {
  return nowMs >= hold.readyAtMs;
}
