// The live size of the nameplate dot row, 0 meaning "draw no row".
//
// It lives here rather than as a field on the renderer for the reason the
// monolith ratchet exists: renderer.ts was carrying it only to hand it straight
// to the nameplate painter, and a pass-through field in a coordinator at its
// line ceiling is exactly the thing that should be a sibling module instead. The
// painter reads it by default and still accepts an injected reader, so a test
// drives it without touching this state.
//
// One number, not two: the showNameplateDots toggle and the nameplateDotScale
// slider are folded together by Settings.nameplateDotRenderScale() before they
// reach here (main.ts applies it on boot, on either setting's change, and on a
// renderer rebuild), so nothing downstream has to ask whether the row is on.

import { NAMEPLATE_DOT_SCALE_MIN } from './nameplate_dots_core';

let current = NAMEPLATE_DOT_SCALE_MIN;

/** Apply the folded setting. Non-finite input reads as off rather than as some
 *  arbitrary size: a corrupt stored value must not paint a row. */
export function setNameplateDotScale(scale: number): void {
  current = Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/** The live size for the painter; 0 means the row is off. */
export function nameplateDotScale(): number {
  return current;
}
