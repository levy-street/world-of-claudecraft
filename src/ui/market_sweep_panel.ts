// The World Market's Market Sweep card: the thin DOM painter over
// market_sweep_core.ts. Lives at the head of the Browse list while a sweep is
// staged (a row's Sweep button stages it): the item, a unit-count field, the
// server's live quote, and a Sweep button that asks first through Hud's one modal
// confirm prompt, then sends the quoted total as the price cap the sim enforces.
//
// Snapshot-driven like the rest of the window: staging or editing the count sends
// marketSweepQuote, and the quote line is PATCHED in place when the echo lands
// (refresh, the refreshSellPriceRef precedent) so the count field the player is
// typing in is never rebuilt under them. The whole card is rebuilt only when the
// Browse list itself repaints (mount), from the staged state.

import { audio } from '../game/audio';
import { MARKET_SWEEP_MAX_UNITS } from '../sim/market_sweep';
import type { IWorld } from '../world_api';
import { esc } from './esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from './i18n';
import {
  type MarketSweepAgreed,
  type MarketSweepStage,
  recheckMarketSweep,
  sweepCountFromInput,
  sweepQuoteView,
} from './market_sweep_core';

export interface MarketSweepPanelDeps {
  world(): IWorld;
  showError(text: string): void;
  /** Hud's one modal confirm prompt (the market Buy gate's own dependency). */
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  /** Re-render the Browse list (the window's renderContent): staging a sweep
   *  mounts the card, clearing it unmounts it. */
  repaint(): void;
}

const count0 = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });

export class MarketSweepPanel {
  private staged: MarketSweepStage | null = null;
  private itemName = '';
  private lastQuoteSig = '';
  private focusCountOnMount = false;

  constructor(private readonly deps: MarketSweepPanelDeps) {}

  get active(): boolean {
    return this.staged !== null;
  }

  /** A row's Sweep button: stage this item (keeping the typed count when the
   *  same item is re-staged), ask the server for a quote, and repaint. */
  stage(itemId: string, itemName: string): void {
    const count = this.staged?.itemId === itemId ? this.staged.count : 1;
    this.staged = { itemId, count };
    this.itemName = itemName;
    this.focusCountOnMount = true;
    this.requestQuote();
    this.deps.repaint();
  }

  /** Drop the staged sweep (the card's Close, or the window closing). A zero
   *  count is the wire's "clear": the sim sanitizes it to no quote. */
  clear(repaint = true): void {
    if (!this.staged) return;
    this.deps.world().marketSweepQuote(this.staged.itemId, 0);
    this.staged = null;
    this.lastQuoteSig = '';
    if (repaint) this.deps.repaint();
  }

  /** Build the card at the head of `list` (the Browse list container) when a
   *  sweep is staged. Called from the list's own repaint, so it never has to
   *  diff: the list was just emptied. */
  mount(list: HTMLElement): void {
    const stage = this.staged;
    if (!stage) return;
    const card = document.createElement('div');
    card.className = 'mkt-sweep ui-card';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', t('itemUi.market.sweepTitle', { item: this.itemName }));
    card.innerHTML =
      `<div class="mkt-sweep-head"><span class="mkt-sweep-title">${esc(
        t('itemUi.market.sweepTitle', { item: this.itemName }),
      )}</span>` +
      `<button type="button" class="mkt-sweep-close ui-btn" aria-label="${esc(t('itemUi.market.sweepClose'))}">${esc(t('itemUi.market.sweepClose'))}</button></div>` +
      `<div class="mkt-sweep-note">${esc(t('itemUi.market.sweepNote'))}</div>` +
      `<div class="mkt-price-row"><label for="mkt-sweep-qty">${esc(t('itemUi.market.sweepQuantity'))}</label>` +
      `<input class="coininput ui-input" id="mkt-sweep-qty" type="number" min="1" max="${MARKET_SWEEP_MAX_UNITS}" inputmode="numeric" value="${stage.count}"></div>` +
      `<div class="mkt-sweep-quote" role="status" aria-live="polite"></div>` +
      `<button type="button" class="mkt-sweep-go ui-btn ui-btn--red" disabled>${esc(t('itemUi.market.sweepButton'))}</button>`;
    const qty = card.querySelector<HTMLInputElement>('#mkt-sweep-qty');
    qty?.addEventListener('input', () => {
      if (!this.staged) return;
      const count = sweepCountFromInput(qty.value);
      if (count === this.staged.count) return;
      this.staged = { itemId: this.staged.itemId, count };
      this.requestQuote();
      this.paintQuote(card);
    });
    card.querySelector('.mkt-sweep-close')?.addEventListener('click', () => {
      audio.click();
      this.clear();
    });
    card.querySelector('.mkt-sweep-go')?.addEventListener('click', () => {
      audio.click();
      this.promptSweep();
    });
    list.appendChild(card);
    this.lastQuoteSig = '';
    this.paintQuote(card);
    if (this.focusCountOnMount) {
      this.focusCountOnMount = false;
      qty?.focus();
    }
  }

