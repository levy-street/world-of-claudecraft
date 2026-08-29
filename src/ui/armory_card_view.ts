// Season 1 Armory presentation: the store's section, card and class-chip markup.
// Split out of src/ui/daily_rewards_window.ts, the twin move that put the
// Strongbox charter markup in src/ui/charter_card_view.ts: the window owns the
// purchase flow and the store's mutable state, and none of this needs any of it.
// Every function here is a pure function of its arguments (src/ui/CLAUDE.md,
// pure-core plus thin painter), so a Vitest renders a section without a DOM.
//
// The rows themselves are projected by buildArmorySections in
// src/ui/woc_store_view.ts; this module only turns one into HTML.

import {
  badgeLabel,
  localizeWeaponSkin,
  rarityLabel,
  weaponSkinCollectionLabel,
  weaponTypeLabel,
} from './armory_labels';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatNumber, t } from './i18n';
import { portraitChipHtml } from './portrait_chip';
import type { ArmorySection, ArmorySkinRow } from './woc_store_view';

export function armorySectionHtml(section: ArmorySection): string {
  const servicePrice = section.rows.find((row) => row.costClaudium !== null)?.costClaudium ?? null;
  const price =
    servicePrice === null
      ? `<span class="armory-section-price unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
      : `<span class="armory-section-price"><img src="/claudium/icons/claudium_coin_64.webp" alt="">${formatNumber(servicePrice, { maximumFractionDigits: 0 })}</span>`;
  const cards = section.rows.map((row) => armoryCardHtml(row)).join('');
  return (
    `<section class="armory-section rarity-${esc(section.rarity)}">` +
    `<header><div><span>${esc(rarityLabel(section.rarity))}</span><h3>${esc(t('hudChrome.wocStore.collectionLine', { collection: weaponSkinCollectionLabel(section.collection) }))}</h3></div>` +
    `${price}</header>` +
    `<div class="armory-grid">${cards}</div></section>`
  );
}

export function armoryCardHtml(row: ArmorySkinRow): string {
  const copy = localizeWeaponSkin(row.skin);
  const state = row.applied
    ? `<span class="armory-state applied">${esc(t('hudChrome.wocStore.applied'))}</span>`
    : row.owned
      ? `<span class="armory-state">${esc(t('hudChrome.wocStore.owned'))}</span>`
      : row.costClaudium === null
        ? `<span class="armory-state unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
        : `<span class="armory-cost"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
  const badge = row.skin.badge
    ? `<span class="armory-badge">${esc(badgeLabel(row.skin.badge))}</span>`
    : '';
  return (
    `<article class="armory-card rarity-${esc(row.skin.rarity)}${row.owned ? ' owned' : ''}${row.applied ? ' applied' : ''}">` +
    `<button type="button" data-armory-skin="${esc(row.skin.id)}"` +
    `${focusKeyAttr(`armory-${row.skin.id}`)} ` +
    `aria-label="${esc(t('hudChrome.wocStore.inspectAria', { item: copy.name }))}">` +
    `<span class="armory-card-art"><img src="${esc(row.art)}" alt="" loading="lazy" decoding="async">${badge}${armoryClassChipsHtml(row)}</span>` +
    `<span class="armory-card-copy"><span class="armory-card-type">${esc(weaponTypeLabel(row.skin.weaponType))}</span>` +
    `<h4>${esc(copy.name)}</h4>${state}</span>` +
    `</button></article>`
  );
}

/** Top-right face chips: the classes that can ever apply this skin. Class
 *  names come from the entity matcher (already localized in every locale).
 *  The shared portrait chip shows the class crest while the character GLBs
 *  are still preloading and upgrades itself via the global ready hook. */
export function armoryClassChipsHtml(row: ArmorySkinRow): string {
  const chips = row.eligibleClasses
    .map((cls) => {
      const name = tEntity({ kind: 'class', id: cls, field: 'name' });
      return `<span class="armory-class-chip" title="${esc(name)}">${portraitChipHtml({ cls, name, badge: false, deferSource: true })}</span>`;
    })
    .join('');
  return chips ? `<span class="armory-classes">${chips}</span>` : '';
}
