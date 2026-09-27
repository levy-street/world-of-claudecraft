import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  parseWeeklyTableSelection,
  selectedWeeklyRewardTables,
  weeklyRewardTableOptions,
} from './weekly_reward_options';
import {
  nearWeeklyKeeper,
  stateFor,
  type WeeklyChoice,
  type WeeklyRewardState,
  type WeeklyVaultBatch,
} from './weekly_rewards';

export interface WeeklyRewardOpening {
  meta: PlayerMeta;
  state: WeeklyRewardState;
  batch: WeeklyVaultBatch;
  choice: WeeklyChoice;
  itemId: string;
}

/** Prepare exactly one roll. The server must persist before acknowledging it. */
export function prepareWeeklyRewardOpen(
  ctx: SimContext,
  choiceKey: string,
  pid?: number,
  expectedToken?: string,
  tableIds?: string | readonly string[],
): WeeklyRewardOpening | null {
  const r = ctx.resolve(pid);
  if (!r || r.meta.leaving || !nearWeeklyKeeper(ctx, r.e)) return null;
  const state = stateFor(ctx, r.meta);
  const batch = state.vaults[0];
  if (!batch || batch.resetAtMs > ctx.lockoutNowMs()) return null;
  if (expectedToken !== undefined && expectedToken !== `${state.resetAtMs}:${state.claimSequence}`)
    return null;
  const choice = batch.choices.find((_, i) => choiceKey === `${batch.resetAtMs}:${i}`);
  if (!choice || choice.opening || (choice.opened && !choice.pendingSave)) return null;
  if (!choice.itemId) {
    const ids = parseWeeklyTableSelection(tableIds);
    if (!ids) return null;
    const candidateBatch = { ...batch, bossUnlocks: batch.bossUnlocks ?? state.bossUnlocks };
    const options = weeklyRewardTableOptions(candidateBatch, choice, r.meta.cls, r.e.level);
    const selected = selectedWeeklyRewardTables(options, ids);
    if (!selected) return null;
    const items = [...new Set(selected.flatMap((table) => table.items))].sort();
    if (!items.length) return null;
    choice.itemId = ctx.rng.pick(items);
    // Persist only the attributed source, not the transient multi-selection.
    choice.tableId = selected.find((table) => table.items.includes(choice.itemId!))!.id;
    batch.bossUnlocks ??= { ...state.bossUnlocks };
  }
  // Persist opened:true with the item. Runtime flags conceal it until save success.
  // Never clear the item on failure: an ambiguous commit must not permit a reroll.
  choice.opened = true;
  choice.pendingSave = true;
  choice.opening = true;
  return { meta: r.meta, state, batch, choice, itemId: choice.itemId };
}

export function isWeeklyRewardOpeningCurrent(
  ctx: SimContext,
  pid: number,
  opening: WeeklyRewardOpening,
): boolean {
  const r = ctx.resolve(pid);
  return (
    !!r &&
    !r.meta.leaving &&
    r.meta === opening.meta &&
    r.meta.weeklyRewards === opening.state &&
    opening.state.vaults[0] === opening.batch &&
    opening.batch.choices.includes(opening.choice) &&
    opening.choice.itemId === opening.itemId
  );
}

export function finishWeeklyRewardOpen(opening: WeeklyRewardOpening, saved: boolean): void {
  delete opening.choice.opening;
  if (saved) delete opening.choice.pendingSave;
}

/** Offline/headless have no remote persistence barrier; snapshots retain the roll. */
export function openWeeklyReward(
  ctx: SimContext,
  choiceKey: string,
  table?: string | readonly string[],
  pid?: number,
): void {
  const opening = prepareWeeklyRewardOpen(ctx, choiceKey, pid, undefined, table);
  if (opening) finishWeeklyRewardOpen(opening, true);
}
