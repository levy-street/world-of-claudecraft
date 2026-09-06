// Town focus: the persistent allocation (#1143) plus its re-spec/payment-tier
// machinery (#1144), extracted verbatim off the sim.ts monolith ratchet into a
// SimContext module. Behavior is unchanged: this is a MOVE, not a rewrite (see
// src/sim/CLAUDE.md "Shape of the core"), so every comment below is restated as
// it stood on Sim, with `this.X` calls resolved onto `ctx.X`. `Sim` keeps thin
// delegates (`townFocusFor`/`get townFocus`/`setTownFocus`/the private
// `updateTownFocusRespec` call site in the per-player tick loop) so every
// existing call site resolves unchanged.

import { zoneAt } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { RespecPaymentTier } from './focus';
import * as professionsFocus from './focus';

export function townFocusFor(ctx: SimContext, pid: number): Record<string, number> {
  return ctx.players.get(pid)?.townFocus ?? {};
}

// #1143: sets the caller's persistent town focus allocation. Gated on the
// player standing in their current zone's town hub (professions/focus.ts
// isInTownZone); rejected requests (out of town, malformed, over budget)
// leave the previous allocation untouched and surface a toast.
//
// #1144: `tier` picks which of the three RESPEC_TIER_CONFIG rows prices the
// reallocation (computeRespecCost). The validity/afford checks happen HERE,
// between validating the request and either committing it (instant tier) or
// queuing it (time/timeAndPartial): the pure validator runs first and never
// mutates state, so an invalid/over-budget/out-of-town request is rejected
// before any cost is even computed, and an unaffordable one is rejected
// before anything is charged or queued. Priced off `result.allocation` (the
// request AFTER the pure validator drops zero-point entries), not the raw
// `allocation` argument, so a caller cannot inflate the bill with junk the
// commit itself would discard. A no-op reallocation costs nothing at any
// tier and can never fail the affordability check.
//
// A tier with durationMs > 0 (`time`/`timeAndPartial`) does NOT commit or
// charge here: it queues `meta.pendingTownFocus`, which the per-player tick
// loop resolves via `updateTownFocusRespec` once the duration elapses. That
// is what makes the 'free, slow' tier actually slow instead of a same-tick
// no-cost commit; only the `instant` tier (durationMs 0) ever runs the
// charge-then-commit path below directly. Charging only at resolution, not
// at the request, means an abandoned queue (a later request that replaces
// it, or a logout, since pendingTownFocus is transient) never spends
// anything.
export function setTownFocus(
  ctx: SimContext,
  allocation: Record<string, number>,
  tier: RespecPaymentTier,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const zone = zoneAt(p.pos.x, p.pos.z);
  const inTown = professionsFocus.isInTownZone(p.pos, zone);
  const result = professionsFocus.setTownFocus(meta.townFocus, allocation, inTown);
  if (!result.ok) {
    ctx.error(
      meta.entityId,
      result.reason === 'not_in_town'
        ? 'You must be in town to set your focus.'
        : result.reason === 'over_budget'
          ? 'That allocation exceeds your focus point budget.'
          : 'Invalid focus allocation.',
    );
    return;
  }
  const resolvedAllocation = result.allocation as Record<string, number>;
  const cost = professionsFocus.computeRespecCost(meta.townFocus, resolvedAllocation, tier);
  const canAfford =
    meta.copper >= cost.coin &&
    ctx.countItem(professionsFocus.RESPEC_MATERIAL_ITEM_ID, meta.entityId) >= cost.materials;
  if (!canAfford) {
    ctx.error(meta.entityId, 'You cannot afford that focus re-spec.');
    return;
  }
  if (cost.durationMs <= 0) {
    chargeTownFocusRespec(ctx, meta, cost);
    meta.townFocus = resolvedAllocation;
    // An instant commit supersedes any earlier queued re-spec: without this,
    // an older `time`/`timeAndPartial` request would still resolve later via
    // updateTownFocusRespec, double-charging and overwriting this allocation
    // with the stale one (see the CHANGES_REQUESTED finding on PR #2909).
    meta.pendingTownFocus = undefined;
    ctx.markDeedsDirty(meta.entityId); // soc_civic_duty reads the allocation
    return;
  }
  meta.pendingTownFocus = {
    allocation: resolvedAllocation,
    readyAtTime: ctx.time + cost.durationMs / 1000,
    coin: cost.coin,
    materials: cost.materials,
  };
  ctx.notice(
    meta.entityId,
    `Your focus re-spec will complete in ${Math.ceil(cost.durationMs / 1000)}s.`,
  );
}

function chargeTownFocusRespec(
  ctx: SimContext,
  meta: PlayerMeta,
  cost: professionsFocus.RespecCost,
): void {
  if (cost.coin > 0) meta.copper -= cost.coin;
  if (cost.materials > 0) {
    ctx.removeItem(professionsFocus.RESPEC_MATERIAL_ITEM_ID, cost.materials, meta.entityId);
  }
}

// #1144: resolves a queued 're-spec' once its duration has elapsed. Called
// from the per-player tick loop for a live player. Re-checks affordability
// at resolution time (the charge happens here, never at the request), so a
// purse spent in the meantime cancels the queued re-spec instead of going
// negative or silently discarding materials the player no longer has.
export function updateTownFocusRespec(ctx: SimContext, meta: PlayerMeta): void {
  const pending = meta.pendingTownFocus;
  if (!pending || ctx.time < pending.readyAtTime) return;
  meta.pendingTownFocus = undefined;
  const canAfford =
    meta.copper >= pending.coin &&
    ctx.countItem(professionsFocus.RESPEC_MATERIAL_ITEM_ID, meta.entityId) >= pending.materials;
  if (!canAfford) {
    ctx.error(
      meta.entityId,
      'You could not afford your pending focus re-spec, so it was cancelled.',
    );
    return;
  }
  chargeTownFocusRespec(ctx, meta, {
    durationMs: 0,
    coin: pending.coin,
    materials: pending.materials,
  });
  meta.townFocus = pending.allocation;
  ctx.markDeedsDirty(meta.entityId); // soc_civic_duty reads the allocation
  ctx.notice(meta.entityId, 'Your focus re-spec is complete.');
}
