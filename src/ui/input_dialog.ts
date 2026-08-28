// In-app text-input modal (reuses the confirm-dialog chrome), replacing native
// window.prompt for build name / import / export. `readOnly` + `copy` powers
// the export view (selectable string + Copy button).
//
// Extracted from Hud.inputDialog as a MOVE, not a rewrite (Masterwrought
// phase 14, the hud.ts ratchet payback): the markup, the shared
// #confirm-dialog slot, the trap lifecycle, and every listener are the same;
// Hud keeps a thin delegator and passes the pieces that must stay Hud state
// (the confirm-trap slot on the FocusManager, the pending no-choice cancel)
// through the deps bag. Three known gaps are fixed HERE, keeping every old
// call site's behavior identical: the input now carries an accessible name
// (aria-labelledby the dialog title, or an explicit inputAria), an optional
// maxLength caps it, and the returned handle can hold the OK control busy
// for callers whose submit answers asynchronously.
//
// Registered in UI_DOM_MODULES (tests/architecture.test.ts): it mints the
// #confirm-dialog element. The managed-close registry (CODE_BUILT) records
// this module as the input half of that shared id.

import { audio } from '../game/audio';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface InputDialogOpts {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  copy?: boolean;
  selectText?: boolean;
  okText?: string;
  cancelText?: string;
  onOk?: (value: string) => void;
  /** Cap the input length (the maxlength attribute on either field shape). */
  maxLength?: number;
  /** An explicit accessible name for the field; defaults to the dialog
   *  title via aria-labelledby (the field was anonymous before this move). */
  inputAria?: string;
}

export interface InputDialogDeps {
  /** Release any standing confirm trap WITHOUT restore and fire the pending
   *  no-choice cancel (the R40 family): the shared #confirm-dialog slot is
   *  being taken over. */
  replaceStandingDialog(): void;
  /** Install the focus trap on the freshly mounted dialog (Hud parks the
   *  handle in its confirmTrap slot so closeManagedWindow can release it). */
  trapOpen(el: HTMLElement): void;
  /** Release the trap installed by trapOpen (with focus restore). */
  trapClose(): void;
  /** The shared dialog key-activation binder. */
  bindKeys(el: HTMLElement): void;
  showError(text: string): void;
}

export interface InputDialogHandle {
  /** Hold the OK control disabled with aria-busy (async submit affordance);
   *  false re-enables it. A dialog without an OK button ignores this. */
  setBusy(busy: boolean): void;
  /** Tear the dialog down (trap release + element removal), firing nothing. */
  close(): void;
}

export function showInputDialog(deps: InputDialogDeps, opts: InputDialogOpts): InputDialogHandle {
  // Shares the #confirm-dialog slot: a replaced confirm's pending
  // no-choice callback (R40 family) fires before the input modal takes it.
  deps.replaceStandingDialog();
  document.getElementById('confirm-dialog')?.remove();
  const el = document.createElement('div');
  el.id = 'confirm-dialog';
  el.className = 'window panel';
  el.style.display = 'block';
  // Same named, modal dialog semantics as confirmDialog (this reuses the #confirm-dialog
  // chrome and is focus-trapped below); without them it announces as a bare unlabelled div.
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'confirm-dialog-title');
  const maxLength = opts.maxLength !== undefined ? ` maxlength="${opts.maxLength}"` : '';
  // The field's accessible name (WCAG 1.3.1 / 4.1.2): an explicit label wins,
  // else the dialog title names it, so the input is never anonymous.
  const fieldName = opts.inputAria
    ? ` aria-label="${esc(opts.inputAria)}"`
    : ' aria-labelledby="confirm-dialog-title"';
  const field = opts.multiline
    ? `<textarea class="cd-input" rows="3" ${opts.readOnly ? 'readonly' : ''}${maxLength}${fieldName} placeholder="${esc(opts.placeholder ?? '')}">${esc(opts.value ?? '')}</textarea>`
    : `<input class="cd-input" type="text" ${opts.readOnly ? 'readonly' : ''}${maxLength}${fieldName} placeholder="${esc(opts.placeholder ?? '')}" value="${esc(opts.value ?? '')}">`;
  el.innerHTML =
    `<div class="panel-title"><span id="confirm-dialog-title">${esc(opts.title)}</span><button type="button" class="x-btn" data-cancel aria-label="${esc(opts.cancelText ?? t('game.talents.cancel'))}">${svgIcon('close')}</button></div>` +
    (opts.label ? `<div class="cd-body">${esc(opts.label)}</div>` : '') +
    `<div class="cd-field">${field}</div>` +
    `<div class="cd-actions"><button class="btn" data-cancel>${esc(opts.cancelText ?? t('game.talents.cancel'))}</button>` +
    (opts.copy ? `<button class="btn" data-copy>${t('game.talents.copy')}</button>` : '') +
    (opts.onOk
      ? `<button class="btn cd-ok" data-ok>${esc(opts.okText ?? t('game.talents.save'))}</button>`
      : '') +
    `</div>`;
  document.body.appendChild(el);
  deps.trapOpen(el);
  deps.bindKeys(el);
  const input = el.querySelector('.cd-input') as HTMLInputElement | HTMLTextAreaElement;
  const okBtn = el.querySelector('[data-ok]') as HTMLButtonElement | null;
  let busy = false;
  const close = () => {
    deps.trapClose();
    el.remove();
  };
  const submit = () => {
    if (busy) return;
    const v = input?.value ?? '';
    close();
    opts.onOk?.(v);
  };
  el.querySelectorAll('[data-cancel]').forEach((b) => {
    b.addEventListener('click', () => {
      audio.click();
      close();
    });
  });
  okBtn?.addEventListener('click', submit);
  el.querySelector('[data-copy]')?.addEventListener('click', () => {
    input.select();
    navigator.clipboard?.writeText(input.value).catch(() => {
      /* clipboard blocked; manual select still works */
    });
    deps.showError(t('game.talents.exportCopied'));
  });
  if (!opts.multiline)
    input?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
  input?.focus();
  if (opts.readOnly || opts.selectText) input?.select?.();
  return {
    setBusy: (value: boolean) => {
      busy = value;
      if (okBtn) okBtn.disabled = value;
      if (value) el.setAttribute('aria-busy', 'true');
      else el.removeAttribute('aria-busy');
    },
    close,
  };
}
