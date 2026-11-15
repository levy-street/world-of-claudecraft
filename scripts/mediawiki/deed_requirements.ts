import { DEEDS } from '../../src/sim/content/deeds';
import { FARM_CROPS } from '../../src/sim/content/farm_crops';
import { TRANSPORT_ROUTES } from '../../src/sim/content/transport_ships';
import {
  BUILTIN_WORLD,
  DELVE_LIST,
  DUNGEONS,
  gatherNodesInActiveWorld,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
} from '../../src/sim/data';
import { POI_VISIT_RADIUS, ZONE_FISH } from '../../src/sim/deeds';
import { LAUNCH_PAPERDOLL_SLOTS } from '../../src/sim/launch_paperdoll_slots';
import {
  type DeedDef,
  type DeedFlagId,
  type DeedMeterId,
  type DeedStatKey,
  MAX_LEVEL,
} from '../../src/sim/types';
import { list, type SystemWriter, words } from './system_writer';

const fmt = (n: number) => n.toLocaleString('en-US');
const coord = (p: { x: number; z: number }) => '(' + p.x + ', ' + p.z + ')';
const stats: Record<DeedStatKey, string> = {
  kills: 'kills',
  deaths: 'deaths',
  damageDealt: 'damage dealt',
  crits: 'critical hits',
  dummyDamage: 'damage dealt to training dummies',
  lootCopper: 'copper looted',
  duelsWon: 'duels won',
  duelsLost: 'duels lost',
  cardDuelsWon: 'card duels won',
  tradesCompleted: 'completed player trades',
  mailAttachmentsSent: 'mail attachments sent',
  craftsPerformed: 'completed crafts',
  partiesJoined: 'parties joined',
  fullPartyDungeonClears: 'dungeons cleared in a full party',
  guildsFounded: 'guilds founded',
  marketSaleCopper: 'copper earned from market sales',
  groundObjectsLooted: 'ground objects looted',
  dungeonFinalBossKills: 'dungeon final bosses defeated',
  thunzharrKills: 'Thunzharr kills',
  balgathKills: 'Balgath kills',
  bloatCleanKills: 'Bog Bloat kills without being caught in Caustic Spores',
  hubCraftsPerformed: 'crafts that need a crafting station, made at one',
  attunementsCompleted: 'profession attunements completed',
  masterworksCrafted: 'masterworks crafted',
  salvagesPerformed: 'items salvaged',
  riftClears: 'Rifts cleared',
  riftSRankClears: 'S-rank Rifts cleared',
  tutorialGraduations: 'graduation rides home after completing the Proving Shore quests',
  legendariesForged: 'legendary promotions completed',
  hoardGoblinKills: 'Coinsack Scurrier kills that gave a reward',
  thatchgrinKills: 'Old Thatchgrin kills',
};
const meters: Record<DeedMeterId, string> = {
  prestigeRank: 'Prestige rank',
  talentPoints: 'Talent points spent',
  arenaRankedMatches: 'Ranked arena matches finished across 1v1 and 2v2',
  arenaRankedWins: 'Ranked arena wins across 1v1 and 2v2',
  bgWins: 'Battleground wins',
  bgCaptures: 'Battleground captures',
  vcupWins: 'Vale Cup wins',
  vcupGuildWins: 'Vale Cup guild wins',
  bankPurchasedSlots: 'Bank slots purchased',
  bankSocketsUnlocked: 'Bank sockets unlocked',
  townFocusPoints: 'Total Town Focus points allocated',
  delveLoreCount: 'Different Delve lore entries unlocked',
  companionRankBest: 'Highest rank of a single Delve companion',
  itemsDiscoveredCount: 'Different items discovered',
  poorItemsDiscoveredCount: 'Different poor-quality items discovered',
  lifetimeHonor: 'Lifetime Honor earned',
  standingRiftWatch: 'Rift Watch standing',
  standingChurchOrder: 'Church Order standing',
  standingAutomatons: 'Automatons standing',
  clueCasketsOpened: 'Treasure Caskets opened',
};
const flags: Record<DeedFlagId, string> = {
  talentSpecChosen: 'Choose a specialization.',
  talentCapstone: 'Choose a level 20 talent.',
  hasRestedXp: 'Have some rested experience (any amount above 0).',
  guildMember: 'Join a guild on the online realm.',
  nonDefaultSkin: 'Equip a mech skin or a non-default character skin.',
  allEquipSlotsFilled:
    'Wear an item in every one of these slots at the same time: ' +
    LAUNCH_PAPERDOLL_SLOTS.map((s) =>
      s === 'ring1'
        ? 'first ring'
        : s === 'ring2'
          ? 'second ring'
          : s === 'mainhand'
            ? 'main hand'
            : s,
    ).join(', ') +
    '.',
  heroicMarkCircuit:
    'Earn the daily Heroic Mark from Hollow Crypt, Sunken Bastion, Drowned Temple and Gravewyrm Sanctum, all in the same reward window.',
  companionsBothMax: 'Upgrade both Tessa and Edda to rank 3.',
  firstEraCap: 'Reach level ' + MAX_LEVEL + ' during the First Era.',
};
function visitInstruction(w: SystemWriter, mark: string): string {
  const [action, id, detail] = mark.split(':');
  const zone = BUILTIN_WORLD.zones.find((z) => z.id === id);
  const place = zone ? w.entity('zone', id, zone.name) : words(id);
  switch (action) {
    case 'poi': {
      const poi = zone?.pois.find((p) => p.id === detail);
      if (!poi) throw Error('Unknown deed landmark ' + mark);
      return (
        'Go within ' +
        POI_VISIT_RADIUS +
        ' yd of ' +
        poi.label +
        ' at ' +
        coord(poi) +
        ' in ' +
        place +
        '.' +
        (poi.hideOnMap ? ' This landmark has no map label.' : '')
      );
    }
    case 'fish':
      return (
        'Catch one fish in ' +
        place +
        '. Any of these counts: ' +
        ZONE_FISH[id].map((f) => w.entity('item', f, ITEMS[f].name)).join(', ') +
        '. Weeds, boots and empty hooks do not count.'
      );
    case 'gather': {
      const node = gatherNodesInActiveWorld()
        .filter((n) => n.zoneId === id && n.type === detail)
        .sort((a, b) => a.tier - b.tier)[0];
      const label = detail === 'ore' ? 'ore vein' : detail === 'wood' ? 'wood stand' : 'herb patch';
      return (
        'Harvest one ' +
        label +
        ' in ' +
        place +
        '.' +
        (node ? ' One that counts is at ' + coord(node.pos) + '.' : '')
      );
    }
    case 'slain':
      return 'Get kill credit for ' + w.entity('mob', id, MOBS[id].name) + '.';
    case 'dungeon':
      return 'Enter ' + w.entity('dungeon', id, DUNGEONS[id].name) + '.';
    case 'quality':
      return 'Get an item of ' + id + ' quality.';
    case 'craft_rare':
      return 'Use ' + words(id) + ' to craft an item of rare quality or better.';
    case 'npc':
      return (
        (NPCS[id].banker ? 'Open the bank or complete a bank transaction with ' : 'Talk to ') +
        w.entity('npc', id, NPCS[id].name) +
        '.'
      );
    case 'fiesta':
      return 'Collect the ' + words(id.replace(/^pow_/, '')) + ' power-up in Fiesta.';
    case 'ferry': {
      for (const route of TRANSPORT_ROUTES)
        for (const from of route.berths)
          for (const to of route.berths) {
            if (from.id + '_' + to.id !== id) continue;
            const name = (poi: string) => {
              const [, z, p] = poi.split(':');
              return (
                BUILTIN_WORLD.zones.find((zone) => zone.id === z)?.pois.find((x) => x.id === p)
                  ?.label ?? words(p)
              );
            };
            return (
              'Ride the ferry from ' +
              name(from.poi) +
              ' to ' +
              name(to.poi) +
              ' and get off alive.'
            );
          }
      throw Error('Unknown deed ferry ' + mark);
    }
    case 'farm':
      return id === 'planted'
        ? 'Plant a crop in a farm bed.'
        : 'Harvest a crop in ' + place + ' before it dies.';
    case 'farm_crop': {
      const item = FARM_CROPS[id].produceItemId;
      return 'Harvest a ' + w.entity('item', item, ITEMS[item].name) + ' crop before it dies.';
    }
    case 'witness':
      return (
        'Go within 100 yd of ' +
        w.entity('mob', id, MOBS[id].name) +
        ' while the world boss is alive.'
      );
    case 'gather_event':
      return 'Start the ' + words(id) + ' gathering event.';
    case 'apex_feast':
      return 'Craft an apex feast.';
    case 'gourdlight': {
      if (id === 'knock')
        return 'Trick-or-treat at the door of ' + w.entity('npc', detail, NPCS[detail].name) + '.';
      if (id === 'errand') return 'Turn in ' + w.entity('quest', detail, QUESTS[detail].name) + '.';
      if (id === 'boo')
        return (
          'Use Boo! to frighten a townsperson in ' +
          w.entity('zone', detail, BUILTIN_WORLD.zones.find((z) => z.id === detail)!.name) +
          '.'
        );
      if (id === 'thatchgrin') return 'Get kill credit for Old Thatchgrin.';
      if (id === 'pumpkins') return 'Find every Haunted Pumpkin of the event edition.';
    }
  }
  throw Error('No encyclopedia instruction for deed mark ' + mark);
}

