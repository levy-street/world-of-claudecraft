// Full-screen notice shown while the game socket is auto-retrying after an
// unexpected drop. The server holds the character in-world (linkdead) during
// the retry window, so this is a pause, not a logout: the overlay blocks
// input until the world resumes (hide) or the session ends for good (main.ts
// then swaps in its fatal disconnect overlay).
import { t } from './i18n';

const OVERLAY_ID = 'reconnect-overlay';

export function showReconnectOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return;
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.className = 'fatal-overlay';
  const messageEl = document.createElement('div');
  messageEl.textContent = t('loading.reconnecting');
  el.appendChild(messageEl);
  document.body.appendChild(el);
}

export function hideReconnectOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
