// Thin DOM consumer for the town-focus allocation panel (#1143).
//
// Paints #town-focus-window from the structured TownFocusView (town_focus_view.ts)
// and wires the +/- steppers and Save/Close actions. Owns no state; Hud stays the
// orchestrator (open/close + cross-window coordination).
//
// The chrome comes from the shared window-frame builder (window_frame.ts): a
// titlebar with a close control, a scrollable body carrying the budget + stepper
// rows, and a sticky footer that hosts the primary Save action. The frame is
// stamped cold on an inner mount at first open and reused on later repaints
// (each step re-renders); only the body + footer refill per render. The root
// keeps display:block (the root-scroll model), so Hud's open/close is unchanged.

import { esc } from './esc';
import { t } from './i18n';
import type { TownFocusView } from './town_focus_view';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

// A closable, footer-bearing frame with no tab rail. The close reuses the shared
// generic close key the panel already used ('itemUi.vendor.close').
const TOWN_FOCUS_FRAME: WindowFrameDescriptor = {
  id: 'town-focus-window',
  titleKey: 'hudChrome.townFocus.title',
  closeLabelKey: 'itemUi.vendor.close',
  footer: true,
};

export interface TownFocusWindowDeps {
  onStep(component: string, delta: 1 | -1): void;
  onSave(): void;
  onClose(): void;
}

/** Stamp the shared window frame cold on an inner mount, then reuse it. */
function ensureFrame(el: HTMLElement, onClose: () => void): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) {
    return {
      root: mounted,
      body,
      footer: mounted.querySelector<HTMLElement>('.window-footer'),
      tabButtons: [],
    };
  }
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, TOWN_FOCUS_FRAME, { onClose });
  el.replaceChildren(mount);
  return parts;
}

export function renderTownFocusWindow(
  el: HTMLElement,
  view: TownFocusView,
  deps: TownFocusWindowDeps,
): void {
  const scrollTop = el.scrollTop;
  const { body, footer } = ensureFrame(el, () => deps.onClose());
  body.innerHTML = '';

  const hint = document.createElement('div');
  hint.className = 'town-focus-hint';
  hint.textContent = t('hudChrome.townFocus.hint');
  body.appendChild(hint);

  if (!view.inTown) {
    const notInTown = document.createElement('div');
    notInTown.className = 'town-focus-not-in-town';
    notInTown.textContent = t('hudChrome.townFocus.notInTownHint');
    body.appendChild(notInTown);
  }

  const budget = document.createElement('div');
  budget.className = 'town-focus-budget';
  budget.textContent = t('hudChrome.townFocus.budgetLabel', {
    remaining: view.remaining,
    budget: view.budget,
  });
  body.appendChild(budget);

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
    body.appendChild(rowEl);
  }

  if (footer) {
    footer.innerHTML = '';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn is-primary town-focus-save';
    save.textContent = t('hudChrome.townFocus.saveButton');
    save.disabled = !view.inTown;
    save.addEventListener('click', () => deps.onSave());
    footer.appendChild(save);
  }

  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
