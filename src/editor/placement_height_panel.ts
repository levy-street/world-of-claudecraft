import { MAX_PLACEMENT_Y_OFFSET } from '../sim/map_doc';
import { FOCUS_KEY_ATTR } from '../ui/focus_restore';
import { formatNumber, t } from '../ui/i18n';
import { button, el, selectRow } from './dom';
import { PLACEMENT_HEIGHT_STEPS, selectionHeightTarget } from './placement_height_core';
import './placement_height_panel.css';

export interface PlacementHeightPanelDeps {
  getSelection(): { y: number | null } | null;
  getSelectionHeights(): readonly number[];
  commitSelectionTransform(): void;
  updateSelection(change: { y: number }, commit: boolean): void;
  getStep(): number;
  setStep(value: number): void;
}

/** Shares the inspector's placement command, including group movement and undo. */
export function placementHeightPanel(deps: PlacementHeightPanelDeps): HTMLElement {
  const root = el('div', 'ed-placement-height');
  const label = t('editor.selection.heightOffset');
  const field = el('label', 'ed-field');
  const input = el('input');
  input.type = 'number';
  input.step = 'any';
  input.min = String(-MAX_PLACEMENT_Y_OFFSET);
  input.max = String(MAX_PLACEMENT_Y_OFFSET);
  input.valueAsNumber = Number((deps.getSelection()?.y ?? 0).toFixed(6));
  input.setAttribute('aria-label', label);
  input.setAttribute(FOCUS_KEY_ATTR, 'placement-height:offset');
  field.append(el('span', undefined, label), input);

  const change = (requested: (height: number) => number): void => {
    deps.commitSelectionTransform();
    const selection = deps.getSelection();
    if (!selection) return;
    const current = selection.y ?? 0;
    const target = selectionHeightTarget(current, requested(current), deps.getSelectionHeights());
    if (target !== current) deps.updateSelection({ y: target }, true);
    // Keep the controls mounted: a typed edit commits on blur, before the
    // adjacent button receives its click. Rebuilding here would swallow it.
    input.valueAsNumber = Number((deps.getSelection()?.y ?? 0).toFixed(6));
  };
  input.addEventListener('keydown', (event) => event.stopPropagation());
  input.addEventListener('change', () => {
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    change(() => value);
  });

  const actions = el('div', 'ed-row');
  for (const direction of ['lower', 'raise'] as const) {
    const control = button(t(`editor.selection.${direction}Asset`), () => {
      change((height) => height + (direction === 'raise' ? 1 : -1) * deps.getStep());
    });
    control.setAttribute(FOCUS_KEY_ATTR, `placement-height:${direction}`);
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    actions.appendChild(control);
  }
  const step = selectRow(
    t('editor.selection.heightStep'),
    PLACEMENT_HEIGHT_STEPS.map((value) => ({
      value: String(value),
      label: formatNumber(value, { maximumFractionDigits: 1 }),
    })),
    String(deps.getStep()),
    (value) => {
      const next = Number(value);
      if (PLACEMENT_HEIGHT_STEPS.some((candidate) => candidate === next)) deps.setStep(next);
    },
  );
  step.input.setAttribute(FOCUS_KEY_ATTR, 'placement-height:step');
  step.input.addEventListener('keydown', (event) => event.stopPropagation());
  root.append(field, actions, step.root, el('p', 'ed-hint', t('editor.selection.heightHint')));
  return root;
}
