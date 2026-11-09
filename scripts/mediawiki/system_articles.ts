import { FINDER_CLASS_ROLES } from '../../src/sim/content/dungeon_finder';
import { FACTION_VENDOR_GATES, FACTION_VENDOR_STOCK } from '../../src/sim/content/faction_vendors';
import { MAILBOXES } from '../../src/sim/content/mailboxes';
import { ITEMS, ZONES, zoneContaining } from '../../src/sim/data';
import {
  FACTION_TIER_TITLES,
  FACTIONS,
  factionCurrencyName,
  maxStandingForLevel,
  STANDING_THRESHOLDS,
  STANDING_TIERS,
} from '../../src/sim/factions';
import {
  MAIL_ATTACHMENT_EXPIRY_SECONDS,
  MAIL_DELIVERY_SECONDS,
  MAIL_ESCROW_COPPER_MIN,
  MAIL_MAX_ATTACHMENTS,
  MAIL_POSTAGE,
} from '../../src/sim/mail/post_office';
import { MAX_LEVEL, PRESTIGE_XP_PER_RANK, xpForLevel } from '../../src/sim/types';
import { guideStrings as guide } from '../../src/ui/i18n.catalog/guide';
import { addActivityRules } from './system_activities';
import { addExpeditionCollections } from './system_collections';
import { directoryTopics } from './system_directory';
import { addPetAndTravelRules } from './system_pets_travel';
import { addRecoveryAndFinder } from './system_recovery';
import { addRiftAndHoardRules } from './system_rifts';
import { addTradeSkills } from './system_trades';
import { heading, list, type SystemWikiContext, systemWriter } from './system_writer';
import { talentLoadoutGuide } from './talent_loadout_guide';

