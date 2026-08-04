// Desktop auto-update card: a shell-level, non-blocking notice that works both
// on the pre-game shell and in-world (it owns its fixed-position element on
// document.body; styles in src/styles/shell.css "desktop update toast"
// section). State transitions live in the pure view-core
// (src/ui/desktop_update_view.ts); this module is the thin DOM consumer.
//
// UX: 'checking' shows a spinner card for the session's FIRST check, so a
// fresh launch tells the player the client keeps itself up to date;
// 'not-available' resolves it into a short auto-hiding "up to date"
// confirmation. 'available' + 'progress' show a live download bar;
// 'downloaded' shows the persistent restart affordance (Restart now / Later).
// If the player picks Later (or never answers), the update still installs on
// quit (autoInstallOnAppQuit in electron/updater.cjs).
//
// A11y notes: the card root is a polite live region, so every text write below
// is elided on equality; combined with aria-live="off" on the progress row,
// a download announces its state transitions, not eleven percent ticks. The
// root is minted (hidden) at init so the live region is already present and
// idle when the first event populates it (screen readers drop mutations in a
// region created in the same task). The up-to-date auto-hide never fires
// while focus is inside the card (WCAG 2.2.1: do not yank focus on a timer).

import type { DesktopBridge, DesktopUpdateEvent } from '../runtime';
import {
  dismissUpdateToast,
  expireUpToDateToast,
  INITIAL_UPDATE_TOAST_STATE,
  reduceUpdateToast,
  type UpdateToastState,
} from './desktop_update_view';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

// How long the "up to date" confirmation lingers before hiding itself.
export const UPTODATE_HIDE_MS = 6000;

