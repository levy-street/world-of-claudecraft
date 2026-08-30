// The ONE buy-confirm prompt builder the bank family's three purchase
// confirms share (rule of three, the bank_quantity_prompt.ts precedent: the
// personal buy-slots confirm, the guild treasury confirm, and the vault
// unlock/upgrade confirm each hand-rolled the same chrome). It owns only the
// shared mechanics: the #prompt-stack mount, the escaped body text, the
// confirm/cancel .btn pair, the injected WCAG dialog wiring (each window
// passes its own installPromptDialog so the inert root and Tab cycle stay
// that window's), cancel as dismiss-and-return, and the deferred confirm
// focus. Every localized string arrives RESOLVED (the callers stay the render
// sink); every family-specific side effect (the world send, audio, repaint,
// the focus landing) lives in the caller's onConfirm closure, which receives
// dismiss so the caller closes the prompt at the point its own flow wants.
//
// Registered in UI_DOM_MODULES (tests/architecture.test.ts): it mounts real
// DOM. Cold-path chrome: built once per prompt open, no driver, no layout
// read.

import { esc } from './esc';

export interface BuyConfirmPromptWiring {
  /** The owning window's WCAG prompt-dialog installer (role/aria-modal/Tab
   *  cycle/Escape/inert), so a shared prompt is indistinguishable from a
   *  hand-rolled one to AT and to the window's force-close teardown. */
  installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): { dismiss: () => void; dismissAndReturn: () => void };
  /** Tear down the family's sibling prompts before mounting this one. */
  dismissSiblings(): void;
}

export interface BuyConfirmPromptOpts {
  /** Extra classes after 'prompt panel bank-buy-prompt' (the family teardown
   *  selector rides the shared class; callers add their own markers). NOTE
   *  the DELIBERATE divergence from bank_quantity_prompt.ts, whose required
   *  className makes the CALLER supply the family class: the buy confirm has
   *  exactly one family class and every caller wants it, so the leaf owns it
   *  and the field is optional; the quantity prompt is shared with the BAGS
   *  family (bank-deposit-prompt), so its callers must choose. */
  className?: string;
  /** The caller-localized confirm body (escaped here). */
  text: string;
  /** Optional caller-localized secondary line under the body (escaped here),
   *  styled .bank-buy-disclaimer: the economy price disclaimer. The rule
   *  since phase 09: a confirm committing one of the three server-tunable
   *  STORAGE_PRICES dimensions (bank slots, bank sockets, vault rungs;
   *  server/storage_prices.ts) passes it; the guild confirms omit it because
   *  the guild rung ladder is deliberately outside the tunable seam (the
   *  packet ledger's OPEN call), and an omitting caller renders no extra
   *  node. */
  secondaryText?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** The confirm side effects: the world send, audio, repaint, and the focus
   *  landing, in the caller's own order around the received dismiss. */
  onConfirm(dismiss: () => void): void;
  /** An OPTIONAL second confirm action, rendered immediately after the primary
   *  one and before cancel: the Claudium rail of the banker's dual-price rung
   *  purchase (Bank Storage phase 13). One prompt, two rails, so both
   *  currencies confirm the same way and the gold rail stays primary BY
   *  POSITION rather than by demoting anything. An omitting caller renders no
   *  extra node, which is every pre-phase-13 caller. */
  altConfirm?: {
    label: string;
    onConfirm(dismiss: () => void): void;
  };
  /** Fired exactly once when the prompt closes through `dismiss()`: either
   *  confirm, cancel, or Escape. It cannot tell the caller WHICH, on purpose; a
   *  caller that needs to distinguish (the rung flow, which drops an unsent
   *  purchase intent on abandonment) latches that itself in its own onConfirm and
   *  reads the latch here.
   *
   *  NOT the family teardown, which removes the node directly. See the close
   *  callback below. */
  onDismiss?(): void;
}

export function showBuyConfirmPrompt(
  wiring: BuyConfirmPromptWiring,
  opts: BuyConfirmPromptOpts,
): void {
  wiring.dismissSiblings();
  const opener = document.activeElement as HTMLElement | null;
  const stack = document.getElementById('prompt-stack');
  if (!stack) return;
  const prompt = document.createElement('div');
  prompt.className = ['prompt panel bank-buy-prompt', opts.className].filter(Boolean).join(' ');
  prompt.innerHTML =
    `<div class="prompt-text">${esc(opts.text)}</div>` +
    (opts.secondaryText !== undefined
      ? `<div class="bank-buy-disclaimer">${esc(opts.secondaryText)}</div>`
      : '');
  const confirm = document.createElement('button');
  confirm.className = 'btn';
  confirm.textContent = opts.confirmLabel;
  // The alternate rail, when there is one. Built with the same .btn treatment
  // and placed AFTER the primary confirm: the two rails are independent
  // per-product prices, never a rate or a combined total, and order is the
  // only thing that says which one is primary.
  const alt = opts.altConfirm
    ? (() => {
        const button = document.createElement('button');
        button.className = 'btn bank-buy-alt';
        button.textContent = opts.altConfirm.label;
        return button;
      })()
    : null;
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = opts.cancelLabel;
  prompt.append(confirm, ...(alt ? [alt] : []), cancel);
  const { dismiss, dismissAndReturn } = wiring.installPromptDialog(prompt, opener, () => {
    prompt.remove();
    // Every close path that goes through dismiss() funnels here, which is why the
    // hook lives here and not on the two buttons: Escape reaches it too.
    //
    // WHAT IT DOES NOT REACH, corrected by Bank Storage phase 17 because this
    // comment used to claim the opposite: a FAMILY TEARDOWN removes the prompt
    // node directly (dismissBankPrompts in src/ui/bank_window.ts) and never runs
    // dismiss(), so this never fires on that path. A caller whose attempt owns
    // real money must therefore end that attempt at its OWN teardown sites as
    // well; the rung flow does, through one method on
    // src/ui/bank_rung_purchase_core.ts that both paths call.
    opts.onDismiss?.();
  });
  // The secondary line joins the dialog's accessible DESCRIPTION: the
  // installer names the dialog by .prompt-text only, so without this the
  // disclaimer is never announced when the confirm opens, yet it is part of
  // the purchase decision. The id rides the installer's own labelledby id.
  if (opts.secondaryText !== undefined) {
    const disclaimer = prompt.querySelector('.bank-buy-disclaimer') as HTMLElement | null;
    const labelId = prompt.getAttribute('aria-labelledby');
    if (disclaimer && labelId) {
      disclaimer.id = `${labelId}-desc`;
      prompt.setAttribute('aria-describedby', disclaimer.id);
    }
  }
  confirm.addEventListener('click', () => opts.onConfirm(dismiss));
  alt?.addEventListener('click', () => opts.altConfirm?.onConfirm(dismiss));
  cancel.addEventListener('click', dismissAndReturn);
  stack.appendChild(prompt);
  window.setTimeout(() => confirm.focus(), 0);
}
