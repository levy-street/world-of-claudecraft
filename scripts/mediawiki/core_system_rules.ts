import { GROUP_XP_BONUS } from '../../src/sim/data';
import { GUILD_RANK_MAX, GUILD_RANK_MIN, GUILD_RANK_NAME_MAX } from '../../src/sim/guild_ranks';
import {
  MARKET_CUT,
  MARKET_LISTING_DEPOSIT_COPPER,
  MARKET_MAX_LISTINGS,
} from '../../src/sim/market';
import { PARTY_MAX, RAID_MAX } from '../../src/sim/social/party';
import { TRADE_OFFER_MAX_LINES } from '../../src/sim/social/trade';
import { armorReduction, MAX_LEVEL, PARTY_XP_RANGE, xpForLevel } from '../../src/sim/types';

export function coreSystemRules(
  title: string,
  section: (heading: string, body: string) => string,
  table: (rows: string[][]) => string,
) {
  switch (title) {
    case 'Combat':
      return (
        section(
          'How armor changes a hit',
          'For an attack that checks armor, divide the target’s nonnegative armor by (armor + 85 × attacker level + 400). The result is the fraction of damage removed, capped at 75%. For example, 2,100 armor removes ' +
            Math.round(100 * armorReduction(2100, 20)) +
            '% from an ordinary level-20 physical hit. An ability can bypass armor if its damage path specifies that.',
        ) +
        section(
          'Lower-level enemies',
          'When a lower-level, unowned hostile enemy hits a player or an owned creature, the game blends armor mitigation toward a 20% ceiling. Each level of difference moves one third of the way to that ceiling, up to three levels. This only lowers mitigation that exceeds 20%.',
        )
      );
    case 'Parties':
      return (
        section(
          'Sharing kill experience',
          'A party holds ' +
            PARTY_MAX +
            ' players and a raid holds ' +
            RAID_MAX +
            '. In the overworld, eligible members within ' +
            PARTY_XP_RANGE +
            ' yd share kill rewards. Members inside the same claimed dungeon can qualify across the instance. Each player’s base kill XP depends on that player’s level. Apply the elite multiplier and the group multiplier, then divide by the number of eligible members.',
        ) +
        section(
          'Group multiplier',
          table(
            GROUP_XP_BONUS.map((n, i) => [
              i === GROUP_XP_BONUS.length - 1 ? i + 1 + ' or more eligible players' : String(i + 1),
              String(n) + ' ×',
            ]),
          ),
        )
      );
    case 'World Market':
      return section(
        'Selling for copper',
        'You can have ' +
          MARKET_MAX_LISTINGS +
          ' active listings. An asking price can range from 1 copper to 500 gold. The deposit is ' +
          MARKET_LISTING_DEPOSIT_COPPER +
          ' copper. Unsold listings expire after 48 hours. On a sale, the Merchant keeps ' +
          100 * MARKET_CUT +
          '% of the price, or ' +
          50 * MARKET_CUT +
          '% if the seller had the membership discount when listing. Proceeds round down to whole copper.',
      );
    case 'Trading':
      return section(
        'Offer limits',
        'Stand within 10 yd of your trading partner. Each side can offer copper and up to ' +
          TRADE_OFFER_MAX_LINES +
          ' item lines. Changing the offer requires both players to confirm again. Moving outside trade range cancels the exchange.',
      );
    case 'Guilds':
      return section(
        'Ranks',
        'The Guild Master can configure ' +
          GUILD_RANK_MIN +
          ' to ' +
          GUILD_RANK_MAX +
          ' ordered ranks, with names up to ' +
          GUILD_RANK_NAME_MAX +
          ' characters. The top rank is the Guild Master, with all permissions. New members enter at the bottom. The standard ladder gives Officers invites, removal of lower members, vault access, officer chat, billboard and calendar permissions.',
      );
    case 'Duels':
      return section(
        'Starting and ending a duel',
        'Challenge another player within 30 yd. The invitation expires after 30 seconds. Accepting starts a 3-second countdown. Defeating the other player leaves them at 1 health. Separating by more than 60 yd ends the duel without a winner.',
      );
    case 'Ashen Coliseum':
      return section(
        'Rating changes',
        'Expected win chance = 1 ÷ (1 + 10 raised to ((opponent rating − your rating) ÷ 400)). The base Elo change rounds 32 × (match score − expected win chance) to the nearest integer. At equal ratings a win gives a base change of +16.',
      );
    case 'Level experience':
      return section(
        'Experience by level',
        table(
          Array.from({ length: MAX_LEVEL - 1 }, (_, i) => [
            'Level ' + (i + 1) + ' to ' + (i + 2),
            xpForLevel(i + 1) + ' XP',
          ]),
        ),
      );
    default:
      return '';
  }
}
