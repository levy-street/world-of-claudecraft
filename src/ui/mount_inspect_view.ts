// Mount-skin inspect panel: the pure row model and markup (DOM-free, every
// dynamic value escaped) behind src/ui/mount_inspect_controller.ts, the same split the
// Armory inspect's card views use. The store opens the panel from a Machine
// Stable card, the Cosmetics window from a mount card; both hand it one
// MountInspectRow so the panel never re-derives ownership or prices itself.
//
// The row unions three sources: the store's service projection (price and
// purchasability, absent when the store has not fetched a snapshot), the
// account cosmetics mirror (owned), and the acting character (worn, and
// whether a mount exists to wear a skin over). Actions are decided here so
// the painter only binds what this returns.

import { mountSkinDef } from '../sim/content/mount_skins';
import type { MountRarity } from '../sim/content/mounts';
import { sceneLabel } from './armory_labels';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { mountSkinDescription, mountSkinDisplayName } from './mount_labels';
import { svgIcon } from './ui_icons';

export interface MountInspectRow {
  skinId: string;
  rarity: MountRarity;
  /** Claudium cost from the store's service snapshot, or null when unknown. */
  costClaudium: number | null;
  purchasable: boolean;
  owned: boolean;
  /** This character wears the skin right now. */
  worn: boolean;
  /** The character owns at least one rideable mount (a skin needs a ride). */
  ownsAnyMount: boolean;
  /** The ACCOUNT MIRROR carries the skin (accountCosmetics.mountSkinIds).
   *  Both worlds' changeMountSkin refuse an id the mirror lacks, so Wear is
   *  offered only on this, never on the service's grant flag alone: a fresh
   *  grant reads owned from the service first and wearable once the push
   *  lands. */
  wearable: boolean;
}

export type MountInspectAction =
  | 'buy'
  | 'wear'
  | 'takeOff'
  | 'needsMount'
  | 'syncing'
  | 'unavailable';

/** The one action the panel offers for a row, so the painter and its test
 *  read the same decision. */
export function mountInspectAction(row: MountInspectRow): MountInspectAction {
  if (row.worn) return 'takeOff';
  if (row.owned) {
    if (!row.wearable) return 'syncing';
    return row.ownsAnyMount ? 'wear' : 'needsMount';
  }
  return row.purchasable && row.costClaudium !== null ? 'buy' : 'unavailable';
}

/** Project a row from the three sources. `store` is the Machine Stable row
 *  when the store has one (price + purchasability); null outside the store
 *  or before a snapshot, which reads as unavailable-to-buy, never as free. */
export function mountInspectRow(
  skinId: string,
  store: { costClaudium: number | null; purchasable: boolean; owned: boolean } | null,
  character: {
    ownedMountSkinIds: readonly string[];
    wornMountSkinId: string | null;
    ownsAnyMount: boolean;
  },
): MountInspectRow | null {
  const def = mountSkinDef(skinId);
  if (!def) return null;
  const wearable = character.ownedMountSkinIds.includes(skinId);
  const owned = (store?.owned ?? false) || wearable;
  return {
    skinId,
    rarity: def.rarity,
    costClaudium: store?.costClaudium ?? null,
    purchasable: store?.purchasable ?? false,
    owned,
    worn: owned && character.wornMountSkinId === skinId,
    ownsAnyMount: character.ownsAnyMount,
    wearable,
  };
}

/** The scene presets the stage offers: the Armory's vocabulary (armory_labels). */
export type MountInspectSceneKey = Parameters<typeof sceneLabel>[0];

export const MOUNT_INSPECT_CLOSE_ATTR = 'data-mount-close';
export const MOUNT_INSPECT_BUY_ATTR = 'data-mount-buy';
export const MOUNT_INSPECT_WEAR_ATTR = 'data-mount-wear';
export const MOUNT_INSPECT_TAKEOFF_ATTR = 'data-mount-takeoff';
export const MOUNT_INSPECT_MODE_ATTR = 'data-mount-mode';
export const MOUNT_INSPECT_SCENE_ATTR = 'data-mount-scene';

export function mountRarityLabel(rarity: MountRarity): string {
  switch (rarity) {
    case 'common':
      return t('itemUi.quality.common');
    case 'uncommon':
      return t('itemUi.quality.uncommon');
    case 'rare':
      return t('itemUi.quality.rare');
    case 'epic':
      return t('itemUi.quality.epic');
  }
}

/** The dialog shell: the Armory inspect FAMILY (`.armory-inspect*` classes, so
 *  the shipped rarity border and two-column grid style it), with the stage
 *  slot the painter swaps its canvas into and the actions host it repaints. */
