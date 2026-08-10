// Portrait chip — a class-framed 2D headshot of a character, rendered from the
// real 3D model (src/render/characters/portrait.ts). Used in the character
// list, the create screen, the in-game profile, and the inspect-player window.
//
// Renders an HTML string (both call sites build their UI via innerHTML), then
// hydrates: while the character GLBs are still preloading the chip shows the
// class crest as a placeholder and upgrades to the real portrait once ready.

import { modularVisualKey } from '../render/characters/manifest';
import type { ModularLook } from '../render/characters/modular';
import {
  modularPortraitDataUrl,
  onPortraitsReady,
  onPortraitUpdate,
  type PortraitFraming,
  playerPortraitDataUrl,
  portraitsReady,
  visualPortraitDataUrl,
} from '../render/characters/portrait';
import type { PlayerClass, SkinCatalog } from '../sim/types';
import {
  clearCrestImageFallback,
  crestImageFallbackAttributes,
  hydrateCrestImageFallbacks,
} from './crest_image_fallback';
import { esc } from './esc';
import { t } from './i18n';
import { iconDataUrl } from './icons';

// This module is the UI's sanctioned crossing into the portrait renderer, so
// the look resolver is surfaced here too: painters that stay out of the render
// layer (char_window's paperdoll boundary test) get it without their own
// render import.
export { modularLookFor } from '../render/characters';

export type PortraitVariant = 'sm' | 'md' | 'lg';

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
  /** Omit the potentially large data URL from generated HTML and let
   *  hydratePortraits assign it after the subtree is mounted. Useful for dense
   *  repeated grids where embedding one cached portrait dozens of times would
   *  create multi-megabyte innerHTML strings. Assets must already be ready. */
  deferSource?: boolean;
  /** Draw this chip as the COMPOSED character rather than the stock art for
   *  `cls`. Only the local player has an authored look (it is presentation
   *  state and is not on the wire), so this is set on the player's own chips,
   *  their Character sheet, and left off for everyone else's. */
  look?: ModularLook | null;
  /** Which skin catalog `skin` indexes. Under `'mech'` the chip draws the
   *  Combat Mech body in that chroma, `skin` is a chroma index there, not a
   *  class-atlas index, and any `look` is ignored (the world shows the mech,
   *  so the chip must too). */
  catalog?: SkinCatalog;
}

/** Class crest data URL — the placeholder before the 3D portrait is ready and
 *  the small class badge overlaid on the portrait. */
function crestUrl(cls: PlayerClass): string {
  return iconDataUrl('crest', `class_${cls}`, 96);
}

/** Build a portrait-chip HTML string. Call {@link hydratePortraits} on the
 *  container afterwards (or rely on the global ready hook to upgrade it). */
export function portraitChipHtml(opts: PortraitChipOpts): string {
  const {
    cls,
    skin = 0,
    name,
    variant = 'sm',
    badge = true,
    framing = 'headshot',
    deferSource = false,
    look = null,
    catalog = 'class',
  } = opts;
  const mech = catalog === 'mech';
  // A composed chip is never `deferSource`: that path re-derives the URL in
  // hydratePortraits from data attributes alone, and a look does not fit in
  // one. It is only used for dense repeated grids of OTHER players anyway.
  const portrait = mech
    ? visualPortraitDataUrl('player_mech', skin, framing)
    : look
      ? modularPortraitDataUrl(modularVisualKey(cls), look, framing)
      : deferSource
        ? null
        : playerPortraitDataUrl(cls, skin, framing);
  const src = deferSource ? null : (portrait ?? crestUrl(cls));
  const source = src ? ` src="${src}"` : '';
  const crestId = `class_${cls}`;
  const fallbackAttrs = crestImageFallbackAttributes(crestId, 96);
  const portraitFallbackAttrs = !portrait && !deferSource ? ` ${fallbackAttrs}` : '';
  const pending = portrait && !deferSource ? '' : ' data-portrait-pending="1"';
  const fallbackCls = portrait && !deferSource ? '' : ' is-fallback';
  const alt = esc(t('character.portraitAlt', { name }));
  const badgeHtml = badge
    ? `<img class="portrait-badge" src="${crestUrl(cls)}" ${fallbackAttrs} alt="" aria-hidden="true" draggable="false">`
    : '';
  return (
    `<span class="portrait-chip portrait-${variant}${fallbackCls}" data-class="${cls}" data-cls="${cls}" data-skin="${skin}" data-catalog="${catalog}" data-framing="${framing}"${pending}>` +
    `<span class="portrait-ring"><img class="portrait-img"${source}${portraitFallbackAttrs} alt="${alt}" loading="lazy" decoding="async" draggable="false"></span>` +
    badgeHtml +
    `</span>`
  );
}

/** Swap any still-pending placeholder chips under `root` for the real 3D
 *  portrait. Safe to call repeatedly; a no-op until assets are ready. */
export function hydratePortraits(
  root: ParentNode = document,
  onlyClass?: PlayerClass,
  onlySkin?: number,
): void {
  hydrateCrestImageFallbacks(root);
  if (!portraitsReady()) return;
  root.querySelectorAll<HTMLElement>('.portrait-chip[data-portrait-pending]').forEach((chip) => {
    const cls = chip.dataset.cls as PlayerClass | undefined;
    if (!cls) return;
    const skin = Number(chip.dataset.skin ?? 0) || 0;
    if (onlyClass && (cls !== onlyClass || skin !== onlySkin)) return;
    const framing = (chip.dataset.framing as PortraitFraming | undefined) ?? 'headshot';
    const url =
      chip.dataset.catalog === 'mech'
        ? visualPortraitDataUrl('player_mech', skin, framing)
        : playerPortraitDataUrl(cls, skin, framing);
    if (!url) return;
    const img = chip.querySelector<HTMLImageElement>('.portrait-img');
    if (img) {
      clearCrestImageFallback(img);
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = url;
    }
    chip.classList.remove('is-fallback');
    chip.removeAttribute('data-portrait-pending');
  });
}

// Once the GLBs finish loading, upgrade every placeholder currently on screen.
onPortraitsReady(() => hydratePortraits(document));
onPortraitUpdate((visualKey, skin) => {
  if (!visualKey.startsWith('player_')) return;
  hydratePortraits(document, visualKey.slice('player_'.length) as PlayerClass, skin);
});
