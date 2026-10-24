// Portrait chip — a class-framed 2D headshot of a character, rendered from the
// real 3D model (src/render/characters/portrait.ts). Used in the character
// list, the create screen, the in-game profile, and the inspect-player window.
//
// Renders an HTML string (both call sites build their UI via innerHTML), then
// hydrates: while the character GLBs are still preloading the chip shows the
// class crest as a placeholder and upgrades to the real portrait once ready.

import { type BodyPick, modularVisualKey, playerVisualKey } from '../render/characters/manifest';
import type { ModularLook } from '../render/characters/modular';
import {
  cachedPortraitByKey,
  composedPortraitKey,
  isComposedPortraitKey,
  isHeadPortraitKey,
  modularPortraitDataUrl,
  onPortraitsReady,
  onPortraitUpdate,
  type PortraitFraming,
  portraitsReady,
  visualPortraitDataUrl,
  visualPortraitKey,
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
// The look TYPE crosses here too, for a painter that carries one through its
// deps (inspect_window's turntable mount) without a render import of its own.
export type { ModularLook } from '../render/characters/modular';
// The composed-capture signal rides the same crossing: a composed chip is a
// full HTML rebuild rather than a src swap (hydratePortraits skips it below),
// so its builder listens for the capture landing and re-renders itself.
export { isComposedPortraitKey, onPortraitUpdate } from '../render/characters/portrait';

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
   *  `cls`. The look rides the identity wire, so any player with a live
   *  entity can be composed: the viewer's own chips (the Character sheet) and
   *  a peer's (the player menu). Left off where no look is known, such as a
   *  remote profile fetched for someone out of range. */
  look?: ModularLook | null;
  /** Which skin catalog `skin` indexes. Under `'mech'` the chip draws the
   *  Combat Mech body in that chroma, `skin` is a chroma index there, not a
   *  class-atlas index, and any `look` is ignored (the world shows the mech,
   *  so the chip must too). */
  catalog?: SkinCatalog;
  /** The character's stored appearance (their `app`, the character's own DB
   *  column), even when no look composes: it picks the male or female body of a
   *  fixed WOC class AND the modular head that body's headshot wears, so the
   *  chip shows THEIR hair, beard, face and colours rather than the body's
   *  default head (portrait.ts visualPortraitDataUrl). */
  appearance?: BodyPick;
}

/** What a pending HEAD-keyed chip re-asks with: a WOC body in its player's own
 *  head is keyed by that head (portrait.ts visualPortraitKey), and an appearance
 *  does not fit in a data attribute, so the builder files the request here under
 *  the key the chip carries and hydratePortraits re-asks through it (which kicks
 *  the capture a chip built before the assets were ready never started).
 *  Bounded like the per-player half of the portrait cache it feeds: the oldest
 *  request leaves first, and a chip whose request aged out keeps its crest. */
interface HeadChipRequest {
  readonly visualKey: string;
  readonly skin: number;
  readonly framing: PortraitFraming;
  readonly head: BodyPick;
}

/** The request registry's cap: the portrait cache's per-player cap (portrait.ts
 *  MODULAR_PORTRAIT_CACHE_MAX), a raid plus headroom. A literal, not the import:
 *  the HUD suites mock the portrait module without it, and this is module scope. */
export const HEAD_CHIP_REQUESTS_MAX = 48;
const headChipRequests = new Map<string, HeadChipRequest>();

function rememberHeadChip(key: string, request: HeadChipRequest): void {
  headChipRequests.delete(key);
  headChipRequests.set(key, request);
  while (headChipRequests.size > HEAD_CHIP_REQUESTS_MAX) {
    const oldest = headChipRequests.keys().next().value;
    if (oldest === undefined) break;
    headChipRequests.delete(oldest);
  }
}

/** A head-keyed chip's portrait: the live getter re-asked with the appearance its
 *  builder filed (a hit, or a miss that kicks the capture), else a peek at the
 *  key alone. Null while the capture runs, and for a chip whose request aged out,
 *  which keeps its crest rather than wear a face that is not that player's. */
function headChipUrl(key: string | undefined): string | null {
  if (!key) return null;
  const request = headChipRequests.get(key);
  if (!request) return cachedPortraitByKey(key);
  return visualPortraitDataUrl(request.visualKey, request.skin, request.framing, request.head);
}

/** Class crest data URL — the placeholder before the 3D portrait is ready and
 *  the small class badge overlaid on the portrait. Exported for the
 *  paperdoll cold-open stand-in (preview_stand_in.ts), which climbs the same
 *  ladder while the preview's programs link. */
