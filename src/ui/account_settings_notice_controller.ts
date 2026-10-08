// Account settings migration is a blocking decision: only a persisted
// acknowledgement may release this modal and the background it makes inert.
import { markDialogRoot } from './dialog_root';
import { FocusManager } from './focus_manager';
import { t } from './i18n';

let pendingNotice: Promise<void> | null = null;

/** Gameplay and gamepad dispatchers must pause while this acknowledgement is open. */
export function accountSettingsNoticeOpen(): boolean {
  return pendingNotice !== null;
}

/** Resolve after the player checks the box and the server saves their acknowledgement. */
export function showAccountSettingsNotice(acknowledge: () => Promise<void>): Promise<void> {
  if (pendingNotice) return pendingNotice;
  let finish!: () => void;
  let fail!: (reason: unknown) => void;
  const result = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  pendingNotice = result;
  try {
    mountAccountSettingsNotice(acknowledge, finish);
  } catch (error) {
    pendingNotice = null;
    fail(error);
  }
  return result;
}

function mountAccountSettingsNotice(acknowledge: () => Promise<void>, finish: () => void): void {
  const focus = new FocusManager();
  const opener = focus.activeFocusable();
  const backdrop = document.createElement('div');
  backdrop.className = 'account-settings-notice-backdrop';
  const dialog = document.createElement('div');
  dialog.id = 'account-settings-notice';
  dialog.className = 'account-settings-notice ui-panel-strong';
  const title = document.createElement('h2');
  title.id = 'account-settings-notice-title';
  title.className = 'ui-h ui-cin';
  title.textContent = t('hudChrome.accountSettingsNotice.title');
  const message = document.createElement('p');
  message.id = 'account-settings-notice-message';
  message.className = 'ui-soft';
  message.textContent = t('hudChrome.accountSettingsNotice.message');
  const label = document.createElement('label');
  label.className = 'account-settings-notice-check ui-soft';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'ui-check';
  const labelText = document.createElement('span');
  labelText.textContent = t('hudChrome.accountSettingsNotice.understand');
  label.append(checkbox, labelText);
  const status = document.createElement('p');
  status.className = 'account-settings-notice-status ui-soft';
  status.setAttribute('role', 'status');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-btn ui-btn--gold';
  button.textContent = t('hudChrome.accountSettingsNotice.continue');
  button.disabled = true;
  dialog.append(title, message, label, status, button);
  markDialogRoot(dialog, { labelledBy: title.id, modal: true });
  dialog.setAttribute('aria-describedby', message.id);
  backdrop.append(dialog);

  // Preserve any already inert siblings (another modal may own them).
  const background = [...document.body.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .map((element) => ({ element, inert: element.inert }));
  for (const { element } of background) element.inert = true;
  document.body.append(backdrop);
  const trap = focus.open({ root: () => dialog, returnFocusTo: opener });
  trap.focusFirst('input');

  // Escape never dismisses this migration gate. Keep gameplay bindings from
  // seeing keys pressed in the modal while native checkbox/button activation survives.
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') event.preventDefault();
  });
  let saving = false;
  checkbox.addEventListener('change', () => {
    button.disabled = saving || !checkbox.checked;
  });
  button.addEventListener('click', async () => {
    if (!checkbox.checked || saving) return;
    saving = true;
    button.disabled = true;
    checkbox.disabled = true;
    dialog.setAttribute('aria-busy', 'true');
    status.textContent = t('hudChrome.accountSettingsNotice.saving');
    // Leave a focusable landing while both controls are temporarily disabled.
    dialog.focus();
    try {
      await acknowledge();
    } catch {
      saving = false;
      checkbox.disabled = false;
      button.disabled = !checkbox.checked;
      dialog.removeAttribute('aria-busy');
      status.textContent = t('hudChrome.accountSettingsNotice.failed');
      button.focus();
      return;
    }
    for (const { element, inert } of background) element.inert = inert;
    backdrop.remove();
    trap.release();
    pendingNotice = null;
    finish();
  });
}
