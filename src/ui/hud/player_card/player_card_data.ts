import { ITEMS } from '../../../sim/data';
import type { EquipSlot } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { deedTitleText } from '../../deed_i18n';
import { classDisplayName, itemDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { weaponDps } from '../../stat_tooltip';
import type { PlayerCardData, PlayerCardStat } from './player_card';
import type { CharacterStanding, ReferralInfo } from './player_card_share';

export interface PlayerCardDataInput {
  characterImage: string;
  referral: ReferralInfo | null;
  standing: CharacterStanding | null;
  balance: number | null;
  showDevBadges: boolean;
  slotName(slot: EquipSlot): string;
}

export function playerCardSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Projects an IWorld snapshot into the localized, compositor-only card model. */
export function buildPlayerCardData(world: IWorld, input: PlayerCardDataInput): PlayerCardData {
  const player = world.player;
  const playerClass = world.cfg.playerClass;
  const classColor = `#${(player.color & 0xffffff).toString(16).padStart(6, '0')}`;
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });
  const percent = (value: number) =>
    `${formatNumber(value * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  let topPercent: number | null = null;
  if (input.standing && input.standing.total >= 5 && input.standing.rank >= 1) {
    const percentile = (input.standing.rank / input.standing.total) * 100;
    if (percentile <= 50) topPercent = percentile;
  }

  const weapon = world.equipment.mainhand ? ITEMS[world.equipment.mainhand] : null;
  const dps = weaponDps(weapon?.weapon, player.attackPower);
  const primaryStats: PlayerCardStat[] = [
    { label: t('itemUi.stats.str'), value: number(player.stats.str) },
    { label: t('itemUi.stats.agi'), value: number(player.stats.agi) },
    { label: t('itemUi.stats.sta'), value: number(player.stats.sta) },
    { label: t('itemUi.stats.int'), value: number(player.stats.int) },
    { label: t('itemUi.stats.spi'), value: number(player.stats.spi) },
    { label: t('itemUi.stats.armor'), value: number(player.stats.armor) },
  ];
  const combatStats: PlayerCardStat[] = [
    { label: t('itemUi.stats.attackPower'), value: number(player.attackPower) },
    {
      label: t('itemUi.stats.dps'),
      value: formatNumber(dps, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    },
    { label: t('itemUi.stats.critChance'), value: percent(player.critChance) },
    { label: t('itemUi.stats.dodge'), value: percent(player.dodgeChance) },
  ];
  const rating = world.arenaInfo?.rating ?? null;
  if (rating !== null)
    combatStats.push({ label: t('playerCard.arenaStat'), value: number(rating) });
  if (world.prestigeRank > 0) {
    combatStats.push({ label: t('game.prestige.rank'), value: number(world.prestigeRank) });
  }

  const slots: EquipSlot[] = ['mainhand', 'offhand', 'chest', 'legs', 'feet'];
  const gear = slots.map((slot) => {
    const itemId = world.equipment[slot];
    const item = itemId ? ITEMS[itemId] : null;
    return {
      slot: input.slotName(slot),
      name: item ? itemDisplayName(item) : t('itemUi.equipment.empty'),
      color: item ? (QUALITY_COLOR[item.quality ?? 'common'] ?? '#cfc3a0') : '#7c7058',
    };
  });

  const titleText = world.activeTitle ? deedTitleText(world.activeTitle) : '';
  return {
    name: player.name,
    className: classDisplayName(playerClass),
    classColor,
    level: player.level,
    realm: world.realm,
    characterImage: input.characterImage,
    primaryStats,
    combatStats,
    gear,
    ...(titleText ? { titleText } : {}),
    topPercent,
    balance: input.balance,
    devTier: input.showDevBadges ? (player.devTier ?? null) : null,
    devMergedPrs: input.showDevBadges ? (player.devMergedPrs ?? null) : null,
    referralHandle: input.referral?.slug ?? playerCardSlug(player.name),
    referralCount: input.referral?.count ?? null,
    siteUrl: 'worldofclaudecraft.com',
  };
}
