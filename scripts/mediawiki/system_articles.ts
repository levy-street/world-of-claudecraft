import { FACTION_VENDOR_GATES, FACTION_VENDOR_STOCK } from '../../src/sim/content/faction_vendors';
import { ITEMS, ZONES } from '../../src/sim/data';
import {
  FACTION_TIER_TITLES,
  FACTIONS,
  factionCurrencyName,
  maxStandingForLevel,
  STANDING_THRESHOLDS,
  STANDING_TIERS,
} from '../../src/sim/factions';
import { MAX_LEVEL, PRESTIGE_XP_PER_RANK, xpForLevel } from '../../src/sim/types';
import { guideStrings as guide } from '../../src/ui/i18n.catalog/guide';
import { addActivityRules } from './system_activities';
import { addExpeditionCollections } from './system_collections';
import { addPetAndTravelRules } from './system_pets_travel';
import { addRecoveryAndFinder } from './system_recovery';
import { addRiftAndHoardRules } from './system_rifts';
import { addTradeSkills } from './system_trades';
import { heading, list, type SystemWikiContext, systemWriter } from './system_writer';

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
  w.describe('Mail', economy.mailBody);
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
    arena.honorBody,
    arena.quartermastersBody,
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
  w.describe('Dungeon Finder', dungeons.finderRolesBody);
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
  w.describe('Clue hunts', quests.cluesEarnBody, quests.cluesHuntBody, quests.cluesCasketBody);
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
    mounts.raceBody,
  );
  w.describe(
    'Professions',
    trades.whatBody,
    trades.ringBody,
    trades.archetypeChooseBody,
    trades.archetypeSwitchBody,
    trades.stationsBody,
    trades.provenanceBody,
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
