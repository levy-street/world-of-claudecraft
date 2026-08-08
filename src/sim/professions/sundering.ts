// The Sundered Essence extraction (Masterwrought phase 04): a cast-paced,
// disenchant-adjacent action that breaks a RAID-sourced epic of the tier into
// the bound ceiling material the Perfecting stage consumes (ruling R1). Any
// character can sunder (no profession gate: the research's TBC-tailoring
// lesson bars stacking access gates on the apex chain); the cost IS the epic.
//
// Shape: the whole cast rides the enchant-family session seam
// (beginEnchantFamilyCast / clearEnchantCastSession in enchanting.ts), so it
// inherits the cancel semantics, the 1-based bag-slot parity encoding, and,
// critically, the pinned-slot re-check: a mid-cast bag splice (move, destroy,
// sell, bank, sort consolidation) can slide a DIFFERENT copy of the same item
// id under the pinned index, and an id-only check would then destroy a copy
// the player never selected (the phase 03 QA amendment names this hazard for
// exactly this cast). Deny and let the player re-pick, the disenchant rule.
//
// Determinism: the extraction draws NO rng anywhere (yield is a deterministic
// constant), so it is draw-order neutral by construction.
//
// Feedback: refusals are single-line ctx.error emits (each with its EXACT
// matcher row in src/ui/sim_i18n.ts, the phase 02 pattern); success passes
// callerLogs so the hub's generic receive line yields to the one sunder line
// naming the destroyed piece (the loot ding still fires).

import { bagCapacity, bagsFullError, fitsAll } from '../bags';
import { ITEMS } from '../data';
import { itemFromRaid } from '../item_level';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, type InvSlot, type ItemDef, isConsuming, SUNDER_CAST_ID } from '../types';
import {
  beginEnchantFamilyCast,
  clearEnchantCastSession,
  consumePreferredDisenchantVictim,
  consumeSelectedInventorySlot,
  disenchantVictimPin,
} from './enchanting';
import { SUNDERED_ESSENCE_ITEM_ID } from './masterwrought_materials';

// Deterministic: one essence per sundered epic (recorded in state.md; the
// RS3 trimmed-masterwork model this stage follows is a 1:1 sink).
export const SUNDERED_ESSENCE_YIELD = 1;

/** The one eligibility rule: an epic whose source index says a raid encounter
 *  drops it. Rift legendaries and heroic five-man epics are excluded by the
 *  index itself (itemFromRaid), vendor and crafted epics never enter it. */
export function isSunderable(def: ItemDef | undefined): boolean {
  return !!def && def.quality === 'epic' && itemFromRaid(def.id);
}

/** Shared admission for the start AND the completion re-validation: emits the
 *  refusal line itself and reports whether the attempt may proceed. The
 *  scratch consume mirrors evaluateDisenchantAdmission so the capacity model
 *  cannot drift from what the completion actually does. */
function sunderAdmitted(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  slotIndex: number | undefined,
): boolean {
  const def = ITEMS[itemId];
  if (!isSunderable(def)) {
    ctx.error(meta.entityId, 'Only raid-won epics can be sundered.');
    return false;
  }
  const scratch: InvSlot[] = meta.inventory.map((s) => ({ ...s }));
  if (consumeSelectedInventorySlot(scratch, itemId, slotIndex) === null) {
    ctx.error(meta.entityId, 'You are not holding that item.');
    return false;
  }
  if (slotIndex === undefined) {
    if (consumePreferredDisenchantVictim(scratch, itemId) === undefined) {
      ctx.error(meta.entityId, 'You are not holding that item.');
      return false;
    }
  }
  const adds: InvSlot[] = [{ itemId: SUNDERED_ESSENCE_ITEM_ID, count: SUNDERED_ESSENCE_YIELD }];
  if (!fitsAll(scratch, bagCapacity(meta.bags), adds)) {
    bagsFullError(ctx, meta.entityId);
    return false;
  }
  return true;
}

/** Command entry point: validates and STARTS a SUNDER_CAST_ID cast. The
 *  essence resolves only in completeSunderCast. Runs on the deterministic
 *  tick the command arrives on, never off-tick. */
export function extractEssence(
  ctx: SimContext,
  itemId: string,
  pid?: number,
  slotIndex?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (!sunderAdmitted(ctx, meta, itemId, slotIndex)) return;
  beginEnchantFamilyCast(ctx, p, SUNDER_CAST_ID, {
    itemId,
    bagSlot: slotIndex === undefined ? -1 : slotIndex,
    enchantId: '',
    equipSlot: '',
    confirmReplace: false,
    // Pin the SELECTED copy's identity, not just its index: the complete-side
    // re-check below is what stops a mid-cast bag splice from redirecting the
    // destroy onto a different copy of the same item id. An unpinned sunder
    // re-resolves its preferred victim fresh and needs no pin.
    targetPin: slotIndex === undefined ? '' : disenchantVictimPin(meta.inventory[slotIndex]),
  });
}

/** Completion of a running sunder cast (updateCasting routes here):
 *  re-validates, applies the pinned-slot re-check, consumes exactly one copy
 *  under the disenchant victim discipline, and grants the essence. */
export function completeSunderCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const session = clearEnchantCastSession(p);
  const itemId = session.itemId;
  const slotIndex = session.bagSlot < 0 ? undefined : session.bagSlot;
  // The phase 03 QA amendment's re-check: re-resolve the selected copy at
  // completion and refuse if it moved or merged (inv_sort's consolidation
  // splice shifts indices exactly when it empties a donor stack).
  if (
    slotIndex !== undefined &&
    disenchantVictimPin(meta.inventory[slotIndex]) !== session.targetPin
  ) {
    ctx.error(meta.entityId, 'The item moved; sundering canceled.');
    return;
  }
  if (!sunderAdmitted(ctx, meta, itemId, slotIndex)) return;
  const consumed =
    slotIndex !== undefined
      ? consumeSelectedInventorySlot(meta.inventory, itemId, slotIndex)
      : consumePreferredDisenchantVictim(meta.inventory, itemId);
  if (consumed === null || consumed === undefined) {
    ctx.error(meta.entityId, 'You are not holding that item.');
    return;
  }
  const def = ITEMS[itemId];
  ctx.addItem(SUNDERED_ESSENCE_ITEM_ID, SUNDERED_ESSENCE_YIELD, meta.entityId, {
    callerLogs: true,
  });
  ctx.emit({
    type: 'log',
    text: `You sunder ${def?.name ?? itemId} into Sundered Essence.`,
    color: '#c9f',
    pid: meta.entityId,
  });
}
