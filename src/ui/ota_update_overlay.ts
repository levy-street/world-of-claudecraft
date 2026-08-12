// Full-screen modal shown by the native OTA update gate (net/ota_update_gate)
// while a bundle download runs before the player is in the world, and as the
// recovery surface for the incompatible-version rejection. Same visual family
// as the store-update prompt (native_update_prompt.ts): backdrop + panel +
// title + body + actions, plus a progress bar the gate drives with the
// plugin's download percent.
//
// Cold, event-driven painter (no driver of its own): it repaints only when
// the gate reduces an event, and every mutable write is elided against the
// previous value so a repeated percent tick touches nothing. The model type
// is import type-only, so this module stays free of runtime net/ imports.

import type { OtaOverlayModel } from '../net/ota_update_gate';
import { markDialogRoot } from './dialog_root';
import { formatNumber, t } from './i18n';

export interface OtaOverlayActions {
  onContinue(): void;
}

const BACKDROP_ID = 'ota-update-backdrop';

interface OverlayRefs {
  backdrop: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  continueBtn: HTMLButtonElement;
}

let refs: OverlayRefs | null = null;
let lastStatusText = '';
let lastPercent = -1;
let lastContinueShown: boolean | null = null;

function mount(actions: OtaOverlayActions): OverlayRefs {
  const backdrop = document.createElement('div');
  backdrop.id = BACKDROP_ID;
  backdrop.className = 'native-update-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = 'panel native-update-dialog ota-update-dialog';

  const title = document.createElement('div');
  title.id = 'ota-update-title';
  title.className = 'native-update-title';
  title.textContent = t('hudChrome.otaUpdate.title');

  const status = document.createElement('div');
  status.id = 'ota-update-status';
  status.className = 'native-update-body';

  const bar = document.createElement('div');
  bar.className = 'ota-update-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-label', t('hudChrome.otaUpdate.progressLabel'));

  const fill = document.createElement('div');
  fill.className = 'ota-update-fill';
  bar.appendChild(fill);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'native-update-actions';

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'btn ota-update-continue';
  continueBtn.textContent = t('hudChrome.otaUpdate.continueAnyway');
  continueBtn.addEventListener('click', () => actions.onContinue());
  actionsRow.appendChild(continueBtn);

  dialog.append(title, status, bar, actionsRow);
  markDialogRoot(dialog, { labelledBy: 'ota-update-title', modal: true });
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  return { backdrop, status, bar, fill, continueBtn };
}

export function renderOtaUpdateOverlay(model: OtaOverlayModel, actions: OtaOverlayActions): void {
  let mounted = false;
  if (!refs || !refs.backdrop.isConnected) {
    refs = mount(actions);
    mounted = true;
  }

  const statusText =
    model.phase === 'applying'
      ? t('hudChrome.otaUpdate.applying')
      : model.fatal
        ? t('hudChrome.otaUpdate.incompatible')
        : t('hudChrome.otaUpdate.downloading', {
            // Locale-correct percent (digits and the % sign both localized),
            // per the i18n formatter rule; the value already carries the sign,
            // so the catalog string interpolates {percent} without a literal %.
            percent: formatNumber(Math.max(0, Math.min(100, model.percent)) / 100, {
              style: 'percent',
              maximumFractionDigits: 0,
            }),
          });
  if (statusText !== lastStatusText) {
    refs.status.textContent = statusText;
    lastStatusText = statusText;
  }

  const percent = Math.max(0, Math.min(100, Math.round(model.percent)));
  if (percent !== lastPercent) {
    refs.fill.style.width = `${percent}%`;
    refs.bar.setAttribute('aria-valuenow', String(percent));
    lastPercent = percent;
  }

  if (model.showContinue !== lastContinueShown) {
    refs.continueBtn.style.display = model.showContinue ? '' : 'none';
    lastContinueShown = model.showContinue;
  }

  if (mounted) {
    // Land keyboard focus inside the dialog: on the escape hatch when it is
    // offered, otherwise on the dialog root itself (tabindex -1 via
    // markDialogRoot). Deferred a tick like native_update_prompt so the
    // element is laid out before focus.
    const target = model.showContinue
      ? refs.continueBtn
      : (refs.backdrop.firstElementChild as HTMLElement | null);
    window.setTimeout(() => {
      if (refs && refs.backdrop.isConnected) target?.focus();
    }, 0);
  }
}

export function hideOtaUpdateOverlay(): void {
  document.getElementById(BACKDROP_ID)?.remove();
  refs = null;
  lastStatusText = '';
  lastPercent = -1;
  lastContinueShown = null;
}
