// The "Deposit all materials" control both bank panes share (Personal and
// Vault). Where the materials go is the caller's decision; this module only
// builds the button and its always-present description.
import { t } from './i18n';

export interface DepositAllButtonModel {
  /** True names the Materials Vault sweep in the tooltip, false the bank's. */
  toVault: boolean;
  disabled: boolean;
  onClick: () => void;
  /** The Vault pane's instance: its own label, class and description id. */
  vaultPane?: { descId: string };
}

/** Append the button plus its description. The clarification (which items move
 *  and which stay) is exposed two ways so it reaches touch and keyboard users,
 *  not only a mouse-hover title: a `title` for desktop hover, PLUS a
 *  visually-hidden aria-describedby span the button always carries. A screen
 *  reader announces it on hover and keyboard focus, and reading it needs no
 *  pointer at all, so it also covers touch users who tap the button directly. */
export function appendDepositAllButton(parent: HTMLElement, model: DepositAllButtonModel): void {
  const descId = model.vaultPane?.descId ?? 'bank-deposit-all-desc';
  const deposit = document.createElement('button');
  deposit.type = 'button';
  deposit.className = `bank-deposit-all ui-btn${model.vaultPane ? ' vault-deposit-all' : ''}`;
  deposit.textContent = t(
    model.vaultPane ? 'hudChrome.bank.vaultDepositAll' : 'hudChrome.bank.depositAll',
  );
  const tooltip = t(
    model.toVault ? 'hudChrome.bank.vaultDepositAllTooltip' : 'hudChrome.bank.depositAllTooltip',
  );
  deposit.title = tooltip;
  deposit.setAttribute('aria-describedby', descId);
  deposit.disabled = model.disabled;
  deposit.addEventListener('click', model.onClick);
  parent.appendChild(deposit);
  const desc = document.createElement('span');
  desc.id = descId;
  desc.className = 'visually-hidden';
  desc.textContent = tooltip;
  parent.appendChild(desc);
}