export function mountInspectHtml(row: MountInspectRow): string {
  const name = mountSkinDisplayName(row.skinId);
  const desc = mountSkinDescription(row.skinId);
  return (
    `<div class="armory-inspect mount-inspect rarity-${esc(row.rarity)}" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.wocStore.mountInspectAria', { item: name }))}">` +
    `<button type="button" class="x-btn armory-inspect-close" ${MOUNT_INSPECT_CLOSE_ATTR} aria-label="${esc(t('hudChrome.wocStore.close'))}">${svgIcon('close')}</button>` +
    `<div data-mount-stage-slot></div>` +
    `<div class="armory-inspect-panel">` +
    `<div class="armory-inspect-details">` +
    `<div class="armory-inspect-head">` +
    `<span class="armory-collection">${esc(t('hudChrome.wocStore.mountsTitle'))}</span>` +
    `<span class="armory-rarity-pill">${esc(mountRarityLabel(row.rarity))}</span>` +
    `</div>` +
    `<h2>${esc(name)}</h2>` +
    `<p class="armory-type-line">${esc(t('hudChrome.wocStore.mountSkinType'))} · ${esc(t('hudChrome.wocStore.seasonOne'))}</p>` +
    (desc ? `<p class="armory-look">${esc(desc)}</p>` : '') +
    `<p class="armory-type-line">${esc(t('hudChrome.wocStore.mountScopeLine'))}</p>` +
    `</div>` +
    `<div class="armory-inspect-actions" data-mount-actions></div>` +
    `</div></div>`
  );
}

/** The stage's mode and scene toggles (painted once per stage, then synced).
 *  Scenes are the Armory's (armory_labels sceneLabel), one vocabulary. */
export function mountInspectControlsHtml(scenes: readonly MountInspectSceneKey[]): string {
  return (
    `<div class="armory-mode-toggle" role="group" aria-label="${esc(t('hudChrome.wocStore.viewModeLabel'))}">` +
    `<button type="button" ${MOUNT_INSPECT_MODE_ATTR}="rider">${esc(t('hudChrome.wocStore.mountRideIt'))}</button>` +
    `<button type="button" ${MOUNT_INSPECT_MODE_ATTR}="mount">${esc(t('hudChrome.wocStore.mountOnly'))}</button></div>` +
    `<div class="armory-scene-toggle" role="group" aria-label="${esc(t('hudChrome.wocStore.sceneLabel'))}">` +
    scenes
      .map(
        (scene) =>
          `<button type="button" ${MOUNT_INSPECT_SCENE_ATTR}="${esc(scene)}">${esc(sceneLabel(scene))}</button>`,
      )
      .join('') +
    `</div>`
  );
}

/** The price and action row: Buy (with the price) for an unowned priced
 *  skin, Unavailable when the store has no price, Wear / Take off once
 *  owned, and the needs-a-mount hint when nothing can be ridden. */
export function mountInspectActionsHtml(row: MountInspectRow): string {
  const action = mountInspectAction(row);
  const price =
    row.costClaudium === null
      ? ''
      : `<span class="armory-price"><img src="/claudium/icons/claudium_coin_64.webp" alt="">` +
        `<strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
  switch (action) {
    case 'buy':
      return `${price}<button type="button" class="armory-buy" ${MOUNT_INSPECT_BUY_ATTR}>${esc(t('hudChrome.wocStore.mountBuy'))}</button>`;
    case 'unavailable':
      return `<button type="button" class="armory-buy" ${MOUNT_INSPECT_BUY_ATTR} disabled>${esc(t('hudChrome.wocStore.unavailable'))}</button>`;
    case 'takeOff':
      return (
        `<span class="armory-owned-pill applied">${esc(t('hudChrome.cosmetics.worn'))}</span>` +
        `<button type="button" class="armory-detach" ${MOUNT_INSPECT_TAKEOFF_ATTR}>${esc(t('hudChrome.cosmetics.takeOff'))}</button>`
      );
    case 'wear':
      return (
        `<span class="armory-owned-pill">${esc(t('hudChrome.wocStore.owned'))}</span>` +
        `<button type="button" class="armory-apply" ${MOUNT_INSPECT_WEAR_ATTR}>${esc(t('hudChrome.cosmetics.wear'))}</button>`
      );
    case 'needsMount':
      return (
        `<span class="armory-owned-pill">${esc(t('hudChrome.wocStore.owned'))}</span>` +
        `<span class="armory-equip-hint">${esc(t('hudChrome.cosmetics.mountsNoMount'))}</span>`
      );
    case 'syncing':
      // Owned per the service, not yet in the account mirror: the pill alone,
      // since a Wear here would be refused silently by both worlds.
      return `<span class="armory-owned-pill">${esc(t('hudChrome.wocStore.owned'))}</span>`;
  }
}
