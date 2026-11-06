import { dismissBagPrompts } from './bags_window';
import { touchBagsShown } from './mobile_hud_layout';

/** Bank and bags share a layout lifecycle, while each keeps its own focus owner. */
export function openBankCompanion(
  bank: { open(): void },
  bags: HTMLElement,
  renderBags: () => void,
): void {
  document.body.classList.add('bank-open');
  bank.open();
  renderBags();
  bags.style.display = 'flex';
}

export function closeBankBags(
  bags: HTMLElement,
  cancelPetFeed: () => void,
  renderBags: () => void,
): void {
  const classes = document.body.classList;
  const closeMobileBags = touchBagsShown(classes, bags.style.display);
  classes.remove('bank-open');
  if (closeMobileBags) {
    dismissBagPrompts();
    bags.style.display = 'none';
    bags.inert = false;
    cancelPetFeed();
  } else if (bags.style.display !== 'none') renderBags();
}

/** A mobile companion close returns the remaining window to full width.
 * Desktop retains its docked offset until the bank or market closes. */
export function undockBagCompanions(bankOpen: boolean, marketOpen: boolean): void {
  const classes = document.body.classList;
  if (!classes.contains('mobile-touch')) return;
  if (bankOpen) classes.remove('bank-open');
  if (marketOpen) classes.remove('market-open');
}
