import type { ClientUpdateResult } from '../client_update_search';
import { markDialogRoot } from './dialog_root';
import { FocusManager } from './focus_manager';
import { t } from './i18n';

export interface FatalOverlayOptions {
  buttonLabel?: string;
  searchUpdates?: () => Promise<ClientUpdateResult>;
  installUpdate?: () => Promise<void>;
}

// Cold terminal screen. Recovery actions are injected by the bootstrap host.
export function showFatalOverlay(message: string, opts?: FatalOverlayOptions): void {
  if (document.getElementById('disconnect-overlay')) return;
  const el = document.createElement('div');
  el.id = 'disconnect-overlay';
  el.className = 'fatal-overlay';
  const messageEl = document.createElement('div');
  messageEl.id = 'disconnect-message';
  messageEl.textContent = message;
  markDialogRoot(el, { labelledBy: messageEl.id, modal: true });
  // Stop game hotkeys while preserving native button activation and Tab's
  // document-level FocusManager cycle. This terminal screen exits by reload.
  el.addEventListener('keydown', (event) => event.stopPropagation());
  el.addEventListener('keyup', (event) => event.stopPropagation());
  el.appendChild(messageEl);
  const actions = document.createElement('div');
  actions.className = 'fatal-overlay-actions';
  const status = document.createElement('div');
  status.className = 'fatal-overlay-status';
  status.setAttribute('role', 'status');
  let result: ClientUpdateResult | null = null;
  let busy = false;
  const search = document.createElement('button');
  search.type = 'button';
  search.className = 'ui-btn ui-btn--red';
  const paint = () => {
    const searchFocused = document.activeElement === search;
    search.disabled = busy;
    if (busy && searchFocused) el.focus();
    else if (!busy && document.activeElement === el) search.focus();
    search.textContent = busy
      ? t('desktop.update.checkingTitle')
      : result === 'ready'
        ? t('desktop.update.restart')
        : t('errors.searchUpdates');
    status.textContent =
      result === 'none'
        ? t('errors.noUpdateFound')
        : result === 'unavailable'
          ? t('errors.updateUnavailable')
          : result === 'failed'
            ? t('errors.updateSearchFailed')
            : result === 'updating'
              ? t('hudChrome.nativeUpdate.title')
              : '';
  };
  search.addEventListener('click', async () => {
    if (busy || !opts?.searchUpdates) return;
    const ready = result === 'ready';
    busy = true;
    result = null;
    paint();
    try {
      if (ready && opts?.installUpdate) {
        await opts.installUpdate();
        result = 'updating';
      } else result = await opts.searchUpdates();
    } catch {
      result = 'failed';
    } finally {
      busy = false;
      paint();
    }
  });
  if (opts?.searchUpdates) actions.appendChild(search);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-btn ui-btn--red';
  btn.textContent = opts?.buttonLabel ?? t('errors.returnToLogin');
  btn.addEventListener('click', () => location.reload());
  actions.appendChild(btn);
  el.append(actions, status);
  document.body.appendChild(el);
  paint();
  const focus = new FocusManager().open({ root: () => (el.isConnected ? el : null) });
  focus.focusFirst();
}
