import { GUIDE_PROF_CRAFTS } from '../../src/guide/content.generated';
import { FARM_COMPOST_ITEM_ID, FARM_WITHERED_HUSK_ITEM_ID } from '../../src/sim/content/farm_crops';
import { PROFESSION_TRAINERS } from '../../src/sim/content/profession_trainers';
import { STATIONS } from '../../src/sim/content/professions';
import { WEEKLY_QUEST_REWARD, WEEKLY_QUESTS } from '../../src/sim/content/weekly_quests';
import { ITEMS } from '../../src/sim/data';
import { type NpcRole, npcRoleFor, TRAINER_ROLES } from '../../src/sim/npc_role';
import { FARMER_TRADE_RANGE } from '../../src/sim/professions/farmer_npcs';
import { FARM_HUSKS_PER_COMPOST } from '../../src/sim/professions/farming';
import { TIER_SKILL_STEP, tierForSkill } from '../../src/sim/professions/wheel';
import { RIFT_FORGE_RANGE } from '../../src/sim/rift/forge_gate';
import type { NpcDef } from '../../src/sim/types';
import { buildTrainView } from '../../src/ui/hud/vendor/train_view';
import { t } from '../../src/ui/i18n';
import { type ArticleTools, ref } from './entity_format';
import { wikiProfessionName, wikiStationName } from './wiki_item_kind';

// The forge trainer's nameplate still says "Blacksmithing Trainer", but the game has no
// Blacksmithing profession: the forge teaches Armorcrafting and Weaponcrafting
// (STATION_TYPE_BY_CRAFT), which are the pages the wiki links. Name the trades it teaches.
const WIKI_LABELS: Partial<Record<NpcRole, string>> = {
  weaponsmithTrainer: 'Armorcrafting and Weaponcrafting Trainer',
};

export function npcServiceLabel(role: NpcRole): string {
  return WIKI_LABELS[role] ?? t(`hudChrome.nameplate.npcRole.${role}`);
}

/** One thing an NPC does for players: the Service row label and a plain sentence about it. */
export interface NpcService {
  label: string;
  text: string;
}

type Tools = ArticleTools;

// The system guides each service links to. Each is a fixed page title written by
// system_articles (the services pin test checks every one is a real page).
export const SERVICE_PAGES = {
  market: 'World Market',
  banker: 'Banking',
  riftForge: 'Rift Forge',
  cardMaster: 'The Card Master',
  heroic: 'Heroic difficulty',
  warfare: 'Honor and Warfare gear',
  weekly: 'Weekly quests',
  worldQuests: 'World quests',
  farming: 'Farming',
  mining: 'Mining',
  professions: 'Professions',
  stations: 'Crafting stations',
  riding: 'Mounts and riding',
  vendors: 'Vendors',
} as const;

const WEEKLY_GOALS: Record<(typeof WEEKLY_QUESTS)[number]['kind'], (n: number) => string> = {
  dungeons: (n) => 'clear ' + n + ' dungeons',
  raid: (n) => 'clear ' + n + ' raid',
  battlegrounds: (n) => 'play ' + n + ' battleground matches',
  worldboss: (n) => 'defeat ' + n + ' world boss',
};

function orList(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? '')
    : parts.slice(0, -1).join(', ') + ' or ' + parts[parts.length - 1];
}

function vendorText(role: NpcRole, w: Tools): string {
  const riding = role === 'stableMaster' ? ' See ' + w.link(SERVICE_PAGES.riding) + '.' : '';
  return (
    'Sells the items listed under Vendor stock below. ' +
    w.link(SERVICE_PAGES.vendors) +
    ' lists every vendor in the world.' +
    riding
  );
}

/** What a station master teaches: talk to them at their station and pick Training. */
function trainerText(npcId: string, w: Tools): string {
  const station = STATIONS.find((s) => s.masterNpcId === npcId);
  if (!station) return '';
  return (
    'Teaches crafting recipes at the ' +
    wikiStationName(station.type).toLowerCase() +
    '. Stand at the ' +
    w.link(SERVICE_PAGES.stations, 'station') +
    ', talk to them and choose Training. The Training section below lists every recipe they teach.'
  );
}

