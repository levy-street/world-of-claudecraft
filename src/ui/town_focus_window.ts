// Thin DOM consumer for the town-focus allocation panel (#1143).
//
// Paints #town-focus-window from the structured TownFocusView (town_focus_view.ts)
// and wires the +/- steppers and Save/Close actions. Owns no state; Hud stays the
// orchestrator (open/close + cross-window coordination).

import { esc } from './esc';
import { t } from './i18n';
import type { TownFocusView } from './town_focus_view';
import { svgIcon } from './ui_icons';

export interface TownFocusWindowDeps {
  onStep(component: string, delta: 1 | -1): void;
  onSave(): void;
  onClose(): void;
}

export function renderTownFocusWindow(
  el: HTMLElement,
  view: TownFocusView,
  deps: TownFocusWindowDeps,
): void {
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.townFocus.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const hint = document.createElement('div');
  hint.className = 'town-focus-hint';
  hint.textContent = t('hudChrome.townFocus.hint');
  el.appendChild(hint);

  if (!view.inTown) {
    const notInTown = document.createElement('div');
    notInTown.className = 'town-focus-not-in-town';
    notInTown.textContent = t('hudChrome.townFocus.notInTownHint');
    el.appendChild(notInTown);
  }

  const budget = document.createElement('div');
  budget.className = 'town-focus-budget';
  budget.textContent = t('hudChrome.townFocus.budgetLabel', {
    remaining: view.remaining,
    budget: view.budget,
  });
  el.appendChild(budget);

  for (const row of view.rows) {
    const componentName = t(
      `hudChrome.corpseHarvest.components.${row.component}` as Parameters<typeof t>[0],
    );
    const rowEl = document.createElement('div');
    rowEl.className = 'town-focus-row';
    rowEl.innerHTML = `<span class="tf-name">${esc(componentName)}</span><span class="tf-points">${row.points}</span>`;

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'tf-step';
    dec.textContent = '-';
    dec.disabled = !row.canDecrease;
    dec.setAttribute(
      'aria-label',
      t('hudChrome.townFocus.decreaseAria', { component: componentName }),
    );
    dec.addEventListener('click', () => deps.onStep(row.component, -1));

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'tf-step';
    inc.textContent = '+';
    inc.disabled = !row.canIncrease;
    inc.setAttribute(
      'aria-label',
      t('hudChrome.townFocus.increaseAria', { component: componentName }),
    );
    inc.addEventListener('click', () => deps.onStep(row.component, 1));

    rowEl.appendChild(dec);
    rowEl.appendChild(inc);
    el.appendChild(rowEl);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'town-focus-save';
  save.textContent = t('hudChrome.townFocus.saveButton');
  save.disabled = !view.inTown;
  save.addEventListener('click', () => deps.onSave());
  el.appendChild(save);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