export function addSystemArticles(ctx: SystemWikiContext): string[] {
  const w = systemWriter(ctx);
  const {
    combat,
    social,
    economy,
    arenaPage: arena,
    thornhollowPage: bg,
    worldPvpPage: pvp,
    dungeonsPage: dungeons,
    professions: trades,
    gear,
    stats,
    questsPage: quests,
    delvesPage: delves,
    riftsPage: rifts,
    deedsPage: deeds,
    reliquaryPage: museum,
    progression: levels,
    mountsPage: mounts,
  } = guide;
  w.describe(
    'Combat',
    combat.hitBody,
    combat.mitigationBody,
    combat.resourcesBody,
    combat.queueBody,
    combat.ccBody,
    combat.threatBody,
  );
  w.describe('Death and recovery', combat.deathBody, combat.allyRezBody, combat.unstuckBodyWindow);
  w.describe('Swimming and climbing', combat.breathBody, combat.fatigueBody, combat.climbBody);
  w.describe(
    'Parties',
    social.partyBody,
    social.partyCredit,
    social.raidBody,
    social.readyBody,
    social.markersBody,
  );
  w.describe(
    'Party loot',
    social.lootCoinBody,
    social.lootCommonBody,
    social.lootRollBodyNeedBeatsGreed,
    social.lootMasterBody,
  );
  w.describe(
    'Guilds',
    social.guildBody,
    social.guildBoardBody,
    social.guildChatBody,
    social.guildBankBody,
    social.guildBankRulesBody,
  );
  w.describe('Trading', economy.tradeBody);
  w.describe('World Market', economy.marketBody);
  w.describe('Banking', economy.bankBody);
  w.describe(
    'Mail',
    economy.mailBody,
    heading(
      'Send a letter',
      list([
        'Click a Ravenpost mailbox and open the Send tab. In the To box, type the name of the character you are writing to.',
        `Enter your message. To send items, click an item in your bags and set how many under Parcels. A letter can carry up to ${MAIL_MAX_ATTACHMENTS} stacks of items. Use Attach coin to send money too.`,
        `Choose Send letter. You pay ${MAIL_POSTAGE} copper for postage, plus any coin you attached. The items leave your bags as soon as you send. The letter arrives after ${MAIL_DELIVERY_SECONDS} seconds.`,
      ]),
    ),
    heading(
      'Collect a parcel',
      `At any Ravenpost mailbox, open Inbox, pick the letter, then choose Take attachments. Some letters from players go back to the sender if nobody collects them. This happens to a letter with items, or with at least ${MAIL_ESCROW_COPPER_MIN} copper, that sits unclaimed for ${MAIL_ATTACHMENT_EXPIRY_SECONDS / 86400} days.`,
    ),
    'Membership tokens you buy, and the mount reins from a yearly membership, come in their own delivery window. You can collect them there, wherever you are. If your bags are full, the reward goes into your inventory overflow instead.',
    heading(
      'Where to find a mailbox',
      list(
        MAILBOXES.map(({ x, z }) => {
          const zone = zoneContaining(x, z);
          return `${zone ? zone.hub.name + ', ' + w.entity('zone', zone.id) + ': ' : ''}x ${x}, z ${z}.`;
        }),
      ),
    ),
  );
  w.describe(
    'Vendors and currencies',
    economy.coinBody,
    economy.vendorsBody,
    economy.buyingBody,
    economy.marksBody,
    economy.honorBody,
  );
  w.describe(
    'Friends and chat',
    social.friendsBody,
    social.chatBody,
    social.emotesBodyNamedTarget,
    social.ignoreBody,
    social.blockBody,
  );
  w.describe('Calendar', social.calendarBodyDoubleHonor);
  w.describe('Duels', arena.duelsBody);
  w.describe('Ashen Coliseum', arena.coliseumBody, arena.ladderBody, arena.rewardsBodyLossShare);
  w.describe(
    'Honor and Warfare gear',
    'Honor is a currency you earn from PvP activities that give it. Your character sheet counts it apart from your gold. Both quartermasters sell the same things. Check the price on each item: Season 1 starter gear costs gold, but everything else costs Honor, including the two Warfare trinkets.',
    arena.warfareBodyStatsStay,
    arena.warfareTradeBodyRatingSpent,
  );
  w.describe('Vanguard equipment', arena.vanguardBody, arena.vanguardStatsBody);
  w.describe(
    'Thornhollow battleground',
    bg.queueBody,
    bg.fieldBody,
    bg.flagsBody,
    bg.carrierBody,
    bg.respawnBody,
    bg.leavingBody,
    bg.rewardsBody,
  );
  w.describe(
    'World PvP',
    pvp.flagBodyAid,
    pvp.stakesBodyFlagged,
    pvp.zonesBody,
    pvp.limitsBodyRaids,
  );
  w.describe('King of the Hill', pvp.hillBodyTwoHour);
  w.describe('Mobile Play', guide.controls.mobileBody, guide.controls.controllerBody);
  w.describe(
    'Agents and Bots',
    'The headless environment is a copy of the game with no graphics. It runs the exact same game rules. With the same starting seed and the same actions, it always plays out the same way. A computer program (an agent) can use it to move through the world one step at a time, see what is around it and choose what to do.',
  );
  w.describe(
    'Equipment and inventory',
    gear.slotsBody,
    gear.bagsBody,
    gear.qualityBody,
    gear.itemLevelBody,
    gear.requiredLevelBody,
    gear.soulboundBodyBound,
    gear.bindOnTradeBody,
    gear.uniqueBody,
  );
  w.describe(
    'Dungeon Finder',
    'Your class decides which roles you can pick. You can choose any role your class allows, no matter which talents you have. Everyone in the queue must be inside the level range for the activity.',
    heading(
      'Who can queue for each role',
      list(
        Object.entries(FINDER_CLASS_ROLES).map(
          ([role, classes]) =>
            (role === 'dps' ? 'Damage' : role === 'tank' ? 'Tank' : 'Healer') +
            ': ' +
            classes
              .map((id) => {
                const title = id[0].toUpperCase() + id.slice(1);
                return `[[${title}]]`;
              })
              .join(', '),
        ),
      ),
    ),
  );
  w.describe(
    'Heroic difficulty',
    dungeons.heroicHowBody,
    dungeons.heroicRewardsBody,
    dungeons.heroicLockoutBody,
    dungeons.resetBody,
  );
  w.describe(
    'Rifts',
    rifts.whatBody,
    rifts.openBody,
    rifts.ranksBody,
    rifts.groupBody,
    rifts.floorsBody,
    rifts.boundBody,
    rifts.rewardsBody,
    rifts.forgeBody,
  );
  w.describe(
    'Delves',
    delves.howBody,
    delves.tiersBody,
    delves.affixesBody,
    delves.companionBody,
    delves.lockpickAnteBody,
    delves.riteBody,
    delves.marksBody,
  );
  w.describe(
    'Questing',
    quests.acceptBody,
    quests.objectivesBody,
    quests.turninBody,
    quests.partyBody,
    quests.typeEscortBody,
  );
  w.describe('Clue hunts', quests.cluesHuntBody, quests.cluesCasketBody);
  w.describe('The Card Master', quests.cardMasterBody);
  w.describe(
    'Book of Deeds',
    deeds.howBody,
    deeds.renownBody,
    deeds.rewardsBody,
    deeds.chroniclesBody,
    deeds.featsBody,
  );
  w.describe('The Reliquary', museum.howBody, museum.ranksBody);
  w.describe(
    'Mounts and riding',
    mounts.whatBody,
    mounts.whereBody,
    mounts.rideBody,
    mounts.breaksBody,
    '[[Mount racing]] is no longer part of the live game. Its page keeps the old rules, including the solo jumping course used in [[Riding Lessons]].',
  );
  w.describe(
    'Professions',
    'Every character can gather and try all ten crafts. For example, a new engineer can learn Bronze Hoe from Tinker Gizzel at skill 0. Your crafting archetype decides which levels of recipes can still raise your skill. If you change archetype, you keep the skills and recipes you already earned.',
    'Each craft has its own skill bar, which goes up to 125. You can keep making items after you reach 125. Open [[Crafting recipes]] to compare recipes for each profession.',
    trades.archetypeChooseBody,
    trades.archetypeSwitchBody,
    'Eastbrook has the forge, kitchens, loom and toolworks. Fenbridge has the tannery. Highwatch has the apothecary. See [[Crafting stations]] for where they are. Each recipe says whether you need a work station. You can put equipment enchants on anywhere. But Enchanting recipes for gathering-tool charms need the toolworks.',
    trades.provenanceBody,
    heading(
      'Crafting professions',
      list(
        directoryTopics('Crafting professions', [
          'Professions',
          'Crafting recipes',
          'Crafting stations',
          'Profession work orders',
          'Masterwork crafting',
        ]).map((t) => '[[' + t + ']]'),
      ),
    ),
    heading(
      'Gathering professions',
      list(
        directoryTopics('Gathering and farming', ['Harvesting and gathering', 'Farm crops']).map(
          (t) => '[[' + t + ']]',
        ),
      ),
    ),
  );
  w.describe(
    'Harvesting and gathering',
    trades.harvestBodyFamilies,
    trades.focusBodyTiers,
    trades.toolEffectsBody,
  );
  w.describe(
    'Perfecting and promotion',
    trades.crucibleCollectionsBody,
    trades.perfectingBody,
    trades.promotionBody,
  );
  w.describe(
    'Character stats',
    stats.primaryBody,
    stats.strBody,
    stats.agiBody,
    stats.intBody,
    stats.spiBody,
    'Each of your first 20 points of Stamina gives 1 maximum health. Every point after that gives 10. Intellect works the same way for classes that use mana: each of the first 20 points gives 1 maximum mana, and every point after that gives 15. These amounts are added to the base health and mana from your class and level. Any percent bonuses are applied after that.',
    stats.apBody,
    stats.spBody,
    stats.critBody,
    stats.dodgeBody,
    stats.hitBody,
    stats.parryBody,
    stats.hasteBody,
    stats.warfareBodyPets,
  );
  w.describe(
    'Leveling and prestige',
    levels.xpBody,
    levels.restedBody,
    levels.prestigeBody,
    'The playable level cap is ' +
      MAX_LEVEL +
      '. After that, each prestige rank needs another ' +
      PRESTIGE_XP_PER_RANK +
      ' XP, counted from when you reach the cap.',
    heading(
      'XP to the next level',
      list(
        Array.from(
          { length: MAX_LEVEL - 1 },
          (_, i) => `Level ${i + 1} to ${i + 2}: ${xpForLevel(i + 1)} XP.`,
        ),
      ),
    ),
  );
  w.describe(
    'Specialization and talents',
    guide.talentsPage.whatBody,
    'See [[Specializations]] and [[Talent choices]] for each class.',
    talentLoadoutGuide(),
  );
  w.describe(
    'Faction standing',
    guide.factionsPage.earningBody,
    guide.factionsPage.weeklyBody,
    guide.factionsPage.quartermastersBody,
    'At level 15, the most standing you can have is ' +
      maxStandingForLevel(15) +
      '. From level 16, the most is ' +
      maxStandingForLevel(16) +
      '.',
  );
  for (const f of Object.values(FACTIONS)) {
    w.article(
      'Faction standing',
      f.name,
      'Faction',
      `Hub: ${f.hub.name} in ${w.entity('zone', f.hub.zoneId)}.`,
      heading(
        'Quartermaster stock',
        list(
          FACTION_VENDOR_STOCK[f.id].map((id) => {
            const row = FACTION_VENDOR_GATES[id];
            const item = w.entity('item', id, ITEMS[id]?.name);
            return row
              ? `${item}: ${row.currencyCost} ${factionCurrencyName(f.id)}. Needs ${row.requiredStanding} standing ${row.factionId ? 'with this faction' : 'with any allied faction'}.`
              : item;
          }),
        ),
      ),
      heading(
        'Territory',
        list(ZONES.filter((z) => f.zones.includes(z.id)).map((z) => w.entity('zone', z.id))),
      ),
      heading(
        'Standing ranks',
        list(
          STANDING_TIERS.map(
            (t) => `${STANDING_THRESHOLDS[t]} standing: ${FACTION_TIER_TITLES[f.id][t]}.`,
          ),
        ),
      ),
    );
  }
  addRecoveryAndFinder(w);
  addPetAndTravelRules(w);
  addRiftAndHoardRules(w);
  addActivityRules(w);
  addTradeSkills(w);
  addExpeditionCollections(w);
  w.describe('Level experience', 'How much experience (XP) you need to reach each next level.');
  return w.finish();
}
