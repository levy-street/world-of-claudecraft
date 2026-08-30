// Pure tuning and deterministic portal selection for the Cinder Artificer.
// Encounter state and mutation stay in encounters/varkhul.ts.

import type { VarkhulAssemblyDifficulty } from './varkhul_assembly';

export const VARKHUL_CINDER_ARTIFICER_FIRST_SECONDS = 10;
export const VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS = 18;
export const VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS = 2;

export const VARKHUL_CINDER_REPAIR_CAST_ID = 'cinder_recalibrate';
export const VARKHUL_CINDER_REPAIR_START_ANIMATION_ID = 'cinder_recalibrate_start';
export const VARKHUL_CINDER_REPAIR_END_ANIMATION_ID = 'cinder_recalibrate_end';
export const VARKHUL_CINDER_REPAIR_NAME = 'Recalibrate';
export const VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS = 6;
export const VARKHUL_CINDER_REPAIR_RANGE = 4;
export const VARKHUL_CINDER_REPAIR_RETRY_SECONDS = 2;
export const VARKHUL_CINDER_REPAIR_TICK_SECONDS = 1;
export const VARKHUL_CINDER_ARTIFICER_HEAL_PCT_NORMAL = 0.02;
export const VARKHUL_CINDER_ARTIFICER_HEAL_PCT_HEROIC = 0.03;
export const VARKHUL_CINDER_ARTIFICER_MINIMUM_WINDOW_SECONDS =
  VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS + VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS;

export function varkhulCinderArtificerCanQueue(intermissionRemainingSeconds: number): boolean {
  return (
    Number.isFinite(intermissionRemainingSeconds) &&
    intermissionRemainingSeconds >= VARKHUL_CINDER_ARTIFICER_MINIMUM_WINDOW_SECONDS
  );
}

export function varkhulCinderArtificerPortalIndex(spawnIndex: number): number {
  const safeIndex = Math.max(0, Math.floor(spawnIndex));
  return safeIndex % 4;
}

export function varkhulCinderRepairTickAmount(
  bossMaxHp: number,
  difficulty: VarkhulAssemblyDifficulty,
): number {
  const fraction =
    difficulty === 'heroic'
      ? VARKHUL_CINDER_ARTIFICER_HEAL_PCT_HEROIC
      : VARKHUL_CINDER_ARTIFICER_HEAL_PCT_NORMAL;
  return Math.max(0, Math.round(bossMaxHp * fraction));
}
