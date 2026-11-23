import type { BrushShape } from '../sim/brush_shape';
import { FOCUS_KEY_ATTR } from '../ui/focus_restore';
import { t } from '../ui/i18n';
import { button, el } from './dom';
import './brush_shape_panel.css';

/** Shared paint/sculpt control, with state owned by the app. `withTitle`
 *  false drops the subtitle where the host section already names the shape. */
export function brushShapeButtons(
  shape: BrushShape,
  onChange: (shape: BrushShape) => void,
  withTitle = true,
): HTMLElement {
  const root = el('div', 'ed-brush-shape');
  if (withTitle) root.appendChild(el('h3', 'ed-subtitle', t('editor.brush.shape')));
  const row = el('div', 'ed-row');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', t('editor.brush.shape'));
  const controls: HTMLButtonElement[] = [];
  for (const value of ['circle', 'square'] as const) {
    const control = button(
      t(`editor.brush.${value}`),
      () => {
        for (const entry of controls) {
          const active = entry === control;
          entry.setAttribute('aria-pressed', String(active));
          entry.classList.toggle('active', active);
        }
        onChange(value);
      },
      'small',
    );
    control.dataset.brushShape = value;
    control.setAttribute(FOCUS_KEY_ATTR, `brush:shape:${value}`);
    control.setAttribute('aria-pressed', String(value === shape));
    control.classList.toggle('active', value === shape);
    controls.push(control);
    row.appendChild(control);
  }
  root.appendChild(row);
  return root;
}
