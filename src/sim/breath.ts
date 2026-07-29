// Underwater breath: WoW's mirror-timer rules. A submerged player spends a
// sixty-second lungful; surfacing refills it ten times as fast (~6s for a
// full recovery). An empty lungful drowns: 10% of max hp every second, so a
// full-health player has ten seconds to reach air.
//
// Runs per live player in the tick beside the fatigue check (fatigue.ts is
// the open-sea DISTANCE clock; this is the DEPTH clock — they never overlap:
// fatigue bites at the surface far from shore, breath bites under it). Draws
// no rng, so all hosts stay identical. The HUD's mirror bar computes its own
// display-side copy of this clock from the same constants (main.ts), so no
// wire traffic carries the value.

import { isSubmerged } from './player_motion';
import type { SimContext } from './sim_context';
import { DT, type Entity } from './types';

export const BREATH_SECONDS = 60;
/** Refill runs this many times faster than the drain (WoW pacing: ~6s). */
export const BREATH_REFILL_MULT = 10;
/** Of max hp, once per second while the lungful is empty and the head under. */
export const DROWN_PULSE_PCT = 0.1;

export const BREATH_TICKS = Math.round(BREATH_SECONDS / DT);
const DROWN_PULSE_TICKS = Math.round(1 / DT);

export function updateBreath(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;
  if (p.dead) {
    // Death resets the lungs (the corpse run starts fresh, like WoW).
    p.breathUsedTicks = 0;
    p.drownTicks = 0;
    return;
  }
  if (isSubmerged(p, ctx.cfg.seed)) {
    if (p.breathUsedTicks < BREATH_TICKS) {
      p.breathUsedTicks++;
      p.drownTicks = 0;
      return;
    }
    // Lungs empty and still under: the drown clock runs on its own counter so
    // the spent-breath clamp above can never stall the pulse cadence, and the
    // refill after surfacing always starts from exactly-empty (WoW's bar
    // refills the same whether you cut it close or blacked out down there).
    p.drownTicks++;
    if (p.drownTicks % DROWN_PULSE_TICKS === 0) {
      const dmg = Math.max(1, Math.round(p.maxHp * DROWN_PULSE_PCT));
      ctx.dealDamage(null, p, dmg, false, 'physical', 'Drowning', 'hit', true);
    }
    return;
  }
  p.drownTicks = 0;
  p.breathUsedTicks = Math.max(0, p.breathUsedTicks - BREATH_REFILL_MULT);
}

/** Display-side mirror of the same clock, in SECONDS of spent breath. The HUD
 *  steps this from the frame loop with its own submerged read, so the bar
 *  needs no wire traffic; both sides share the constants, so they agree to
 *  within a frame of latency. */
export function stepBreathUsedSeconds(used: number, submerged: boolean, dt: number): number {
  const next = submerged ? used + dt : used - dt * BREATH_REFILL_MULT;
  return Math.min(BREATH_SECONDS, Math.max(0, next));
}

/** 1 = full lungs, 0 = empty (drowning). */
export function breathFraction(usedSeconds: number): number {
  return Math.min(1, Math.max(0, 1 - usedSeconds / BREATH_SECONDS));
}
