// The log lines Lantern Hall's events take (src/ui/hud/quest/quest_event_router.ts): a paid
// contract and a bought title, horse or sword. Pure: strings through t(), numbers through
// formatNumber.
import { GUILD_QUARTERMASTER_STOCK_BY_ID } from '../../../sim/content/guild_contracts';
import { WEAPON_SKINS } from '../../../sim/content/weapon_skins';
import { ITEMS } from '../../../sim/data';
import { localizeWeaponSkin } from '../../armory_labels';
import { deedTitleText } from '../../deed_i18n';
import { formatNumber, t, tPlural } from '../../i18n';
import { mountDisplayName } from '../../mount_labels';
import { guildContractLabel } from './guild_hall_view';

export function guildContractToast(contractId: string, seals: number): string {
  const count = formatNumber(seals, { maximumFractionDigits: 0 });
  const contract = guildContractLabel(contractId);
  return tPlural('hudChrome.guildHall.contractDone', seals, { contract, count });
}

export function guildCosmeticToast(offerId: string): string {
  const offer = Object.hasOwn(GUILD_QUARTERMASTER_STOCK_BY_ID, offerId)
    ? GUILD_QUARTERMASTER_STOCK_BY_ID[offerId]
    : undefined;
  // an offer this client does not know logs nothing rather than a line with a hole in it
  if (!offer) return '';
  switch (offer.kind) {
    case 'title':
      return t('hudChrome.guildHall.bought', { title: deedTitleText(offer.deedId) });
    case 'mount': {
      const def = ITEMS[offer.itemId];
      if (def?.kind !== 'mount') return '';
      return t('hudChrome.guildHall.boughtMount', { mount: mountDisplayName(def.mount) });
    }
    case 'weaponSkin': {
      const skin = WEAPON_SKINS[offer.skinId];
      if (!skin) return '';
      return t('hudChrome.guildHall.boughtSkin', { skin: localizeWeaponSkin(skin).name });
    }
  }
}
