import { headOptions } from '../render/characters/manifest';
import { CLASSES } from '../sim/content/classes';
import type { PlayerClass } from '../sim/types';
import { t } from './i18n';

export interface HeadState {
  face: number;
  hairStyle: number;
  beard: boolean;
  hairColor?: number;
  faceColor?: number;
}

const HAIR_COLOR_SWATCH = '#86553f';

const FACE_SHADES: { swatch: string; tint: number | undefined }[] = [
  { swatch: '#e6c2a2', tint: undefined },
  { swatch: '#c99a6e', tint: 0xd8ccbf },
  { swatch: '#a06f45', tint: 0xa68c7a },
];

/** Render the pre-game head controls and preserve keyboard focus across rebuilds. */
export function renderHeadPicker(
  selector: string,
  cls: PlayerClass,
  initial: HeadState,
  onChange: (state: HeadState) => void,
): void {
  const row = document.querySelector<HTMLElement>(selector);
  if (!row) return;
  const opts = headOptions(`player_${cls}`);
  if (!opts) {
    row.style.display = 'none';
    row.replaceChildren();
    return;
  }
  row.style.display = '';
  row.style.setProperty('--class-color', `#${CLASSES[cls].color.toString(16).padStart(6, '0')}`);
  const state: HeadState = { ...initial };

  const group = (
    labelKey: Parameters<typeof t>[0],
    kind: string,
  ): { items: HTMLElement; addRow: () => HTMLElement } => {
    const root = document.createElement('div');
    root.className = `head-group head-group-${kind}`;
    const title = document.createElement('div');
    title.className = 'head-group-title';
    title.textContent = t(labelKey);
    const addRow = (): HTMLElement => {
      const items = document.createElement('div');
      items.className = 'head-group-items';
      root.appendChild(items);
      return items;
    };
    root.appendChild(title);
    const items = addRow();
    row.appendChild(root);
    return { items, addRow };
  };

  const restoreFocus = (key?: string): void => {
    if (!key) return;
    row.querySelector<HTMLElement>(`[data-head-focus="${key}"]`)?.focus({ preventScroll: true });
  };

  const build = (focusKey?: string): void => {
    row.replaceChildren();
    state.face = Math.min(Math.max(0, state.face), opts.faces.length - 1);
    const faceOpt = opts.faces[state.face];

    const pressedButton = (
      label: string,
      aria: string,
      pressed: boolean,
      key: string,
      pick: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'head-toggle';
      button.textContent = label;
      button.dataset.headFocus = key;
      button.setAttribute('aria-label', aria);
      button.setAttribute('aria-pressed', String(pressed));
      button.addEventListener('click', () => {
        pick();
        build(key);
        onChange({ ...state });
      });
      return button;
    };

    if (opts.faces.length > 1 || opts.hasFaceColor) {
      const { items, addRow } = group('auth.face', 'face');
      opts.faces.forEach((_face, index) => {
        items.appendChild(
          pressedButton(
            String(index + 1),
            t('auth.faceOption', { n: index + 1 }),
            index === state.face,
            `face-${index}`,
            () => {
              state.face = index;
              state.hairStyle = 0;
              if (!opts.faces[index].hasBeard) state.beard = false;
            },
          ),
        );
      });
      if (opts.hasFaceColor) {
        const shadeRow = addRow();
        FACE_SHADES.forEach((shade, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'head-skin';
          button.dataset.headFocus = `face-tone-${index}`;
          button.style.setProperty('--skin-swatch', shade.swatch);
          button.setAttribute('aria-label', t('auth.skinTone', { n: index + 1 }));
          button.setAttribute('aria-pressed', String(shade.tint === state.faceColor));
          button.addEventListener('click', () => {
            state.faceColor = shade.tint;
            build(`face-tone-${index}`);
            onChange({ ...state });
          });
          shadeRow.appendChild(button);
        });
      }
    }

    if (faceOpt.hairCount > 1 || opts.hasHairColor) {
      const { items, addRow } = group('auth.hair', 'hair');
      for (let index = 0; index < faceOpt.hairCount; index++) {
        const isBald = faceOpt.hasBald && index === faceOpt.hairCount - 1;
        items.appendChild(
          pressedButton(
            String(index + 1),
            isBald ? t('auth.bald') : t('auth.hairStyle', { n: index + 1 }),
            index === state.hairStyle,
            `hair-${index}`,
            () => {
              state.hairStyle = index;
            },
          ),
        );
      }
      if (opts.hasHairColor) {
        const colorRow = addRow();
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'head-color';
        input.dataset.headFocus = 'hair-color';
        input.value =
          state.hairColor !== undefined
            ? `#${state.hairColor.toString(16).padStart(6, '0')}`
            : HAIR_COLOR_SWATCH;
        input.setAttribute('aria-label', t('auth.hairColor'));
        input.addEventListener('input', () => {
          state.hairColor = Number.parseInt(input.value.slice(1), 16);
          onChange({ ...state });
        });
        colorRow.appendChild(input);
      }
    }

    if (faceOpt.hasBeard) {
      const { items } = group('auth.beard', 'beard');
      items.appendChild(
        pressedButton('1', t('auth.beard'), state.beard, 'beard', () => {
          state.beard = !state.beard;
        }),
      );
    }

    restoreFocus(focusKey);
  };

  build();
}
