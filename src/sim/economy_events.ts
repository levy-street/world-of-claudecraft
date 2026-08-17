// Economy Watch, phase 1: the sim half. THE one place a character's purse
// changes, and the emitter of the audit event that explains each change.
//
// Why a mutating helper rather than a "remember to emit beside your `-=`"
// convention: server/economy_telemetry.ts already samples the acting player's
// copper delta per command and says so in its own header, "COPPER FLOW IS A
// TREND, NOT A LEDGER". It books nothing for a credit landing on a third party
// and misattributes tick-driven payouts. A ledger cannot rest on a convention a
// new faucet can silently skip, so the mutation and the event are the SAME
// call: `applyMoneyDelta` writes the purse and emits the matching
// `EconomyEvent`, and `tests/economy_ledger_guard.test.ts` fails CI on any raw
// `.copper +=` / `-=` that reappears in `src/sim` outside this module.
//
// DETERMINISM. Pure arithmetic over sim-owned state. No clock (the event
// carries `ctx.tickCount`, the sim clock), no `Math.random`, no import outside
// `src/sim`. Draws NO rng: a caller needing a random amount rolls it on
// `ctx.rng` first and hands the settled integer in, so the draw order stays the
// caller's and instrumenting a site can never fork the world.
//
// DIRECTION. Out only. The event rides the existing per-player SimEvent path
// (`ctx.emit` with `pid` set, personal by the same rule every other personal
// event follows); nothing about the ledger, the database, or the reconciliation
// job is readable from here. The type is flagged server-only
// (`SERVER_ONLY_SIM_EVENT_TYPES`), so the authoritative host consumes it off the
// drained batch and it never reaches a client socket: an audit trail is
// operator data, and putting it on the wire would spend player bandwidth on
// bytes no client reads.

import { zoneAt } from './data';
import type { EconomyCounterparty, EconomyEventKind } from './economy_event_kinds';
import type { Entity, SimEvent } from './types';

/**
 * The purse this module writes, declared structurally rather than imported.
 * `PlayerMeta` lives in `sim.ts`, which imports this module; naming the fields
 * the ledger actually reads keeps the dependency one-way and makes a Vitest
 * double a two-line object literal.
 */
export interface MoneyHolder {
  entityId: number;
  copper: number;
}

/**
 * The slice of `SimContext` this module needs, same structural trick: a Vitest
 * drives it with a plain object instead of standing a whole `Sim` up.
 */
export interface EconomyEmitContext {
  readonly tickCount: number;
  readonly entities: Map<number, Entity>;
  emit(ev: SimEvent): void;
}

/**
 * SimEvent types the authoritative host consumes but never forwards to a
 * client. Exported from the sim (rather than hardcoded in `server/game.ts`) so
 * the sim classifies its own output, the way `DISPATCH_ONLY_COMMANDS` lives on
 * the shared `world_api` table rather than in the dispatcher.
 */
export const SERVER_ONLY_SIM_EVENT_TYPES: ReadonlySet<string> = new Set(['economy']);

/**
 * Coarsen a world coordinate to a whole unit. Enough to tell "farming the
 * Deepfen camps" from "standing at the Highwatch bank" without turning a
 * keep-forever audit table into a movement recording. A non-finite input
 * (unreachable from the motion kernel, cheap to survive) coarsens to 0 rather
 * than poisoning an integer column.
 */
function coarse(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

// Where the actor is standing, coarsened, plus the zone that contains it. One
// helper so the purse arm and the pool arm cannot describe the same position
// two different ways.
function whereIs(ctx: EconomyEmitContext, pid: number): { x: number; z: number; zone: string } {
  const e = ctx.entities.get(pid);
  const x = coarse(e?.pos.x ?? 0);
  const z = coarse(e?.pos.z ?? 0);
  return { x, z, zone: zoneAt(x, z).id };
}

/**
 * Apply a signed copper delta to a purse AND emit the event explaining it.
 *
 * Returns the delta ACTUALLY applied, which is not always the delta asked for:
 * `clampToZero` (the craft sink's rule, #1301) floors the purse at zero instead
 * of denying the craft, and a floor that took less than asked must book what it
 * took, never what it wanted. A delta resolving to zero emits NOTHING and
 * returns 0: a no-op is not a ledger row, and writing one per refused command
 * would flood a keep-forever table at the command-lane rate.
 *
 * Deliberately NOT a gate. Every caller keeps the affordability check it
 * already had: refusing here would move a gameplay decision into an
 * observability module, and the refusal lines are player-facing text the client
 * matcher already covers at their existing sites.
 *
 * A non-integer, non-finite, or unsafe delta is refused whole rather than
 * applied: it would put a fractional or NaN purse into the save blob, and a NaN
 * would then poison every later chain check silently.
 */
export function applyMoneyDelta(
  ctx: EconomyEmitContext,
  holder: MoneyHolder,
  kind: EconomyEventKind,
  delta: number,
  opts?: { counterparty?: EconomyCounterparty; clampToZero?: boolean },
): number {
  if (!Number.isSafeInteger(delta) || delta === 0) return 0;
  const applied = opts?.clampToZero === true ? Math.max(delta, -holder.copper) : delta;
  if (applied === 0) return 0;
  holder.copper += applied;
  const { x, z, zone } = whereIs(ctx, holder.entityId);
  ctx.emit({
    type: 'economy',
    pid: holder.entityId,
    kind,
    holder: 'purse',
    amount: applied,
    balanceAfter: holder.copper,
    counterparty: opts?.counterparty ?? null,
    tick: ctx.tickCount,
    zone,
    x,
    z,
  });
  return applied;
}

/**
 * The non-purse side of a transfer: coin entering or leaving a holding area the
 * sim owns but no character carries (a market collection box, a letter's
 * attached coin, a guild treasury). Emits the balancing half so the symmetry
 * check sees both rows.
 *
 * `actorPid` is the character whose ACTION moved the pool, so the row stays
 * attributable; `poolBalanceAfter` is the POOL's balance, not a purse's, which
 * is why the event is stamped `holder: 'pool'` and the reconciler keeps these
 * rows out of the per-character chain entirely. The counterparty cannot carry
 * that job: a burn row (the Merchant's cut) names no counterparty at all and
 * would otherwise read as a purse row.
 *
 * Pass `null` for `poolBalanceAfter` when the movement's holder has no single
 * running balance: a burn belongs to nobody, and the mail book is a pile of
 * letters each holding its own coin. Passing 0 there would state a false
 * balance in a keep-forever table.
 */
export function emitPoolMovement(
  ctx: EconomyEmitContext,
  actorPid: number,
  kind: EconomyEventKind,
  delta: number,
  poolBalanceAfter: number | null,
  counterparty: EconomyCounterparty,
): void {
  if (!Number.isSafeInteger(delta) || delta === 0) return;
  const { x, z, zone } = whereIs(ctx, actorPid);
  ctx.emit({
    type: 'economy',
    pid: actorPid,
    kind,
    holder: 'pool',
    amount: delta,
    balanceAfter: poolBalanceAfter,
    counterparty,
    tick: ctx.tickCount,
    zone,
    x,
    z,
  });
}