export function initDesktopUpdateToast(bridge: DesktopBridge): void {
  if (typeof bridge.onUpdateEvent !== 'function') return;
  // The card's element and title ids are document-global; a second init would
  // mint duplicates and break the progressbar's aria-labelledby resolution.
  if (document.getElementById('desktop-update-toast')) return;
  // The sibling toasts' taller stacked slots key on this class, so the
  // reservation exists exactly where the card can: a shell whose bridge lacks
  // the update capability never stamps it (body.desktop-app alone only says
  // the RUNTIME is the desktop shell, not that this card can ever render).
  document.body.classList.add('desktop-update-card');

  let state: UpdateToastState = INITIAL_UPDATE_TOAST_STATE;
  let iconMode = '';
  let upToDateTimer: ReturnType<typeof setTimeout> | null = null;

  const root = document.createElement('div');
  root.id = 'desktop-update-toast';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;

  const icon = document.createElement('span');
  icon.className = 'desktop-update-icon';
  icon.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'desktop-update-content';
  const title = document.createElement('div');
  title.className = 'desktop-update-title';
  title.id = 'desktop-update-title';
  const body = document.createElement('div');
  body.className = 'desktop-update-body';

  const progress = document.createElement('div');
  progress.className = 'desktop-update-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-labelledby', 'desktop-update-title');
  // The bar itself stays out of the enclosing live region: role=progressbar +
  // aria-valuenow already conveys it on demand, and announcing every 10-point
  // tick would read the whole card up to eleven times per download.
  progress.setAttribute('aria-live', 'off');
  const track = document.createElement('div');
  track.className = 'desktop-update-progress-track';
  const progressFill = document.createElement('div');
  progressFill.className = 'desktop-update-progress-fill';
  track.appendChild(progressFill);
  const progressPct = document.createElement('span');
  progressPct.className = 'desktop-update-progress-pct';
  progress.append(track, progressPct);

  const actions = document.createElement('div');
  actions.className = 'desktop-update-actions';
  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.className = 'desktop-update-restart';
  restartButton.addEventListener('click', () => {
    void bridge.installUpdate?.();
  });
  const laterButton = document.createElement('button');
  laterButton.type = 'button';
  laterButton.className = 'desktop-update-later';
  laterButton.addEventListener('click', () => {
    state = dismissUpdateToast(state);
    render();
  });
  actions.append(restartButton, laterButton);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'desktop-update-close';
  closeButton.innerHTML = svgIcon('close');
  closeButton.addEventListener('click', () => {
    state = dismissUpdateToast(state);
    render();
  });

  content.append(title, body, progress, actions);
  root.append(icon, content, closeButton);
  document.body.appendChild(root);

  // Equality-elided writers: an unchanged write into the live region would
  // still replace the text node and can re-trigger an announcement.
  const setText = (el: HTMLElement, text: string): void => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setAttr = (el: HTMLElement, name: string, value: string): void => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };

  // The icon slot is rebuilt only when the mode actually changes (progress
  // events land every 10 points; re-parsing the SVG each time would be waste,
  // and it also keeps the running spinner alive across a locale re-render).
  const renderIcon = (): void => {
    if (state.mode === iconMode) return;
    iconMode = state.mode;
    if (state.mode === 'checking') {
      icon.innerHTML = '<span class="desktop-update-spinner"></span>';
    } else if (state.mode === 'downloading') {
      icon.innerHTML = svgIcon('download');
    } else {
      icon.innerHTML = svgIcon('check');
    }
  };

  // A strict ONE-SHOT (never self-rescheduling; the perf gate's driver table
  // treats a re-arming setTimeout as a repeating driver). Never hide the card
  // out from under the keyboard: with focus inside (the corner dismiss is
  // focusable here) the expiry goes dormant instead, and the root's focusout
  // listener below re-arms a fresh window once focus leaves.
  const armUpToDateTimer = (): void => {
    upToDateTimer = setTimeout(() => {
      upToDateTimer = null;
      if (root.contains(document.activeElement)) return;
      state = expireUpToDateToast(state);
      render();
    }, UPTODATE_HIDE_MS);
  };

  const render = (): void => {
    if (state.mode !== 'uptodate' && upToDateTimer !== null) {
      clearTimeout(upToDateTimer);
      upToDateTimer = null;
    }
    if (state.mode === 'hidden') {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    setAttr(root, 'data-mode', state.mode);
    renderIcon();
    setAttr(closeButton, 'aria-label', t('desktop.update.dismiss'));

    const version = state.version;
    let bodyText = '';
    if (state.mode === 'checking') {
      setText(title, t('desktop.update.checkingTitle'));
      bodyText = t('desktop.update.checkingBody');
    } else if (state.mode === 'downloading') {
      setText(title, t('desktop.update.downloadingTitle', { version }));
      bodyText = t('desktop.update.downloadingBody');
    } else if (state.mode === 'uptodate') {
      setText(title, t('desktop.update.uptodateTitle'));
    } else {
      setText(title, t('desktop.update.readyTitle', { version }));
      bodyText = t('desktop.update.readyBody');
    }
    setText(body, bodyText);
    body.hidden = bodyText === '';

    const downloading = state.mode === 'downloading';
    progress.hidden = !downloading;
    if (downloading) {
      setAttr(progress, 'aria-valuenow', String(state.percent));
      const width = `${state.percent}%`;
      if (progressFill.style.width !== width) progressFill.style.width = width;
      setText(
        progressPct,
        formatNumber(state.percent / 100, { style: 'percent', maximumFractionDigits: 0 }),
      );
    }

    const ready = state.mode === 'ready';
    actions.hidden = !ready;
    // The ready card keeps its explicit "Later" choice; every other mode gets
    // the corner dismiss instead.
    closeButton.hidden = ready;
    if (ready) {
      setText(restartButton, t('desktop.update.restart'));
      setText(laterButton, t('desktop.update.later'));
    }

    if (state.mode === 'uptodate' && upToDateTimer === null) armUpToDateTimer();
  };

  // The other half of the focus-holding auto-hide: once focus leaves a card
  // whose expiry went dormant (timer already fired and returned), start a
  // fresh linger window.
  root.addEventListener('focusout', () => {
    if (state.mode === 'uptodate' && upToDateTimer === null) armUpToDateTimer();
  });

  bridge.onUpdateEvent((event: DesktopUpdateEvent) => {
    state = reduceUpdateToast(state, event);
    render();
  });

  // Locale flips re-render whatever is currently shown (the language selector
  // dispatches this on both the shell and the in-game options path).
  document.addEventListener('woc:languagechange', render);
}