  /** Per-frame: patch the quote line when the server's echo changed. */
  refresh(root: HTMLElement): void {
    if (!this.staged) return;
    const card = root.querySelector<HTMLElement>('.mkt-sweep');
    if (card) this.paintQuote(card);
  }

  private requestQuote(): void {
    if (!this.staged) return;
    this.deps.world().marketSweepQuote(this.staged.itemId, this.staged.count);
  }

  private paintQuote(card: HTMLElement): void {
    if (!this.staged) return;
    const view = sweepQuoteView(this.deps.world().marketInfo, this.staged);
    const sig = JSON.stringify([this.staged, view]);
    if (sig === this.lastQuoteSig) return;
    this.lastQuoteSig = sig;
    const line = card.querySelector<HTMLElement>('.mkt-sweep-quote');
    const go = card.querySelector<HTMLButtonElement>('.mkt-sweep-go');
    if (!line || !go) return;
    if (view.state === 'waiting') {
      line.textContent = '';
      go.disabled = true;
      return;
    }
    if (view.state === 'none') {
      line.textContent = t('itemUi.market.sweepQuoteNone');
      go.disabled = true;
      return;
    }
    line.textContent = t(
      view.state === 'short' ? 'itemUi.market.sweepQuoteShort' : 'itemUi.market.sweepQuoteLine',
      {
        units: count0(view.units),
        listings: count0(view.listings),
        total: formatLocalizedMoney(view.total),
        each: formatLocalizedMoney(view.each),
      },
    );
    go.disabled = false;
  }

  // The Sweep gate: state the quoted terms in the modal prompt; nothing is sent
  // until OK, and OK re-resolves the quote against the live snapshot first.
  private promptSweep(): void {
    const stage = this.staged;
    if (!stage) return;
    const view = sweepQuoteView(this.deps.world().marketInfo, stage);
    if (view.state !== 'ok' && view.state !== 'short') return;
    const agreed: MarketSweepAgreed = { units: view.units, total: view.total };
    this.deps.confirmDialog(
      t('itemUi.market.sweepConfirmTitle'),
      t('itemUi.market.sweepConfirmBody', {
        item: this.itemName,
        units: count0(view.units),
        listings: count0(view.listings),
        total: formatLocalizedMoney(view.total),
        each: formatLocalizedMoney(view.each),
      }),
      t('itemUi.market.sweepButton'),
      t('itemUi.market.buyConfirmCancel'),
      () => this.commitSweep(stage, agreed),
    );
  }

  private commitSweep(stage: MarketSweepStage, agreed: MarketSweepAgreed): void {
    const check = recheckMarketSweep(this.deps.world().marketInfo, stage, agreed);
    if (check.state !== 'ok') {
      this.deps.showError(
        t(check.state === 'gone' ? 'itemUi.errors.sweepNoListings' : 'itemUi.market.sweepChanged'),
      );
      return;
    }
    this.deps.world().marketSweep(stage.itemId, stage.count, check.total);
    audio.coin();
  }
}
