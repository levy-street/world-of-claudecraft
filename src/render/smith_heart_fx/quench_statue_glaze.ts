// The Guardian of the Quench's death frost on her own body: her effects
// (quench_body.ts, which knows when she fell) hold the glaze here each frame
// (quench_body_core.ts quenchStatueGlaze: the rime climbing her from the feet
// into a statue), and the renderer's body tints (../character_effects.ts
// applyCharacterBodyTints) paint it through the same surface program the
// fight's cold already paints on the raid (characters/surface_response.ts), so
// nothing new is prepared for the GPU. One guardian at a time; no allocation.

import type { QuenchGlaze } from './quench_glaze_core';

let heldId = -1;
const held: QuenchGlaze = { height: 0, glow: 0, bite: 0, alpha: 0 };

/** Hold `glaze` on entity `id` (null releases it). Copied, never kept. */
export function holdQuenchStatueGlaze(id: number, glaze: QuenchGlaze | null): void {
  if (!glaze) {
    if (heldId === id) heldId = -1;
    return;
  }
  heldId = id;
  held.height = glaze.height;
  held.glow = glaze.glow;
  held.bite = glaze.bite;
  held.alpha = glaze.alpha;
}

/** The statue glaze held on entity `id`, or null. */
export function quenchStatueGlazeFor(id: number): QuenchGlaze | null {
  return heldId === id ? held : null;
}
