// Thin DOM consumer for the memorial plaque. Cold window: built on interact,
// torn down on close, no repeating driver and no layout read.
//
// Reuses the shared `.window.panel` shell and the confirm-dialog chrome
// (.cd-body / .cd-actions) rather than bespoke styles, the
// profession_tutorial_window precedent. The pure model (reading order, column
// split, name composition) lives in memorial_plaque_view.ts; this consumer only
// localizes and paints. The Hud owns the focus trap and dismiss wiring.

import { bindDialogKeyActivation } from '../../dialog_key_activation';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import type { MemorialPlaqueModel } from './memorial_plaque_view';

export interface MemorialPlaqueDeps {
  onClose(): void;
}

const ROOT_ID = 'memorial-plaque';
const TITLE_ID = 'memorial-plaque-title';

/**
 * Build (or rebuild) the plaque from the model and return the root so the Hud
 * can trap focus. Any prior instance is removed first: reading a second
 * memorial replaces the panel rather than stacking one behind it.
 */
export function renderMemorialPlaque(
  model: MemorialPlaqueModel,
  deps: MemorialPlaqueDeps,
): HTMLElement {
  document.getElementById(ROOT_ID)?.remove();
  const el = document.createElement('div');
  el.id = ROOT_ID;
  el.className = 'window panel memorial-plaque';
  el.style.display = 'block';
  markDialogRoot(el, { labelledBy: TITLE_ID, modal: true });

  const closeLabel = esc(t(model.closeKey));
  // Names are proper nouns spliced verbatim, so they still pass through esc().
  const columns = model.columns
    .map(
      (column) =>
        `<ol class="memorial-plaque-column">${column
          .map((name) => `<li class="memorial-plaque-name">${esc(name)}</li>`)
          .join('')}</ol>`,
    )
    .join('');

  el.innerHTML =
    `<div class="panel-title"><span id="${TITLE_ID}">${esc(t(model.titleKey))}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${closeLabel}">${svgIcon('close')}</button></div>` +
    `<div class="cd-body memorial-plaque-body">` +
    `<p class="cd-para memorial-plaque-dedication">${esc(t(model.dedicationKey))}</p>` +
    `<h3 class="memorial-plaque-heading">${esc(
      t(model.rollHeadingKey, {
        count: formatNumber(model.total, { maximumFractionDigits: 0 }),
      }),
    )}</h3>` +
    `<div class="memorial-plaque-columns">${columns}</div>` +
    // The blank stone under the newest name is the point of the monument, so
    // the plaque states it rather than just ending.
    `<p class="memorial-plaque-room">${esc(t(model.roomRemainingKey))}</p>` +
    `</div>` +
    `<div class="cd-actions"><button type="button" class="btn cd-ok" data-close>${closeLabel}</button></div>`;

  document.body.appendChild(el);
  for (const button of el.querySelectorAll<HTMLElement>('[data-close]')) {
    button.addEventListener('click', () => deps.onClose());
  }
  bindDialogKeyActivation(el);
  return el;
}

/** Remove the plaque if it is open. Safe to call when it is not. */
export function closeMemorialPlaque(): void {
  document.getElementById(ROOT_ID)?.remove();
}

export const memorialPlaqueInternalsForTest = { ROOT_ID };
