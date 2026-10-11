// Character storage shares one load/save boundary with the weekly ledger.

import { sanitizeBankState, savedBankState } from './bank';
import type { CharacterState } from './character_state';
import * as vaultMod from './materials_vault';
import type { PlayerMeta } from './sim';
import { cloneInvSlot } from './types';
import * as weeklyMod from './weekly_rewards';

export function restoreCharacterStorage(
  meta: PlayerMeta,
  s: CharacterState,
  droppedInstanceJunk: string[],
  playerId: number,
): void {
  // Bank sanitizes on load (never destroys items; a pre-bank save sanitizes to
  // an empty bank; see bank.ts sanitizeBankState). Deliberately NO wire-rev bump
  // here, unlike the vault install below: bankInfoWireRevFor is banker-gated and
  // a load always pairs with an empty lastSent, so a fresh session resends anyway.
  meta.bank = sanitizeBankState(s.bank, meta.name, droppedInstanceJunk, playerId);
  // The Materials Vault sanitizes on load too (never destroys stock; a pre-vault
  // save sanitizes to the empty locked vault): restoreVaultStateOnLoad owns the
  // whole-record replacement AND its vaultWireRev bump (the rationale sits there).
  vaultMod.restoreVaultStateOnLoad(meta, s.vault, droppedInstanceJunk, playerId);
  meta.weeklyRewards = weeklyMod.sanitizeWeeklyRewards(s.weeklyRewards);
}

export function savedCharacterStorage(
  meta: PlayerMeta,
): Pick<CharacterState, 'inventory' | 'bags' | 'bank' | 'vault' | 'weeklyRewards'> {
  return {
    inventory: meta.inventory.map(cloneInvSlot),
    bags: [...meta.bags],
    bank: savedBankState(meta.bank),
    // Hand-enumerated clone: tsc forces a new REQUIRED MaterialsVaultState field
    // to appear here, but an optional one would compile unpersisted; add it by hand.
    vault: vaultMod.savedVaultState(meta.vault),
    ...(meta.weeklyRewards
      ? { weeklyRewards: weeklyMod.sanitizeWeeklyRewards(meta.weeklyRewards) }
      : {}),
  };
}
