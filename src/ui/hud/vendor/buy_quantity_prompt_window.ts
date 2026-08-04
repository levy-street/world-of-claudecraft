// The vendor custom-amount prompt (phase 21): the 'custom' arm of the
// 1x/5x/10x/custom control row. Opens over the vendor window, capped at the
// countFit-derived row-unit maximum (the sim's own bag-fit math via
// vendor_buy_stack.ts maxBuyCount, so the shown cap can never promise a
// quantity the buy path's capacity pre-check would refuse), and submits the
// typed count through the same onBuy callback every other purchase uses.
//
// The third consumer of the shared modal recipe (src/ui/prompt_dialog.ts): the
// vendor window is the inert root while the prompt is open, and every teardown
// routes through the recipe's dismiss(). dismissBuyQuantityPrompts is the
// force-close backstop the Hud close path calls so the window is never left
// inert while hidden. Pointer/keyboard-only by the sell-prompt precedent
// (Q24, recorded limitation): the fixed control row is the gamepad path.

import type { ItemDef } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { installPromptDialog } from '../../prompt_dialog';

/** Remove any open custom-amount prompt and clear the window inert it held.
 *  Called on open (self-dedupe) and from the vendor close path as the
 *  force-close backstop. */
export function dismissBuyQuantityPrompts(vendorRoot: HTMLElement): void {
  const open = document.querySelectorAll('.buy-quantity-prompt');
  if (open.length === 0) return;
  for (const el of open) el.remove();
  vendorRoot.inert = false;
}

export function showBuyQuantityPrompt(
  vendorRoot: HTMLElement,
  item: ItemDef,
  maxCount: number,
  onSubmit: (count: number) => void,
): void {
  dismissBuyQuantityPrompts(vendorRoot);
  const opener = document.activeElement as HTMLElement | null;
  const stack = document.getElementById('prompt-stack');
  if (!stack) return;
  // A full bag reports a fit of 0; the prompt still opens at a floor of 1 and
  // lets the server's refuse-whole answer the attempt with the honest
  // bags-full toast (maxBuyCount's contract).
  const cap = Math.max(1, Math.floor(maxCount));
  const prompt = document.createElement('div');
  prompt.className = 'prompt panel buy-quantity-prompt';
  prompt.innerHTML = `<div class="prompt-text">${esc(
    t('itemUi.vendor.buyQuantityTitle', {
      item: itemDisplayName(item),
      max: formatNumber(cap, { maximumFractionDigits: 0 }),
    }),
  )}</div>`;
  const input = document.createElement('input');
  input.className = 'prompt-number';
  input.type = 'number';
  input.setAttribute('aria-label', t('itemUi.vendor.buyQuantityInput'));
  input.min = '1';
  input.max = String(cap);
  input.step = '1';
  input.value = '1';
  const confirm = document.createElement('button');
  confirm.className = 'btn';
  confirm.textContent = t('itemUi.vendor.buyQuantityConfirm');
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  // The shared prompt cancel label, the deposit-prompt precedent.
  cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
  const close = () => prompt.remove();
  prompt.append(input, confirm, cancel);
  const { dismiss, dismissAndReturn } = installPromptDialog(prompt, opener, close, {
    inertRoot: vendorRoot,
    idPrefix: 'vendor-prompt-title',
  });
  // Focus landing net for EVERY teardown path. The window's own restore
  // ladder cannot help here: it only runs when the pre-rebuild focus was
  // INSIDE the window (focusedWithin), and this prompt's focus lives in
  // #prompt-stack. And the recipe's opener return can silently no-op: any
  // renderVendor while the prompt is open (an inventory delta, a party
  // loot) detaches the captured row, and focusing a detached node does
  // nothing. When the recipe's return already landed inside the window,
  // this is a no-op; otherwise it re-lands by key on the rebuilt DOM. The
  // ladder mirrors renderVendorWindow's own (row, then sell-junk, then
  // close): the opener key leads, but browsers that do not focus buttons on
  // click (macOS Safari/Firefox, iOS) hand us a <body> opener with no key,
  // so the prompt's OWN row key (`buy:` plus the item id) is the rung that
  // keeps a keyboard user beside the row they were buying instead of on
  // Close, where a reflexive Enter would shut the whole vendor.
  const openerKey = opener?.dataset.focusKey;
  const landFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.isConnected && vendorRoot.contains(active)) return;
    const keyed = [...vendorRoot.querySelectorAll<HTMLElement>('[data-focus-key]')];
    const byKey = (key: string) => keyed.find((b) => b.dataset.focusKey === key);
    restoreFirstEnabled([
      openerKey ? byKey(openerKey) : undefined,
      byKey(`buy:${item.id}`),
      byKey('sell-junk'),
      byKey('close'),
    ]);
  };
  const submit = () => {
    const count = Math.max(1, Math.min(cap, Math.floor(Number(input.value) || 0)));
    dismiss();
    // Submit AFTER dismiss: onBuy rebuilds the vendor window, and the rebuild
    // must not run under a still-inert root. The buy replaces the opener row
    // node, so the landing net below re-finds it by key on the fresh DOM.
    onSubmit(count);
    landFocus();
  };
  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', () => {
    dismissAndReturn();
    landFocus();
  });
  // Registered AFTER installPromptDialog's own keydown listener on the same
  // element, so the recipe's Escape teardown (dismissAndReturn) has already
  // run when this fires; stopPropagation does not stop same-element
  // listeners, only the bubble.
  prompt.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') landFocus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  stack.appendChild(prompt);
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}
