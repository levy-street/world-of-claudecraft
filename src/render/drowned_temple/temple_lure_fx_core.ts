// Pure plan for the Moonlit Siren's Call of the Shallows (temple_lure_fx.ts),
// the trash pass's second wave (sim: mob/trash_kit/temple_lure.ts):
//  - while her song runs, a moon-silver tether from her mouth to the victim's
//    chest, rippling like a sound wave, silver notes flowing along it toward
//    her, and a silver ring under the victim whose chevrons point at her (the
//    way the song drags them); every piece brightens as the bar fills;
//  - the song breaking on a column (TEMPLE_SHALLOWS_BROKEN): the tether snaps
//    into drifting shards;
//  - the song landing: a burst of notes on the victim, and while they are
//    Song-Struck a slow ring of silver notes and stars orbiting their head.
//
// Every read is what IWorld mirrors (the siren's cast id, its cast target and
// bar, the victim's aura), so offline and online look the same. Numbers the
// player acts on (the drag's pace) come from the sim's own template.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_SONG_STRUCK,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import { templeBodyHeight } from './temple_trash_fx_core';

/** The singer's template id. */
export const LURE_SIREN = 'moonlit_siren';

/** Seconds the snapped tether's shards drift and fade. */
export const LURE_SNAP_SECONDS = 0.9;
/** Seconds the landing burst's flash ring lives on the victim. */
export const LURE_LAND_SECONDS = 0.7;
/** The victim's chest height (yards): the tether's player end. */
export const LURE_VICTIM_CHEST = 1.35;
/** The dazed halo's height over a player's feet and its orbit radius. */
export const LURE_HALO_UP = 2.55;
export const LURE_HALO_RADIUS = 0.75;
/** The drag ring's radius under the victim (yards). */
export const LURE_RING_RADIUS = 1.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The minimal mob view the plan reads (an IWorld entity satisfies it). */
export interface LureCasterView {
  templateId: string;
  dead: boolean;
  castingAbility: string | null;
  castTargetId: number | null;
  castRemaining: number;
  castTotal: number;
}

/** The victim a siren's song is drawing now, or null when no song runs. */
export function lureVictimOf(e: LureCasterView): number | null {
  if (e.dead || e.templateId !== LURE_SIREN) return null;
  if (e.castingAbility !== TEMPLE_CALL_OF_THE_SHALLOWS) return null;
  return e.castTargetId;
}

/** How far the bar has run (0 just begun, 1 landing). */
export function lureFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return clamp01(1 - castRemaining / castTotal);
}

/** The tether's strength off the bar: never faint (the read must land from
 *  its first frame), swelling toward the landing. */
export function lureIntensity(fill: number): number {
  return 0.5 + 0.5 * clamp01(fill) ** 0.7;
}

/** The song's mouth height on the siren (yards over her feet): high on her
 *  drawn body, where the voice leaves her. */
export function lureMouthUp(templateId: string = LURE_SIREN): number {
  return templeBodyHeight(templateId) * 0.8;
}

/** The yaw (the sim's facing convention, atan2(dx, dz)) the victim's ring
 *  chevrons point along: from the victim toward the singer, the way the
 *  song drags them. */
export function lureChevronYaw(
  victim: { x: number; z: number },
  siren: { x: number; z: number },
): number {
  return Math.atan2(siren.x - victim.x, siren.z - victim.z);
}

/** The drag's authored pace (yards a second), so the chevrons scroll as fast
 *  as the victim is pulled. The heroic pace when `heroic`. */
export function lurePullPace(heroic = false): number {
  const def = MOBS[LURE_SIREN]?.trashKit?.temple?.lure;
  if (!def) return 2;
  return heroic ? def.heroicPull : def.pull;
}

/** Notes born a second along a tether: more as the bar fills, thinned on the
 *  low tier by `density`. */
export function lureNoteRate(fill: number, density: number): number {
  return (6 + 18 * clamp01(fill)) * density;
}

/** The note sprite's flight along a tether of `length` yards: it rides from
 *  the victim to the singer in a fixed beat, so a long song reads as fast. */
export function lureNoteFlight(length: number): { speed: number; life: number } {
  const life = 0.9;
  return { speed: Math.max(0.5, length) / life, life };
}

/** The snapped tether's look `age` seconds after the break: the ribbon's
 *  fading alpha and how far its two halves have sprung apart (0..1). */
export function lureSnapLook(age: number): { alpha: number; spring: number } {
  const k = clamp01(age / LURE_SNAP_SECONDS);
  return { alpha: (1 - k) ** 1.6, spring: 1 - (1 - k) ** 3 };
}

/** The landing's flash ring on the victim `age` seconds after it lands: its
 *  radius (yards) and alpha. */
export function lureLandRing(age: number): { radius: number; alpha: number } {
  const k = clamp01(age / LURE_LAND_SECONDS);
  return { radius: 0.6 + 2.6 * (1 - (1 - k) ** 3), alpha: (1 - k) ** 1.3 };
}

/** The minimal aura view the halo reads. */
export interface LureAuraView {
  id: string;
  remaining: number;
  duration: number;
}

/** The dazed halo off a player's auras: null when they are not Song-Struck,
 *  else its strength (full while the stun holds, easing out over its last
 *  quarter second) and its orbit turn (radians, slow). */
export function songStruckHalo(
  auras: readonly LureAuraView[],
  clock: number,
): { alpha: number; turn: number } | null {
  for (const a of auras) {
    if (a.id !== TEMPLE_SONG_STRUCK) continue;
    const alpha = clamp01(a.remaining / 0.25);
    return { alpha: Math.max(0.15, alpha), turn: clock * 1.6 };
  }
  return null;
}
