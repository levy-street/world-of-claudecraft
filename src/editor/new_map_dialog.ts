// The New Map size dialog: presets (Interior / Zone / Open World) plus custom
// width/height and a scale multiplier, resolving to the yard dimensions
// newFlatCustomMap builds a bounded world from. Pure dialog chrome: no map
// state; the app owns creation.

import { t } from '../ui/i18n';
import { NEW_MAP_MAX_SIDE, NEW_MAP_MIN_SIDE, type NewMapSize } from './custom_map';
import { button, el } from './dom';
import { buildModal } from './toasts';

const PRESETS = [
  { labelKey: 'editor.newMap.interior', width: 60, height: 60 },
  { labelKey: 'editor.newMap.zone', width: 240, height: 360 },
  // Open World matches the base game world: 360 wide x 1080 deep (3 stacked
  // 360x360 zone bands).
  { labelKey: 'editor.newMap.openWorld', width: 360, height: 1080 },
] as const;

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
): { root: HTMLElement; input: HTMLInputElement } {
  const field = el('label', 'ed-modal-field');
  field.appendChild(el('span', undefined, label));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('keydown', (ev) => ev.stopPropagation());
  field.appendChild(input);
  return { root: field, input };
}

/** Ask for the new map's dimensions; resolves null on cancel. */
export function newMapSizeDialog(parent: HTMLElement): Promise<NewMapSize | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: NewMapSize | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const modal = buildModal(parent, t('editor.newMap.title'), () => settle(null));
    modal.panel.appendChild(el('p', 'ed-modal-body', t('editor.newMap.hint')));

    const width = numberField(
      t('editor.newMap.width'),
      PRESETS[1].width,
      NEW_MAP_MIN_SIDE,
      NEW_MAP_MAX_SIDE,
      10,
    );
    const height = numberField(
      t('editor.newMap.height'),
      PRESETS[1].height,
      NEW_MAP_MIN_SIDE,
      NEW_MAP_MAX_SIDE,
      10,
    );
    const scale = numberField(t('editor.newMap.scale'), 1, 0.25, 4, 0.25);

    // Preset row fills the custom fields (and resets scale), so a preset is a
    // starting point, not a lock.
    const presets = el('div', 'ed-modal-actions ed-wrap');
    for (const p of PRESETS) {
      presets.appendChild(
        button(
          t(p.labelKey as Parameters<typeof t>[0]),
          () => {
            width.input.value = String(p.width);
            height.input.value = String(p.height);
            scale.input.value = '1';
          },
          'small',
        ),
      );
    }
    modal.panel.append(presets, width.root, height.root, scale.root);

    const row = el('div', 'ed-modal-actions');
    const cancel = button(t('editor.confirm.cancel'), () => {
      settle(null);
      modal.close();
    });
    const ok = button(
      t('editor.newMap.create'),
      () => {
        const clampSide = (v: number): number =>
          Math.min(NEW_MAP_MAX_SIDE, Math.max(NEW_MAP_MIN_SIDE, v));
        const k = Number(scale.input.value);
        const mul = Number.isFinite(k) && k > 0 ? Math.min(4, Math.max(0.25, k)) : 1;
        const w = Number(width.input.value);
        const h = Number(height.input.value);
        settle({
          width: clampSide((Number.isFinite(w) ? w : PRESETS[1].width) * mul),
          height: clampSide((Number.isFinite(h) ? h : PRESETS[1].height) * mul),
        });
        modal.close();
      },
      'primary',
    );
    row.append(cancel, ok);
    modal.panel.appendChild(row);
    width.input.focus();
    width.input.select();
  });
}
