// Hero Points: the Season 1 Frontier PvP currency, earned by killing the frost
// rares that roam the Frostreach Frontier and spent at the hub vendor on the
// item-level 31 PvP set. Soulbound like honor (heroPoints is spendable,
// lifetimeHeroPoints is a monotonic earned total). Mirrors grantHonor so both
// counters and the client float update together through one emit.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { HeroPointsReason } from '../types';

function safeAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}

export function normalizeHeroPoints(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

export function grantHeroPoints(
  ctx: SimContext,
  meta: PlayerMeta,
  amount: number,
  reason: HeroPointsReason,
): number {
  const requested = safeAmount(amount);
  if (requested === 0) return 0;
  const before = meta.heroPoints;
  const lifetimeBefore = meta.lifetimeHeroPoints;
  meta.heroPoints = Math.min(Number.MAX_SAFE_INTEGER, before + requested);
  meta.lifetimeHeroPoints = Math.min(Number.MAX_SAFE_INTEGER, lifetimeBefore + requested);
  const credited = meta.heroPoints - before;
  const earned = meta.lifetimeHeroPoints - lifetimeBefore;
  const eventAmount = Math.max(credited, earned);
  if (eventAmount === 0) return 0;
  ctx.emit({ type: 'heroPoints', pid: meta.entityId, amount: eventAmount, reason });
  return credited;
}

/** Spend hero points if the wallet covers it. Returns false (no mutation) if not. */
export function spendHeroPoints(meta: PlayerMeta, cost: number): boolean {
  const c = safeAmount(cost);
  if (c === 0) return true;
  if (meta.heroPoints < c) return false;
  meta.heroPoints -= c;
  return true;
}
