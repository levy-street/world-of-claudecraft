// The legendary naming dialog (Masterwrought phase 14, deliverable B): the
// orange promotion's one input. A Perfected copy promotes through the SAME
// perfect_item command with the player-chosen name riding its existing `name`
// field; this dialog adds NOTHING else to the wire.
//
// Built on the shared modal recipe (src/ui/prompt_dialog.ts installPromptDialog:
// role=dialog + aria-modal + labelledby, the window behind it inert, every
// teardown through dismiss(), focus back to the opener), mounted into
// #prompt-stack like the bank/bags/vendor prompts, never a hand-rolled trap.
//
// The name SHAPE mirrors the sim's own authority (legendary_name.ts:
// normalizeLegendaryName, MAX_LEGENDARY_NAME_LENGTH) to GUIDE the player, never
// to replace the server screen: the online server separately screens CONTENT
// before the command reaches the sim, and the sim re-validates the shape.
//
// SUBMIT IS DISABLED FOR A BEAT after each send (msg_lanes.ts's own header
// names this as the phase 14 window's obligation): named perfect_item frames
// ride the name_screen lane at refill 2/s burst 5, and a lane DROP sends
// NOTHING back, so without the lock a mash would read as a dead button. The
// lock re-arms on a timer, or early through notifyAnswered() when any answer
// (an error toast, a mirror re-diff) lands; re-submitting is always safe, the
// sim re-validates.
//
// The item name is a VALUE (the D13-2 ruling): interpolated through t() as a
// {name} param and written via textContent, never composed into a catalog
// value and never innerHTML.
//
// Registered in UI_DOM_MODULES (tests/architecture.test.ts): it mounts real
// DOM into #prompt-stack. Cold chrome: built per open, no repeating driver
// (the one setTimeout is a one-shot re-arm), no layout read.

import {
  MAX_LEGENDARY_NAME_LENGTH,
  normalizeLegendaryName,
} from '../../../sim/professions/legendary_name';
import { formatNumber, t } from '../../i18n';
import { installPromptDialog } from '../../prompt_dialog';

// About 600ms: longer than the name_screen lane's 500ms per-token refill, so
// an honest retry after the lock lifts always has a token waiting.
export const NAME_SUBMIT_LOCK_MS = 600;

export interface LegendaryNamingDialogOpts {
  /** The Perfecting window root, set inert while the dialog is open. */
  inertRoot: HTMLElement;
  /** The control that opened the dialog (focus returns to it on dismiss). */
  opener: HTMLElement | null;
  /** The copy's resolved display name (a value; interpolated, never catalog). */
  itemName: string;
  /** Send the promotion: perfectItem(ref, name) with the NORMALIZED name. */
  onSubmit(name: string): void;
  /** Fired once on teardown, whichever path closed the dialog. */
  onClosed?(): void;
}

export interface LegendaryNamingDialogHandle {
  isOpen(): boolean;
  /** Tear the dialog down (clears inert, no focus return). */
  dismiss(): void;
  /** Tear down AND return focus to the opener (cancel/escape semantics). */
  dismissAndReturn(): void;
  /** An answer to the last submit arrived (error toast, mirror re-diff):
   *  lift the submit lock early so the player can correct and retry. */
  notifyAnswered(): void;
}

