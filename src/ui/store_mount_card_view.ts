// Machine Stable presentation: the WOC Store's mount SKIN sections and their
// cards. Split out of src/ui/daily_rewards_window.ts the same way the Armory
// (src/ui/armory_card_view.ts) and the Strongbox charters
// (src/ui/charter_card_view.ts) were: every function here is a pure function
// of its arguments (src/ui/CLAUDE.md, pure-core plus thin painter), so a
// Vitest renders a section without a DOM. The rows themselves are projected
// by buildStoreMountRows in src/ui/woc_store_view.ts; this module only turns
// them into HTML, and the purchase flow lives in src/ui/store_mount_purchase.ts.
//
// A mount skin (src/sim/content/mount_skins.ts) is an account cosmetic, never
// a mount item: buying one lands nothing in the bags, and wearing it is the
// Cosmetics window's job (src/ui/hud/cosmetics/). The markup is the Armory
// card FAMILY, not a bespoke card: the same `.armory-section` (which is where
// src/styles/components.css keys the rarity border and glow, so the rarity
// class sits on the SECTION, one section per rarity present), the same
// whole-card `<button>` with `.armory-card-art` and `.armory-card-copy`, and
// the same `.armory-cost` / `.armory-state` slot. The one difference is what
// the card button DOES: a weapon-skin card opens the inspect overlay, a mount
// skin card goes straight to the purchase prompt, so the button is disabled
// once there is nothing to buy (owned, or no service price).

import { MOUNT_SKINS, mountSkinDef } from '../sim/content/mount_skins';
import type { MountRarity } from '../sim/content/mounts';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatNumber, t } from './i18n';
import { mountSkinDisplayName } from './mount_labels';
import { mountSkinArt, type StoreMountRow } from './woc_store_view';

/** The buy button's data attribute; the store body binding reads the skin id
 *  back off it (src/ui/store_body_actions.ts). */
export const STORE_MOUNT_BUY_ATTR = 'data-store-mount-buy';

/** The skin's display name, for the card and the confirm dialog. Falls back
 *  to the id only for a row whose skin the catalog does not declare, which
 *  buildStoreMountRows never produces. */
export function storeMountName(skinId: string): string {
  return mountSkinDef(skinId) ? mountSkinDisplayName(skinId) : skinId;
}

/** One card, or '' for a row the catalog does not declare. */
export function storeMountCardHtml(row: StoreMountRow): string {
  const skin = mountSkinDef(row.itemId);
  if (!skin) return '';
  const name = storeMountName(row.itemId);
  const purchasable = !row.owned && row.costClaudium !== null;
  // The skin art through the store art seam (mountSkinArt), never a path
  // built by hand; a skin without shipped art draws the art slot empty.
  const art = mountSkinArt(skin.id);
  const state = row.owned
    ? `<span class="armory-state">${esc(t('hudChrome.wocStore.owned'))}</span>`
    : row.costClaudium === null
      ? `<span class="armory-state unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
      : `<span class="armory-cost"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
  return (
    `<article class="armory-card rarity-${esc(skin.rarity)}${row.owned ? ' owned' : ''}">` +
    `<button type="button" ${STORE_MOUNT_BUY_ATTR}="${esc(row.itemId)}"` +
    `${focusKeyAttr(`store-mount-${row.itemId}`)}${purchasable ? '' : ' disabled'} ` +
    `aria-label="${esc(t('hudChrome.wocStore.mountBuyAria', { item: name }))}">` +
    `<span class="armory-card-art"><img src="${esc(art)}" alt="" loading="lazy" decoding="async"></span>` +
    `<span class="armory-card-copy"><span class="armory-card-type">${esc(t('hudChrome.wocStore.mountSkinType'))}</span>` +
    `<h4>${esc(name)}</h4>${state}</span>` +
    `</button></article>`
  );
}

/** The store's Machine Stable strip: one Armory-family section per rarity
 *  present (the rarity class must sit on the section for the CSS to key the
 *  border), in catalog order within a rarity, or '' when there is nothing to
 *  show. */
export function storeMountsSectionHtml(rows: readonly StoreMountRow[]): string {
  const byRarity = new Map<MountRarity, StoreMountRow[]>();
  for (const row of rows) {
    const skin = mountSkinDef(row.itemId);
    if (!skin) continue;
    const bucket = byRarity.get(MOUNT_SKINS[skin.id].rarity) ?? [];
    bucket.push(row);
    byRarity.set(MOUNT_SKINS[skin.id].rarity, bucket);
  }
  return [...byRarity.entries()]
    .map(
      ([rarity, group]) =>
        `<section class="armory-section store-mounts rarity-${esc(rarity)}"><header><div>` +
        `<span>${esc(t('hudChrome.wocStore.mountsEyebrow'))}</span>` +
        `<h3>${esc(t('hudChrome.wocStore.mountsTitle'))}</h3></div></header>` +
        `<div class="armory-grid">${group.map(storeMountCardHtml).join('')}</div></section>`,
    )
    .join('');
}
