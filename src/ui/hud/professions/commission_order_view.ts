// Pure, host-agnostic view model for the commission order board (issue #1298).
//
// The pure-core half of the pure-core + thin-consumer split (reference
// unbind_view.ts / crafting_view.ts): splits the viewer's IWorld
// `commissionOrders` projection (already filtered server/sim-side to what
// this viewer may see) into the three sections the window paints, resolves
// each row's item def for display, and decides which action button (if any)
// a row offers. Also builds the "open a new order" recipe picker from the
// viewer's own known, commission-eligible recipes. DOM/i18n-free so
// tests/commission_order_view.test.ts can drive it directly.

import { isCommissionEligible } from '../../../sim/professions/commission';
import type { ItemDef } from '../../../sim/types';
import type {
  CommissionOrderScope,
  CommissionOrderStatus,
  CommissionOrderView,
} from '../../../world_api/professions';

export interface CommissionOrderRowModel {
  id: number;
  recipeId: string;
  itemId: string;
  item?: ItemDef;
  requesterName: string;
  scope: CommissionOrderScope;
  crafterName?: string;
  status: CommissionOrderStatus;
  acceptedByName?: string;
  /** The accepter's craft record line (Masterwrought phase 14, the quality
   *  signal): present only when the row should RENDER it, i.e. the order is
   *  accepted (or delivered: the record stays honest on the closing row) AND
   *  the wire actually carried the snapshot (absent from a pre-signal
   *  server, so no row ever invents a zero). */
  crafterRecord?: { masterworks: number; legendaries: number };
  canCancel: boolean;
  canAccept: boolean;
  canDeliver: boolean;
}

export interface OpenableRecipeOption {
  recipeId: string;
  itemId: string;
  item?: ItemDef;
}

export interface CommissionOrderBoardModel {
  /** Orders the viewer themselves opened (any status). */
  myOrders: CommissionOrderRowModel[];
  /** Orders the viewer accepted, or that a 'crafter'-scope order still
   *  open names them for: the viewer's own commission work. */
  toCraft: CommissionOrderRowModel[];
  /** Every other visible order: the general open board. */
  board: CommissionOrderRowModel[];
  /** The viewer's known, commission-eligible recipes, for the "open a new
   *  order" picker. */
  openableRecipes: OpenableRecipeOption[];
}

interface RecipeLike {
  id: string;
  resultItemId: string;
}

/** The record renders on rows a crafter is COMMITTED to (accepted, and the
 *  delivered close-out while it lingers in retention), never on open or
 *  never-accepted terminal rows, and only when both numbers actually rode the
 *  wire (a pre-signal server sends neither; half a snapshot is treated as
 *  none rather than inventing a zero for the missing half). */
function crafterRecordFor(
  o: CommissionOrderView,
): CommissionOrderRowModel['crafterRecord'] | undefined {
  if (o.status !== 'accepted' && o.status !== 'delivered') return undefined;
  if (o.crafterMasterworks === undefined || o.crafterLegendaries === undefined) return undefined;
  return { masterworks: o.crafterMasterworks, legendaries: o.crafterLegendaries };
}

function toRowModel(
  o: CommissionOrderView,
  items: Record<string, ItemDef>,
): CommissionOrderRowModel {
  const crafterRecord = crafterRecordFor(o);
  return {
    id: o.id,
    recipeId: o.recipeId,
    itemId: o.itemId,
    item: items[o.itemId],
    requesterName: o.requesterName,
    scope: o.scope,
    crafterName: o.crafterName,
    status: o.status,
    acceptedByName: o.acceptedByName,
    ...(crafterRecord ? { crafterRecord } : {}),
    canCancel: o.mine && o.status === 'open',
    canAccept: !o.mine && o.status === 'open',
    canDeliver: o.mineToCraft && o.status === 'accepted',
  };
}

/**
 * Build the board model from the viewer's IWorld projection, the viewer's
 * known recipes (for the picker), and the item table. `orders` is already
 * scoped to what this viewer may see (own requests, accepted/targeted
 * commissions, the open board); this function only buckets and decorates.
 */
export function buildCommissionOrderBoardModel(
  orders: readonly CommissionOrderView[],
  knownRecipes: readonly RecipeLike[],
  items: Record<string, ItemDef>,
): CommissionOrderBoardModel {
  const myOrders: CommissionOrderRowModel[] = [];
  const toCraft: CommissionOrderRowModel[] = [];
  const board: CommissionOrderRowModel[] = [];
  for (const o of orders) {
    const row = toRowModel(o, items);
    if (o.mine) myOrders.push(row);
    else if (o.mineToCraft) toCraft.push(row);
    else board.push(row);
  }
  const openableRecipes: OpenableRecipeOption[] = knownRecipes
    .filter((r) => isCommissionEligible(items[r.resultItemId]))
    .map((r) => ({ recipeId: r.id, itemId: r.resultItemId, item: items[r.resultItemId] }));
  return { myOrders, toCraft, board, openableRecipes };
}
