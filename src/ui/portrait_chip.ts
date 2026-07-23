// Portrait chip — a class-framed 2D headshot of a character, rendered from the
// real 3D model (src/render/characters/portrait.ts). Used in the character
// list, the create screen, the in-game profile, and the inspect-player window.
//
// Renders an HTML string (both call sites build their UI via innerHTML), then
// hydrates: while the character GLBs are still preloading the chip shows the
// class crest as a placeholder and upgrades to the real portrait once ready.

import {
  onPortraitsReady,
  type PortraitFraming,
  playerPortraitDataUrl,
  portraitsReady,
} from '../render/characters/portrait';
import type { PlayerClass } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';
import { iconDataUrl } from './icons';

export type PortraitVariant = 'sm' | 'md' | 'lg';

// Painted class portraits (CraftPix RPG icon art) for the PRE-GAME character
// screens (choose / create), shown INSTEAD of the 3D model snapshot there. The
// in-game HUD chips keep the live 3D render. public/ui/class-icons/<class>.webp;
// provenance in CREDITS.md, existence pinned by tests/class_icons.test.ts.
const CLASS_ICON_DIR = '/ui/class-icons';

/** URL of the painted class portrait for `cls`. Every playable class ships one. */
export function classIconUrl(cls: PlayerClass): string {
  return `${CLASS_ICON_DIR}/${cls}.webp`;
}

/** Decorate pre-game class chips with their painted class icon once. */
export function decorateClassChips(root: ParentNode = document): void {
  root
    .querySelectorAll<HTMLElement>('#charcreate-panel .mini-class, #offline-select .mini-class')
    .forEach((chip) => {
      if (chip.querySelector('.mini-class-portrait')) return;
      const cls = chip.dataset.class as PlayerClass;
      const key = chip.dataset.i18n;
      const label = document.createElement('span');
      label.className = 'mini-class-label';
      if (key) label.dataset.i18n = key;
      label.textContent = (chip.textContent ?? '').trim();
      chip.removeAttribute('data-i18n');
      chip.textContent = '';
      const image = document.createElement('img');
      image.className = 'mini-class-portrait';
      image.alt = '';
      image.src = classIconUrl(cls);
      chip.append(image, label);
      chip.classList.add('has-portrait');
    });
}

export interface PortraitChipOpts {
  cls: PlayerClass;
  skin?: number;
  /** Character name — used for the accessible label. */
  name: string;
  variant?: PortraitVariant;
  /** Show the small class-crest badge in the corner (default true). */
  badge?: boolean;
  /** Which slice of the model to show (default 'headshot'). Pass 'body' for a
   *  normal 3/4 figure framing where the chip is shown large, e.g. the
   *  Inspect window, so it does not read as an over-zoomed helmet crop. */
  framing?: PortraitFraming;
  /** Show this static image (a painted class icon) INSTEAD of the 3D portrait:
   *  the pre-game choose/create screens pass classIconUrl(cls); every in-game
   *  HUD chip omits it and keeps the live 3D render. Never hydrates. */
  iconUrl?: string;
}

/** Class crest data URL — the placeholder before the 3D portrait is ready and
 *  the small class badge overlaid on the portrait. */
function crestUrl(cls: PlayerClass): string {
  return iconDataUrl('crest', `class_${cls}`, 96);
}

/** Build a portrait-chip HTML string. Call {@link hydratePortraits} on the
 *  container afterwards (or rely on the global ready hook to upgrade it). */
export function portraitChipHtml(opts: PortraitChipOpts): string {
  const { cls, skin = 0, name, variant = 'sm', badge = true, framing = 'headshot', iconUrl } = opts;
  // A painted class icon (iconUrl) wins over the 3D portrait and never hydrates.
  const portrait = iconUrl ?? playerPortraitDataUrl(cls, skin, framing);
  const src = portrait ?? crestUrl(cls);
  const pending = portrait ? '' : ' data-portrait-pending="1"';
  const fallbackCls = portrait ? '' : ' is-fallback';
  const alt = esc(t('character.portraitAlt', { name }));
  // The painted icon is already class-art, so its crest badge would be redundant.
  const badgeHtml =
    badge && !iconUrl
      ? `<img class="portrait-badge" src="${crestUrl(cls)}" alt="" aria-hidden="true" draggable="false">`
      : '';
  return (
    `<span class="portrait-chip portrait-${variant}${fallbackCls}" data-class="${cls}" data-cls="${cls}" data-skin="${skin}" data-framing="${framing}"${pending}>` +
    `<span class="portrait-ring"><img class="portrait-img" src="${src}" alt="${alt}" draggable="false"></span>` +
    badgeHtml +
    `</span>`
  );
}

/** Swap any still-pending placeholder chips under `root` for the real 3D
 *  portrait. Safe to call repeatedly; a no-op until assets are ready. */
export function hydratePortraits(root: ParentNode = document): void {
  if (!portraitsReady()) return;
  root.querySelectorAll<HTMLElement>('.portrait-chip[data-portrait-pending]').forEach((chip) => {
    const cls = chip.dataset.cls as PlayerClass | undefined;
    if (!cls) return;
    const skin = Number(chip.dataset.skin ?? 0) || 0;
    const framing = (chip.dataset.framing as PortraitFraming | undefined) ?? 'headshot';
    const url = playerPortraitDataUrl(cls, skin, framing);
    if (!url) return;
    const img = chip.querySelector<HTMLImageElement>('.portrait-img');
    if (img) img.src = url;
    chip.classList.remove('is-fallback');
    chip.removeAttribute('data-portrait-pending');
  });
}

// Once the GLBs finish loading, upgrade every placeholder currently on screen.
onPortraitsReady(() => hydratePortraits(document));
