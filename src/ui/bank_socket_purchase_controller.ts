// DOM adapter for the personal-bank socket purchase. The pure core owns the
// consent/echo decision; this leaf owns prompt chrome, busy semantics, visible
// and announced stale-price feedback, and post-repaint focus.

import { type BuyConfirmPromptWiring, showBuyConfirmPrompt } from './bank_buy_prompt';
import {
  BankSocketPurchaseCore,
  type BankSocketPurchaseOffer,
  type BankSocketPurchaseSnapshot,
} from './bank_socket_purchase_core';
import { appendBankStatusLine, type BankStatusAnnouncementState } from './bank_status_line';
import { formatMoney, t } from './i18n';
import type { StorageRungEchoTimers } from './storage_rung_echo_core';

export interface BankSocketPurchaseControllerDeps extends BuyConfirmPromptWiring {
  timers: StorageRungEchoTimers;
  current(): BankSocketPurchaseSnapshot | null | undefined;
  send(): void;
  repaint(): void;
  root(): HTMLElement;
}

export class BankSocketPurchaseController {
  private readonly core: BankSocketPurchaseCore;
  private status: BankStatusAnnouncementState | null = null;

  constructor(private readonly deps: BankSocketPurchaseControllerDeps) {
    this.core = new BankSocketPurchaseCore(deps.timers, deps.repaint);
  }

  observeRevision(revision: number | null | undefined): boolean {
    return this.core.observeRevision(revision);
  }

  observeText(text: string): boolean {
    return this.core.observeText(text);
  }

  clearStatus(): void {
    this.status = null;
  }

  markBusy(button: HTMLButtonElement): void {
    if (!this.core.pending) return;
    // disabled + aria-busy, the vault/guild busy form: aria-disabled on a
    // natively disabled button is redundant and the three ladders align.
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }

  appendStatus(parent: HTMLElement): void {
    const status = this.status;
    if (!status) return;
    appendBankStatusLine(parent, status, {
      text: t('hudChrome.bank.priceChanged'),
      visibleClass: 'bank-socket-purchase-status',
      liveDataAttribute: 'data-bank-socket-purchase-live',
      isCurrent: () => this.status === status,
    });
  }

  show(offer: BankSocketPurchaseOffer): void {
    if (this.core.pending) return;
    showBuyConfirmPrompt(this.deps, {
      text: t('hudChrome.bank.socketUnlockConfirm', { price: formatMoney(offer.cost) }),
      secondaryText: t('hudChrome.bank.priceDisclaimer'),
      confirmLabel: t('hudChrome.bank.socketUnlockAccept'),
      cancelLabel: t('itemUi.vendor.sellQuantityCancel'),
      onConfirm: (dismiss) => {
        const decision = this.core.confirm(offer, this.deps.current());
        if (decision === 'pending') return;
        if (decision === 'changed') this.status = { announcedText: null };
        else {
          this.status = null;
          this.deps.send();
        }
        dismiss();
        this.deps.repaint();
        if (decision === 'changed') this.focusOffer();
        else this.focusClose();
      },
    });
  }

  private focusOffer(): void {
    const root = this.deps.root();
    const offer = root.querySelector<HTMLElement>(
      '.bank-sockets .bank-socket.locked:not(:disabled):not([aria-disabled="true"])',
    );
    (offer ?? root.querySelector<HTMLElement>('[data-close]'))?.focus();
  }

  private focusClose(): void {
    this.deps.root().querySelector<HTMLElement>('[data-close]')?.focus();
  }
}