export function openLegendaryNamingDialog(
  opts: LegendaryNamingDialogOpts,
): LegendaryNamingDialogHandle | null {
  const stack = document.getElementById('prompt-stack');
  if (!stack) {
    // Dev-channel only: both entry documents ship #prompt-stack, so a miss is
    // a broken embed, and a silently dead promote button would read as a bug.
    console.warn('perfecting: #prompt-stack missing, naming dialog unavailable');
    return null;
  }
  const prompt = document.createElement('div');
  prompt.className = 'prompt panel pf-name-prompt';
  const title = document.createElement('div');
  title.className = 'prompt-text';
  title.textContent = t('hudChrome.perfecting.nameTitle');
  const label = document.createElement('div');
  label.className = 'pf-name-label';
  label.textContent = t('hudChrome.perfecting.nameLabel', { name: opts.itemName });
  const input = document.createElement('input');
  input.className = 'pf-name-input';
  input.type = 'text';
  input.maxLength = MAX_LEGENDARY_NAME_LENGTH;
  input.autocomplete = 'off';
  input.spellcheck = false;
  // A REAL accessible name of its own: the prompt title labels the dialog,
  // and this labels the field (WCAG 1.3.1 / 4.1.2).
  input.setAttribute('aria-label', t('hudChrome.perfecting.nameInputAria'));
  const count = document.createElement('div');
  count.className = 'pf-name-count';
  // Visible convenience only: the maxlength attribute plus the shape hint
  // below carry the limit for AT without a chattering live region.
  count.setAttribute('aria-hidden', 'true');
  const hint = document.createElement('div');
  hint.className = 'pf-name-hint';
  hint.id = 'legendary-name-hint';
  hint.textContent = t('hudChrome.perfecting.nameHint');
  input.setAttribute('aria-describedby', hint.id);
  const actions = document.createElement('div');
  actions.className = 'pf-name-actions';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn pf-name-submit';
  submit.textContent = t('hudChrome.perfecting.nameSubmit');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn pf-name-cancel';
  cancel.textContent = t('hudChrome.perfecting.nameCancel');
  actions.append(cancel, submit);
  prompt.append(title, label, input, count, hint, actions);

  let open = true;
  let lockTimer: number | null = null;
  let locked = false;
  const wholeNumber = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });
  const refresh = (): void => {
    count.textContent = t('hudChrome.perfecting.nameCount', {
      count: wholeNumber(input.value.length),
      max: wholeNumber(MAX_LEGENDARY_NAME_LENGTH),
    });
    const normalized = normalizeLegendaryName(input.value);
    // Guidance only: an ill-shaped draft disables the submit and flags the
    // hint (text is the signal; the tint is a redundant hint), while the sim
    // and the server stay the real validators.
    const invalid = input.value.length > 0 && normalized === null;
    hint.dataset.invalid = invalid ? 'true' : 'false';
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    submit.disabled = locked || normalized === null;
    submit.textContent = locked
      ? t('hudChrome.perfecting.nameSubmitBusy')
      : t('hudChrome.perfecting.nameSubmit');
  };
  const unlock = (): void => {
    if (lockTimer !== null) {
      window.clearTimeout(lockTimer);
      lockTimer = null;
    }
    locked = false;
    prompt.removeAttribute('aria-busy');
    if (open) refresh();
  };
  const { dismiss, dismissAndReturn } = installPromptDialog(
    prompt,
    opts.opener,
    () => {
      open = false;
      if (lockTimer !== null) window.clearTimeout(lockTimer);
      lockTimer = null;
      prompt.remove();
      opts.onClosed?.();
    },
    { inertRoot: opts.inertRoot, idPrefix: 'pf-name-title' },
  );
  const send = (): void => {
    const normalized = normalizeLegendaryName(input.value);
    if (locked || normalized === null) return;
    locked = true;
    prompt.setAttribute('aria-busy', 'true');
    refresh();
    opts.onSubmit(normalized);
    lockTimer = window.setTimeout(() => {
      lockTimer = null;
      locked = false;
      prompt.removeAttribute('aria-busy');
      if (open) refresh();
    }, NAME_SUBMIT_LOCK_MS);
  };
  submit.addEventListener('click', send);
  cancel.addEventListener('click', () => dismissAndReturn());
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') send();
  });
  refresh();
  stack.appendChild(prompt);
  input.focus();
  return {
    isOpen: () => open,
    dismiss: () => {
      if (open) dismiss();
    },
    dismissAndReturn: () => {
      if (open) dismissAndReturn();
    },
    notifyAnswered: () => {
      if (open) unlock();
    },
  };
}
