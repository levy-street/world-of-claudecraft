// PURE (RENDER_PURE_CORES): the look of Grief of the Stone on the Hammer
// Council's enraged survivor (sim: encounters/smith_heart/council_grief.ts;
// painter: council_grief_fx.ts). The palette, the onset's flare, the halo's
// beat and breath round its chest, the embers' rate and the throb ring's clock,
// every size scaled to the body's real drawn height. No three, no DOM, no clock
// of its own: time comes in.

import {
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import { BOND_BODY } from './council_mechanic_look_core';

/** Molten rage over the vein's ochre (it must stand off the Singer's own amber
 *  crystals and the Quarry's warm stone, so it runs red): linear 0..1 for the
 *  pooled particles, hex for the shock rings. Tuned in game on 2026-11-19. */
export const GRIEF_COLORS = {
  /** The halo round the body. */
  halo: [1, 0.24, 0.05] as const,
  /** The onset's white-gold flare. */
  flare: [1, 0.86, 0.52] as const,
  /** The embers streaming off it. */
  ember: [1, 0.45, 0.12] as const,
  ring: 0xff4a14,
  ringHot: 0xffc060,
} as const;

/** Seconds between two halo puffs: one a beat at every density (the body's
 *  rage reads on every tier, as the aura on its frame does). */
export const GRIEF_HALO_BEAT = 0.07;
/** The halo's breath, in cycles a second. */
export const GRIEF_BREATH_HZ = 0.75;
/** Embers a second off the body at full density (the low tier thins them). */
export const GRIEF_EMBERS = 24;
/** Seconds between two throb rings at its feet, and their reach as a share
 *  of the body's height. */
export const GRIEF_THROB_EVERY = 1.8;
export const GRIEF_THROB_REACH = 0.75;
/** Seconds the onset's swell takes to settle into the steady halo. */
export const GRIEF_ONSET_SECONDS = 1.4;
/** Where the halo sits on the body (its chest), as a share of its height. */
export const GRIEF_HALO_AT = 0.55;
/** The onset's two rings: the hot one and the wide one (yards). */
export const GRIEF_ONSET_RINGS = { hot: 12, wide: 24 } as const;

/** The survivor's real height feet to crown (yards: the model's times the
 *  template's scale, the same body the bond's tether is anchored on), which
 *  the halo, the embers and the rings scale with. */
export function griefBodyHeight(role: CouncilRole): number {
  return BOND_BODY[role].height;
}

export interface GriefHaloLook {
  /** A halo puff's size (yards), born at `size`, grown to `grow`. */
  size: number;
  grow: number;
  alpha: number;
}

/**
 * The halo at time `t` (seconds), `since` seconds after the onset (negative or
 * past the swell: the steady halo), round a body `height` yards tall: wide
 * enough to stand out past its silhouette, it breathes, and swells bright with
 * the onset before settling. Reduced motion holds the breath still and keeps
 * the swell small. Fills `out`.
 */
export function griefHaloLook(
  t: number,
  since: number,
  height: number,
  reducedMotion: boolean,
  out: GriefHaloLook = { size: 0, grow: 0, alpha: 0 },
): GriefHaloLook {
  const breath = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * GRIEF_BREATH_HZ);
  const onset = since >= 0 && since < GRIEF_ONSET_SECONDS ? 1 - since / GRIEF_ONSET_SECONDS : 0;
  const swell = reducedMotion ? onset * 0.35 : onset;
  out.size = height * (0.45 + 0.075 * breath + 0.25 * swell);
  out.grow = out.size * 1.3;
  out.alpha = Math.min(0.85, 0.16 + 0.08 * breath + 0.45 * swell);
  return out;
}

/** The onset lands with the inheritance's stream: the sim's own clock, so the
 *  flare and the river's arrival are one beat (council_fx_core.ts
 *  INHERIT_SECONDS reads the same constant). */
export const GRIEF_FLOW_SECONDS = T.griefFlow;
