import type { DungeonDifficulty } from './types';

export const VARKHUL_ANVILS_DECREE_CAST_ID = "Anvil's Decree";
export const VARKHUL_ANVILS_DECREE_STRIKE_SECONDS = 2;

export const VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP = {
  normal: [0.1, 0.1, 0.2],
  heroic: [0.14, 0.14, 0.25],
} as const satisfies Record<DungeonDifficulty, readonly number[]>;

export const VARKHUL_ANVILS_DECREE_STRIKES = VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP.normal.length;

export function varkhulAnvilsDecreeDamageMaxHp(
  difficulty: DungeonDifficulty,
  strikeIndex: number,
): number {
  return VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP[difficulty][strikeIndex] ?? 0;
}
