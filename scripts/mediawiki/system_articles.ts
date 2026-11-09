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
        'Click a Ravenpost mailbox and open the Send tab. In To, enter the name of the character you are writing to.',
        `Enter your message. To send goods, click an item in your bags and set its quantity under Parcels. A letter holds up to ${MAIL_MAX_ATTACHMENTS} item stacks. Use Attach coin to send money as well.`,
        `Choose Send letter. You pay ${MAIL_POSTAGE} copper in postage plus any coin you attached. The items leave your bags when you send. Delivery takes ${MAIL_DELIVERY_SECONDS} seconds.`,
      ]),
    ),
    heading(
      'Collect a parcel',
      `At any Ravenpost mailbox, open Inbox, choose the letter, then select Take attachments. A player letter with goods or at least ${MAIL_ESCROW_COPPER_MIN} copper attached returns to its sender if left unclaimed for ${MAIL_ATTACHMENT_EXPIRY_SECONDS / 86400} days.`,
    ),
    'Purchased membership tokens and annual membership mount reins can be collected directly from their delivery window, wherever you are. If your bags are full, the purchased reward goes into inventory overflow.',
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
    'Honor is a currency earned in eligible PvP activities. Your character sheet tracks it separately from gold. Both quartermasters sell the same stock. Check the price on the offer: Season 1 entry gear costs gold, while other goods, including the two Warfare trinkets, cost Honor.',
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
    'The headless environment runs the same deterministic simulation used by the game. It lets an external agent step through a world, observe it and choose actions.',
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
    'Roles are determined by class. You can select any role your class supports, regardless of which talents you have chosen. Every queued member must meet the activity level range.',
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
    '[[Mount racing]] is retired from live play. See its historical rules for the solo jumping course used in [[Riding Lessons]].',
  );
  w.describe(
    'Professions',
    'Every character can gather and try the ten crafts. For example, a new engineer can learn Bronze Hoe from Tinker Gizzel at skill 0. Your crafting archetype sets which recipe tiers can raise your skill. You keep the skills and recipes you already earned when you change archetype.',
    'Each craft has its own skill bar and reaches 125. You can keep making items at the cap. Open [[Crafting recipes]] to compare recipes by profession.',
    trades.archetypeChooseBody,
    trades.archetypeSwitchBody,
    'Eastbrook has the forge, kitchens, loom and toolworks. Fenbridge has the tannery and Highwatch has the apothecary. Use [[Crafting stations]] for their coordinates. The recipe determines whether you need a bench. You can apply equipment enchants in the field, while Enchanting recipes for gathering-tool charms use the toolworks.',
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
    'The first 20 Stamina give 1 maximum health apiece. Every additional point gives 10. Intellect follows the same breakpoint for mana users: 1 maximum mana per point through 20, then 15 per point. Both contributions are added to class and level base values before multipliers.',
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
      '. Each prestige rank requires another ' +
      PRESTIGE_XP_PER_RANK +
      ' lifetime XP beyond the cap.',
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
    'At level 15 the standing cap is ' +
      maxStandingForLevel(15) +
      '. From level 16 the cap is ' +
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
              ? `${item}: ${row.currencyCost} ${factionCurrencyName(f.id)}. Requires ${row.requiredStanding} standing ${row.factionId ? 'with this faction' : 'with any allied faction'}.`
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
  w.describe('Level experience', 'Experience needed to reach the next character level.');
  return w.finish();
}
