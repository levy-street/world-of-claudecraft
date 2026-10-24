import { t } from '../ui/i18n';

/** Keep the editing boundary visible after the opening toast fades. */
export function showLiveWorldNotice(root: HTMLElement, enabled: boolean): void {
  root.querySelector('.ed-live-world-notice')?.remove();
  if (!enabled) return;
  const note = document.createElement('div');
  note.className = 'ed-live-world-notice';
  note.setAttribute('role', 'note');
  note.textContent = t('editor.liveWorld.scope');
  root.querySelector('.ed-topbar')?.after(note);
}
