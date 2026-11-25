// "What is inside" tables for things you open: the Emissary's Cache, the Treasure Casket,
// a buried hoard, and the delve reward chests. Every chance comes from the game's own
// reward code (src/sim/), run through rollOutcomes, never from a copied number.

import {
  CASKET_COPPER_BASE,
  CASKET_COPPER_PER_LEVEL,
  CASKET_DELVE_TIER,
  CASKET_GEAR_CHANCE,
  CASKET_HEROIC_MARK_CHANCE,
  CASKET_HEROIC_MARKS,
  CASKET_MATERIAL_COUNT,
  CASKET_MATERIAL_POOL,
  CASKET_MOUNT_CHANCE,
  CASKET_MOUNT_REINS_ITEM_ID,
} from '../../src/sim/clue_casket';
import { drownedLitanyChestItemsForTier } from '../../src/sim/content/delves/drowned_litany_loot';
import { delveChestItemsForTier } from '../../src/sim/content/delves/lockpick_tiers';
import { HEROIC_MARK_CURRENCY_ID } from '../../src/sim/content/dungeon_difficulty';
import {
  nextTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  type TreasureMapRarity,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_MATERIAL_POOL,
  VAULT_OWNER_COPPER_BONUS,
  VAULT_PAYOUTS,
} from '../../src/sim/content/treasure_maps';
import { CLASSES, ITEMS } from '../../src/sim/data';
import {
  EMISSARY_CACHE_MARKS,
  emissaryCachePoolForClass,
  emissaryCacheRaidPool,
} from '../../src/sim/emissary_cache';
import type { LootTier } from '../../src/sim/lockpick';
import type { ItemDef, PlayerClass } from '../../src/sim/types';
import { itemSlotLabel } from '../../src/ui/item_slot_labels';
import { itemArtPath } from './article_art';
import { type ArticleTools, ref } from './entity_format';
import { emptyChance, itemChances, rollOutcomes } from './roll_outcomes';
import { wikiQualityName } from './wiki_item_kind';

/** How a page links things. Item pages and system pages use different link helpers. */
export interface ContentLinks {
  item(id: string): string;
  cls(cls: PlayerClass): string;
}

export function articleLinks(w: ArticleTools): ContentLinks {
  return { item: (id) => ref(w, 'item', id), cls: (cls) => ref(w, 'class', cls) };
}

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

/** The same rounding the creature loot tables use. */
export const lootPercent = (chance: number): string => `${Number((100 * chance).toFixed(2))}%`;

/** A table in the look of the creature loot tables. */
export function lootTable(header: string[], rows: string[][]): string {
  return (
    '{| class="wikitable loot-table"\n|-\n! ' +
    header.join(' !! ') +
    '\n' +
    rows.map((cells) => '|-\n| ' + cells.join(' || ')).join('\n') +
    '\n|}'
  );
}

/** Icon, amount and link for one item, like the first column of a creature loot table. */
export function itemCell(links: ContentLinks, id: string, count = 1): string {
  const art = itemArtPath(id);
  return (
    (art ? '<woc-art path="' + art + '" size="icon" /> ' : '') +
    (count > 1 ? count + ' × ' : '') +
    links.item(id)
  );
}

export const qualityOf = (id: string): string => wikiQualityName(ITEMS[id]?.quality);

const slotNote = (item: ItemDef | undefined): string =>
  item?.slot ? itemSlotLabel(item.slot) + (item.set ? ', part of a set' : '') : '';

/** Classes that get exactly the same result, in class order. */
function classGroups<T>(
  resultFor: (cls: PlayerClass) => T,
  key: (result: T) => string,
): { classes: PlayerClass[]; result: T }[] {
  const groups = new Map<string, { classes: PlayerClass[]; result: T }>();
  for (const cls of CLASS_IDS) {
    const result = resultFor(cls);
    const k = key(result);
    const group = groups.get(k) ?? { classes: [], result };
    group.classes.push(cls);
    groups.set(k, group);
  }
  return [...groups.values()];
}

const chanceKey = (m: Map<string, { chance: number; count: number }>) =>
  JSON.stringify([...m].sort(([a], [b]) => a.localeCompare(b)));

