// The spend of a cosmetic unlock item (the event skin token, a mech chroma
// armor plate): both are tracked epics (item_tracking.ts), so the spent copy
// writes its final `consume` ledger row naming the cosmetic it became
// (docs/design/item-tracking.md "Lineage"). Kept beside the Sim rather than in
// it: sim.ts is at its monolith ceiling, so its claimEventSkin and the
// item-use ctx binding call these instead of growing a removal-plus-row pair.
//
// Emit only, no rng draw: the shared draw order (tests/parity) never moves.

import { recordTrackedConsumed } from './item_tracking';
import { type MechChromaOwnershipHost, unlockMechChromaFromItem } from './mech_chroma_ownership';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemUseResult } from './types';

/** Spend one skin-select token on a claimed skin (Sim.claimEventSkin, after
 *  every claim gate passed): `detail` names the cosmetic it became
 *  (`class:<skin>` or `mech:<chromaId>`). */
export function spendSkinToken(
  ctx: SimContext,
  meta: PlayerMeta,
  tokenItemId: string,
  detail: string,
): void {
  const spent = ctx.removeItem(tokenItemId, 1, meta.entityId);
  recordTrackedConsumed(ctx, meta, tokenItemId, spent, 'skinToken', detail);
}

/** The `mechChroma` item-use arm (items.ts useItem via ctx): the ownership
 *  mutation (mech_chroma_ownership.ts) plus the spent plate's ledger row,
 *  source `mechChroma`, detail the chroma it unlocked. */
export function useMechChromaPlate(
  sim: MechChromaOwnershipHost & { readonly ctx: SimContext },
  meta: PlayerMeta,
  itemId: string,
  chromaId: string,
): ItemUseResult | undefined {
  return unlockMechChromaFromItem(sim, meta, itemId, chromaId, (spent) =>
    recordTrackedConsumed(sim.ctx, meta, itemId, spent, 'mechChroma', chromaId),
  );
}
