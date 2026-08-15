// The ONE quantity-prompt builder the bank family's three split-stack prompts
// share (rule of three: the personal bank withdraw prompt, the guild bank
// withdraw prompt, and the bags-side deposit prompt each hand-rolled the same
// chrome). It owns only the shared mechanics: the #prompt-stack mount, the
// number input (min 1, seeded 1, Enter submits), confirm/cancel, the injected
// WCAG dialog wiring (each window passes its own installPromptDialog so the
// inert root and Tab cycle stay that window's), and the submit protocol:
// `resolveCount` re-resolves the LIVE target at submit and returns null to
// REFUSE a stale prompt (acting on the wrong stack is worse than dismissing)
// or the clamped count to send. Every localized string arrives RESOLVED (the
// callers stay the render sink); every family-specific side effect (audio,
// repaint, focus landing) lives in the caller's closures.
//
// Registered in UI_DOM_MODULES (tests/architecture.test.ts): it mounts real
// DOM. Cold-path chrome: built once per prompt open, no driver, no layout read.

export interface QuantityPromptWiring {
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

export interface QuantityPromptOpts {
  /** Extra classes after 'prompt panel' (the family's teardown selectors). */
  className: string;
  titleText: string;
  inputAriaText: string;
  confirmText: string;
  cancelText: string;
  maxCount: number;
  /** Re-resolve the live target at submit: null refuses (stale), else the
   *  count clamped against the live state. */
  resolveCount(requested: number): number | null;
  send(count: number): void;
  /** Runs after the prompt closed on the submit path (sent true) or the
   *  stale-refusal path (sent false): repaint + focus landing. */
  afterClose(sent: boolean): void;
}

export function showQuantityPrompt(wiring: QuantityPromptWiring, opts: QuantityPromptOpts): void {
  wiring.dismissSiblings();
  const opener = document.activeElement as HTMLElement | null;
  const stack = document.getElementById('prompt-stack');
  if (!stack) return;
  const prompt = document.createElement('div');
  prompt.className = `prompt panel ${opts.className}`;
  const title = document.createElement('div');
  title.className = 'prompt-text';
  title.textContent = opts.titleText;
  prompt.appendChild(title);
  const input = document.createElement('input');
  input.className = 'prompt-number';
  input.type = 'number';
  input.setAttribute('aria-label', opts.inputAriaText);
  input.min = '1';
  input.max = String(opts.maxCount);
  input.step = '1';
  input.value = '1';
  const confirm = document.createElement('button');
  confirm.className = 'btn';
  confirm.textContent = opts.confirmText;
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = opts.cancelText;
  prompt.append(input, confirm, cancel);
  const { dismiss, dismissAndReturn } = wiring.installPromptDialog(prompt, opener, () =>
    prompt.remove(),
  );
  const submit = (): void => {
    const count = opts.resolveCount(Math.floor(Number(input.value) || 0));
    if (count === null) {
      dismiss();
      opts.afterClose(false);
      return;
    }
    opts.send(count);
    dismiss();
    opts.afterClose(true);
  };
  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', dismissAndReturn);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  stack.appendChild(prompt);
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}