export function crestUrl(cls: PlayerClass): string {
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
  const visualKey = mech ? 'player_mech' : playerVisualKey(cls, opts.appearance);
  // A class body in its player's OWN head (a WOC body with a custom head) keys
  // its portrait on that head; a default head keys like no head at all, so a
  // stock chip is unchanged.
  const headKey =
    mech || look ? null : visualPortraitKey(visualKey, skin, framing, opts.appearance);
  const head = headKey !== null && isHeadPortraitKey(headKey) ? opts.appearance : undefined;
  // A composed chip is never `deferSource`: that path re-derives the URL in
  // hydratePortraits from data attributes alone, and a look does not fit in
  // one. It is only used for dense repeated grids of OTHER players anyway.
  const portrait = mech
    ? visualPortraitDataUrl('player_mech', skin, framing)
    : look
      ? modularPortraitDataUrl(modularVisualKey(cls), look, framing)
      : deferSource
        ? null
        : visualPortraitDataUrl(visualKey, skin, framing, head);
  const src = deferSource ? null : (portrait ?? crestUrl(cls));
  const source = src ? ` src="${src}"` : '';
  const crestId = `class_${cls}`;
  const fallbackAttrs = crestImageFallbackAttributes(crestId, 96);
  // A deferSource chip deliberately carries NO crest fallback: it ships with no
  // src at all, and hydrateCrestImageFallbacks fires its error path immediately
  // for a src-less image (complete, naturalWidth 0), painting a procedural crest
  // data URL into every chip. That per-chip cost is exactly what deferSource
  // exists to avoid in dense grids; those chips upgrade through
  // hydratePortraits instead.
  const portraitFallbackAttrs = !portrait && !deferSource ? ` ${fallbackAttrs}` : '';
  const pending = portrait && !deferSource ? '' : ' data-portrait-pending="1"';
  const fallbackCls = portrait && !deferSource ? '' : ' is-fallback';
  // A composed chip built before its capture landed holds the crest, and
  // hydratePortraits must NOT upgrade it (it would re-derive the LEGACY
  // portrait from the data attributes: a look does not fit in one). It carries
  // the capture's cache KEY instead, so hydrateComposedChips can swap in the
  // exact portrait filed under it when that key lands; builders that rebuild
  // themselves (the sheet, the roster row) do so as well.
  const composedKey =
    !mech && look && !portrait ? composedPortraitKey(modularVisualKey(cls), look, framing) : null;
  // A pending head-keyed chip waits on its key the same way, through the request
  // filed for hydratePortraits (see HeadChipRequest).
  const pendingHeadKey = head !== undefined && (deferSource || !portrait) ? headKey : null;
  if (pendingHeadKey) rememberHeadChip(pendingHeadKey, { visualKey, skin, framing, head });
  const composed = composedKey
    ? ` data-portrait-composed="1" data-portrait-key="${esc(composedKey)}"`
    : pendingHeadKey
      ? ` data-portrait-head="1" data-portrait-key="${esc(pendingHeadKey)}"`
      : '';
  const alt = esc(t('character.portraitAlt', { name }));
  const badgeHtml = badge
    ? `<img class="portrait-badge" src="${crestUrl(cls)}" ${fallbackAttrs} alt="" aria-hidden="true" draggable="false">`
    : '';
  return (
    `<span class="portrait-chip portrait-${variant}${fallbackCls}" data-class="${cls}" data-cls="${cls}" data-skin="${skin}" data-catalog="${catalog}" data-visual-key="${visualKey}" data-framing="${framing}"${pending}${composed}>` +
    `<span class="portrait-ring"><img class="portrait-img"${source}${portraitFallbackAttrs} alt="${alt}" loading="lazy" decoding="async" draggable="false"></span>` +
    badgeHtml +
    `</span>`
  );
}

/** Swap any still-pending placeholder chips under `root` for the real 3D
 *  portrait. Safe to call repeatedly; a no-op until assets are ready. */
export function hydratePortraits(
  root: ParentNode = document,
  onlyVisualKey?: string,
  onlySkin?: number,
): void {
  hydrateCrestImageFallbacks(root);
  if (!portraitsReady()) return;
  root.querySelectorAll<HTMLElement>('.portrait-chip[data-portrait-pending]').forEach((chip) => {
    // Composed chips re-render through their builder (see portraitChipHtml);
    // deriving from data attributes here would paint the wrong (legacy) body.
    if (chip.dataset.portraitComposed) return;
    const cls = chip.dataset.cls as PlayerClass | undefined;
    if (!cls) return;
    const skin = Number(chip.dataset.skin ?? 0) || 0;
    const visualKey =
      chip.dataset.visualKey ??
      (chip.dataset.catalog === 'mech' ? 'player_mech' : playerVisualKey(cls, null));
    if (onlyVisualKey && (visualKey !== onlyVisualKey || skin !== onlySkin)) return;
    const framing = (chip.dataset.framing as PortraitFraming | undefined) ?? 'headshot';
    // A head-keyed chip re-asks with the appearance its builder filed: the data
    // attributes alone would re-derive the body's DEFAULT head.
    const url = chip.dataset.portraitHead
      ? headChipUrl(chip.dataset.portraitKey)
      : visualPortraitDataUrl(visualKey, skin, framing);
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

/** Swap the composed portrait filed under `key` into every chip under `root`
 *  still waiting on exactly that key. No look is re-derived (the doctrine
 *  hydratePortraits keeps): the URL is the one the key names, so the body is
 *  always the right one. A chip whose key differs, or one the builder already
 *  rebuilt (no pending marker), is left alone. A no-op while the key has no
 *  portrait, which the peek answers without starting a capture. */
export function hydrateComposedChips(root: ParentNode, key: string): void {
  const url = cachedPortraitByKey(key);
  if (!url) return;
  root.querySelectorAll<HTMLElement>('.portrait-chip[data-portrait-pending]').forEach((chip) => {
    if (chip.dataset.portraitKey !== key) return;
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
onPortraitUpdate((_visualKey, _skin, key) => {
  if (key !== undefined && isComposedPortraitKey(key)) hydrateComposedChips(document, key);
});
onPortraitUpdate((visualKey, skin) => {
  if (!visualKey.startsWith('player_')) return;
  hydratePortraits(document, visualKey, skin);
});
