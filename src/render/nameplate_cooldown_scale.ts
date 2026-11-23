// The live size of the enemy cooldown row on hostile player nameplates, 0 meaning
// "draw no row". A sibling module rather than a renderer field for the reason
// nameplate_dot_scale.ts gives: the renderer only handed it to the painter. The
// painter reads it by default and accepts an injected reader for tests.
//
// One number: the showNameplateCooldowns toggle and the nameplateCooldownScale
// slider fold together in Settings.nameplateCooldownRenderScale() before they
// reach here (main.ts applies it on boot, on either setting's change, and on a
// renderer rebuild).

import { NAMEPLATE_COOLDOWN_SCALE_MIN } from './nameplate_cooldowns_core';

let current = NAMEPLATE_COOLDOWN_SCALE_MIN;

/** Apply the folded setting. Non-finite input reads as off. */
export function setNameplateCooldownScale(scale: number): void {
  current = Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/** The live size for the painter; 0 means the row is off. */
export function nameplateCooldownScale(): number {
  return current;
}