export function classList(links: ContentLinks, classes: PlayerClass[]): string {
  return classes.length === CLASS_IDS.length
    ? 'All classes'
    : classes.map((c) => links.cls(c)).join(', ');
}

export const byName = (a: string, b: string) =>
  (ITEMS[a]?.name ?? a).localeCompare(ITEMS[b]?.name ?? b, 'en');

// ---------------------------------------------------------------------------
// Emissary's Cache
// ---------------------------------------------------------------------------

/** The Emissary's Cache: its marks, then the gear list for each class. */
export function emissaryCacheContents(links: ContentLinks): string {
  const total = emissaryCacheRaidPool().length;
  const blocks = [
    'Every cache holds ' +
      EMISSARY_CACHE_MARKS +
      ' Heroic Marks and one piece of epic gear from a Normal raid. Which gear can come out depends on the class of the character who opens the cache. Every piece on that class list is equally likely.',
    "'''Always inside'''",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      [
        [
          itemCell(links, HEROIC_MARK_CURRENCY_ID, EMISSARY_CACHE_MARKS),
          qualityOf(HEROIC_MARK_CURRENCY_ID),
          lootPercent(1),
          'Every cache.',
        ],
      ],
    ),
    "'''One piece of gear'''",
    'The whole gear list has ' +
      total +
      ' pieces. Each class only gets the pieces it can use, so each class list is shorter. Pick your class below.',
  ];
  for (const cls of CLASS_IDS) {
    const pool = [...emissaryCachePoolForClass(cls)].sort(byName);
    if (!pool.length) continue;
    blocks.push(
      '=== ' +
        CLASSES[cls].name +
        ' ===\n' +
        pool.length +
        ' pieces, so each one is a 1 in ' +
        pool.length +
        ' chance.\n\n' +
        lootTable(
          ['Drop', 'Quality', 'Chance', 'Notes'],
          pool.map((id) => [
            itemCell(links, id),
            qualityOf(id),
            lootPercent(1 / pool.length),
            slotNote(ITEMS[id]),
          ]),
        ),
    );
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Treasure Casket
// ---------------------------------------------------------------------------

/** The casket's gear roll, the way openTreasureCasket draws it (src/sim/clue_casket.ts). */
export function casketGearOdds(cls: PlayerClass): Map<string, { chance: number; count: number }> {
  const gear = itemChances(
    rollOutcomes((rng) => {
      const pieces = delveChestItemsForTier(CASKET_DELVE_TIER, cls, rng);
      return [pieces.length === 1 ? pieces[0] : pieces[rng.int(0, pieces.length - 1)]];
    }),
  );
  for (const row of gear.values()) row.chance *= CASKET_GEAR_CHANCE;
  return gear;
}

/** The gear pieces a casket can hold, named with their chance per casket, for the short
 *  line in "Equipment and use". */
export function casketGearNames(links: ContentLinks): string {
  return classGroups(casketGearOdds, chanceKey)
    .map(
      (g) =>
        [...g.result]
          .sort(([a], [b]) => byName(a, b))
          .map(([id, { chance }]) => links.item(id) + ' ' + lootPercent(chance))
          .join(' or ') +
        (g.classes.length === CLASS_IDS.length ? '' : ' (' + classList(links, g.classes) + ')'),
    )
    .join('; ');
}

const materialRows = (links: ContentLinks, pool: readonly string[], count: number) =>
  pool.map((id) => [
    itemCell(links, id, count),
    qualityOf(id),
    lootPercent(1 / pool.length),
    'One of ' + pool.length + ', each equally likely.',
  ]);

export function casketContents(w: ArticleTools): string {
  const links = articleLinks(w);
  const gearRows = classGroups(casketGearOdds, chanceKey).flatMap((g) =>
    [...g.result]
      .sort(([a], [b]) => byName(a, b))
      .map(([id, { chance, count }]) => [
        itemCell(links, id, count),
        qualityOf(id),
        lootPercent(chance),
        classList(links, g.classes) + '. Low-tier delve gear.',
      ]),
  );
  return [
    "'''Always inside'''",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      [
        [
          w.money(CASKET_COPPER_BASE) +
            ' plus ' +
            w.money(CASKET_COPPER_PER_LEVEL) +
            ' for each of your levels',
          'Coins',
          lootPercent(1),
          'Every casket.',
        ],
      ],
    ),
    "'''One material, always'''\n\nThe game picks one of these. You always get exactly one stack.",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      materialRows(links, CASKET_MATERIAL_POOL, CASKET_MATERIAL_COUNT),
    ),
    "'''Separate rolls'''\n\nEach row has its own roll, so one casket can give several of these.",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      [
        ...gearRows,
        [
          itemCell(links, HEROIC_MARK_CURRENCY_ID, CASKET_HEROIC_MARKS),
          qualityOf(HEROIC_MARK_CURRENCY_ID),
          lootPercent(CASKET_HEROIC_MARK_CHANCE),
          '',
        ],
        [
          itemCell(links, CASKET_MOUNT_REINS_ITEM_ID),
          qualityOf(CASKET_MOUNT_REINS_ITEM_ID),
          lootPercent(CASKET_MOUNT_CHANCE),
          'Only if you do not own this mount yet.',
        ],
      ],
    ),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Buried hoards
