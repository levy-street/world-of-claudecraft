// Machine Stable presentation: the WOC Store's account-mount sections and
// their cards. Split out of src/ui/daily_rewards_window.ts the same way the
// Armory (src/ui/armory_card_view.ts) and the Strongbox charters
// (src/ui/charter_card_view.ts) were: every function here is a pure function
// of its arguments (src/ui/CLAUDE.md, pure-core plus thin painter), so a
// Vitest renders a section without a DOM. The rows themselves are projected
// by buildStoreMountRows in src/ui/woc_store_view.ts; this module only turns
// them into HTML, and the purchase flow lives in src/ui/store_mount_purchase.ts.
//
// The markup is the Armory card FAMILY, not a bespoke card: the same
// `.armory-section` (which is where src/styles/components.css keys the rarity
// border and glow, so the rarity class sits on the SECTION, one section per
// rarity present), the same whole-card `<button>` with `.armory-card-art` and
// `.armory-card-copy`, and the same `.armory-cost` / `.armory-state` slot. The
// one difference is what the card button DOES: a skin card opens the inspect
// overlay, a mount card goes straight to the purchase prompt, so the button is
// disabled once there is nothing to buy (owned, or no service price).

import { MOUNTS, type MountKey, type MountRarity } from '../sim/content/mounts';
import { ITEMS } from '../sim/data';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatNumber, t } from './i18n';
import { itemImageUrl } from './icons';
import type { StoreMountRow } from './woc_store_view';

/** The buy button's data attribute; the store body binding reads the item id
 *  back off it (src/ui/store_body_actions.ts). */
export const STORE_MOUNT_BUY_ATTR = 'data-store-mount-buy';

/** The reins item's display name, for the card and the confirm dialog. Falls
 *  back to the id only for a row whose item the catalog does not declare, which
 *  buildStoreMountRows never produces. */
export function storeMountName(itemId: string): string {
  const def = ITEMS[itemId];
  return def ? itemDisplayName(def) : itemId;
}

/** The catalog mount behind a row, or null for a row whose reins item or mount
 *  the catalog does not declare (never rendered, no card invented). */
function storeMountOf(row: StoreMountRow): (typeof MOUNTS)[MountKey] | null {
  const def = ITEMS[row.itemId];
  const mountKey = def?.kind === 'mount' ? def.mount : undefined;
  return (mountKey ? MOUNTS[mountKey as MountKey] : undefined) ?? null;
}

/** One card, or '' for a row the catalog does not declare. */
export function storeMountCardHtml(row: StoreMountRow): string {
  const mount = storeMountOf(row);
  if (!mount) return '';
  const name = storeMountName(row.itemId);
  const purchasable = !row.owned && row.costClaudium !== null;
  // The reins art through the item-icon seam (src/ui/icons.ts), never a path
  // built by hand; a mount without shipped art draws the art slot empty.
  const art = itemImageUrl(row.itemId);
  const state = row.owned
    ? `<span class="armory-state">${esc(t('hudChrome.wocStore.owned'))}</span>`
    : row.costClaudium === null
      ? `<span class="armory-state unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
      : `<span class="armory-cost"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
  return (
    `<article class="armory-card rarity-${esc(mount.rarity)}${row.owned ? ' owned' : ''}">` +
    `<button type="button" ${STORE_MOUNT_BUY_ATTR}="${esc(row.itemId)}"` +
    `${focusKeyAttr(`store-mount-${row.itemId}`)}${purchasable ? '' : ' disabled'} ` +
    `aria-label="${esc(t('hudChrome.wocStore.mountBuyAria', { item: name }))}">` +
    `<span class="armory-card-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}</span>` +
    `<span class="armory-card-copy"><span class="armory-card-type">${esc(t('hudChrome.mounts.spec_speed', { pct: Math.round(mount.moveSpeedPct * 100) }))}</span>` +
    `<h4>${esc(name)}</h4>${state}</span>` +
    `</button></article>`
  );
}

/** The store's Mounts strip: one Armory-family section per rarity present (the
 *  rarity class must sit on the section for the CSS to key the border), in
 *  catalog order within a rarity, or '' when there is nothing to show. */
export function storeMountsSectionHtml(rows: readonly StoreMountRow[]): string {
  const byRarity = new Map<MountRarity, StoreMountRow[]>();
  for (const row of rows) {
    const mount = storeMountOf(row);
    if (!mount) continue;
    const bucket = byRarity.get(mount.rarity) ?? [];
    bucket.push(row);
    byRarity.set(mount.rarity, bucket);
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
