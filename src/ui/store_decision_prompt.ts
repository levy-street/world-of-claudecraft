// Store-owned confirmation and result surfaces. Store decisions must not route
// through the HUD's body-level confirm dialog: the Armory inspector sits above
// the Store window, and a body-owned dialog leaves both Store surfaces reachable
// to assistive technology. This controller mounts in #prompt-stack, makes the
// Store (and an open inspector) inert, owns every teardown path, and can publish
// a nonmodal result when an async purchase finishes after the Store surface has
// gone away.

import { esc } from './esc';
import { installPromptDialog, type PromptDialogHandle } from './prompt_dialog';
import type { StorageRungEchoTimers } from './storage_rung_echo_core';
import { svgIcon } from './ui_icons';

/** How long the nonmodal result may sit on screen unattended. It is nonmodal
 *  chrome with pointer-events on mobile, published from an async purchase that
 *  can finish after its Store surface is gone, so with no expiry (and before
 *  the closeAll rung below) a result nobody dismissed sat over the world
 *  eating touches indefinitely. Generous on purpose: it is a purchase outcome
 *  the player should get a fair chance to read. */
export const STORE_RESULT_EXPIRY_MS = 60_000;

/** The registry Hud's single Escape dispatcher asks (the tap_menu shape), so
 *  Escape stays with closeAll and this module never grows its own key
 *  handler. A Set of WEAK references, insertion-ordered: construction
 *  registers, the returned handle unregisters, and holding the panel weakly
 *  means this module-global registry can never retain a torn-down owner's
 *  whole object graph (startGame has two call sites and `hud` is
 *  function-local to it, so a second Hud construction is plausible even
 *  though today's logout paths reload the page; weakness makes the question
 *  moot). A plain WeakSet cannot serve: the closeAll rung below
 *  must WALK the stack topmost-first, and a WeakSet is not iterable. Dead
 *  refs prune opportunistically during that walk. One instance exists in
 *  production (the Store surface runtime's). */
const resultPanels = new Set<WeakRef<StoreDecisionPrompts>>();

function registerResultPanel(panel: StoreDecisionPrompts): () => void {
  // Unlike the plain Set this replaced, a Set of refs does not dedupe a
  // double registration of one panel; only the constructor registers, so
  // that stays unreachable today.
  const ref = new WeakRef(panel);
  resultPanels.add(ref);
  return () => {
    resultPanels.delete(ref);
  };
}

/** Clear the most recently registered panel's open nonmodal purchase result,
 *  reporting whether one cleared. Topmost-first and ONE panel only: panels
 *  stack in registration order, and an Escape should dismiss the top of the
 *  stack, never every registrant's result at once (the next Escape takes the
 *  next one). Wired as the FIRST closeAll rung in src/ui/hud.ts, and that
 *  placement is a RECORDED design call: for up to STORE_RESULT_EXPIRY_MS
 *  after a purchase, Escape dismisses this passive role=status toast before
 *  anything else, and with nothing else open the first Escape eats the toast
 *  instead of opening Options (main.ts falls through to toggleOptionsMenu
 *  only when closeAll returns false). Deliberate: the toast sits topmost and
 *  eats touches on mobile, so Escape-dismisses-topmost is the consistent
 *  physical model, accepting that a nonmodal status surface becomes an
 *  Escape target while visible. */
export function clearOpenStoreResult(): boolean {
  const refs = [...resultPanels];
  for (let i = refs.length - 1; i >= 0; i--) {
    const panel = refs[i].deref();
    if (!panel) {
      // Intentionally uncovered by tests: exercising this prune needs a real
      // garbage collection, which no deterministic arm can force.
      resultPanels.delete(refs[i]);
      continue;
    }
    if (panel.clearResult()) return true;
  }
  return false;
}

export interface StoreDecisionPromptOptions {
  title: string;
  body: string;
  confirmText: string;
  cancelText: string;
  closeText: string;
  onConfirm(): void;
  onCancel?(): void;
}

export interface StoreResultOptions {
  text: string;
  tone: 'success' | 'failure';
  closeText: string;
}

interface ActiveDecision {
  prompt: HTMLElement;
  handle: PromptDialogHandle;
}

let promptSeq = 0;

export class StoreDecisionPrompts {
  private active: ActiveDecision | null = null;
  private result: HTMLElement | null = null;
  private resultExpiry: number | null = null;

  /** Removes this panel from the module Escape registry. An owner with a real
   *  teardown calls it there; an owner that lives for the whole client session
   *  keeps the handle here, on the instance, unfired. */
  readonly unregister: () => void;