// ---------------------------------------------------------------------------

/** What one hoard reward holds for a map of this rarity. */
export function hoardContents(w: ArticleTools, rarity: TreasureMapRarity): string {
  const links = articleLinks(w);
  const v = VAULT_PAYOUTS[rarity];
  const next = nextTreasureMapRarity(rarity);
  return [
    'This is what each player who can loot the hoard gets when its guardian falls.',
    "'''Always inside'''",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      [
        [
          'Copper: ' + lootPercent(v.copperMult) + ' of what a Treasure Casket gives at your level',
          'Coins',
          lootPercent(1),
          'The player who read the map gets ' + lootPercent(VAULT_OWNER_COPPER_BONUS) + ' more.',
        ],
      ],
    ),
    "'''One material, always'''\n\nThe game picks one of these. You always get exactly one stack.",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      materialRows(links, VAULT_MATERIAL_POOL, v.materials),
    ),
    "'''Separate rolls'''\n\nEach row has its own roll, so one hoard can give several of these.",
    lootTable(
      ['Drop', 'Quality', 'Chance', 'Notes'],
      [
        [
          "One piece of gear from the guardian's own loot",
          'Varies',
          lootPercent(v.gearChance),
          'This chance is for the player who read the map. Anyone else in the group has ' +
            lootPercent(VAULT_GUEST_GEAR_CHANCE[rarity]) +
            ". See [[Hoard encounters]] for each guardian's pieces.",
        ],
        [
          itemCell(links, HEROIC_MARK_CURRENCY_ID, v.marks),
          qualityOf(HEROIC_MARK_CURRENCY_ID),
          lootPercent(v.markChance),
          '',
        ],
        [
          itemCell(links, CASKET_MOUNT_REINS_ITEM_ID),
          qualityOf(CASKET_MOUNT_REINS_ITEM_ID),
          lootPercent(v.mountChance),
          'Only if you do not own this mount yet.',
        ],
        ...(next && v.nextMapChance > 0
          ? [
              [
                itemCell(links, TREASURE_MAP_ITEM_IDS[next]),
                qualityOf(TREASURE_MAP_ITEM_IDS[next]),
                lootPercent(v.nextMapChance),
                'A map one rarity higher.',
              ],
            ]
          : []),
      ],
    ),
  ].join('\n\n');
}

/** One line naming the material roll for a map rarity, for a "(Hoard)" page's reward list. */
export function hoardMaterialsText(links: ContentLinks, rarity: TreasureMapRarity): string {
  return (
    'Gives ' +
    VAULT_PAYOUTS[rarity].materials +
    ' of one material, picked from ' +
    VAULT_MATERIAL_POOL.map(links.item).join(', ') +
    ' (each ' +
    lootPercent(1 / VAULT_MATERIAL_POOL.length) +
    ').'
  );
}

