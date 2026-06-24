// Portrait chip — a class-framed 2D headshot of a character, rendered from the
// real 3D model (src/render/characters/portrait.ts). Used in the character
// list, the create screen, the in-game profile, and the inspect-player window.
//
// Renders an HTML string (both call sites build their UI via innerHTML), then
// hydrates: while the character GLBs are still preloading the chip shows the
// class crest as a placeholder and upgrades to the real portrait once ready.
import { t } from './i18n';
import { esc } from './esc';
import { iconDataUrl } from './icons';
import { PlayerClass } from '../sim/types';
import { playerPortraitDataUrl, onPortraitsReady, portraitsReady } from '../render/characters/portrait';

export type PortraitVariant = 'sm' | 'md' | 'lg';

export interface PortraitChipOpts {
  cls: PlayerClass;
  skin?: number;
  /** Character name — used for the accessible label. */
  name: string;
  variant?: PortraitVariant;
  /** Show the small class-crest badge in the corner (default true). */
  badge?: boolean;
}

/** Class crest data URL — the placeholder before the 3D portrait is ready and
 *  the small class badge overlaid on the portrait. */
function crestUrl(cls: PlayerClass): string {
  return iconDataUrl('crest', `class_${cls}`, 96);
}

/** Build a portrait-chip HTML string. Call {@link hydratePortraits} on the
 *  container afterwards (or rely on the global ready hook to upgrade it). */
export function portraitChipHtml(opts: PortraitChipOpts): string {
  const { cls, skin = 0, name, variant = 'sm', badge = true } = opts;
  const portrait = playerPortraitDataUrl(cls, skin);
  const src = portrait ?? crestUrl(cls);
  const pending = portrait ? '' : ' data-portrait-pending="1"';
  const fallbackCls = portrait ? '' : ' is-fallback';
  const alt = esc(t('character.portraitAlt', { name }));
  const badgeHtml = badge
    ? `<img class="portrait-badge" src="${crestUrl(cls)}" alt="" aria-hidden="true" draggable="false">`
    : '';
  return (
    `<span class="portrait-chip portrait-${variant}${fallbackCls}" data-class="${cls}" data-cls="${cls}" data-skin="${skin}"${pending}>` +
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
    const url = playerPortraitDataUrl(cls, skin);
    if (!url) return;
    const img = chip.querySelector<HTMLImageElement>('.portrait-img');
    if (img) img.src = url;
    chip.classList.remove('is-fallback');
    chip.removeAttribute('data-portrait-pending');
  });
}

// Once the GLBs finish loading, upgrade every placeholder currently on screen.
onPortraitsReady(() => hydratePortraits(document));
