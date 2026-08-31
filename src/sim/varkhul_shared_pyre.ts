// Pure target eligibility and damage pricing for Varkhul's Shared Pyre.
// Encounter timing and authoritative aura/damage mutation stay in encounters/varkhul.ts.

import type { VarkhulAssemblyDifficulty } from './varkhul_assembly';

export const VARKHUL_SHARED_PYRE_AURA_ID = 'varkhul_shared_pyre';
export const VARKHUL_SHARED_PYRE_NAME = 'Shared Pyre';
export const VARKHUL_SHARED_PYRE_CAST_SECONDS = 6;
export const VARKHUL_SHARED_PYRE_FIRST_SECONDS = 20;
export const VARKHUL_SHARED_PYRE_EVERY_SECONDS = 38;
export const VARKHUL_SHARED_PYRE_RADIUS = 5.5;
export const VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS = 4;
export const VARKHUL_SHARED_PYRE_REQUIRED_NORMAL = VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS;
export const VARKHUL_SHARED_PYRE_REQUIRED_HEROIC = VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS;
export const VARKHUL_SHARED_PYRE_TOTAL_DAMAGE_NORMAL = 1.4;
export const VARKHUL_SHARED_PYRE_TOTAL_DAMAGE_HEROIC = 2;
export const VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING = 0.15;

export interface VarkhulSharedPyreCandidate {
  id: number;
  dead: boolean;
  auras: readonly { id: string }[];
}

export function varkhulSharedPyreRequiredPlayers(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_SHARED_PYRE_REQUIRED_HEROIC
    : VARKHUL_SHARED_PYRE_REQUIRED_NORMAL;
}

export function varkhulSharedPyreDamageFraction(
  difficulty: VarkhulAssemblyDifficulty,
  soakers: number,
): number {
  return varkhulSharedPyreTotalDamageFraction(difficulty) / Math.max(1, Math.floor(soakers));
}

export function varkhulSharedPyreTotalDamageFraction(
  difficulty: VarkhulAssemblyDifficulty,
): number {
  return difficulty === 'heroic'
    ? VARKHUL_SHARED_PYRE_TOTAL_DAMAGE_HEROIC
    : VARKHUL_SHARED_PYRE_TOTAL_DAMAGE_NORMAL;
}

export function varkhulSharedPyreRaidDamageFraction(soakers: number): number {
  const missing = Math.max(0, VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS - Math.floor(soakers));
  return missing * VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING;
}

export function varkhulSharedPyreEligibleTargets<T extends VarkhulSharedPyreCandidate>(
  players: readonly T[],
  tankIds: ReadonlySet<number>,
): T[] {
  return players.filter(
    (player) =>
      !player.dead &&
      !tankIds.has(player.id) &&
      !player.auras.some(
        (aura) => aura.id === 'varkhul_red_hot_metal' || aura.id === 'varkhul_red_hot_metal_absorb',
      ),
  );
}
