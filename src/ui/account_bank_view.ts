import { isTransferLockedInstance } from '../sim/item_instance_transfer';
import { isItemLocked } from '../sim/item_lock';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import type { AccountBankInfo } from '../world_api/bank';
import type { TranslationKey } from './i18n';

/** Only transferable copies can cross character ownership. The server rechecks
 *  (membershipBankTransferable in src/sim/membership_bank.ts); this mirrors it
 *  so the bank pane's grid and the bags' deposit click never offer a move the
 *  server refuses as bound. */
export function accountBankItemMovable(
  item: { kind: string; soulbound?: boolean; noMarketList?: boolean },
  instance: ItemInstancePayload | undefined,
): boolean {
  return (
    item.kind !== 'quest' &&
    !item.soulbound &&
    !item.noMarketList &&
    !isTransferLockedInstance(instance) &&
    !isItemLocked(instance)
  );
}

export function accountBankTransferAllowed(slot: InvSlot, item: ItemDef | undefined): boolean {
  return !!item && accountBankItemMovable(item, slot.instance);
}

/** The character a bag click deposits into: only while the selected bank is on
 *  screen (stage ready), never while it loads, fails or awaits a choice. */
export function accountBankDepositTarget(
  info: AccountBankInfo | null,
  membershipActive: boolean | undefined,
): number | null {
  const stage = accountBankStage(info, membershipActive);
  return stage.kind === 'ready' ? stage.characterId : null;
}

/** What the Other characters pane shows before (or instead of) the two grids. */
export type AccountBankStage =
  | { kind: 'membership' }
  | { kind: 'loading' }
  | { kind: 'no_characters' }
  | { kind: 'choose' }
  | { kind: 'opening'; characterId: number }
  | { kind: 'failed'; characterId: number | null; errorKey: TranslationKey }
  | { kind: 'ready'; characterId: number; errorKey?: TranslationKey };

export function accountBankStage(
  info: AccountBankInfo | null,
  membershipActive: boolean | undefined,
): AccountBankStage {
  if (membershipActive !== true) return { kind: 'membership' };
  // The roster request is in flight (or its reply was refused by the decoder).
  if (!info) return { kind: 'loading' };
  const characterId = info.selectedCharacterId;
  const errorKey = info.error ? accountBankErrorKey(info.error) : undefined;
  // A refused move keeps its bank (the server resends it), so the grids stay up
  // under the refusal instead of vanishing behind it.
  if (characterId !== null && info.bank) return { kind: 'ready', characterId, errorKey };
  if (errorKey) return { kind: 'failed', characterId, errorKey };
  if (info.characters.length === 0) return { kind: 'no_characters' };
  if (characterId === null) return { kind: 'choose' };
  return { kind: 'opening', characterId };
}

/** Server refusal codes (membership_bank_service / membership_bank_db) to the line
 *  the pane shows. Unknown codes read as the generic unavailable line. */
export function accountBankErrorKey(error: string): TranslationKey {
  switch (error) {
    case 'membership_required':
      return 'hudChrome.bank.accountMembership';
    case 'online':
      return 'hudChrome.bank.accountOnline';
    case 'busy':
    case 'rate_limited':
      return 'hudChrome.bank.accountBusy';
    case 'no_fit':
      return 'hudChrome.bank.accountNoFit';
    case 'stale':
      return 'hudChrome.bank.accountStale';
    case 'bound':
      return 'hudChrome.bank.accountBound';
    case 'too_large':
      return 'hudChrome.bank.accountTooLarge';
    default:
      return 'hudChrome.bank.accountUnavailable';
  }
}
