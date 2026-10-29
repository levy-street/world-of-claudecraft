// Pure view core for Lantern Hall's quartermaster counter (Garrick Holt): the stock as item
// cards (the offer's art, its price in Lantern Seals, owned / affordable / short), the one
// selected card's detail (what it gives you, how to use it, the price against the seals
// balance, the buy action, and what its preview stage shows) and each card's hover lines.
// DOM-free and canvas-free: it NAMES the art (a Book of Deeds crest id, an item id, an Armory
// skin id) and the stage subject, and the painter resolves the pixels and the 3D.
//
// The stock (content/guild_contracts.ts GUILD_QUARTERMASTER_STOCK) holds three kinds of offer,
// all cosmetic: titles (Book of Deeds feats), account-wide weapon appearances and the guild's
// war horse. A title's preview is the nameplate it draws over your head, split around the name
// the way the target frame splits it (deed_i18n.ts titledNameDecoration); a weapon appearance
// is tried on your own character and the horse is shown under you, both on a live 3D stage
// the painter mounts (guild_offer_stage_controller.ts).

import { DEEDS } from '../../../sim/content/deeds';
import {
  GUILD_QUARTERMASTER_STOCK,
  GUILD_QUARTERMASTER_STOCK_BY_ID,
  type GuildQuartermasterOffer,
} from '../../../sim/content/guild_contracts';
import { WEAPON_SKINS } from '../../../sim/content/weapon_skins';
import { ITEMS } from '../../../sim/data';
import type { GuildContractsView } from '../../../sim/guild_contracts';
import { localizeWeaponSkin } from '../../armory_labels';
import { deedTitleText, titledDisplayName, titledNameDecoration } from '../../deed_i18n';
import { deedCrestId } from '../../deeds_view';
import { formatNumber, t, tPlural } from '../../i18n';
import { mountDisplayName } from '../../mount_labels';

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** The Lantern Seals balance: a currency counter (src/sim/lantern_seals.ts), never a bag stack. */
export function lanternSeals(board: Pick<GuildContractsView, 'seals'>): number {
  return board.seals;
}

/** "{count} Lantern Seals", in the locale's own plural form. */
export function sealCount(count: number): string {
  return tPlural('hudChrome.guildHall.reward', count, { count: whole(count) });
}

/** Where a card stands against the balance: bought, buyable now, or short of seals. */
export type GuildShopItemState = 'owned' | 'ready' | 'short';

/** A card's art, by name: the painter resolves the pixels (iconDataUrl for a crest,
 *  itemImageUrl for an item, the Armory card for a weapon appearance). */
export type GuildShopArt =
  | { kind: 'crest'; id: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'skin'; skinId: string };

/** What the detail's preview stage shows: the nameplate a title draws (text only), or a live
 *  3D subject (the war horse under you; a weapon appearance in your hand). */
export type GuildShopStage =
  | { kind: 'plate'; heading: string; pre: string; name: string; post: string }
  | { kind: 'mount'; heading: string; mountKey: string }
  | { kind: 'weapon'; heading: string; skinId: string };

export interface GuildShopItemView {
  id: string;
  offerKind: GuildQuartermasterOffer['kind'];
  art: GuildShopArt;
  /** The reward itself ("Writ-Runner", "Lantern Hall Destrier", "Blade of Lantern Hall"). */
  name: string;
  kindLabel: string;
  /** The bare price, for the seal-icon price tag. */
  priceValue: string;
  /** The price in words ("6 Lantern Seals"), for a screen reader and the hover card. */
  price: string;
  state: GuildShopItemState;
  /** The card's state chip: Owned, Buy, or how many seals are still wanted. */
  stateLabel: string;
  selected: boolean;
}

export interface GuildShopDetailView {
  id: string;
  offerKind: GuildQuartermasterOffer['kind'];
  art: GuildShopArt;
  name: string;
  kindLabel: string;
  stage: GuildShopStage;
  /** What it does in a line (the horse's speed, where an appearance shows); '' for a title,
   *  whose nameplate says it. */
  summary: string;
  howTo: string;
  /** "Cosmetic only" for a title; null where the summary already says what it changes. */
  cosmetic: string | null;
  priceText: string;
  priceValue: string;
  haveText: string;
  state: GuildShopItemState;
  /** The buy button's label (Buy, Owned, or Needs N more) and whether it can be pressed. */
  action: string;
  actionEnabled: boolean;
  /** Why it cannot be bought yet, a sentence of its own (null when it can be, or is owned). */
  shortText: string | null;
}

export interface GuildShopView {
  stockLabel: string;
  items: GuildShopItemView[];
  /** The selected card's detail (null only for an empty stock). */
  detail: GuildShopDetailView | null;
}

export interface GuildShopInput {
  readonly seals: number;
  readonly playerName: string;
  readonly deedsEarned: ReadonlyMap<string, string>;
  /** The catalog mounts held (IWorld.ownedMounts: owned while the reins are in the bags). */
  readonly ownedMounts: readonly string[];
  /** The account's weapon appearances (IWorld.accountCosmetics.weaponSkinIds). */
  readonly weaponSkinIds: readonly string[];
  /** Riding learned (IWorld.ridingTrained): the horse's buy gate, the stable's own. */
  readonly ridingTrained: boolean;
}

