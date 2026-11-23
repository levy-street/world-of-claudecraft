// Fixed rarity budgets for Buried Hoard stats, mechanics, and encounter pressure.

import {
  HOARD_SUGGESTED_PLAYERS,
  hoardDamageReduction,
  type TreasureMapRarity,
} from '../content/treasure_maps';
import type { RiftInstance } from './types';

export interface HoardPressure {
  /** Multiplier on every boss mechanic's damage. */
  damage: number;
  /** Multiplier on the time BETWEEN a boss's mechanics: below 1 they come faster. */
  cadence: number;
  /** Extra things to deal with at once (souls, for one), on top of the head count. */
  extra: number;
  /** Multiplier on how fast a moving mechanic closes (a soul's walk). */
  speed: number;
}

/** Fixed encounter size plus rarity determines simultaneous mechanics. */
export const HOARD_RARITY_STEP: Readonly<Record<TreasureMapRarity, number>> = Object.freeze({
  common: -1,
  rare: 0,
  epic: 1,
  legendary: 2,
});
export const HOARD_DOUBLE_MECHANIC_INTENSITY = 6;

export function hoardIntensity(
  vault: RiftInstance['vault'] | undefined,
  livingPlayers: number,
): number {
  return hoardPlayerBudget(vault, livingPlayers) + (vault ? HOARD_RARITY_STEP[vault.rarity] : 0);
}

export const HOARD_RARITY_PRESSURE: Readonly<Record<TreasureMapRarity, HoardPressure>> =
  Object.freeze({
    common: { damage: 0.85, cadence: 1.15, extra: -1, speed: 0.9 },
    rare: { damage: 1, cadence: 1, extra: 0, speed: 1 },
    epic: { damage: 1.12, cadence: 0.92, extra: 1, speed: 1.08 },
    legendary: { damage: 1.25, cadence: 0.84, extra: 1, speed: 1.16 },
  });

const BASELINE: HoardPressure = HOARD_RARITY_PRESSURE.rare;

export function hoardPressure(vault: RiftInstance['vault'] | undefined): HoardPressure {
  return vault ? HOARD_RARITY_PRESSURE[vault.rarity] : BASELINE;
}

/** The health a mechanic's `fraction` is read against: a level-20 damage dealer
 *  in good gear (cloth tops out near 1,300 to 1,460, tanks near 2,000). Mechanics
 *  hit a FLAT amount, not a share of the victim's own health: with a share,
 *  stamina bought nothing against them and non-tanks dropped it (playtest). */
export const HOARD_REFERENCE_HEALTH = 1200;

/** What one boss mechanic does to whoever it hits: `fraction` of the reference
 *  health, pressed by the rarity of the hoard `inst`. The same number lands on a
 *  tank and a mage; more stamina means more room to take it. No cap: a mechanic
 *  stood in on low health can kill. Every hoard mechanic goes through here, so
 *  the rarity ladder holds for all eight bosses and their casters. */
export function hoardMechanicDamage(
  inst: RiftInstance,
  fraction: number,
  role: 'boss' | 'add' = 'boss',
): number {
  const reduction = inst.vault ? hoardDamageReduction(inst.vault.rarity, role) : 1;
  const scale = hoardPressure(inst.vault).damage * reduction;
  return Math.max(1, Math.round(HOARD_REFERENCE_HEALTH * fraction * scale));
}

/** Difficulty uses the authored party size; target selection still uses living players. */
export function hoardPlayerBudget(vault: RiftInstance['vault'] | undefined, fallback = 1): number {
  return vault ? HOARD_SUGGESTED_PLAYERS[vault.rarity] : Math.max(1, fallback);
}
