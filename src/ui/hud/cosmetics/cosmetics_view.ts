// Pure, DOM-free view core for the Cosmetics window: which cards each tab
// shows and in what state, from one plain snapshot of the account cosmetics
// and the acting character. i18n-free like every UI_PURE_CORES entry (labels
// are resolved by cosmetics_cards_view.ts); the painter
// (cosmetics_window.ts) only paints what this returns and forwards clicks to
// IWorld.
//
// Scope is the whole point of the window: ownership is ACCOUNT state (every
// character shares the mount skins, weapon skins and mech chromas the account
// owns) while what is worn is CHARACTER state for mount skins and the mech
// body, and account state for the weapon-skin loadout. Each card model says
// which, so the badge is never inferred in markup.

import { MOUNT_SKIN_IDS, MOUNT_SKINS, type MountSkinId } from '../../../sim/content/mount_skins';
import type { MountRarity } from '../../../sim/content/mounts';
import { MECH_CHROMAS } from '../../../sim/content/skins';
import {
  WEAPON_SKIN_RARITY_ORDER,
  WEAPON_SKIN_TYPES,
  WEAPON_SKINS,
  type WeaponSkinRarity,
} from '../../../sim/content/weapon_skins';
import type { SkinCatalog, SkinRank, WeaponSkinType } from '../../../sim/types';
import { type TabStripModel, tabStripModel } from '../../tab_strip_view';

/** Closed on purpose: a future tab (buddies) is a deliberate addition here. */
export type CosmeticsTab = 'mounts' | 'skins' | 'mech';

export const COSMETICS_TABS: readonly CosmeticsTab[] = ['mounts', 'skins', 'mech'];

export function isCosmeticsTab(value: string): value is CosmeticsTab {
  return (COSMETICS_TABS as readonly string[]).includes(value);
}

export type CosmeticsScope = 'account' | 'character';

/** One plain read of everything the window paints from. */
export interface CosmeticsSnapshot {
  tab: CosmeticsTab;
  ownedMountSkins: readonly string[];
  wornMountSkin: string | null;
  /** The character owns at least one rideable mount (a skin needs a ride). */
  ownsAnyMount: boolean;
  weaponSkinIds: readonly string[];
  weaponSkinLoadout: Readonly<Record<string, string>>;
  /** Weapon types a skin can be applied onto RIGHT NOW (the equipped weapon). */
  applicableWeaponTypes: readonly string[];
  mechChromaIds: readonly string[];
  wornMech: { catalog: SkinCatalog; skin: number };
}

export interface MountSkinCard {
  id: MountSkinId;
  rarity: MountRarity;
  owned: boolean;
  worn: boolean;
  /** null: not owned (the store sells it). */
  action: 'wear' | 'takeOff' | null;
  ownershipScope: CosmeticsScope;
  wornScope: CosmeticsScope;
}

export interface WeaponSkinRow {
  id: string;
  weaponType: WeaponSkinType;
  rarity: WeaponSkinRarity;
  applied: boolean;
  /** Apply is enabled only while a weapon of this type is equipped. */
  canApply: boolean;
  action: 'apply' | 'detach';
  ownershipScope: CosmeticsScope;
  appliedScope: CosmeticsScope;
}

export interface WeaponSkinGroup {
  weaponType: WeaponSkinType;
  rows: WeaponSkinRow[];
}

export interface MechChromaCard {
  id: string;
  /** Index into MECH_CHROMAS, the skin index changeSkin(index, 'mech') takes. */
  index: number;
  rank: SkinRank;
  worn: boolean;
  action: 'wear' | 'takeOff';
  ownershipScope: CosmeticsScope;
  wornScope: CosmeticsScope;
}

/** Every catalog mount skin in store order, owned or not, so the tab doubles
 *  as the catalog a player has not bought into yet. */
export function mountSkinCards(s: CosmeticsSnapshot): MountSkinCard[] {
  return MOUNT_SKIN_IDS.map((id) => {
    const owned = s.ownedMountSkins.includes(id);
    const worn = owned && s.wornMountSkin === id;
    return {
      id,
      rarity: MOUNT_SKINS[id].rarity,
      owned,
      worn,
      action: !owned ? null : worn ? 'takeOff' : 'wear',
      ownershipScope: 'account',
      wornScope: 'character',
    };
  });
}

/** The OWNED weapon skins grouped by weapon type (catalog type order), each
 *  group in rarity order. Unowned skins stay in the store, not here. */
export function weaponSkinGroups(s: CosmeticsSnapshot): WeaponSkinGroup[] {
  const groups: WeaponSkinGroup[] = [];
  for (const weaponType of WEAPON_SKIN_TYPES) {
    const rows = s.weaponSkinIds
      .map((id) => WEAPON_SKINS[id])
      .filter((def) => def !== undefined && def.weaponType === weaponType)
      .sort(
        (a, b) =>
          WEAPON_SKIN_RARITY_ORDER.indexOf(a.rarity) - WEAPON_SKIN_RARITY_ORDER.indexOf(b.rarity),
      )
      .map((def): WeaponSkinRow => {
        const applied = s.weaponSkinLoadout[def.weaponType] === def.id;
        return {
          id: def.id,
          weaponType: def.weaponType,
          rarity: def.rarity,
          applied,
          canApply: s.applicableWeaponTypes.includes(def.weaponType),
          action: applied ? 'detach' : 'apply',
          ownershipScope: 'account',
          appliedScope: 'account',
        };
      });
    if (rows.length > 0) groups.push({ weaponType, rows });
  }
  return groups;
}

/** The OWNED Combat Mech chromas in catalog order. */
export function mechChromaCards(s: CosmeticsSnapshot): MechChromaCard[] {
  const cards: MechChromaCard[] = [];
  MECH_CHROMAS.forEach((chroma, index) => {
    if (!s.mechChromaIds.includes(chroma.id)) return;
    const worn = s.wornMech.catalog === 'mech' && s.wornMech.skin === index;
    cards.push({
      id: chroma.id,
      index,
      rank: chroma.rank,
      worn,
      action: worn ? 'takeOff' : 'wear',
      ownershipScope: 'account',
      wornScope: 'character',
    });
  });
  return cards;
}

/** The WAI-ARIA tab strip for the window (labels already localized by the caller). */
export function cosmeticsTabStrip(
  tab: CosmeticsTab,
  labels: Readonly<Record<CosmeticsTab, string>>,
  ariaLabel: string,
): TabStripModel<CosmeticsTab> {
  return tabStripModel<CosmeticsTab>({
    ariaLabel,
    panelId: 'cosmetics-panel',
    stripClass: 'cos-tabs',
    tabClass: 'cos-tab',
    selectedClass: 'on',
    tabs: COSMETICS_TABS.map((id) => ({ id, label: labels[id] })),
    selected: tab,
  });
}

/** Change signature for the open window's refresh-if-changed path: every
 *  input the cards read, so an unchanged snapshot is a free skip. */
export function cosmeticsSig(s: CosmeticsSnapshot): string {
  return JSON.stringify([
    s.tab,
    s.ownedMountSkins,
    s.wornMountSkin,
    s.ownsAnyMount,
    s.weaponSkinIds,
    s.weaponSkinLoadout,
    s.applicableWeaponTypes,
    s.mechChromaIds,
    s.wornMech.catalog,
    s.wornMech.skin,
  ]);
}
