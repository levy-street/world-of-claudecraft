// Markup for the Cosmetics window body: the three tab panels built from the
// pure card models in cosmetics_view.ts. DOM-free (HTML strings, every
// dynamic value escaped) but i18n-aware: this is where every label resolves
// through t(), so the pure core stays i18n-free and the painter stays thin.
//
// Action buttons carry `data-act` + `data-id` (+ `data-type` / `data-index`
// where the IWorld call needs it); cosmetics_window.ts dispatches them through
// one delegated listener. Every card carries its scope badges so a player can
// always see whether a look is shared by the account or worn by this character.

import { WEAPON_SKINS } from '../../../sim/content/weapon_skins';
import type { WeaponSkinType } from '../../../sim/types';
import { localizeWeaponSkin, rarityLabel, weaponTypeLabel } from '../../armory_labels';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { mountSkinDescription, mountSkinDisplayName } from '../../mount_labels';
import {
  type CosmeticsScope,
  type CosmeticsSnapshot,
  type MechChromaCard,
  type MountSkinCard,
  mechChromaCards,
  mountSkinCards,
  type WeaponSkinGroup,
  weaponSkinGroups,
} from './cosmetics_view';
import { mechChromaName, skinRankName } from './skin_event_i18n';

function mountRarityLabel(rarity: MountSkinCard['rarity']): string {
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

function scopeBadge(scope: CosmeticsScope, wornLike: boolean): string {
  const label =
    scope === 'account'
      ? t('hudChrome.cosmetics.scopeAccount')
      : t('hudChrome.cosmetics.scopeCharacter');
  return `<span class="cos-scope cos-scope-${scope}${wornLike ? ' cos-scope-worn' : ''}">${esc(label)}</span>`;
}

function actionButton(
  act: string,
  id: string,
  label: string,
  extra = '',
  disabled = false,
): string {
  return (
    `<button type="button" class="cos-action" data-act="${esc(act)}" data-id="${esc(id)}"${extra}` +
    `${disabled ? ' disabled aria-disabled="true"' : ''}>${esc(label)}</button>`
  );
}

function mountCardHtml(card: MountSkinCard): string {
  const name = mountSkinDisplayName(card.id);
  const desc = mountSkinDescription(card.id);
  const state = card.worn
    ? `<span class="cos-state worn">${esc(t('hudChrome.cosmetics.worn'))}</span>`
    : card.owned
      ? `<span class="cos-state owned">${esc(t('hudChrome.cosmetics.owned'))}</span>`
      : `<span class="cos-state store">${esc(t('hudChrome.cosmetics.storeOnly'))}</span>`;
  const action =
    card.action === 'wear'
      ? actionButton('wear-mount', card.id, t('hudChrome.cosmetics.wear'))
      : card.action === 'takeOff'
        ? actionButton('takeoff-mount', card.id, t('hudChrome.cosmetics.takeOff'))
        : '';
  return (
    `<article class="cos-card rarity-${esc(card.rarity)}${card.owned ? ' owned' : ''}${card.worn ? ' worn' : ''}" ` +
    `data-card="${esc(card.id)}" aria-label="${esc(t('hudChrome.cosmetics.cardAria', { name, rarity: mountRarityLabel(card.rarity) }))}">` +
    `<div class="cos-card-head">${scopeBadge(card.ownershipScope, false)}${card.worn ? scopeBadge(card.wornScope, true) : ''}` +
    `<span class="cos-rarity q-${esc(card.rarity)}">${esc(mountRarityLabel(card.rarity))}</span></div>` +
    `<h3 class="cos-card-name">${esc(name)}</h3>` +
    (desc ? `<p class="cos-card-desc">${esc(desc)}</p>` : '') +
    `<div class="cos-card-actions">${state}${action}</div></article>`
  );
}

function weaponGroupHtml(group: WeaponSkinGroup): string {
  const typeLabel = weaponTypeLabel(group.weaponType);
  const rows = group.rows
    .map((row) => {
      const def = WEAPON_SKINS[row.id];
      const name = def ? localizeWeaponSkin(def).name : row.id;
      const state = row.applied
        ? `<span class="cos-state worn">${esc(t('hudChrome.cosmetics.applied'))}</span>`
        : `<span class="cos-state owned">${esc(t('hudChrome.cosmetics.owned'))}</span>`;
      const action =
        row.action === 'detach'
          ? actionButton(
              'detach-skin',
              row.id,
              t('hudChrome.cosmetics.detach'),
              ` data-type="${esc(row.weaponType)}"`,
            )
          : actionButton('apply-skin', row.id, t('hudChrome.cosmetics.apply'), '', !row.canApply);
      const hint =
        row.action === 'apply' && !row.canApply
          ? `<p class="cos-card-hint">${esc(t('hudChrome.cosmetics.skinsApplyHint', { type: typeLabel }))}</p>`
          : '';
      return (
        `<article class="cos-card cos-row rarity-${esc(row.rarity)} owned${row.applied ? ' worn' : ''}" ` +
        `data-card="${esc(row.id)}" aria-label="${esc(t('hudChrome.cosmetics.cardAria', { name, rarity: rarityLabel(row.rarity) }))}">` +
        `<div class="cos-card-head">${scopeBadge(row.ownershipScope, false)}${row.applied ? scopeBadge(row.appliedScope, true) : ''}` +
        `<span class="cos-rarity q-${esc(row.rarity)}">${esc(rarityLabel(row.rarity))}</span></div>` +
        `<h3 class="cos-card-name">${esc(name)}</h3>${hint}` +
        `<div class="cos-card-actions">${state}${action}</div></article>`
      );
    })
    .join('');
  return `<section class="cos-group"><h2 class="cos-group-title">${esc(typeLabel)}</h2><div class="cos-grid">${rows}</div></section>`;
}

function mechCardHtml(card: MechChromaCard): string {
  const name = mechChromaName(card.id);
  const rankName = skinRankName(card.rank);
  const state = card.worn
    ? `<span class="cos-state worn">${esc(t('hudChrome.cosmetics.worn'))}</span>`
    : `<span class="cos-state owned">${esc(t('hudChrome.cosmetics.owned'))}</span>`;
  const action =
    card.action === 'takeOff'
      ? actionButton('takeoff-mech', card.id, t('hudChrome.cosmetics.takeOff'))
      : actionButton(
          'wear-mech',
          card.id,
          t('hudChrome.cosmetics.wear'),
          ` data-index="${card.index}"`,
        );
  return (
    `<article class="cos-card cos-mech rarity-${esc(card.rank)} owned${card.worn ? ' worn' : ''}" ` +
    `data-card="${esc(card.id)}" aria-label="${esc(t('hudChrome.cosmetics.cardAria', { name, rarity: rankName }))}">` +
    `<div class="cos-card-head">${scopeBadge(card.ownershipScope, false)}${card.worn ? scopeBadge(card.wornScope, true) : ''}` +
    `<span class="cos-rarity q-${esc(card.rank)}">${esc(rankName)}</span></div>` +
    `<div class="cos-mech-swatch chroma-${esc(card.id)}" aria-hidden="true"></div>` +
    `<h3 class="cos-card-name">${esc(name)}</h3>` +
    `<div class="cos-card-actions">${state}${action}</div></article>`
  );
}

function emptyHtml(text: string): string {
  return `<p class="cos-empty">${esc(text)}</p>`;
}

/** The whole tab panel for the snapshot's selected tab. */
export function cosmeticsPanelHtml(s: CosmeticsSnapshot): string {
  switch (s.tab) {
    case 'mounts': {
      const hint = s.ownsAnyMount
        ? ''
        : `<p class="cos-hint">${esc(t('hudChrome.cosmetics.mountsNoMount'))}</p>`;
      return (
        `<p class="cos-intro">${esc(t('hudChrome.cosmetics.mountsIntro'))}</p>${hint}` +
        `<div class="cos-grid">${mountSkinCards(s).map(mountCardHtml).join('')}</div>`
      );
    }
    case 'skins': {
      const groups = weaponSkinGroups(s);
      if (groups.length === 0) return emptyHtml(t('hudChrome.cosmetics.skinsEmpty'));
      return groups.map(weaponGroupHtml).join('');
    }
    case 'mech': {
      const cards = mechChromaCards(s);
      if (cards.length === 0) return emptyHtml(t('hudChrome.cosmetics.mechEmpty'));
      return (
        `<p class="cos-intro">${esc(t('hudChrome.cosmetics.mechIntro'))}</p>` +
        `<div class="cos-grid">${cards.map(mechCardHtml).join('')}</div>`
      );
    }
  }
}

/** The action a delegated click resolves to, from the button's data attributes. */
export type CosmeticsAction =
  | { kind: 'wear-mount'; id: string }
  | { kind: 'takeoff-mount' }
  | { kind: 'apply-skin'; id: string }
  | { kind: 'detach-skin'; weaponType: WeaponSkinType }
  | { kind: 'wear-mech'; index: number }
  | { kind: 'takeoff-mech'; id: string };

export function cosmeticsActionFrom(dataset: {
  act?: string;
  id?: string;
  type?: string;
  index?: string;
}): CosmeticsAction | null {
  const id = dataset.id ?? '';
  switch (dataset.act) {
    case 'wear-mount':
      return id ? { kind: 'wear-mount', id } : null;
    case 'takeoff-mount':
      return { kind: 'takeoff-mount' };
    case 'apply-skin':
      return id ? { kind: 'apply-skin', id } : null;
    case 'detach-skin':
      return dataset.type
        ? { kind: 'detach-skin', weaponType: dataset.type as WeaponSkinType }
        : null;
    case 'wear-mech': {
      const index = Number(dataset.index);
      return Number.isInteger(index) && index >= 0 ? { kind: 'wear-mech', index } : null;
    }
    case 'takeoff-mech':
      return id ? { kind: 'takeoff-mech', id } : null;
    default:
      return null;
  }
}
