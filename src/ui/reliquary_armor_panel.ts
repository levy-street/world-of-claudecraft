// Painter for the Reliquary "Armor Cosmetics" claim panel: how the skins are
// unlocked (text), the acting class's Inner Crucible set progress (piece icons
// dark until owned, marked once obtained), and the reward skin in a small box
// with a Claim / Claimed button. Markup only: the model comes from
// reliquary_armor_view.ts and the click is delegated by the Reliquary window.
import { preloadFullBodySkinAssets } from '../render/characters/assets';
import { FULL_BODY_SKIN_VISUAL_KEYS } from '../render/characters/manifest';
import { CRUCIBLE_SKIN_CATALOG } from '../sim/content/crucible_skins';
import { ITEM_SETS } from '../sim/content/item_sets';
import { ITEMS } from '../sim/data';
import { esc } from './esc';
import { t } from './i18n';
import { knownItemDef } from './known_item';
import { portraitChipHtml } from './portrait_chip';
import { raidSkinName } from './raid_skin_labels';
import type { ArmorPanelModel, ArmorSetView } from './reliquary_armor_view';

/** Kick the lazy GLB fetch for every Crucible skin body so the portrait chips
 *  (grid cells and the reward box) fill in; portrait_chip.ts repaints any open
 *  chip once each fetch resolves. Memoized inside assets.ts, so repeat calls
 *  are free. */
export function preloadArmorSkinThumbnails(): void {
  for (const def of CRUCIBLE_SKIN_CATALOG) {
    const visualKey = FULL_BODY_SKIN_VISUAL_KEYS[def.catalog];
    if (visualKey) void preloadFullBodySkinAssets(visualKey);
  }
}

/** The small square portrait of one skin, used by the grid cells and the box. */
export function armorSkinChipHtml(catalog: string, cls: string): string {
  const def = CRUCIBLE_SKIN_CATALOG.find((d) => d.catalog === catalog);
  if (!def) return '';
  return portraitChipHtml({
    cls: def.requiredClass,
    catalog: def.catalog,
    name: raidSkinName(def.catalog) || cls,
    variant: 'sm',
    framing: 'headshot',
    badge: false,
  });
}

function pieceHtml(itemId: string, owned: boolean, itemIcon: (id: string) => string): string {
  const def = knownItemDef(ITEMS, itemId);
  const name = def ? def.name : itemId;
  return (
    `<span class="reliquary-armor-piece ${owned ? 'is-owned' : 'is-missing'}" ` +
    `data-armor-piece="${esc(itemId)}" title="${esc(name)}">` +
    `${itemIcon(itemId)}${owned ? '<span class="reliquary-armor-check" aria-hidden="true">&#10003;</span>' : ''}` +
    `</span>`
  );
}

function setHtml(set: ArmorSetView, itemIcon: (id: string) => string): string {
  const name = ITEM_SETS[set.setId]?.name ?? set.setId;
  return (
    `<div class="reliquary-armor-set${set.complete ? ' is-complete' : ''}" data-armor-set="${esc(set.setId)}">` +
    `<div class="reliquary-armor-set-name">${esc(
      t('hudChrome.reliquary.armorSetProgress', {
        name,
        owned: set.owned,
        total: set.total,
      }),
    )}</div>` +
    `<div class="reliquary-armor-pieces">${set.pieces
      .map((p) => pieceHtml(p.itemId, p.owned, itemIcon))
      .join('')}</div></div>`
  );
}

export function armorPanelHtml(model: ArmorPanelModel, itemIcon: (id: string) => string): string {
  const how =
    `<div class="reliquary-armor-how"><h4>${esc(t('hudChrome.reliquary.armorHowTitle'))}</h4>` +
    `<p>${esc(t('hudChrome.reliquary.armorHow'))}</p></div>`;
  if (model.skin === null) {
    return `<section class="reliquary-armor-panel">${how}<p class="reliquary-empty">${esc(
      t('hudChrome.reliquary.armorNoClass'),
    )}</p></section>`;
  }
  const skinName = raidSkinName(model.skin.catalog);
  const button =
    model.state === 'claimed'
      ? `<button type="button" class="ui-btn reliquary-armor-claim is-claimed" disabled aria-label="${esc(
          t('hudChrome.reliquary.armorClaimedAria', { name: skinName }),
        )}">${esc(t('hudChrome.reliquary.armorClaimed'))}</button>`
      : `<button type="button" class="ui-btn reliquary-armor-claim" data-armor-claim="${esc(
          model.skin.catalog,
        )}" data-focus-key="armor-claim"${model.state === 'locked' ? ' disabled' : ''} aria-label="${esc(
          t('hudChrome.reliquary.armorClaimAria', { name: skinName }),
        )}">${esc(t('hudChrome.reliquary.armorClaim'))}</button>`;
  const hint =
    model.state === 'locked'
      ? `<span class="reliquary-armor-claim-hint">${esc(t('hudChrome.reliquary.armorClaimLocked'))}</span>`
      : '';
  const box =
    `<div class="reliquary-armor-reward reliquary-armor-reward--${model.state}">` +
    `<h4>${esc(t('hudChrome.reliquary.armorRewardTitle'))}</h4>` +
    `<div class="reliquary-armor-reward-box">${armorSkinChipHtml(model.skin.catalog, model.playerClass)}` +
    `<div class="reliquary-armor-reward-name">${esc(skinName)}</div>${button}${hint}</div></div>`;
  return (
    `<section class="reliquary-armor-panel">${how}` +
    `<div class="reliquary-armor-sets"><h4>${esc(t('hudChrome.reliquary.armorSetsTitle'))}</h4>${model.sets
      .map((s) => setHtml(s, itemIcon))
      .join('')}</div>${box}</section>`
  );
}