/** Every service an NPC offers, from its NpcDef flags and the trainer tables, in a fixed order. */
export function npcServices(n: NpcDef, w: Tools): NpcService[] {
  const out: NpcService[] = [];
  const role = npcRoleFor(n);
  const page = (key: keyof typeof SERVICE_PAGES, label?: string) =>
    w.link(SERVICE_PAGES[key], label);
  if (role) {
    const label = npcServiceLabel(role);
    switch (role) {
      case 'auctioneer':
        out.push({
          label,
          text:
            'Opens the ' +
            page('market') +
            ', where players buy and sell items with each other. Every market keeper opens the same market.',
        });
        break;
      case 'banker':
        out.push({
          label,
          text:
            'Opens your bank, where you store items you are not carrying. Your bank is the same at every banker. See ' +
            page('banker') +
            '.',
        });
        break;
      case 'riftForgemaster':
        out.push({
          label,
          text:
            'Opens the ' +
            page('riftForge') +
            '. There you upgrade a Riftbound band and put gems in its sockets. Stand within ' +
            RIFT_FORGE_RANGE +
            ' yards of them to use it.',
        });
        break;
      case 'cardMaster':
        out.push({
          label,
          text:
            'Lets you join the queue for a Card Duel, a card game against another player. See ' +
            page('cardMaster') +
            '.',
        });
        break;
      case 'heroicQuartermaster':
        out.push({
          label,
          text:
            'Sells gear for Heroic Marks instead of coin. The stock below shows how many marks each piece costs. See ' +
            page('heroic') +
            '.',
        });
        break;
      case 'crucibleQuartermaster':
        out.push({
          label,
          text: 'Trades raid sigils for set pieces. One sigil buys one set piece for the same slot, made for your class. The stock below lists which sigil each piece needs.',
        });
        break;
      case 'pvpVendor':
        out.push({
          label,
          text: 'Sells Warfare gear for Honor. See ' + page('warfare') + '.',
        });
        break;
      case 'innkeeper':
        out.push({
          label,
          text:
            'Sells food and drink, listed under Vendor stock below. ' +
            w.link(SERVICE_PAGES.vendors) +
            ' lists every vendor in the world.',
        });
        break;
      default:
        if (TRAINER_ROLES.has(role)) out.push({ label, text: trainerText(n.id, w) });
        else out.push({ label, text: vendorText(role, w) });
    }
  }
  if (n.weeklyEmissary) {
    const reward = WEEKLY_QUEST_REWARD;
    out.push({
      label: 'Weekly quests',
      text:
        'Opens the weekly quest window. Pick one charge each week: ' +
        orList(WEEKLY_QUESTS.map((q) => WEEKLY_GOALS[q.kind](q.count))) +
        '. Finish it for ' +
        w.money(reward.copper.base) +
        ' plus ' +
        w.money(reward.copper.perLevel) +
        ' for each of your levels, ' +
        reward.cacheCount +
        ' ' +
        ref(w, 'item', reward.cacheItemId) +
        ' and ' +
        reward.commendationStanding.toLocaleString('en-US') +
        ' standing with one faction you choose. A new week of charges starts every Tuesday. See ' +
        page('weekly') +
        '.',
    });
  }
  if (n.worldQuestBoard)
    out.push({
      label: 'World quests',
      text:
        'Shows the world quest board: the world quests that are active today. You can swap one of them for a different quest once each day. See ' +
        page('worldQuests') +
        '.',
    });
  if (n.farmer)
    out.push({
      label: 'Farmer',
      text:
        'Trades ' +
        FARM_HUSKS_PER_COMPOST +
        ' ' +
        ref(w, 'item', FARM_WITHERED_HUSK_ITEM_ID) +
        ' for 1 ' +
        ref(w, 'item', FARM_COMPOST_ITEM_ID) +
        '. Stand within ' +
        FARMER_TRADE_RANGE +
        ' yards of them to make the trade. See ' +
        page('farming') +
        '.',
    });
  const trade = (PROFESSION_TRAINERS as Record<string, string>)[n.id];
  // Station masters already say what they teach through their role; the others get a row here.
  if (trade && !(role && TRAINER_ROLES.has(role))) {
    const label = t(
      `hudChrome.professionTrainers.${trade as (typeof PROFESSION_TRAINERS)[keyof typeof PROFESSION_TRAINERS]}`,
    );
    const text =
      trade === 'farming'
        ? 'Helps you get started with ' + page('farming') + '.'
        : trade === 'mining'
          ? 'Helps you get started with ' + page('mining') + '.'
          : 'Helps you pick a hobby craft. See ' + page('professions') + '.';
    out.push({ label, text });
  }
  return out;
}

const recipeNames = new Map(
  GUIDE_PROF_CRAFTS.flatMap((c) => c.recipes.map((r) => [r.id, r.name] as const)),
);

/**
 * The recipes a station master teaches, grouped by craft. It is the in-game Training
 * window's own list (buildTrainView) for a new character, so the wiki and the window
 * always name the same recipes, skill steps and fees.
 */
export function npcTrainingSection(npcId: string, w: Tools): string {
  const view = buildTrainView(npcId, {
    stations: STATIONS,
    knownRecipes: [],
    craftSkills: {},
    copper: 0,
    items: ITEMS,
  });
  if (!view.stationType || !view.rows.length) return '';
  const recipeTitles = (w.titleBy as { recipe?: Map<string, string> }).recipe;
  const byCraft = new Map<string, string[]>();
  for (const row of view.rows) {
    const name = recipeNames.get(row.recipeId) ?? ITEMS[row.resultItemId]?.name ?? row.recipeId;
    const title = recipeTitles?.get(row.recipeId);
    const lines = byCraft.get(row.professionId) ?? [];
    lines.push(
      (title ? w.link(title, name) : name) +
        ' · Learn at skill ' +
        tierForSkill(row.skillReq) * TIER_SKILL_STEP +
        ' · ' +
        (row.feeCopper ? 'Fee ' + w.money(row.feeCopper) : 'Free'),
    );
    byCraft.set(row.professionId, lines);
  }
  return w.section(
    'Training',
    'Talk to them at the ' +
      wikiStationName(view.stationType).toLowerCase() +
      ' and choose Training. You can learn a recipe once your skill in its craft reaches the number shown. You pay the fee once.\n\n' +
      [...byCraft]
        .map(
          ([craft, lines]) =>
            "'''" + w.link(wikiProfessionName(craft)) + "'''\n" + w.bullets(lines),
        )
        .join('\n\n'),
  );
}
