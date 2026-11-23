// Prepare one direct-claim delta for both the durable snapshot and live grant.
// Minting reserves identities but emits nothing until the claim commits.
import { ITEMS } from '../src/sim/data';
import { isTrackedItem, stampTrackedCopy } from '../src/sim/item_tracking';
import { hoardRewardGrantItems } from '../src/sim/rift/hoard_reward_items';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot, SimEvent } from '../src/sim/types';
import type { VaultRewardClaim } from './vault_rewards_db';

export interface PreparedVaultReward {
  items: InvSlot[];
  events: SimEvent[];
}

export function prepareVaultRewardTracking(
  ctx: SimContext,
  pid: number,
  claim: VaultRewardClaim,
): PreparedVaultReward | null {
  const meta = ctx.players.get(pid);
  if (!meta || meta.leaving || !ctx.entities.has(pid)) return null;
  const prepared: PreparedVaultReward = { items: [], events: [] };
  // Reuse the hub's stamp and per-Sim ordinal without publishing speculative
  // audit events or touching live bags. A failed claim merely burns UUIDs.
  const recordingCtx = Object.create(ctx) as SimContext;
  recordingCtx.emit = (event) => prepared.events.push(event);
  for (const item of hoardRewardGrantItems(claim.items)) {
    const { instance } = item;
    if (isTrackedItem(ITEMS[item.itemId], instance)) {
      for (let i = 0; i < item.count; i++) {
        prepared.items.push({
          itemId: item.itemId,
          count: 1,
          instance: stampTrackedCopy(recordingCtx, meta, item.itemId, instance ?? {}, undefined),
        });
      }
    } else {
      prepared.items.push({
        itemId: item.itemId,
        count: item.count,
        ...(instance && { instance }),
      });
    }
  }
  return prepared;
}