/** The material list and the per-rarity payouts, for the hoard guide pages. */
export function hoardPayoutTables(links: ContentLinks): string {
  return [
    'Every hoard reward has one stack of one material. The game picks it from these ' +
      VAULT_MATERIAL_POOL.length +
      ', each equally likely (' +
      lootPercent(1 / VAULT_MATERIAL_POOL.length) +
      '): ' +
      VAULT_MATERIAL_POOL.map(links.item).join(', ') +
      '. The map rarity sets how many you get and the chance of every extra.',
    lootTable(
      [
        'Map',
        'Materials',
        'Copper',
        'Gear (map reader)',
        'Gear (others)',
        'Heroic Marks',
        'Mount',
        'Rarer map',
      ],
      TREASURE_MAP_RARITIES.map((rarity) => {
        const v = VAULT_PAYOUTS[rarity];
        return [
          links.item(TREASURE_MAP_ITEM_IDS[rarity]),
          String(v.materials),
          lootPercent(v.copperMult) + ' of casket copper',
          lootPercent(v.gearChance),
          lootPercent(VAULT_GUEST_GEAR_CHANCE[rarity]),
          lootPercent(v.markChance) + ' for ' + v.marks,
          lootPercent(v.mountChance),
          nextTreasureMapRarity(rarity) ? lootPercent(v.nextMapChance) : 'None',
        ];
      }),
    ),
  ].join('\n\n');
}

/** The contents section for an item you open (or a map whose hoard you dig), or ''. */
export function itemContentsSection(w: ArticleTools, item: ItemDef): string {
  const use = item.use;
  if (use?.type === 'container' && use.container === 'emissary_cache')
    return w.section('What is inside', emissaryCacheContents(articleLinks(w)));
  if (use?.type === 'clueCasket') return w.section('What is inside', casketContents(w));
  if (use?.type === 'treasureMap')
    return w.section('What the hoard gives', hoardContents(w, use.rarity));
  return '';
}

// ---------------------------------------------------------------------------
// Delve reward chests
// ---------------------------------------------------------------------------

export const DELVE_CHEST_TIERS = ['low', 'medium', 'premium', 'bountiful'] as const;
export type DelveChestTier = (typeof DELVE_CHEST_TIERS)[number];

type ChestResolver = typeof delveChestItemsForTier;

const CHEST_LABEL: Record<DelveChestTier, string> = {
  low: 'Low loot',
  medium: 'Medium loot',
  premium: 'Premium loot',
  bountiful: 'Bountiful Coffer',
};

/** Item chances (and the chance of nothing) for one chest tier and class. */
export function delveChestOdds(resolver: ChestResolver, tier: DelveChestTier, cls: PlayerClass) {
  const outcomes = rollOutcomes((rng) =>
    resolver(tier === 'bountiful' ? 'premium' : (tier as LootTier), cls, rng, tier === 'bountiful'),
  );
  return { items: itemChances(outcomes), nothing: emptyChance(outcomes) };
}

/** One table per chest tier, with the classes that share each result in the first column.
 *  `place`, when given, starts each table title (for a page that shows both delves). */
export function delveChestTables(links: ContentLinks, litany: boolean, place = ''): string {
  const resolver: ChestResolver = litany ? drownedLitanyChestItemsForTier : delveChestItemsForTier;
  return DELVE_CHEST_TIERS.map((tier) => {
    const rows = classGroups(
      (cls) => delveChestOdds(resolver, tier, cls),
      (r) => chanceKey(r.items) + '|' + r.nothing,
    ).flatMap((g) => [
      ...[...g.result.items]
        .sort(([a], [b]) => byName(a, b))
        .map(([id, { chance, count }]) => [
          classList(links, g.classes),
          itemCell(links, id, count),
          qualityOf(id),
          lootPercent(chance),
        ]),
      ...(g.result.nothing > 0
        ? [[classList(links, g.classes), 'No gear', 'None', lootPercent(g.result.nothing)]]
        : []),
    ]);
    return (
      "'''" +
      (place ? place + ', ' + CHEST_LABEL[tier].toLowerCase() : CHEST_LABEL[tier]) +
      "'''\n\n" +
      lootTable(['Classes', 'Drop', 'Quality', 'Chance'], rows)
    );
  }).join('\n\n');
}
