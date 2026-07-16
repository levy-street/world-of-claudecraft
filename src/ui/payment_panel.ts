// The shared $WOC payment-request panel: prompt + "Open in Wallet" link +
// "Copy Link" button, painted identically by the trade window (settling phase)
// and the market window (pending external purchase). One builder so a fix to
// the payment controls (href handling, a11y, copy wiring) can never land in
// one window and silently miss the other (r7#2). Callers own the prompt text;
// the CSS classes (trade-woc-pay*) are the pre-existing shared selectors.

import { t } from './i18n';

export interface PaymentPanelDeps {
  /** Best-effort clipboard write for the payment-link copy button; failures
   *  are swallowed by the caller (Hud), never thrown here. */
  copyToClipboard(text: string): void;
}

export function buildWocPayPanel(
  promptText: string,
  uri: string,
  deps: PaymentPanelDeps,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'trade-woc-pay';
  const prompt = document.createElement('div');
  prompt.className = 'trade-woc-pay-prompt';
  prompt.textContent = promptText;
  box.appendChild(prompt);
  const link = document.createElement('a');
  link.className = 'trade-woc-pay-link btn';
  link.href = uri;
  link.textContent = t('hud.trade.openInWallet');
  box.appendChild(link);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn trade-woc-pay-copy';
  copy.textContent = t('hud.trade.copyLink');
  // The confirmation ("Payment link copied.") is a toast, owned by Hud
  // (deps.copyToClipboard), so this button stays a static label rather than
  // holding its own transient-text timer.
  copy.addEventListener('click', () => deps.copyToClipboard(uri));
  box.appendChild(copy);
  return box;
}
