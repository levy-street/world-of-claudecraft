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
          'Armor lowers the damage from attacks that check it, such as normal physical hits. To work out how much, divide the target’s armor by (armor + 85 × attacker level + 400). Armor below zero counts as zero. The answer is the share of damage removed, and it can never be more than 75%. For example, 2,100 armor removes ' +
            Math.round(100 * armorReduction(2100, 20)) +
            '% of a normal physical hit from a level 20 attacker. Some abilities ignore armor, and their own pages say so.',
        ) +
        section(
          'Lower-level enemies',
          'Sometimes a wild enemy of a lower level hits a player, or hits a pet or other creature a player owns. Then armor cannot block as much as usual. It is pulled toward a limit of 20% damage removed. Each level the enemy is below you moves it one third of the way to that limit. At three or more levels below, the limit is a full 20%. This only matters when your armor would remove more than 20%.',
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
            '. In the open world, party members who qualify and stand within ' +
            PARTY_XP_RANGE +
            ' yards share kill rewards. Inside a dungeon your party has claimed, members can qualify from anywhere in it. Each player’s kill XP works like this:\n# Start with the base XP for the kill. It depends on that player’s own level.\n# Multiply by the elite bonus. An elite enemy gives double.\n# Multiply by the group bonus from the table below.\n# Divide by the number of members who qualify.',
        ) +
        section(
          'Group multiplier',
          table(
            GROUP_XP_BONUS.map((n, i) => [
              i === GROUP_XP_BONUS.length - 1
                ? i + 1 + ' or more players who qualify'
                : String(i + 1),
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
          ' listings (items up for sale) at once. You can ask from 1 copper up to 500 gold. Listing an item costs a deposit of ' +
          MARKET_LISTING_DEPOSIT_COPPER +
          ' copper. An item that does not sell is taken off the market after 48 hours. When an item sells, the Merchant keeps ' +
          100 * MARKET_CUT +
          '% of the price, or ' +
          50 * MARKET_CUT +
          '% if you had the membership discount when you listed it. What you get is rounded down to a whole copper.',
      );
    case 'Trading':
      return section(
        'Offer limits',
        'Stand within 10 yards of the player you are trading with. Each of you can offer copper and up to ' +
          TRADE_OFFER_MAX_LINES +
          ' item lines. If either offer changes, both players must confirm again. If you move out of range, the trade is canceled.',
      );
    case 'Guilds':
      return section(
        'Ranks',
        'The Guild Master can set up ' +
          GUILD_RANK_MIN +
          ' to ' +
          GUILD_RANK_MAX +
          ' ranks in order. Each rank name can be up to ' +
          GUILD_RANK_NAME_MAX +
          ' characters long. The top rank is the Guild Master, who can do everything. New members start at the bottom rank. In the standard ranks, Officers can invite players, remove members of lower rank, use the vault and officer chat, and change the billboard and calendar.',
      );
    case 'Duels':
      return section(
        'Starting and ending a duel',
        'Challenge another player who is within 30 yards. The challenge runs out after 30 seconds. When they accept, a 3 second countdown starts. When you beat the other player, they are left at 1 health instead of dying. If you move more than 60 yards apart, the duel ends with no winner.',
      );
    case 'Ashen Coliseum':
      return section(
        'Rating changes',
        'Your rating goes up when you win and down when you lose. Beating a higher-rated opponent gains more. It works in two steps:\n# Expected win chance = 1 ÷ (1 + 10 raised to ((opponent rating − your rating) ÷ 400)).\n# Base Elo change = 32 × (match score − expected win chance), rounded to the nearest whole number. A win has a match score of 1.\nIf both ratings are the same, a win gives a base change of +16.',
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
