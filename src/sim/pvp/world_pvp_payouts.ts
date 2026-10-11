// World PvP forfeit payouts: the gold of a fight its loser walked out of,
// held for WORLD_PVP_FORFEIT_PAYOUT_SECONDS and then paid to the winner.
//
// The leaver's stake leaves their purse the moment they forfeit (their save is
// written on the way out, so the debit is durable before they can spend it
// elsewhere); each winner's share waits HERE, on the WINNER's own meta, so it
// persists with the character it is owed to and survives the winner logging
// out or the realm restarting. The countdown is stored as the REMAINING
// seconds and re-anchored to the loading sim's clock (the world_pvp.ts disarm
// precedent: sim time restarts at zero on every boot).
//
// Host-agnostic: no rng, no wall clock. The due pass runs from updateWorldPvp
// behind the `nextPayoutAt` watermark on the books, so a realm with nothing
// owed pays one comparison per tick, never a roster walk.

import { formatMoney } from '../format_money';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

/** One share of forfeited gold still on its way to the winner. */
export interface WorldPvpPendingPayout {
  /** Integer copper owed. */
  copper: number;
  /** Sim time the share is paid. */
  dueAt: number;
  /** The leaver's display name, for the payout notice. */
  from: string;
}

/** The persisted form: the countdown as remaining seconds. */
export interface WorldPvpSavedPayout {
  copper: number;
  remaining: number;
  from: string;
}

/** A save never carries more rows than this: a malformed or hostile blob
 *  cannot grow the per-tick due pass. Far above anything real (a row lives
 *  five minutes and the per-pair diminishing returns stop a farmed victim
 *  paying after three kills an hour). */
export const WORLD_PVP_PENDING_PAYOUT_LIMIT = 64;

const NOTICE_COLOR = '#ffd100';

/** What the winner is told when a held share lands. */
export function worldPvpForfeitPayoutLine(from: string, copper: number): string {
  return `Forfeit paid: ${formatMoney(copper)} from ${from}.`;
}

/** Hold a winner's share for `delaySeconds`. A zero or invalid amount holds
 *  nothing. */
export function queueWorldPvpPayout(
  ctx: SimContext,
  meta: PlayerMeta,
  copper: number,
  from: string,
  delaySeconds: number,
): void {
  if (!Number.isFinite(copper) || copper <= 0) return;
  const state = meta.worldPvp;
  if (!state) return;
  const dueAt = ctx.time + delaySeconds;
  if (!state.pending) state.pending = [];
  state.pending.push({ copper: Math.floor(copper), dueAt, from });
  const books = ctx.worldPvpBooks;
  books.nextPayoutAt = Math.min(books.nextPayoutAt, dueAt);
}

/**
 * Pay every held share that has come due, to every player in the world, and
 * re-arm the watermark at the earliest share still waiting. A share owed to a
 * player who is not in the world this tick waits in their save; their next
 * load re-arms the watermark. Draws no rng.
 */
export function payDueWorldPvpPayouts(ctx: SimContext): void {
  const books = ctx.worldPvpBooks;
  if (ctx.time < books.nextPayoutAt) return;
  let next = Number.POSITIVE_INFINITY;
  for (const meta of ctx.players.values()) {
    const pending = meta.worldPvp?.pending;
    if (!pending || pending.length === 0) continue;
    const waiting: WorldPvpPendingPayout[] = [];
    for (const row of pending) {
      if (ctx.time < row.dueAt) {
        waiting.push(row);
        next = Math.min(next, row.dueAt);
        continue;
      }
      meta.copper += row.copper;
      ctx.emit({
        type: 'log',
        text: worldPvpForfeitPayoutLine(row.from, row.copper),
        color: NOTICE_COLOR,
        pid: meta.entityId,
      });
    }
    if (waiting.length > 0) meta.worldPvp!.pending = waiting;
    else delete meta.worldPvp!.pending;
  }
  books.nextPayoutAt = next;
}

/** The saved rows, or undefined when nothing is owed (so a save without a
 *  pending forfeit stays byte-identical to one from before this existed). */
export function savedWorldPvpPayouts(
  pending: readonly WorldPvpPendingPayout[] | undefined,
  now: number,
): WorldPvpSavedPayout[] | undefined {
  if (!pending || pending.length === 0) return undefined;
  return pending.map((row) => ({
    copper: row.copper,
    remaining: Math.max(0, row.dueAt - now),
    from: row.from,
  }));
}

/** Restore saved rows against THIS sim's clock, dropping every malformed one
 *  and capping the count. Returns the rows (empty when none survive). */
export function loadWorldPvpPayouts(saved: unknown, now: number): WorldPvpPendingPayout[] {
  if (!Array.isArray(saved)) return [];
  const rows: WorldPvpPendingPayout[] = [];
  for (const raw of saved) {
    if (rows.length >= WORLD_PVP_PENDING_PAYOUT_LIMIT) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const copper = typeof r.copper === 'number' && Number.isFinite(r.copper) ? r.copper : 0;
    if (copper < 1) continue;
    const remaining =
      typeof r.remaining === 'number' && Number.isFinite(r.remaining)
        ? Math.max(0, r.remaining)
        : 0;
    if (typeof r.from !== 'string') continue;
    rows.push({ copper: Math.floor(copper), dueAt: now + remaining, from: r.from });
  }
  return rows;
}
