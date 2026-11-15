import { GUIDE_RELIQUARY } from '../../src/guide/content.generated';
import { AUGMENTS, POWERUPS } from '../../src/sim/content/augments';
import { BUDDIES } from '../../src/sim/content/buddies';
import { TUG_HONOR_OFFER } from '../../src/sim/content/buddy_offers';
import { CLUE_HUNTS, CLUE_STEP_RADIUS } from '../../src/sim/content/clue_hunts';
import { DEEDS } from '../../src/sim/content/deeds';
import { GUILD_CONTRACTS, GUILD_QUARTERMASTER_STOCK } from '../../src/sim/content/guild_contracts';
import { MOUNT_SKINS } from '../../src/sim/content/mount_skins';
import { isDeveloperMount, MOUNTS } from '../../src/sim/content/mounts';
import { RELIQUARY_PAGES } from '../../src/sim/content/reliquary';
import { TRANSPORT_ROUTES } from '../../src/sim/content/transport_ships';
import {
  HOARD_MIN_LEVEL,
  HOARD_SUGGESTED_PLAYERS,
  TREASURE_DIG_RADIUS,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  TREASURE_MAP_UPGRADE_INKS,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_PAYOUTS,
  VAULT_PORTAL_LIFETIME,
} from '../../src/sim/content/treasure_maps';
import { isGrantableWeaponSkin, WEAPON_SKIN_LIST } from '../../src/sim/content/weapon_skins';
import { DELVE_LIST, ITEM_SETS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../../src/sim/data';
import { CURATOR_RANK_DEFS } from '../../src/sim/reliquary';
import {
  ADVANCED_RIDING_FEE_COPPER,
  BASIC_RIDING_FEE_COPPER,
  ridingMoveSpeedPct,
} from '../../src/sim/riding_training';
import { deedDisplayCategory } from '../../src/ui/deeds_view';
import { armorySkinStrings } from '../../src/ui/i18n.catalog/armory';
import { clueStrings } from '../../src/ui/i18n.catalog/clues';
import { guideStrings } from '../../src/ui/i18n.catalog/guide';
import { companionBossSources, companionRollText } from './companion_sources';
import { deedLead, deedRequirements } from './deed_requirements';
import { retiredDeedActivity } from './system_availability';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

/** A delve's in-game name; the id only if the delve is unknown. */
const delveName = (id: string): string => DELVE_LIST.find((d) => d.id === id)?.name ?? words(id);
const delveTierLabel = (delveId: string, tierId: string): string =>
  DELVE_LIST.find((d) => d.id === delveId)?.tiers.find((t) => t.id === tierId)?.label ??
  words(tierId);

export function addExpeditionCollections(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const mob = (id: string) => w.entity('mob', id, MOBS[id]?.name);
  const riding =
    'Basic riding costs ' +
    BASIC_RIDING_FEE_COPPER / 10000 +
    ' gold and makes you move ' +
    percent(ridingMoveSpeedPct(1)) +
    ' faster. Advanced training costs ' +
    ADVANCED_RIDING_FEE_COPPER / 10000 +
    ' gold and raises that to ' +
    percent(ridingMoveSpeedPct(2)) +
    '.';
  w.describe('Mounts and riding', riding);
  for (const m of Object.values(MOUNTS).filter((m) => !isDeveloperMount(m.key))) {
    const reins = Object.values(ITEMS).filter((i) => i.kind === 'mount' && i.mount === m.key);
    w.article(
      'Mounts and riding',
      m.name,
      'Mount',
      `A ${m.rarity} mount look. How fast it goes depends only on your riding training.`,
      riding,
      list(reins.map((r) => `Reins: ${item(r.id)}`)),
    );
  }
  for (const m of Object.values(MOUNT_SKINS))
    w.article(
      'Mount appearances',
      m.name,
      'Mount skin',
      'A ' +
        m.rarity +
        ' Season ' +
        m.season +
        ' store look for your mount. Wearing it changes how your mount looks. Your riding training still sets how fast it goes.',
    );
  for (const s of WEAPON_SKIN_LIST.filter((s) => isGrantableWeaponSkin(s.id))) {
    const copy = armorySkinStrings[s.id as keyof typeof armorySkinStrings];
    const offer = GUILD_QUARTERMASTER_STOCK.find(
      (o) => o.kind === 'weaponSkin' && o.skinId === s.id,
    );
    w.article(
      'Weapon appearances',
      copy.name,
      'Weapon skin',
      'A ' +
        s.rarity +
        ' ' +
        words(s.collection) +
        ' look for weapons of type ' +
        s.weaponType +
        '. It changes how your equipped weapon looks. The weapon keeps all its stats.',
      offer
        ? `Buy from the Lantern Hall quartermaster for ${offer.seals} Lantern ${offer.seals === 1 ? 'Seal' : 'Seals'}.`
        : `Available from the Season ${s.season} Armory.`,
      copy.look,
    );
  }
  for (const b of Object.values(BUDDIES)) {
    const sources = companionBossSources.filter((s) => s.key === b.key);
    const articleTitle = w.article(
      'Companions',
      b.name,
      'Companion',
      'A companion that follows its owner around. It is just for looks.',
      b.key === 'sprites'
        ? 'You earn it when five friends finish referral cards. See [[Referral cards]].'
        : '',
      b.key === TUG_HONOR_OFFER.buddy
        ? 'Buy this account unlock for ' +
            TUG_HONOR_OFFER.priceHonor.toLocaleString('en-US') +
            ' Honor from ' +
            Object.values(NPCS)
              .filter((n) => n.warfareVendor)
              .map((n) => w.entity('npc', n.id, n.name))
              .join(' or ') +
            '.'
        : '',
      list(sources.map((s) => mob(s.bossId) + '. ' + companionRollText(s.fullGroupChance))),
    );
    w.registerArt('companion', b.key, articleTitle);
  }
  const deeds = Object.values(DEEDS).filter((d) => !d.hidden);
  const titles = new Map(deeds.map((d) => [d.id, w.reserveArticle(d.name, 'Deed')]));
  for (const [id, title] of titles) w.registerArt('deed', id, title);
  w.describe(
    'The Reliquary',
    heading(
      'Curator ranks',
      'Curator rank counts how many different entries you have collected. Extra copies of the same entry do not count. Rank rewards are just for looks and give no Renown.\n\n' +
        '{| class="wikitable"\n! Rank !! Distinct entries !! Seal and reward\n' +
        CURATOR_RANK_DEFS.map(
          (rank) =>
            '|-\n| ' +
            rank.rank +
            ' || ' +
            rank.threshold +
            ' || ' +
            words(rank.sealId) +
            (rank.deedId ? '; ' + w.entity('deed', rank.deedId) : '; first Curator seal'),
        ).join('\n') +
        '\n|}',
    ),
  );

  for (const d of deeds) {
    const retiredActivity = retiredDeedActivity(d.id);
    w.article(
      {
        owner: 'Book of Deeds',
        title: titles.get(d.id),
        retired: Boolean(retiredActivity),
        section: guideStrings.deedsPage.cat[deedDisplayCategory(d.category)],
      },
      d.name,
      'Deed',
      retiredActivity
        ? `'''Retired deed.''' [[${retiredActivity}]] is closed. Players who already earned this deed keep it. Nobody can earn it now.`
        : deedLead(d),
      heading(retiredActivity ? 'Original requirement' : 'How to earn', deedRequirements(w, d)),
      heading(
        'Reward',
        'Gives ' +
          d.renown +
          ' Renown.' +
          (d.feat ? ' This is a feat, so it does not count toward completion percentages.' : ''),
      ),
      d.reward?.kind === 'title'
        ? `Unlocks the title "${d.reward.text}".`
        : d.reward?.kind === 'border'
          ? `Unlocks the ${words(d.reward.slug)} nameplate border.`
          : '',
    );
  }
  for (const set of Object.values(ITEM_SETS)) {
    const pieces = Object.values(ITEMS).filter((i) => i.set === set.id);
    const related = set.lineage
      ? Object.values(ITEM_SETS)
          .filter((s) => s.lineage === set.lineage && s.id !== set.id)
          .map((s) => s.name)
      : [];
    w.article(
      'Equipment sets',
      set.name,
      'Equipment set',
      heading('Equipped bonuses', list(set.bonuses.map((b) => `${b.pieces} pieces: ${b.text}`))),
      related.length
        ? 'You can mix these pieces with pieces from ' +
            related.join(', ') +
            '. They all count toward the same bonuses. Each bonus only works once, even if you mix sets.'
        : '',
      heading('Pieces', list(pieces.map((i) => item(i.id)))),
    );
  }
  for (const page of RELIQUARY_PAGES) {
    const guide = GUIDE_RELIQUARY.find((p) => p.id === page.id);
    w.article(
      { owner: 'The Reliquary', section: guideStrings.reliquaryPage.shelf[page.shelf] },
      page.name,
      'Collection',
      page.desc ?? '',
      'Shelf: ' +
        guideStrings.reliquaryPage.shelf[page.shelf] +
        '.' +
        (page.excludeFromCompletion
          ? ` This ${page.excludeFromCompletion} page does not count toward completion percentages.`
          : ''),
      heading(
        'Collect these entries',
        list(
          page.relics.map((r, i) => {
            const name =
              r.kind === 'item' ? item(r.itemId) : (guide?.relics[i]?.name ?? words(r.kind));
            const source = r.source ?? page.sourceDefault;
            if (!source) return name;
            const routes = ('sourceKind' in source ? [source] : source).map((h) => {
              switch (h.sourceKind) {
                case 'boss':
                  return mob(h.sourceId);
                case 'vendor':
                  return w.entity('npc', h.sourceId);
                case 'zone':
                  return w.entity('zone', h.sourceId);
                case 'deed':
                  return w.entity('deed', h.sourceId, DEEDS[h.sourceId]?.name);
                case 'quest':
                  return w.entity('quest', h.sourceId, QUESTS[h.sourceId]?.name);
                default:
                  return h.sourceKind === 'delve'
                    ? delveName(h.sourceId)
                    : `${words(h.sourceKind)} (${words(h.sourceId)})`;
              }
            });
            return `${name}: ${routes.join(' or ')}.`;
          }),
        ),
      ),
    );
  }
  w.describe(
    'Delves',
    'For your first three clears each reset day, a Normal clear gives 1 base Delve Mark and a Heroic clear gives 2. After that, a Normal clear has a 50% chance to give 1, and a Heroic clear gives 1. The Drowned Litany gives twice these base amounts. Bonus Marks from the chest and the rite only come in your first three clears.',
  );
  for (const d of DELVE_LIST) {
    w.article(
      'Delves',
      d.name,
      'Delve',
      'You need level ' +
        d.minLevel +
        '. Best party size: ' +
        d.suggestedPlayers +
        '. Most players allowed: ' +
        d.maxPlayers +
        '. The entrance is at x ' +
        d.doorPos.x +
        ', z ' +
        d.doorPos.z +
        '.',
      heading('Bosses', list(d.bosses.map(mob))),
      heading(
        'Clear rewards',
        list(
          d.tiers.map(
            (t) =>
              `${t.label}: ${t.firstClearXp ?? d.baseRewards.firstClearXp} XP for your first clear of this tier each reset day, then ${t.repeatClearXp ?? d.baseRewards.repeatClearXp} XP for later clears. Each clear gives ${t.copperMin ?? d.baseRewards.copperMin} to ${t.copperMax ?? d.baseRewards.copperMax} copper.`,
          ),
        ),
      ),
      heading(
        'Tiers',
        list(
          d.tiers.map(
            (t) =>
              t.label +
              ': you need level ' +
              Math.max(d.minLevel, t.minPlayerLevel ?? d.minLevel) +
              '. Enemy level bonus: +' +
              t.enemyLevelBonus +
              '. Affixes (extra rules that make it harder): ' +
              t.affixCount +
              '.' +
              (t.unlock
                ? ' To unlock this tier, you need ' +
                  t.unlock.clears +
                  ' clear(s) of ' +
                  delveName(t.unlock.delveId) +
                  ' at ' +
                  delveTierLabel(t.unlock.delveId, t.unlock.tierId) +
                  '.'
                : ''),
          ),
        ),
      ),
    );
  }
  for (const c of GUILD_CONTRACTS) {
    // The page suffix already says Contract; only Heroic needs telling apart.
    const name =
      (c.kind === 'task' ? DEEDS[c.taskDeedId!].name : MOBS[c.mobId].name) +
      (c.kind === 'heroic' ? ', Heroic' : '');
    w.article(
      'Guild contracts',
      name,
      'Contract',
      'Defeat ' +
        mob(c.mobId) +
        ' in ' +
        w.entity('dungeon', c.dungeonId) +
        (c.kind === 'heroic' ? ' on Heroic' : '') +
        '. ' +
        (c.taskDeedId ? `${DEEDS[c.taskDeedId].desc} ` : '') +
        'The contract gives ' +
        c.seals +
        (c.seals === 1 ? ' Lantern Seal.' : ' Lantern Seals.'),
    );
  }
  for (const c of CLUE_HUNTS) {
    const copy = clueStrings[c.id as keyof typeof clueStrings] as { title: string };
    w.article(
      'Clue hunts',
      copy.title,
      'Clue hunt',
      `Do these steps in order. The last dig gives you a ${item('treasure_casket')}.`,
      c.steps
        .map((s) => {
          switch (s.kind) {
            case 'npc':
              return `# Talk to ${w.entity('npc', s.npcId)}.`;
            case 'deliver':
              return (
                '# Give ' +
                s.count +
                ' x ' +
                item(s.itemId) +
                ' to ' +
                w.entity('npc', s.npcId) +
                '.'
              );
            case 'dig':
              return (
                '# Use the scroll within ' +
                CLUE_STEP_RADIUS +
                ' yards of x ' +
                s.x +
                ', z ' +
                s.z +
                ' in ' +
                w.entity('zone', s.zoneId) +
                '.'
              );
            case 'landmark':
            case 'emote': {
              const poi = ZONES.find((z) => z.id === s.zoneId)?.pois.find((p) => p.id === s.poiId);
              return (
                '# ' +
                (s.kind === 'emote' ? `Use /${s.emote} at ` : 'Visit ') +
                (poi?.label ?? words(s.poiId)) +
                ' in ' +
                w.entity('zone', s.zoneId) +
                '.'
              );
            }
            default:
              throw new Error('Unsupported clue step.');
          }
        })
        .join('\n'),
    );
  }
  w.describe(
    'Buried hoards',
    'Read a treasure map. Go to within ' +
      TREASURE_DIG_RADIUS +
      ' yards of its marked spot and dig there. The portal stays open for up to ' +
      VAULT_PORTAL_LIFETIME / 3600 +
      ' hours. You need level ' +
      HOARD_MIN_LEVEL +
      '.',
  );
  for (const rarity of TREASURE_MAP_RARITIES) {
    const v = VAULT_PAYOUTS[rarity];
    w.article(
      'Buried hoards',
      ITEMS[TREASURE_MAP_ITEM_IDS[rarity]].name,
      'Hoard',
      'Opened with ' +
        item(TREASURE_MAP_ITEM_IDS[rarity]) +
        '. Best group size: ' +
        HOARD_SUGGESTED_PLAYERS[rarity] +
        '.',
      list([
        'Chance of gear for the map owner: ' +
          percent(v.gearChance) +
          '. Chance of gear for a guest: ' +
          percent(VAULT_GUEST_GEAR_CHANCE[rarity]) +
          '.',
        'Gives ' +
          v.materials +
          ' materials and ' +
          percent(v.copperMult) +
          ' of the casket copper for your level, before the owner bonus is added.',
        `${percent(v.markChance)} chance for ${v.marks} Heroic Marks.`,
        `${percent(v.mountChance)} mount chance.`,
        `${percent(v.nextMapChance)} chance of a rarer map.`,
      ]),
      TREASURE_MAP_UPGRADE_INKS[rarity]
        ? 'To upgrade this map before you dig, spend ' +
            TREASURE_MAP_UPGRADE_INKS[rarity] +
            ' x ' +
            item('cartographers_ink') +
            '.'
        : 'This is the highest map rarity.',
    );
  }
  for (const route of TRANSPORT_ROUTES) {
    const berths = route.berths.map((b) =>
      words(b.id).replace(/\b[a-z]/g, (ch) => ch.toUpperCase()),
    );
    w.article(
      'Ferries',
      berths.join(' to '),
      'Ferry',
      'The ferry waits ' +
        route.timings.docked +
        ' seconds at each dock and sails at ' +
        route.timings.cruise +
        ' yards per second.',
      list(route.berths.map((b, i) => `${berths[i]}: x ${b.x}, z ${b.z}.`)),
    );
  }
  for (const a of AUGMENTS)
    w.article(
      'Fiesta augments',
      a.name,
      'Augment',
      a.description.replace(/\s*[\u2014\u2013]\s*/g, ', '),
      `Tier: ${a.tier}.`,
      a.classes ? `Available to ${a.classes.join(', ')}.` : '',
      a.roles ? `Roles that can get it: ${a.roles.join(', ')}.` : '',
    );
  for (const p of POWERUPS) {
    const effects = p.buffs.map((b) => {
      if (b.kind === 'buff_ap') return `+${b.value} attack power.`;
      const stat = {
        buff_scale: 'Body size',
        buff_speed: 'Movement speed',
        slow: 'Movement speed',
        buff_jump: 'Jump strength',
      }[b.kind as 'buff_scale' | 'buff_speed' | 'slow' | 'buff_jump'];
      return `${stat} becomes ${percent(b.value)} of normal.`;
    });
    w.article(
      'Fiesta power-ups',
      p.name,
      'Power-up',
      `Lasts ${p.duration} seconds.`,
      list(effects),
    );
  }
}
