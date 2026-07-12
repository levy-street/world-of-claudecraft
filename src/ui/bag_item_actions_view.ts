// Pure, host-agnostic decision core for the mobile Bags item-action menu.

import {
  type BagAction,
  type BagItemInfo,
  type BagMode,
  bagDestroyAction,
  bagItemAction,
} from './bags_view';

export type MobileBagItemActionId =
  | 'equip'
  | 'equipBag'
  | 'consume'
  | 'use'
  | 'linkToChat'
  | 'destroy';

export interface MobileBagItemAction {
  id: MobileBagItemActionId;
  destructive?: boolean;
}

export interface MobileBagItemActionsView {
  actions: MobileBagItemAction[];
  canAssignConsumable: boolean;
  directAction?: BagAction;
}

const CONSUMABLE_KINDS = new Set(['food', 'drink', 'potion', 'elixir']);

function hasTransactionalMode(mode: BagMode): boolean {
  return (
    mode.tradeOpen ||
    mode.mailAttach ||
    mode.marketSell ||
    mode.vendorOpen ||
    mode.bankDeposit ||
    mode.petFeed
  );
}

export function mobileBagItemActions(item: BagItemInfo, mode: BagMode): MobileBagItemActionsView {
  if (hasTransactionalMode(mode)) {
    return {
      actions: [],
      canAssignConsumable: false,
      directAction: bagItemAction(item, mode),
    };
  }

  const actions: MobileBagItemAction[] = [];
  if (item.kind === 'weapon' || item.kind === 'armor') actions.push({ id: 'equip' });
  else if (item.kind === 'bag') actions.push({ id: 'equipBag' });
  else if (item.kind === 'food' || item.kind === 'drink') actions.push({ id: 'consume' });
  else if (item.kind === 'potion' || item.kind === 'elixir' || item.use)
    actions.push({ id: 'use' });

  actions.push({ id: 'linkToChat' });

  if (bagDestroyAction(item, mode) === 'discard') {
    actions.push({ id: 'destroy', destructive: true });
  }

  return {
    actions,
    canAssignConsumable: CONSUMABLE_KINDS.has(item.kind),
  };
}
