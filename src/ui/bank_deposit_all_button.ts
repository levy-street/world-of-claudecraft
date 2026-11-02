// The Personal pane's "Deposit all materials" control. Where the materials go
// is the caller's decision (the Materials Vault once it is unlocked, else the
// bank); this module only builds the button and its always-present description.
import { t } from './i18n';

export interface DepositAllButtonModel {
  /** True routes the sweep to the Materials Vault (its tooltip), false to the bank. */
  toVault: boolean;
  disabled: boolean;
  onClick: () => void;
}

/** Which store the Personal pane's button feeds: the vault whenever it is unlocked. */
export function personalDepositAllToVault(vaultUpgrades: number | undefined): boolean {
  return (vaultUpgrades ?? 0) > 0;
}

/** Append the button plus its description. The clarification (which items move
 *  and which stay) is exposed two ways so it reaches touch and keyboard users,
 *  not only a mouse-hover title: a `title` for desktop hover, PLUS a
 *  visually-hidden aria-describedby span the button always carries. A screen
 *  reader announces it on hover and keyboard focus, and reading it needs no
 *  pointer at all, so it also covers touch users who tap the button directly. */
export function appendDepositAllButton(parent: HTMLElement, model: DepositAllButtonModel): void {
  const deposit = document.createElement('button');
  deposit.type = 'button';
  deposit.className = 'bank-deposit-all ui-btn';
  deposit.textContent = t('hudChrome.bank.depositAll');
  const tooltip = t(
    model.toVault ? 'hudChrome.bank.vaultDepositAllTooltip' : 'hudChrome.bank.depositAllTooltip',
  );
  deposit.title = tooltip;
  deposit.setAttribute('aria-describedby', 'bank-deposit-all-desc');
  deposit.disabled = model.disabled;
  deposit.addEventListener('click', model.onClick);
  parent.appendChild(deposit);
  const desc = document.createElement('span');
  desc.id = 'bank-deposit-all-desc';
  desc.className = 'visually-hidden';
  desc.textContent = tooltip;
  parent.appendChild(desc);
}
