// Pure, DOM-free core for the death screens (registered in UI_PURE_CORES): which of
// the death surfaces show this frame. Hud.update paints the result through its
// write-elided setDisplay; this decides, it never touches the DOM.
//
// - A fresh corpse (dead, spirit not released) gets the full-screen Release
//   overlay (a corpse cannot move, so a modal is fine), suppressed in an arena
//   match. A battleground corpse releases like the open world, so it shows there.
// - The overlay's PvP Resurrect button shows only while the corpse carries the
//   offer (Entity.pvpResurrect, src/sim/pvp/pvp_resurrect.ts); the server
//   re-checks every condition.
// - A ghost runs FREELY: the world drains to greyscale (spiritMode), a standing
//   hint line names both ways back, and a small prompt offers Resurrect at Corpse
//   only within the corpse reach. Both are suppressed in a battleground match,
//   where the wave is the one way back.
// - The Death Recap stays reachable for the WHOLE ghost run (a battleground
//   ghost included): releasing hides the corpse overlay and its Recap button, so
//   a small standalone button takes over until the player is alive again.
//
// Allocation-light: the caller owns one view from createDeathPromptView() and
// this rewrites its fields in place every frame.

import { CORPSE_REZ_RANGE } from '../../../sim/spirit';

export interface DeathPromptView {
  /** The greyscale spirit world (the body's spirit-mode class). */
  spiritMode: boolean;
  /** The Release overlay for a fresh corpse. */
  overlay: boolean;
  /** The overlay's PvP Resurrect button. */
  pvpResurrect: boolean;
  /** The ghost's standing "ways back" hint line. */
  ghostHint: boolean;
  /** The ghost's Resurrect at Corpse prompt (corpse in reach). */
  ghostPrompt: boolean;
  /** The ghost's Death Recap button (the whole spirit run). */
  ghostRecap: boolean;
}

export function createDeathPromptView(): DeathPromptView {
  return {
    spiritMode: false,
    overlay: false,
    pvpResurrect: false,
    ghostHint: false,
    ghostPrompt: false,
    ghostRecap: false,
  };
}

/** Decide the death surfaces for this frame into `out` (reused, never reallocated). */
export function updateDeathPromptView(
  out: DeathPromptView,
  dead: boolean,
  ghost: boolean,
  inArenaMatch: boolean,
  inBgMatch: boolean,
  pos: { x: number; z: number },
  corpsePos: { x: number; z: number } | null,
  pvpResurrectOffered: boolean,
): DeathPromptView {
  const spirit = dead && ghost;
  const corpse = dead && !ghost && !inArenaMatch;
  out.spiritMode = spirit;
  out.overlay = corpse;
  out.pvpResurrect = corpse && pvpResurrectOffered;
  out.ghostHint = spirit && !inBgMatch;
  out.ghostPrompt =
    spirit &&
    !inBgMatch &&
    corpsePos !== null &&
    Math.hypot(pos.x - corpsePos.x, pos.z - corpsePos.z) <= CORPSE_REZ_RANGE;
  out.ghostRecap = spirit;
  return out;
}
