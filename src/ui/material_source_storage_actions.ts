// Shared action factories for explicit source moves between bags and storage.
// Each factory captures the container stack pin when the picker opens and
// closes over it until Confirm. Ordinary whole-stack transfer paths stay in
// their owning windows.

import { stackSizeOf } from '../sim/bags';
import { ITEMS } from '../sim/data';
import type { InvSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  captureMaterialSourceTransfer,
  selectedMaterialSourceTransfer,
} from './material_source_transfer_view';
import type { MaterialSourcesSelectionFactory } from './material_sources_dialog';
import { vaultMaterialHeadroom, vaultSpecialRef } from './vault_view';

export type MaterialStorageDestination = 'bank' | 'guild' | 'vault';

export function bagMaterialDepositSelection(
  world: IWorld,
  slot: InvSlot,
  destination: MaterialStorageDestination,
  afterMove: () => void,
): MaterialSourcesSelectionFactory {
  return () => {
    const slotIndex = world.inventory.indexOf(slot);
    if (slotIndex < 0) return null;
    const captured = captureMaterialSourceTransfer(world.inventory, slot.itemId, slotIndex);
    if (!captured) return null;
    // The vault has a live per-material ceiling and refuses an explicit
    // selection that exceeds it outright, so the picker is told what fits
    // (the bank and guild book are slot-bound and have no such number).
    const limit =
      destination === 'vault' ? vaultMaterialHeadroom(world.vaultInfo, slot.itemId) : undefined;
    return {
      sources: captured.sources,
      stepSize: stackSizeOf(ITEMS[slot.itemId]),
      ...(limit === undefined ? {} : { limit }),
      onConfirm: (selected) => {
        const intent = selectedMaterialSourceTransfer(captured, selected);
        if (destination === 'bank') world.bankDeposit(slotIndex, selected.count, intent);
        else if (destination === 'guild') {
          world.guildBankDeposit(slotIndex, selected.count, intent);
        } else {
          world.vaultDeposit(slotIndex, selected.count, intent);
        }
        afterMove();
      },
    };
  };
}

export function bankMaterialWithdrawSelection(
  world: IWorld,
  itemId: string,
  slotIndex: number,
  afterMove: () => void,
): MaterialSourcesSelectionFactory {
  return () => {
    const slots = world.bankInfo?.slots;
    if (!slots) return null;
    const captured = captureMaterialSourceTransfer(slots, itemId, slotIndex);
    if (!captured) return null;
    return {
      sources: captured.sources,
      stepSize: stackSizeOf(ITEMS[itemId]),
      onConfirm: (selected) => {
        world.bankWithdraw(
          slotIndex,
          selected.count,
          selectedMaterialSourceTransfer(captured, selected),
        );
        afterMove();
      },
    };
  };
}

export function guildMaterialWithdrawSelection(
  world: IWorld,
  itemId: string,
  slotIndex: number,
  afterMove: () => void,
): MaterialSourcesSelectionFactory {
  return () => {
    const slots = world.guildBankInfo?.slots;
    if (!slots) return null;
    const captured = captureMaterialSourceTransfer(slots, itemId, slotIndex);
    if (!captured) return null;
    return {
      sources: captured.sources,
      stepSize: stackSizeOf(ITEMS[itemId]),
      onConfirm: (selected) => {
        world.guildBankWithdraw(
          slotIndex,
          selected.count,
          selectedMaterialSourceTransfer(captured, selected),
        );
        afterMove();
      },
    };
  };
}

export function vaultMaterialWithdrawSelection(
  world: IWorld,
  itemId: string,
  slotIndex: number,
  afterMove: () => void,
): MaterialSourcesSelectionFactory {
  return () => {
    const slot = world.vaultInfo?.special[slotIndex];
    const slots = world.vaultInfo?.special;
    if (!slot || !slots || slot.itemId !== itemId) return null;
    const captured = captureMaterialSourceTransfer(slots, itemId, slotIndex);
    if (!captured) return null;
    const special = vaultSpecialRef(slotIndex, slot);
    return {
      sources: captured.sources,
      stepSize: stackSizeOf(ITEMS[itemId]),
      onConfirm: (selected) => {
        world.vaultWithdraw(itemId, selected.count, {
          ...special,
          selection: selectedMaterialSourceTransfer(captured, selected),
        });
        afterMove();
      },
    };
  };
}
