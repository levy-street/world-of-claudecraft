import type { SimContext } from '../../sim_context';
import type { Entity, SeltheScoreState } from '../../types';
import { SELTHE_SPENT_VOICE } from './ids';

/** Cleanup includes players who died or left the claim after their note. */
export function clearScoreRelay(ctx: SimContext, bossId: number): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p?.auras.some((a) => a.id === SELTHE_SPENT_VOICE && a.sourceId === bossId))
      p.auras = p.auras.filter((a) => a.id !== SELTHE_SPENT_VOICE || a.sourceId !== bossId);
  }
}

export function scoreSingerBlocked(
  sc: SeltheScoreState,
  players: readonly Entity[],
  playerId: number,
): boolean {
  return players.length > 1 && sc.lastSingerId === playerId;
}

/** State is authoritative: an expired or removed display mark cannot bypass it.
 * Keep the last singer while solo so a returning teammate restores alternation. */
export function refreshScoreRelay(
  ctx: SimContext,
  boss: Entity,
  sc: SeltheScoreState,
  players: readonly Entity[],
): void {
  if (sc.lastSingerId === null) return;
  const singer = players.find((p) => p.id === sc.lastSingerId);
  if (!singer || players.length < 2) {
    const previous = ctx.entities.get(sc.lastSingerId);
    if (previous?.auras.some((a) => a.id === SELTHE_SPENT_VOICE && a.sourceId === boss.id))
      previous.auras = previous.auras.filter(
        (a) => a.id !== SELTHE_SPENT_VOICE || a.sourceId !== boss.id,
      );
    if (!singer) sc.lastSingerId = null;
    return;
  }
  const mark = singer.auras.find((a) => a.id === SELTHE_SPENT_VOICE && a.sourceId === boss.id);
  if (mark) {
    mark.remaining = Math.max(0, sc.timer);
    return;
  }
  ctx.applyAura(singer, {
    id: SELTHE_SPENT_VOICE,
    name: 'Spent Voice',
    // Neutral harmful marker: no stat effect, and snare immunity cannot hide it.
    kind: 'vulnerability',
    value: 0,
    remaining: Math.max(0, sc.timer),
    duration: Math.max(0, sc.timer),
    sourceId: boss.id,
    school: 'frost',
    undispellable: true,
    unbreakableControl: true,
  });
}

export function recordScoreSinger(
  ctx: SimContext,
  boss: Entity,
  sc: SeltheScoreState,
  players: readonly Entity[],
  playerId: number,
): void {
  clearScoreRelay(ctx, boss.id);
  sc.lastSingerId = playerId;
  refreshScoreRelay(ctx, boss, sc, players);
}
