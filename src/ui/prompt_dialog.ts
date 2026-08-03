// WCAG 2.2 AA modal wiring for the ad-hoc quantity/confirm prompts that mount
// into #prompt-stack (the bags discard/sell prompts, the bank withdraw/deposit
// prompts, the vendor custom-amount prompt). Extracted on the rule of three:
// the bags and bank windows each carried this recipe as a private method
// differing only in inert root and id prefix, and the vendor prompt would have
// been the third copy.
//
// The recipe: role=dialog + aria-modal + aria-labelledby (the prompt text), a
// self-contained Tab cycle among the prompt's controls (prompts append to
// #prompt-stack, outside their window's reach, so they own their own trap), an
// Escape close, and focus return to the element that opened the prompt. The
// window behind the prompt is marked inert while it is open, so a screen
// reader / Tab cannot reach the blocked surface underneath. EVERY teardown
// path (confirm/submit, cancel, Escape) routes through the returned dismiss(),
// which clears inert BEFORE the prompt is removed; callers whose window can be
// force-closed out from under an open prompt should also clear inert in their
// own teardown as a backstop, so the root is never left inert while hidden.
// The focus-returning variant clears inert before refocusing (a focus into a
// still-inert subtree is silently dropped, and the openers live inside the
// inert root).

import { FOCUSABLE_SELECTOR } from './focus_manager';

// Monotonic id source for the prompts' aria-labelledby target, so the id never
// couples to class ordering. Shared across every consumer; ids only need to be
// unique, not sequential per window.
let promptDialogSeq = 0;

export interface PromptDialogHandle {
  /** Clear inert on the root, then run the caller's close. The one teardown
   *  chokepoint every path must route through, so inert never leaks. */
  dismiss: () => void;
  /** dismiss(), then return focus to the opener (WCAG 2.4.3). */
  dismissAndReturn: () => void;
}

export function installPromptDialog(
  prompt: HTMLElement,
  opener: HTMLElement | null,
  close: () => void,
  opts: {
    /** The window root blocked behind this modal prompt (set inert while open). */
    inertRoot: HTMLElement;
    /** Prefix for the generated aria-labelledby id, e.g. 'bags-prompt-title'. */
    idPrefix: string;
  },
): PromptDialogHandle {
  prompt.setAttribute('role', 'dialog');
  prompt.setAttribute('aria-modal', 'true');
  const { inertRoot } = opts;
  inertRoot.inert = true;
  const titleEl = prompt.querySelector('.prompt-text') as HTMLElement | null;
  if (titleEl) {
    if (!titleEl.id) titleEl.id = `${opts.idPrefix}-${promptDialogSeq++}`;
    prompt.setAttribute('aria-labelledby', titleEl.id);
    // Name an unlabeled quantity field by the prompt's own question (the same
    // titled text, e.g. "Destroy how many Linen Cloth?") so a number input is
    // never anonymous (WCAG 1.3.1 / 4.1.2). An input carrying its own
    // dedicated aria-label is left alone (aria-labelledby would otherwise
    // shadow the better name).
    const numInput = prompt.querySelector('.prompt-number');
    if (numInput && !numInput.hasAttribute('aria-label')) {
      numInput.setAttribute('aria-labelledby', titleEl.id);
    }
  }
  // Clear inert THEN remove the prompt; the only teardown the confirm and the
  // cancel paths share, so routing every close through it guarantees inert
  // never leaks.
  const dismiss = (): void => {
    inertRoot.inert = false;
    close();
  };
  const dismissAndReturn = (): void => {
    dismiss();
    opener?.focus();
  };
  prompt.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    // Escape: stopPropagation, not just preventDefault. The input layer's
    // window-level keydown runs the global escape action (closeAll) regardless of
    // defaultPrevented, and prompt BUTTONS are not tag-exempt like inputs, so
    // without it one keypress dismisses the prompt AND closes the whole window.
    if (ke.key === 'Escape') {
      ke.preventDefault();
      ke.stopPropagation();
      dismissAndReturn();
      return;
    }
    // Enter / Space: stopPropagation for the same reason, keeping the default so
    // native activation (Enter/Space on the confirm and cancel buttons) survives.
    // A submit handler on the quantity input runs at the target phase and removes
    // the prompt DURING this keydown, so a window-level gate keyed on the prompt's
    // presence runs too late: without the stop, the same press hits the global
    // chat/jump bind and steals the WCAG 2.4.3 focus return. The event path is
    // fixed at dispatch, so this listener still runs after the detach; only THEN
    // cancel the default too, or the browser runs the key's activation against
    // the freshly re-landed focus (Enter ghost-clicking [data-close] and closing
    // the whole window).
    if (ke.key === 'Enter' || ke.key === ' ' || ke.code === 'Space') {
      ke.stopPropagation();
      if (!prompt.isConnected) ke.preventDefault();
      return;
    }
    if (ke.key !== 'Tab') return;
    // Reuse the one canonical focusable set so a prompt that ever
    // gains an [href] / [tabindex] control stays inside the trap.
    const f = Array.from(prompt.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (ke.shiftKey && document.activeElement === first) {
      ke.preventDefault();
      last.focus();
    } else if (!ke.shiftKey && document.activeElement === last) {
      ke.preventDefault();
      first.focus();
    }
  });
  return { dismiss, dismissAndReturn };
}
