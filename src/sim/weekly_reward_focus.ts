import type { SimContext } from './sim_context';
import { weeklyLootSpecForClass } from './weekly_loot_spec';
import { nearWeeklyKeeper, stateFor } from './weekly_rewards';

/** A bounded preference change; existing character saves provide durability. */
export function setWeeklyLootSpec(ctx: SimContext, raw: string | null, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.meta.leaving || !nearWeeklyKeeper(ctx, r.e)) return;
  const spec = weeklyLootSpecForClass(r.meta.cls, raw);
  if (raw !== null && spec === undefined) return;
  const state = stateFor(ctx, r.meta);
  if (state.lootSpec === spec || state.claimSequence >= Number.MAX_SAFE_INTEGER) return;
  if (spec) state.lootSpec = spec;
  else delete state.lootSpec;
  // Reject commands submitted against the previous preview, including A-B-A changes.
  state.claimSequence++;
}
