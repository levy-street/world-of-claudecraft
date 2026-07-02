import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export const HONOR_PER_PLAYER_KILL = 20;

export interface HonorRank {
  id: string;
  title: string;
  minHonor: number;
}

const UNRANKED_HONOR_RANK: HonorRank = { id: 'unranked', title: 'Unranked', minHonor: 0 };

export const HONOR_RANKS: readonly HonorRank[] = [
  UNRANKED_HONOR_RANK,
  { id: 'skirmisher', title: 'Skirmisher', minHonor: 100 },
  { id: 'vanguard', title: 'Vanguard', minHonor: 250 },
  { id: 'champion', title: 'Champion', minHonor: 500 },
  { id: 'marshal', title: 'Marshal', minHonor: 1000 },
  { id: 'high_marshal', title: 'High Marshal', minHonor: 2000 },
] as const;

export function normalizeHonor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function honorRankFor(lifetimeHonor: number): HonorRank {
  const honor = normalizeHonor(lifetimeHonor);
  let rank = UNRANKED_HONOR_RANK;
  for (const candidate of HONOR_RANKS) {
    if (honor < candidate.minHonor) break;
    rank = candidate;
  }
  return rank;
}

export function grantPvpHonor(meta: PlayerMeta, amount = HONOR_PER_PLAYER_KILL): number {
  const gain = normalizeHonor(amount);
  if (gain === 0) return 0;
  meta.pvpHonor += gain;
  meta.lifetimePvpHonor += gain;
  meta.lifetimeHonorableKills += 1;
  return gain;
}

export function grantPvpHonorForKill(
  ctx: SimContext,
  killer: Entity | null,
  victim: Entity,
): number {
  if (victim.kind !== 'player') return 0;
  const killerPlayer = ctx.pvpController(killer);
  if (!killerPlayer || killerPlayer.id === victim.id || !ctx.isHostileTo(killerPlayer, victim)) {
    return 0;
  }
  const killerMeta = ctx.players.get(killerPlayer.id);
  return killerMeta ? grantPvpHonor(killerMeta) : 0;
}
