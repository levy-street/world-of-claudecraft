import { getContext, setContext } from 'svelte';

export interface AccountModalController {
  open: (accountId: number, onChanged?: () => void) => void;
  close: () => void;
}

const ACCOUNT_MODAL_CONTEXT = Symbol('account-modal');

export function setAccountModalController(controller: AccountModalController): void {
  setContext(ACCOUNT_MODAL_CONTEXT, controller);
}

export function getAccountModalController(): AccountModalController | null {
  return getContext<AccountModalController | undefined>(ACCOUNT_MODAL_CONTEXT) ?? null;
}
