import { GUIDE_RELIQUARY } from '../../src/guide/content.generated';
import { AUGMENTS, POWERUPS } from '../../src/sim/content/augments';
import { BUDDIES } from '../../src/sim/content/buddies';
import { TUG_HONOR_OFFER } from '../../src/sim/content/buddy_offers';
import { BUDDY_BOSS_DROPS } from '../../src/sim/content/buddy_sources';
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
import { DELVE_LIST, ITEM_SETS, ITEMS, MOBS, QUESTS, ZONES } from '../../src/sim/data';
import {
  ADVANCED_RIDING_FEE_COPPER,
  BASIC_RIDING_FEE_COPPER,
  ridingMoveSpeedPct,
} from '../../src/sim/riding_training';
import { armorySkinStrings } from '../../src/ui/i18n.catalog/armory';
import { clueStrings } from '../../src/ui/i18n.catalog/clues';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

export function addExpeditionCollections(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id]?.name);
  const mob = (id: string) => w.entity('mob', id, MOBS[id]?.name);
  const riding =
    'Basic riding costs ' +
    BASIC_RIDING_FEE_COPPER / 10000 +
    ' gold and increases movement speed by ' +
    percent(ridingMoveSpeedPct(1)) +
    '. Advanced training costs ' +
    ADVANCED_RIDING_FEE_COPPER / 10000 +
    ' gold and raises that bonus to ' +
    percent(ridingMoveSpeedPct(2)) +
    '.';
  w.describe('Mounts and riding', riding);
  for (const m of Object.values(MOUNTS).filter((m) => !isDeveloperMount(m.key))) {
    const reins = Object.values(ITEMS).filter((i) => i.kind === 'mount' && i.mount === m.key);
    w.article(
      'Mounts and riding',
      m.name,
      'Mount',
      `A ${m.rarity} mount appearance. Its speed depends entirely on your riding training.`,
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
        ' store appearance. Equipping it changes how your mount looks. Your riding tier still sets its speed.',
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
        ' appearance for weapons of type ' +
        s.weaponType +
        '. It changes the equipped weapon model and preserves the weapon statistics.',
      offer
        ? `Buy from the Lantern Hall quartermaster for ${offer.seals} Lantern Seals.`
        : `Available from the Season ${s.season} Armory.`,
      copy.look,
    );
  }
  for (const b of Object.values(BUDDIES)) {
    const sources = BUDDY_BOSS_DROPS.filter((s) => s.key === b.key);
    const articleTitle = w.article(
      'Companions',
      b.name,
      'Companion',
      'A cosmetic companion that follows its owner.',
      b.key === 'sprites'
        ? 'Earned when five friends complete referral cards. See [[Referral cards]].'
        : '',
      b.key === TUG_HONOR_OFFER.buddy ? `Costs ${TUG_HONOR_OFFER.priceHonor} Honor.` : '',
      list(
        sources.map(
          (s) =>
            mob(s.bossId) +
            ': ' +
            (s.heroicOnly
              ? `${percent(s.chance)} on Heroic only.`
              : percent(s.chance) +
                ' on Normal, ' +
                percent(s.heroicChance ?? s.chance) +
                ' on Heroic.'),
        ),
      ),
    );
    w.registerArt('companion', b.key, articleTitle);
  }
  for (const d of Object.values(DEEDS).filter((d) => !d.hidden)) {
    const articleTitle = w.article(
      'Book of Deeds',
      d.name,
      'Deed',
      d.desc,
      'Awards ' +
        d.renown +
        ' Renown.' +
        (d.feat ? ' This feat sits outside completion percentages.' : ''),
      d.reward?.kind === 'title'
        ? `Unlocks the title "${d.reward.text}".`
        : d.reward?.kind === 'border'
          ? `Unlocks the ${words(d.reward.slug)} nameplate border.`
          : '',
    );
    w.registerArt('deed', d.id, articleTitle);
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
        ? 'Pieces also count toward the same thresholds when mixed with ' +
            related.join(', ') +
            '. Each threshold pays once.'
        : '',
      heading('Pieces', list(pieces.map((i) => item(i.id)))),
    );
  }
  for (const page of RELIQUARY_PAGES) {
    const guide = GUIDE_RELIQUARY.find((p) => p.id === page.id);
    w.article(
      'The Reliquary',
      page.name,
      'Collection',
      page.desc ?? '',
      'Shelf: ' +
        words(page.shelf) +
        '.' +
        (page.excludeFromCompletion
          ? ` This ${page.excludeFromCompletion} page sits outside completion percentages.`
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
                  return DEEDS[h.sourceId]?.name ?? words(h.sourceId);
                case 'quest':
                  return QUESTS[h.sourceId]?.name ?? words(h.sourceId);
                default:
                  return `${words(h.sourceKind)} (${words(h.sourceId)})`;
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
    'Across your first three clears of each reset day, Normal pays 1 base Delve Mark per clear and Heroic pays 2. Later Normal clears have a 50% chance to pay 1, and Heroic pays 1. The Drowned Litany doubles these base payouts. Chest and rite bonus Marks apply only in the first three clears.',
  );
  for (const d of DELVE_LIST) {
    w.article(
      'Delves',
      d.name,
      'Delve',
      'Requires level ' +
        d.minLevel +
        '. Suggested party size: ' +
        d.suggestedPlayers +
        '. Maximum: ' +
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
              `${t.label}: ${t.firstClearXp ?? d.baseRewards.firstClearXp} XP for the first clear of this tier per reset day, then ${t.repeatClearXp ?? d.baseRewards.repeatClearXp} XP. Each clear pays ${t.copperMin ?? d.baseRewards.copperMin} to ${t.copperMax ?? d.baseRewards.copperMax} copper.`,
          ),
        ),
      ),
      heading(
        'Tiers',
        list(
          d.tiers.map(
            (t) =>
              t.label +
              ': minimum level ' +
              Math.max(d.minLevel, t.minPlayerLevel ?? d.minLevel) +
              ', enemy level bonus +' +
              t.enemyLevelBonus +
              ', ' +
              t.affixCount +
              ' affixes.' +
              (t.unlock
                ? ' Requires ' +
                  t.unlock.clears +
                  ' clear(s) of ' +
                  words(t.unlock.delveId) +
                  ' at ' +
                  words(t.unlock.tierId) +
                  '.'
                : ''),
          ),
        ),
      ),
    );
  }
  for (const c of GUILD_CONTRACTS) {
    const name =
      (c.kind === 'task' ? DEEDS[c.taskDeedId!].name : MOBS[c.mobId].name) +
      ' (' +
      words(c.kind) +
      ')';
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
        'The contract pays ' +
        c.seals +
        ' Lantern Seals.',
    );
  }
  for (const c of CLUE_HUNTS) {
    const copy = clueStrings[c.id as keyof typeof clueStrings] as { title: string };
    w.article(
      'Clue hunts',
      copy.title,
      'Clue hunt',
      `Follow these steps in order. The last dig awards a ${item('treasure_casket')}.`,
      c.steps
        .map((s) => {
          switch (s.kind) {
            case 'npc':
              return `# Speak to ${w.entity('npc', s.npcId)}.`;
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
    'Read a treasure map, travel within ' +
      TREASURE_DIG_RADIUS +
      ' yards of its marked spot and dig. The portal lasts up to ' +
      VAULT_PORTAL_LIFETIME / 3600 +
      ' hours. Entry requires level ' +
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
        '. Recommended group size: ' +
        HOARD_SUGGESTED_PLAYERS[rarity] +
        '.',
      list([
        'Owner gear chance: ' +
          percent(v.gearChance) +
          '. Guest gear chance: ' +
          percent(VAULT_GUEST_GEAR_CHANCE[rarity]) +
          '.',
        'Pays ' +
          v.materials +
          ' materials and ' +
          percent(v.copperMult) +
          ' of level-scaled casket copper before the owner bonus.',
        `${percent(v.markChance)} chance for ${v.marks} Heroic Marks.`,
        `${percent(v.mountChance)} mount chance.`,
        `${percent(v.nextMapChance)} chance of a higher-rarity map.`,
      ]),
      TREASURE_MAP_UPGRADE_INKS[rarity]
        ? 'To upgrade this map before digging, spend ' +
            TREASURE_MAP_UPGRADE_INKS[rarity] +
            ' x ' +
            item('cartographers_ink') +
            '.'
        : 'This is the highest map rarity.',
    );
  }
  for (const route of TRANSPORT_ROUTES) {
    const berths = route.berths.map((b) => words(b.id));
    w.article(
      'Ferries',
      berths.join(' to '),
      'Ferry',
      'The ferry waits ' +
        route.timings.docked +
        ' seconds at each berth and cruises at ' +
        route.timings.cruise +
        ' yards per second.',
      list(route.berths.map((b) => `${words(b.id)}: x ${b.x}, z ${b.z}.`)),
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
      a.roles ? `Eligible roles: ${a.roles.join(', ')}.` : '',
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