  constructor(
    private readonly root: () => HTMLElement,
    // Injectable for deterministic tests; production takes the window clock.
    private readonly timers: StorageRungEchoTimers = {
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle),
    },
  ) {
    this.unregister = registerResultPanel(this);
  }

  open(options: StoreDecisionPromptOptions): boolean {
    this.dismiss(true);
    const stack = document.getElementById('prompt-stack');
    if (!stack || document.getElementById('confirm-dialog')) return false;

    const root = this.root();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inspector = document.querySelector<HTMLElement>('.armory-inspect-overlay');
    const inspectorWasInert = inspector?.inert ?? false;
    const prompt = document.createElement('div');
    const bodyId = `woc-store-prompt-body-${promptSeq++}`;
    prompt.id = 'confirm-dialog';
    prompt.className = 'prompt panel woc-store-prompt';
    prompt.innerHTML =
      `<button type="button" class="woc-store-prompt-close" aria-label="${esc(options.closeText)}">${svgIcon('close')}</button>` +
      `<div class="prompt-text">${esc(options.title)}</div>` +
      `<div class="woc-store-prompt-body" id="${bodyId}">${esc(options.body)}</div>` +
      '<div class="woc-store-prompt-actions">' +
      `<button type="button" class="btn" data-store-prompt-cancel>${esc(options.cancelText)}</button>` +
      `<button type="button" class="btn woc-store-prompt-confirm" data-store-prompt-confirm>${esc(options.confirmText)}</button>` +
      '</div>';
    prompt.setAttribute('aria-describedby', bodyId);
    stack.classList.add('store-decision-active');
    stack.appendChild(prompt);
    if (inspector) inspector.inert = true;

    let settled = false;
    let confirmed = false;
    let handle!: PromptDialogHandle;
    const close = (): void => {
      if (settled) return;
      settled = true;
      if (inspector) inspector.inert = inspectorWasInert;
      prompt.remove();
      stack.classList.remove('store-decision-active');
      if (this.active?.prompt === prompt) this.active = null;
      if (!confirmed) options.onCancel?.();
    };
    handle = installPromptDialog(prompt, opener, close, {
      inertRoot: root,
      idPrefix: 'woc-store-prompt-title',
    });
    this.active = { prompt, handle };

    const confirm = prompt.querySelector<HTMLButtonElement>('[data-store-prompt-confirm]');
    const cancel = prompt.querySelector<HTMLButtonElement>('[data-store-prompt-cancel]');
    const closeButton = prompt.querySelector<HTMLButtonElement>('.woc-store-prompt-close');
    confirm?.addEventListener('click', () => {
      if (settled) return;
      // Confirm is settled before application code. A synthetic double
      // activation cannot send a second spend while the async callback runs.
      confirmed = true;
      handle.dismissAndReturn();
      options.onConfirm();
    });
    cancel?.addEventListener('click', handle.dismissAndReturn);
    closeButton?.addEventListener('click', handle.dismissAndReturn);
    confirm?.focus();
    return true;
  }

  /** Force-close/tab-switch paths pass false because their owning surface has
   *  its own explicit focus policy. */
  dismiss(restoreFocus: boolean): void {
    const active = this.active;
    if (!active) return;
    if (restoreFocus) active.handle.dismissAndReturn();
    else active.handle.dismiss();
  }

  showResult(options: StoreResultOptions): void {
    this.clearResult();
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const result = document.createElement('div');
    result.className = `panel woc-store-global-result ${options.tone}`;
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    result.setAttribute('aria-atomic', 'true');
    result.innerHTML =
      '<span data-store-result-text></span>' +
      `<button type="button" aria-label="${esc(options.closeText)}">${svgIcon('close')}</button>`;
    result.querySelector('button')?.addEventListener('click', () => this.clearResult());
    stack.classList.add('store-result-active');
    stack.appendChild(result);
    this.result = result;
    // Bounded lifetime. clearResult() above cancelled any earlier timer, so a
    // result shown twice restarts the full window rather than inheriting the
    // stale deadline; manual close and the closeAll rung cancel it the same
    // way.
    this.resultExpiry = this.timers.schedule(() => {
      this.resultExpiry = null;
      this.clearResult();
    }, STORE_RESULT_EXPIRY_MS);
    // A live region created with its final text in the same DOM mutation is
    // routinely missed by screen readers. Mount it empty first, then publish
    // on the next microtask; identity-checking keeps a replaced result from
    // writing into a detached node.
    queueMicrotask(() => {
      if (this.result !== result || !result.isConnected) return;
      const text = result.querySelector<HTMLElement>('[data-store-result-text]');
      if (text) text.textContent = options.text;
    });
  }

  /** Remove the nonmodal result (button, Escape rung, expiry, or a replacing
   *  showResult), reporting whether one was actually showing. */
  clearResult(): boolean {
    if (this.resultExpiry !== null) this.timers.cancel(this.resultExpiry);
    this.resultExpiry = null;
    if (this.result === null) return false;
    this.result.parentElement?.classList.remove('store-result-active');
    this.result.remove();
    this.result = null;
    return true;
  }
}
