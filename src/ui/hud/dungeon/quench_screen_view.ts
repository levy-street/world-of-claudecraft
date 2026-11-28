// The Guardian of the Quench's screen effects: the pure, DOM-free view core
// (quench_screen_painter.ts paints it), read off the local player's own auras
// the sim already mirrors (encounters/smith_heart/quench_ids.ts):
//   - the frost: a frosty blue border that creeps in from the screen's edges
//     as the cold bar fills, reaching its deepest (frozen solid) at full; the
//     bar resets to zero as the player freezes, so the frozen aura holds the
//     border at full until the ice shatters;
//   - the water: a blue tint over the screen while the player is held in a
//     hole of freezing water (the trapped aura).
// Presentation only. The cold bar (quench_alert_view.ts) stays the gauge the
// player reads; the frost never covers the screen's middle and the overlay
// sits under every HUD frame, so it hides nothing the raid acts on.
// Allocation-free: one model, rewritten a frame.

import { QUENCH_AURAS, QUENCH_TUNING as T } from '../../../sim/encounters/smith_heart/quench_ids';

/** How finely the frost's reach steps (a hundredth of the border's travel),
 *  so a still bar writes nothing and a rising one writes once a step. */
export const QUENCH_FROST_STEPS = 100;

export interface QuenchScreenInput {
  auras: readonly { id: string; value?: number }[];
  dead?: boolean;
}

export interface QuenchScreenView {
  /** False: the overlay is hidden (out of the fight, or dead). */
  visible: boolean;
  /** How far the frost has crept in: 0 (none) to 1 (frozen solid). */
  frost: number;
  /** Frozen solid (the border at its deepest, the ice at its whitest). */
  frozen: boolean;
  /** Held in the water: the blue tint is on. */
  submerged: boolean;
}

export function makeQuenchScreenView(): QuenchScreenView {
  return { visible: false, frost: 0, frozen: false, submerged: false };
}

/** Fill `out` from the player's auras and return it. */
export function buildQuenchScreenView(
  input: QuenchScreenInput,
  out: QuenchScreenView,
): QuenchScreenView {
  out.visible = false;
  out.frost = 0;
  out.frozen = false;
  out.submerged = false;
  if (input.dead) return out;
  let cold = -1;
  for (const a of input.auras) {
    if (a.id === QUENCH_AURAS.cold) cold = a.value ?? 0;
    else if (a.id === QUENCH_AURAS.frozen) out.frozen = true;
    else if (a.id === QUENCH_AURAS.trapped) out.submerged = true;
  }
  if (cold < 0 && !out.frozen && !out.submerged) return out;
  out.visible = true;
  out.frost = out.frozen ? 1 : frostReach(cold);
  return out;
}

/** The border's reach for a cold bar value, stepped. */
export function frostReach(cold: number): number {
  const frac = Math.max(0, Math.min(1, cold / T.coldMax));
  return Math.round(frac * QUENCH_FROST_STEPS) / QUENCH_FROST_STEPS;
}
