// The Guardian of the Quench's frost painted on the body itself (the owner's
// call of 2026-11-04: the rime shell round a cold body read as a white apron).
// PURE: from a body's mirrored auras (what both worlds carry) to the glaze its
// own material wears through the character surface program
// (characters/surface_response.ts `setGlaze`): how high the frost has climbed,
// how bright its cold rim burns, whether it bites through an immunity, and how
// strongly it shows. The same numbers the old shell drew (`shellLook`), so the
// read of the bar is unchanged: a sliver of cold wears nothing, the frost
// climbs with the bar, pulses past three quarters, flares where a splash shard
// lands, and a frozen body is glazed to the crown under its ice block.

import { QUENCH_AURAS, QUENCH_TUNING as T } from '../../sim/encounters/smith_heart/quench_ids';
import { SPLASH_FLARE_SECONDS, SPLASH_FLIGHT_SECONDS, shellLook } from './quench_frost_fx_core';

/** The glaze a body's material wears (all 0..1 but `glow`, 0..~2). */
export interface QuenchGlaze {
  /** How high the frost has climbed (share of the body's height). */
  height: number;
  /** The cold rim's light. */
  glow: number;
  /** 1 while the cold bites through an immunity (veins of frost light). */
  bite: number;
  /** How strongly the glaze shows. */
  alpha: number;
}

/** The aura fields this reads (an `Entity['auras']` row). */
export interface GlazeAura {
  id: string;
  kind?: string;
  value?: number;
  remaining?: number;
}

const _shell = { height: 0, glow: 0, pulse: 0, bite: 0, alpha: 0 };

/**
 * The glaze for a body carrying `auras` at clock `t` (seconds, render time:
 * only the pulse reads it), or null when it wears none. The splash's flare is
 * read from the splash mark's own age, so it lands as the shard does
 * (`SPLASH_FLIGHT_SECONDS` after the mark) and fades over
 * `SPLASH_FLARE_SECONDS`.
 */
export function quenchGlazeOf(
  auras: readonly GlazeAura[],
  t: number,
  out: QuenchGlaze = { height: 0, glow: 0, bite: 0, alpha: 0 },
): QuenchGlaze | null {
  let cold = -1;
  let frozen = false;
  let warded = false;
  let splashAge = -1;
  for (const a of auras) {
    if (a.id === QUENCH_AURAS.cold) cold = a.value ?? 0;
    else if (a.id === QUENCH_AURAS.frozen) frozen = true;
    else if (a.id === QUENCH_AURAS.splashed)
      splashAge = T.splashMarkSeconds - (a.remaining ?? T.splashMarkSeconds);
    else if (a.kind === 'stasis') warded = true;
  }
  // Nothing of the Quench on this body: the common case, every frame, for
  // every character in view.
  if (cold < 0 && !frozen) return null;
  const since = splashAge - SPLASH_FLIGHT_SECONDS;
  const flare = splashAge < 0 || since < 0 ? 0 : Math.max(0, 1 - since / SPLASH_FLARE_SECONDS);
  const look = shellLook(frozen ? T.coldMax : Math.max(0, cold), warded, flare, t, _shell);
  if (look.alpha <= 0.01) return null;
  out.height = frozen ? 1.05 : look.height;
  out.glow = look.glow;
  out.bite = look.bite;
  out.alpha = look.alpha;
  return out;
}
