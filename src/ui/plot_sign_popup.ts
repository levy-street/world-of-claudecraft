// The plot deed card: what a Tidehold housing-plot sign shows when read
// (name, size, price, who holds it) with the one action that matters — buying
// it. Opened by the HUD's 'plotSign' event arm; the purchase goes back through
// the world's buyPlot, whose reply is the same event with the SOLD state, so
// the card repaints itself from that.
//
// Chrome follows realm_builder_popup.ts (the transient .tut-card family, not a
// managed window): role="status", no focus trap, closed by its own button.
// Plot names are world data and splice verbatim; only the chrome localizes.

import type { PlotDeedView } from '../sim/types';
import { formatMoney, t } from './i18n';

export class PlotSignPopup {
  private root: HTMLElement | null = null;
  private plot: PlotDeedView | null = null;

  constructor(private readonly buy: (deedId: string) => void) {}

  show(plot: PlotDeedView): void {
    this.plot = plot;
    this.hide();
    const ui = document.getElementById('ui');
    if (!ui) return;

    const root = document.createElement('div');
    root.className = 'tut-card rb-popup ps-popup';
    root.setAttribute('role', 'status');

    const title = document.createElement('div');
    title.className = 'tut-title';
    title.textContent = plot.name;
    root.appendChild(title);

    const block = document.createElement('div');
    block.className = 'rb-current';
    const label = document.createElement('div');
    label.className = 'rb-label';
    label.textContent = t('hudChrome.plotSign.title');
    const size = document.createElement('div');
    size.className = 'rb-name';
    size.textContent = t('hudChrome.plotSign.size', {
      size: t(`hudChrome.plotSign.sizes.${plot.size}`),
      w: String(Math.round(plot.w)),
      d: String(Math.round(plot.d)),
    });
    const price = document.createElement('div');
    price.className = 'rb-month';
    price.textContent = t('hudChrome.plotSign.price', { price: formatMoney(plot.priceCopper) });
    block.append(label, size, price);
    const status = document.createElement('div');
    status.className = 'rb-hint';
    if (plot.ownedByYou) status.textContent = t('hudChrome.plotSign.yours');
    else if (plot.ownerName) status.textContent = t('hudChrome.plotSign.sold', { name: plot.ownerName });
    else status.textContent = t('hudChrome.plotSign.purse', { purse: formatMoney(plot.yourCopper) });
    block.appendChild(status);
    root.appendChild(block);

    if (!plot.ownedByYou && !plot.ownerName) {
      const buy = document.createElement('button');
      buy.className = 'tut-skip ps-buy';
      buy.type = 'button';
      buy.textContent = t('hudChrome.plotSign.buy', { price: formatMoney(plot.priceCopper) });
      buy.disabled = plot.yourCopper < plot.priceCopper;
      buy.addEventListener('click', () => this.buy(plot.id));
      root.appendChild(buy);
    }

    const close = document.createElement('button');
    close.className = 'tut-skip';
    close.type = 'button';
    close.textContent = t('hudChrome.plotSign.close');
    close.addEventListener('click', () => this.hide());
    root.appendChild(close);

    ui.appendChild(root);
    this.root = root;
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
  }

  /** Re-localize after an in-game language switch: repaint the open card. */
  relocalize(): void {
    if (this.root && this.plot) this.show(this.plot);
  }
}