/** The sim refuses the horse to a rider who has not learned to ride (guild_quartermaster.ts):
 *  the counter says so up front instead of offering a press that will be refused. */
function needsRiding(offer: GuildQuartermasterOffer, owned: boolean, input: GuildShopInput) {
  return offer.kind === 'mount' && !owned && !input.ridingTrained;
}

/** The catalog mount a reins offer carries ('' when the item is not reins). */
export function guildOfferMountKey(itemId: string): string {
  const def = ITEMS[itemId];
  return def?.kind === 'mount' ? def.mount : '';
}

/** Whether the player already has what an offer grants: the sim's own test
 *  (src/sim/guild_quartermaster.ts), read through the three ledgers. */
export function guildOfferOwned(offer: GuildQuartermasterOffer, input: GuildShopInput): boolean {
  switch (offer.kind) {
    case 'title':
      return input.deedsEarned.has(offer.deedId);
    case 'mount':
      return input.ownedMounts.includes(guildOfferMountKey(offer.itemId));
    case 'weaponSkin':
      return input.weaponSkinIds.includes(offer.skinId);
  }
}

/** Every offer's owned flag in stock order, for the window's repaint signature. */
export function guildShopOwnedFlags(input: GuildShopInput): boolean[] {
  return GUILD_QUARTERMASTER_STOCK.map((offer) => guildOfferOwned(offer, input));
}

/** The card a fresh counter opens on: the first offer not yet owned (the titles lead, cheapest
 *  first), else the first. */
export function defaultGuildShopSelection(input: GuildShopInput): string | null {
  const next = GUILD_QUARTERMASTER_STOCK.find((offer) => !guildOfferOwned(offer, input));
  return (next ?? GUILD_QUARTERMASTER_STOCK[0])?.id ?? null;
}

function stateOf(owned: boolean, affordable: boolean): GuildShopItemState {
  if (owned) return 'owned';
  return affordable ? 'ready' : 'short';
}

function actionLabel(state: GuildShopItemState, missing: number): string {
  if (state === 'owned') return t('hudChrome.guildHall.owned');
  if (state === 'ready') return t('hudChrome.guildHall.buy');
  return t('hudChrome.guildHall.needSeals', { count: whole(missing) });
}

/** The art, name and kind label every surface (card, detail, hover card) shares. */
function offerIdentity(offer: GuildQuartermasterOffer): {
  art: GuildShopArt;
  name: string;
  kindLabel: string;
} {
  switch (offer.kind) {
    case 'title':
      return {
        art: {
          kind: 'crest',
          id: deedCrestId(offer.deedId, DEEDS[offer.deedId]?.category ?? 'feat'),
        },
        name: deedTitleText(offer.deedId),
        kindLabel: t('hudChrome.guildHall.shop.kindTitle'),
      };
    case 'mount':
      return {
        art: { kind: 'item', itemId: offer.itemId },
        name: mountDisplayName(guildOfferMountKey(offer.itemId)),
        kindLabel: t('hudChrome.guildHall.shop.kindMount'),
      };
    case 'weaponSkin': {
      const skin = WEAPON_SKINS[offer.skinId];
      return {
        art: { kind: 'skin', skinId: offer.skinId },
        name: skin ? localizeWeaponSkin(skin).name : '',
        kindLabel: t('hudChrome.guildHall.shop.kindSword'),
      };
    }
  }
}

/** What an offer does, in a line ('' for a title: its nameplate preview says it). */
function offerSummary(offer: GuildQuartermasterOffer): string {
  switch (offer.kind) {
    case 'title':
      return '';
    case 'mount':
      return t('hudChrome.guildHall.mountPreview');
    case 'weaponSkin':
      return t('hudChrome.guildHall.skinPreview');
  }
}

/** How to use it once bought, or where it already is when owned. */
function offerHowTo(offer: GuildQuartermasterOffer, owned: boolean): string {
  switch (offer.kind) {
    case 'title':
      return owned ? t('hudChrome.guildHall.shop.ownedLong') : t('hudChrome.guildHall.shop.howTo');
    case 'mount':
      return owned
        ? t('hudChrome.guildHall.shop.mountOwned')
        : t('hudChrome.guildHall.shop.mountHowTo');
    case 'weaponSkin':
      return owned
        ? t('hudChrome.guildHall.shop.skinOwned')
        : t('hudChrome.guildHall.shop.skinHowTo');
  }
}

