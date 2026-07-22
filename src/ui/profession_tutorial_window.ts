// Thin DOM consumer for the first-tier tutorial panel (Professions 2.0 Phase
// 14): paints the once-ever explainer fired by the `profTierTutorial` event.
//
// Reuses the shared confirm-dialog modal family (the .window.panel shell plus
// the .cd-body / .cd-actions chrome, so no new styles) rather than bespoke
// chrome. The pure model (which paragraphs, the target skill) lives in
// profession_tutorial_view.ts; this consumer only localizes and paints. The Hud
// owns the focus trap, z-index floor, and dismiss wiring, the confirmDialog
// precedent, since those need Hud state.

import { bindDialogKeyActivation } from './dialog_key_activation';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { ProfessionTutorialModel } from './profession_tutorial_view';
import { svgIcon } from './ui_icons';

export interface ProfessionTutorialDeps {
  onClose(): void;
}

const TITLE_ID = 'profession-tutorial-title';

/** Build (or rebuild) the #profession-tutorial modal from the model, wire the
 *  two close affordances and keyboard activation, and return the root element so
 *  the Hud can trap focus and floor its z-index. Any prior instance is removed
 *  first (the one-shot never stacks). */
export function renderProfessionTutorial(
  model: ProfessionTutorialModel,
  deps: ProfessionTutorialDeps,
): HTMLElement {
  document.getElementById('profession-tutorial')?.remove();
  const el = document.createElement('div');
  el.id = 'profession-tutorial';
  el.className = 'window panel';
  el.style.display = 'block';
  // The visible panel title is the dialog's accessible name (labelledBy), the
  // markDialogRoot convention every cold window follows.
  markDialogRoot(el, { labelledBy: TITLE_ID, modal: true });

  const skill = formatNumber(model.targetSkill, { maximumFractionDigits: 0 });
  const paragraphs = model.bodyKeys
    .map((key) => `<p class="cd-para">${esc(t(key, { skill }))}</p>`)
    .join('');
  el.innerHTML =
    `<div class="panel-title"><span id="${TITLE_ID}">${esc(t(model.titleKey))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t(model.dismissKey))}">${svgIcon('close')}</button></div>` +
    `<div class="cd-body">${paragraphs}</div>` +
    `<div class="cd-actions"><button type="button" class="btn cd-ok" data-close>${esc(t(model.dismissKey))}</button></div>`;

  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('[data-close]').forEach((button) => {
    button.addEventListener('click', () => deps.onClose());
  });
  bindDialogKeyActivation(el);
  return el;
}