const checkedList = (lines: string[], need = lines.length) =>
  (need === lines.length
    ? 'Do all ' + need + ' of these.'
    : 'Do any ' + need + ' of these ' + lines.length + '.') +
  '\n' +
  list(lines);

export function deedLead(deed: DeedDef): string {
  const t = deed.trigger;
  if (t.kind === 'manual') return '';
  // The game text for Double Digits says level 10 unlocks talents, but talent rows
  // open from level 5 (ROW_LEVELS in src/sim/content/talent_rows.ts), so state only the goal.
  if (deed.id === 'prog_double_digits') return 'Reach level 10.';
  if (t.kind !== 'meta') return deed.desc;
  const quests = t.questIds?.length ?? 0;
  const deeds = t.deedIds.length;
  return (
    'Earn ' +
    deeds +
    ' other ' +
    (deeds === 1 ? 'deed' : 'deeds') +
    (quests ? ' and turn in ' + quests + ' ' + (quests === 1 ? 'quest' : 'quests') : '') +
    ' on the same character.'
  );
}

export function deedRequirements(w: SystemWriter, deed: DeedDef): string {
  const t = deed.trigger;
  const quest = (id: string) => w.entity('quest', id, QUESTS[id].name);
  switch (t.kind) {
    case 'manual':
      return deed.desc;
    case 'level':
      return 'Reach character level ' + t.level + '.';
    case 'lifetimeXp':
      return 'Earn a total of ' + fmt(t.amount) + ' lifetime experience.';
    case 'quest':
      return 'Turn in ' + quest(t.questId) + '.';
    case 'quests':
      return checkedList(t.questIds.map((id) => 'Turn in ' + quest(id) + '.'));
    case 'stat':
      return 'Reach a lifetime total of ' + fmt(t.count) + ' ' + stats[t.stat] + '.';
    case 'meter':
      return meters[t.meter] + ' must reach ' + fmt(t.amount) + '.';
    case 'flag':
      return flags[t.flag];
    case 'dungeonClears':
      return (
        'Clear ' +
        w.entity('dungeon', t.dungeonId, DUNGEONS[t.dungeonId].name) +
        ' ' +
        fmt(t.count) +
        (t.count === 1 ? ' time' : ' times') +
        '. ' +
        (t.difficulty
          ? 'It must be on ' + t.difficulty + ' difficulty.'
          : 'Normal and Heroic clears both count.')
      );
    case 'delveClears':
      return (
        'Complete ' +
        fmt(t.count) +
        ' ' +
        (t.delveId
          ? (DELVE_LIST.find((d) => d.id === t.delveId)?.name ?? words(t.delveId))
          : 'Delve') +
        (t.count === 1 ? ' clear.' : ' clears.') +
        ' ' +
        (t.tier ? 'It must be on tier ' + t.tier + '.' : 'Clears at any tier count.')
      );
    case 'arenaRating':
      return 'Reach a ' + t.bracket + ' arena rating of ' + fmt(t.rating) + '.';
    case 'craftSkill':
      return t.craftId
        ? 'Raise ' + words(t.craftId) + ' to skill ' + t.level + '.'
        : 'Raise ' + (t.count ?? 1) + ' different crafting profession(s) to skill ' + t.level + '.';
    case 'gathering':
      return t.professionId
        ? 'Reach ' + t.amount + ' proficiency in ' + words(t.professionId) + '.'
        : 'Reach ' +
            t.amount +
            ' proficiency in ' +
            (t.count ?? 1) +
            ' different gathering profession(s).';
    case 'collectItems':
      return (
        'Discover ' +
        (t.count === undefined || t.count === t.itemIds.length
          ? 'every listed item'
          : t.count + ' different items from this list') +
        '. An item still counts after it leaves your bags.\n' +
        list(t.itemIds.map((id) => w.entity('item', id, ITEMS[id].name)))
      );
    case 'visit':
      return visitInstruction(w, t.markId);
    case 'visits':
      return (
        checkedList(
          t.markIds.map((m) => visitInstruction(w, m)),
          t.count,
        ) +
        (t.markIds.some((m) => m.startsWith('poi:'))
          ? '\n\nThe game checks landmark visits once a second while you are alive.'
          : '')
      );
    case 'meta': {
      const required = t.deedIds.map((id) => {
        const child = DEEDS[id];
        return { child, link: w.entity('deed', id, child.name) };
      });
      const quests = t.questIds ?? [];
      const parts: string[] = [];
      if (deed.category === 'chronicle') {
        for (const { child, link } of required) {
          parts.push(
            '=== ' +
              link +
              ' ===\n' +
              (child.trigger.kind === 'meta' ? child.desc : deedRequirements(w, child)),
          );
        }
      } else parts.push(list(required.map((r) => r.link)));
      if (quests.length) parts.push('=== Quests to turn in ===\n' + list(quests.map(quest)));
      return parts.join('\n\n');
    }
  }
}