function offerStage(offer: GuildQuartermasterOffer, playerName: string): GuildShopStage {
  switch (offer.kind) {
    case 'title': {
      const plate = titledNameDecoration(offer.deedId);
      return {
        kind: 'plate',
        heading: t('hudChrome.guildHall.shop.plateHeading'),
        pre: plate.pre,
        name: playerName,
        post: plate.post,
      };
    }
    case 'mount':
      return {
        kind: 'mount',
        heading: t('hudChrome.guildHall.shop.mountHeading'),
        mountKey: guildOfferMountKey(offer.itemId),
      };
    case 'weaponSkin':
      return {
        kind: 'weapon',
        heading: t('hudChrome.guildHall.shop.skinHeading'),
        skinId: offer.skinId,
      };
  }
}

export function buildGuildShopView(input: GuildShopInput, selected: string | null): GuildShopView {
  const chosen =
    selected && Object.hasOwn(GUILD_QUARTERMASTER_STOCK_BY_ID, selected)
      ? selected
      : defaultGuildShopSelection(input);
  let detail: GuildShopDetailView | null = null;
  const items = GUILD_QUARTERMASTER_STOCK.map((offer): GuildShopItemView => {
    const owned = guildOfferOwned(offer, input);
    const missing = Math.max(0, offer.seals - input.seals);
    const state = stateOf(owned, missing === 0);
    const { art, name, kindLabel } = offerIdentity(offer);
    const price = sealCount(offer.seals);
    const priceValue = whole(offer.seals);
    const action = actionLabel(state, missing);
    const unridden = needsRiding(offer, owned, input);
    if (offer.id === chosen) {
      detail = {
        id: offer.id,
        offerKind: offer.kind,
        art,
        name,
        kindLabel,
        stage: offerStage(offer, input.playerName),
        summary: offerSummary(offer),
        howTo: offerHowTo(offer, owned),
        cosmetic: offer.kind === 'title' ? t('hudChrome.guildHall.shop.cosmetic') : null,
        priceText: t('hudChrome.guildHall.shop.price', { price }),
        priceValue,
        haveText: t('hudChrome.guildHall.shop.have', { count: whole(input.seals) }),
        state,
        action,
        actionEnabled: state === 'ready' && !unridden,
        shortText:
          state === 'short'
            ? tPlural('hudChrome.guildHall.shop.short', missing, { count: whole(missing) })
            : unridden
              ? t('hudChrome.guildHall.refused.riding')
              : null,
      };
    }
    return {
      id: offer.id,
      offerKind: offer.kind,
      art,
      name,
      kindLabel,
      priceValue,
      price,
      state,
      stateLabel: action,
      selected: offer.id === chosen,
    };
  });
  return { stockLabel: t('hudChrome.guildHall.shop.stockLabel'), items, detail };
}

/** One line of a card's hover card, with its tone (the shared tooltip's classes). */
export interface GuildShopTipLine {
  text: string;
  tone: 'sub' | 'desc' | 'green' | 'red';
}

/** The hover card's title: "Title: Writ-Runner", "Mount: ...", "Sword appearance: ...". */
function offerTipTitle(offer: GuildQuartermasterOffer, name: string): string {
  switch (offer.kind) {
    case 'title':
      return t('hudChrome.guildHall.titleOffer', { title: name });
    case 'mount':
      return t('hudChrome.guildHall.mountOffer', { mount: name });
    case 'weaponSkin':
      return t('hudChrome.guildHall.skinOffer', { skin: name });
  }
}

/** A stock card's hover card, written from the live rule (guild_quartermaster.ts): what the
 *  offer is (a title's nameplate, the horse's speed, where an appearance shows), how to use
 *  it, that a title is cosmetic, its price, and why it cannot be bought when it cannot. */
export function guildShopTooltip(
  offerId: string,
  input: GuildShopInput,
): { title: string; lines: GuildShopTipLine[] } | null {
  if (!Object.hasOwn(GUILD_QUARTERMASTER_STOCK_BY_ID, offerId)) return null;
  const offer = GUILD_QUARTERMASTER_STOCK_BY_ID[offerId];
  const { name } = offerIdentity(offer);
  const owned = guildOfferOwned(offer, input);
  const missing = Math.max(0, offer.seals - input.seals);
  const lines: GuildShopTipLine[] = [
    {
      text:
        offer.kind === 'title'
          ? t('hudChrome.guildHall.titlePreview', {
              preview: titledDisplayName(input.playerName, offer.deedId),
            })
          : offerSummary(offer),
      tone: 'sub',
    },
    { text: offerHowTo(offer, owned), tone: 'desc' },
  ];
  if (offer.kind === 'title')
    lines.push({ text: t('hudChrome.guildHall.shop.cosmetic'), tone: 'desc' });
  lines.push({
    text: t('hudChrome.guildHall.shop.price', { price: sealCount(offer.seals) }),
    tone: 'sub',
  });
  if (!owned && missing > 0) {
    lines.push({
      text: tPlural('hudChrome.guildHall.shop.short', missing, { count: whole(missing) }),
      tone: 'red',
    });
  }
  if (needsRiding(offer, owned, input)) {
    lines.push({ text: t('hudChrome.guildHall.refused.riding'), tone: 'red' });
  }
  return { title: offerTipTitle(offer, name), lines };
}
