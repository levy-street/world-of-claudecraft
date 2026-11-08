import {
  CASKET_GEAR_CHANCE,
  CASKET_HEROIC_MARK_CHANCE,
  CASKET_HEROIC_MARKS,
  CASKET_MATERIAL_COUNT,
  CASKET_MATERIAL_POOL,
  CASKET_MOUNT_CHANCE,
  CASKET_MOUNT_REINS_ITEM_ID,
} from '../../src/sim/clue_casket';
import { CLUE_SCROLL_MIN_LEVEL, TREASURE_CASKET_ITEM_ID } from '../../src/sim/content/clue_hunts';
import { drownedLitanyChestItemsForTier } from '../../src/sim/content/delves/drowned_litany_loot';
import { delveChestItemsForTier } from '../../src/sim/content/delves/lockpick_tiers';
import { DELVE_SHOPS, delveShopGateClears } from '../../src/sim/content/delves/shop';
import { HEROIC_MARK_CURRENCY_ID } from '../../src/sim/content/dungeon_difficulty';
import {
  HOARD_BASE_ITEM_IDS,
  HOARD_BOSS_LOOT_TABLES,
  HOARD_ITEMS,
  HOARD_LOOT_CLASS_BIAS,
  hoardLootTierForMap,
  hoardLootVariantId,
} from '../../src/sim/content/hoard_loot';
import { CAVE_THEMES } from '../../src/sim/content/rift/cave_themes';
import {
  RIFT_ESSENCE_ITEM_ID,
  RIFT_GEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
} from '../../src/sim/content/rift/items';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';
import {
  HOARD_MIN_LEVEL,
  nextTreasureMapRarity,
  TREASURE_DIG_RADIUS,
  TREASURE_MAP_DROP_WEIGHTS,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  TREASURE_SITES,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_MATERIAL_POOL,
  VAULT_PAYOUTS,
} from '../../src/sim/content/treasure_maps';
import { WEEKLY_EMISSARY_NPC_DEF } from '../../src/sim/content/weekly_quests';
import { WORLD_QUEST_CLASS_LOOT } from '../../src/sim/content/world_quest_loot';
import { CLASSES, DELVES } from '../../src/sim/data';
import {
  EMISSARY_CACHE_ITEM_ID,
  EMISSARY_CACHE_MARKS,
  emissaryCachePoolForClass,
} from '../../src/sim/emissary_cache';
import { riftHeroicClearPool, riftNormalClearPool } from '../../src/sim/rift/loot_pools';
import {
  FARM_RIFT_DROP_CHANCE,
  FARM_RIFT_DROP_ITEM_IDS,
  RIFT_BLUE_MOUNT_CHANCE,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_EPIC_MOUNT_CHANCE,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_CHANCE,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_LEGENDARY_CHANCE_S,
  RIFT_PATTERN_CHANCE,
  RIFT_PATTERN_ITEM_IDS,
} from '../../src/sim/rift/progression';
import { Rng } from '../../src/sim/rng';
import type { PlayerClass } from '../../src/sim/types';
import {
  WORLD_QUEST_ITEM_MIN_LEVEL,
  WORLD_QUEST_ITEM_SLOTS_PER_CYCLE,
} from '../../src/sim/world_quest_item_slots';
import { type ArticleTools, pct, ref } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import { addSpecialAcquisitions } from './item_special_acquisition';
import type { RoutePoint } from './quest_map';
import { npcPin, worldPin } from './system_route_points';
import { systemRoutes } from './system_routes';

/** Keep the verified geography, but never carry another guide's step numbers. */
function delvePoints(litany: boolean): RoutePoint[] {
  return systemRoutes.Delves.points
    .filter((p) =>
      p.frame === 'Overworld'
        ? p.label.includes(litany ? 'Drowned Litany' : 'Collapsed Reliquary')
        : p.frame.includes(litany ? 'Drowned Litany' : 'Collapsed Reliquary'),
    )
    .map((p) => ({
      ...p,
      step: p.frame === 'Overworld' ? 'Start' : p.step === 'Reward' ? 'Reward' : 2,
    }));
}

export function activityAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const index = new Map<string, ItemAcquisition[]>();
  const add = (id: string, source: ItemAcquisition) => addAcquisition(index, id, source);
  const item = (id: string) => ref(w, 'item', id);
  const classes = Object.keys(CLASSES) as PlayerClass[];
  const riftSteps = [
    'Watch realm chat for a natural [[Rifts|rift]] announcement. Go to its named zone and enter the live portal of the required rank. Its exact position changes each opening.',
    "Clear every floor: defeat its enemies, complete its puzzle, then interact with the opened descent. Your group must be the first group to defeat this natural rift's final boss to earn these first-clear extras.",
    'Loot the final boss where it falls. Shared items use the group loot rules; a shared drop is not one copy for every participant. Personal bands, Essence and gems are also on this corpse, reserved for their eligible recipient.',
  ];
  const rift = (id: string, odds: string) =>
    add(id, {
      title: 'Natural rift first-clear reward',
      steps: riftSteps,
      details: [
        odds,
        'A dug treasure-map hoard does not award these rift first-clear extras. Portal, rooms and boss coordinates are generated for the current run, so follow the live map and floor tracker.',
      ],
    });
  for (const [ids, ranks] of [
    [riftNormalClearPool(), 'C'],
    [riftHeroicClearPool(), 'B, A or S'],
  ] as const)
    for (const id of ids)
      rift(
        id,
        'Rank ' +
          ranks +
          ': one guaranteed shared gear slot chooses uniformly from ' +
          ids.length +
          ' pieces, giving this item ' +
          pct(1 / ids.length) +
          ' per slot.' +
          (ranks !== 'C'
            ? ' Rank S also has a 35% chance to add a second independent gear slot.'
            : ''),
      );
  for (const id of RIFT_LEGENDARY_ITEM_IDS)
    rift(
      id,
      'Rank S: ' +
        pct(RIFT_LEGENDARY_CHANCE_S) +
        ' independent chance for this legendary. Each legendary is rolled separately.',
    );
  for (const [ids, chance, ranks] of [
    [RIFT_GREEN_MOUNT_REINS, RIFT_GREEN_MOUNT_CHANCE, 'B'],
    [RIFT_BLUE_MOUNT_REINS, RIFT_BLUE_MOUNT_CHANCE, 'A'],
    [RIFT_EPIC_MOUNT_REINS, RIFT_EPIC_MOUNT_CHANCE, 'S'],
    [RIFT_PATTERN_ITEM_IDS, RIFT_PATTERN_CHANCE, 'B, A or S'],
    [FARM_RIFT_DROP_ITEM_IDS, FARM_RIFT_DROP_CHANCE, 'B, A or S'],
  ] as const)
    for (const id of ids)
      rift(
        id,
        'Rank ' +
          ranks +
          ': ' +
          pct(chance) +
          ' chance to select one of ' +
          ids.length +
          ' items equally. This item has ' +
          pct(chance / ids.length) +
          ' chance per eligible first clear, before group distribution.',
      );
  rift(
    RIFT_ESSENCE_ITEM_ID,
    'Personal reward: at the standard loot multiplier, C gives 1, B 2, A 3 and S 4 Essence. A custom multiplier is clamped to 0.5-2; multiply by the rank amount, round to the nearest whole number, then clamp to 1-8.',
  );
  for (const id of RIFT_GEM_IDS)
    rift(
      id,
      'Personal gem reward on A or S, or when crafting-material bias is at least 0.5. Colors rotate through the participant list; this is not a separate percentage roll for each color.',
    );
  for (const [id, cls] of [
    ['riftbound_band_of_might', 'Warrior, Paladin or Shaman'],
    ['riftbound_band_of_guile', 'Rogue, Hunter or Druid'],
    ['riftbound_band_of_insight', 'Mage, Priest or Warlock'],
  ])
    rift(
      id,
      'Guaranteed personal band for an eligible ' +
        cls +
        '. The rift rank determines the starting band tier.',
    );

  const board = npcPin('Start', 'npc_wq_taskmaster', 'Show me the world quest board');
  const boardSteps = [
    'Talk to ' +
      ref(w, 'npc', 'npc_wq_taskmaster') +
      ' at the marked location. Select “Show me the world quest board.”',
    "Inspect the assignments currently offered. Travel to each assignment's marked area and complete its displayed objective; its own wiki quest guide gives its objective map.",
    "Collect the completed assignment's reward through its completion flow. Check your bags and Ravenpost overflow for awarded items.",
  ];
  const mapWeight = Object.values(TREASURE_MAP_DROP_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const rarity of TREASURE_MAP_RARITIES)
    add(TREASURE_MAP_ITEM_IDS[rarity], {
      title: 'Complete the rotating world-quest slate',
      points: [board],
      steps: [
        boardSteps[0],
        'At level ' +
          CLUE_SCROLL_MIN_LEVEL +
          ' or higher, finish every eligible rotating zone slot on your current board. Always-open dailies are optional. Use the objective map for each assignment you draw.',
        'The final eligible completion awards one map for that cycle. Check bags or Ravenpost overflow; no extra NPC hand-in is needed for the map.',
      ],
      details: [
        pct(TREASURE_MAP_DROP_WEIGHTS[rarity] / mapWeight) +
          ' chance for this map rarity. One slate map per cycle; objective locations change with the selected assignments.',
      ],
    });
  for (const [cls, ids] of Object.entries(WORLD_QUEST_CLASS_LOOT))
    for (const id of ids)
      add(id, {
        title: 'Rotating world-quest equipment',
        points: [board],
        steps: boardSteps,
        details: [
          'Available to ' +
            ref(w, 'class', cls) +
            ' at level ' +
            WORLD_QUEST_ITEM_MIN_LEVEL +
            ' or higher. ' +
            WORLD_QUEST_ITEM_SLOTS_PER_CYCLE +
            ' zones carry equipment each cycle. Inspect the offered reward before starting: the piece is fixed for the zone, class and cycle, not a rerollable monster drop.',
        ],
      });

  const hoardPoints = TREASURE_SITES.map((s) =>
    worldPin(
      2,
      s.x,
      s.z,
      'Possible dig site: ' +
        ref(w, 'zone', s.zoneId) +
        '. Use only the X selected by your own map.',
      TREASURE_DIG_RADIUS,
    ),
  );
  const hoardSteps = (rarity: (typeof TREASURE_MAP_RARITIES)[number], boss?: string) => [
    'Reach level ' +
      HOARD_MIN_LEVEL +
      '. Obtain ' +
      item(TREASURE_MAP_ITEM_IDS[rarity]) +
      ", or join its owner's party. Use the map in your bags to reveal its own marked dig site.",
    "Go to that map's X, within " +
      TREASURE_DIG_RADIUS +
      ' yards, and use the same map again to dig. The map below lists possible sites, not a route to visit all of them. Enter the portal created at your selected site.',
    'Follow the private hoard to its guardian and defeat ' +
      (boss ? ref(w, 'mob', boss) : 'the guardian') +
      '. ' +
      (boss
        ? 'The seed selects the guardian; a map of this rarity is not guaranteed to choose this boss.'
        : 'See [[Hoard encounters]] for its attacks.'),
    'Interact with the reward chest that appears inside the cleared hoard. Every eligible player claims their own reward. The generated chamber and chest have no single permanent overworld coordinate.',
  ];
  const hoard = (
    id: string,
    rarity: (typeof TREASURE_MAP_RARITIES)[number],
    details: string[],
    boss?: string,
  ) =>
    add(id, {
      title: (boss ? ref(w, 'mob', boss) + ': ' : '') + rarity + ' buried hoard',
      steps: hoardSteps(rarity, boss),
      details,
      points: hoardPoints,
    });
  const hoardOdds = (
    ids: readonly string[],
    base: string,
    rarity: (typeof TREASURE_MAP_RARITIES)[number],
  ) => {
    const groups = new Map<string, string[]>();
    for (const cls of classes) {
      const usable = ids.filter(
        (id) => !HOARD_ITEMS[id].requiredClass || HOARD_ITEMS[id].requiredClass?.includes(cls),
      );
      const selection = usable.length
        ? (1 - HOARD_LOOT_CLASS_BIAS) / ids.length +
          (usable.includes(base) ? HOARD_LOOT_CLASS_BIAS / usable.length : 0)
        : 1 / ids.length;
      const odds =
        'owner ' +
        pct(VAULT_PAYOUTS[rarity].gearChance * selection) +
        ', guest ' +
        pct(VAULT_GUEST_GEAR_CHANCE[rarity] * selection);
      groups.set(odds, [...(groups.get(odds) ?? []), ref(w, 'class', cls)]);
    }
    return [...groups].map(
      ([odds, names]) =>
        names.join(', ') +
        ': ' +
        odds +
        ' for this exact item, conditional on this guardian/pool and map rarity.',
    );
  };
  for (const [boss, ids] of Object.entries(HOARD_BOSS_LOOT_TABLES))
    for (const rarity of TREASURE_MAP_RARITIES) {
      const themes = rarity === 'common' || rarity === 'rare' ? CAVE_THEMES : RIFT_THEMES;
      if (!themes.some((theme) => theme.boss === boss)) continue;
      for (const base of ids)
        hoard(
          hoardLootVariantId(base, hoardLootTierForMap(rarity)),
          rarity,
          [
            'Map owner: ' +
              pct(VAULT_PAYOUTS[rarity].gearChance) +
              ' chance for a gear piece. Eligible guest: ' +
              pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
              '.',
            'After a successful gear roll, ' +
              pct(HOARD_LOOT_CLASS_BIAS) +
              " of selections favor this boss's class-appropriate pieces if any exist; the rest choose equally among all " +
              ids.length +
              ' pieces. The chance for this exact item therefore depends on your class and on which guardian the map selects.',
            ...hoardOdds(ids, base, rarity),
          ],
          boss,
        );
    }
  for (const rarity of TREASURE_MAP_RARITIES) {
    const payout = VAULT_PAYOUTS[rarity];
    if (rarity === 'common' || rarity === 'rare')
      for (const base of HOARD_BASE_ITEM_IDS)
        hoard(hoardLootVariantId(base, 'rare'), rarity, [
          'Cave guardians use the shared pool of all ' +
            HOARD_BASE_ITEM_IDS.length +
            ' hoard pieces: ' +
            CAVE_THEMES.map((theme) => ref(w, 'mob', theme.boss)).join(', ') +
            '.',
          'The owner has a ' +
            pct(payout.gearChance) +
            ' gear chance; an eligible guest has ' +
            pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
            '. After a successful roll, ' +
            pct(HOARD_LOOT_CLASS_BIAS) +
            ' of selections prefer class-appropriate pieces if available; other rolls choose uniformly from the whole pool. Exact-item odds therefore depend on your class.',
          ...hoardOdds(HOARD_BASE_ITEM_IDS, base, rarity),
        ]);
    for (const id of VAULT_MATERIAL_POOL)
      hoard(id, rarity, [
        pct(1 / VAULT_MATERIAL_POOL.length) +
          ' chance to receive ' +
          payout.materials +
          ' of this material. Each reward chooses one material uniformly.',
      ]);
    hoard(HEROIC_MARK_CURRENCY_ID, rarity, [
      pct(payout.markChance) + ' chance for ' + payout.marks + ' Heroic Marks.',
    ]);
    hoard(CASKET_MOUNT_REINS_ITEM_ID, rarity, [
      pct(payout.mountChance) + ' personal chance if you do not already own the mount.',
    ]);
    const next = nextTreasureMapRarity(rarity);
    if (next)
      hoard(TREASURE_MAP_ITEM_IDS[next], rarity, [
        pct(payout.nextMapChance) + ' chance for one map of the next rarity.',
      ]);
  }

  const casketSteps = [
    'Obtain ' +
      item(TREASURE_CASKET_ITEM_ID) +
      ' by completing a [[Clue hunts|clue hunt]]. The hunt article lists every stop and the final dig coordinates.',
    'Open the Treasure Casket from your bags. One casket is consumed and its rewards are granted at your current location.',
  ];
  add(TREASURE_CASKET_ITEM_ID, {
    title: 'Finish a clue hunt',
    steps: [
      'Have two existing Clue Scrolls in your bags. Use one to start a hunt; it is consumed. New rotating quest slates award treasure maps instead of scrolls.',
      "Open [[Clue hunts]], match your riddle to its hunt, and follow that hunt's mapped stops in order. Perform the named action at each stop and wait for the tracker to advance.",
      'At the final dig, stand within 12 yards and use your remaining scroll. This copy is not consumed by digging. Receive the casket at the dig site.',
    ],
    details: [
      'The map must match your drawn hunt. A generic example hunt is not the route for every scroll.',
    ],
  });
  for (const id of CASKET_MATERIAL_POOL)
    add(id, {
      title: 'Open a Treasure Casket',
      steps: casketSteps,
      details: [
        pct(1 / CASKET_MATERIAL_POOL.length) +
          ' chance for ' +
          CASKET_MATERIAL_COUNT +
          ' of this material.',
      ],
    });
  for (const [id, chance, amount] of [
    [CASKET_MOUNT_REINS_ITEM_ID, CASKET_MOUNT_CHANCE, 1],
    [HEROIC_MARK_CURRENCY_ID, CASKET_HEROIC_MARK_CHANCE, CASKET_HEROIC_MARKS],
  ] as const)
    add(id, {
      title: 'Open a Treasure Casket',
      steps: casketSteps,
      details: [
        pct(chance) +
          ' chance for ' +
          amount +
          (id === CASKET_MOUNT_REINS_ITEM_ID ? ', only if the mount is not already owned.' : '.'),
      ],
    });
  for (const id of ['reliquary_legs', 'reliquary_shoulder'])
    add(id, {
      title: 'Open a Treasure Casket',
      steps: casketSteps,
      details: [
        pct(CASKET_GEAR_CHANCE) +
          ' chance for low-tier delve gear, then an equal choice of two pieces: ' +
          pct(CASKET_GEAR_CHANCE / 2) +
          ' chance for this item.',
      ],
    });

  const emissary = WEEKLY_EMISSARY_NPC_DEF;
  const cacheSteps = [
    'Visit ' +
      ref(w, 'npc', emissary.id) +
      ' in Eastbrook Vale at x ' +
      emissary.pos.x +
      ', z ' +
      emissary.pos.z +
      '. Open the weekly-charge window and choose one charge for the week.',
    "Complete the selected charge: 3 dungeon clears, 1 raid clear, 3 battleground matches, or 1 world-boss kill. Use that activity's wiki page to find its entrance or queue.",
    'The final completion automatically awards ' +
      item(EMISSARY_CACHE_ITEM_ID) +
      ' to your bags, or Ravenpost if full. Open the cache in your bags to receive one class-usable Normal raid piece and ' +
      EMISSARY_CACHE_MARKS +
      ' Heroic Marks.',
  ];
  const cachePoints = [
    worldPin('Start', emissary.pos.x, emissary.pos.z, emissary.name + ': choose weekly charge'),
  ];
  add(EMISSARY_CACHE_ITEM_ID, {
    title: 'Finish a weekly emissary charge',
    steps: cacheSteps
      .slice(0, 2)
      .concat(
        'The final completion automatically awards one cache to your bags, or Ravenpost if full. No return hand-in is needed for the cache. A later faction commendation claim is separate.',
      ),
    points: cachePoints,
    details: [
      'One chosen charge per reset week. The map marks the starting NPC; your chosen activity determines the objective and reward location.',
    ],
  });
  const cacheOdds = new Map<string, string[]>();
  for (const cls of classes) {
    const pool = emissaryCachePoolForClass(cls);
    for (const id of pool)
      cacheOdds.set(id, [
        ...(cacheOdds.get(id) ?? []),
        ref(w, 'class', cls) +
          ': ' +
          pct(1 / pool.length) +
          ' (1 of ' +
          pool.length +
          ' eligible pieces)',
      ]);
  }
  for (const [id, odds] of cacheOdds)
    add(id, {
      title: "Open an Emissary's Cache",
      steps: cacheSteps,
      points: cachePoints,
      details: [
        'The character opening the cache determines the eligible pool. Exactly one gear piece is selected uniformly.',
        ...odds,
      ],
    });
  add(HEROIC_MARK_CURRENCY_ID, {
    title: "Open an Emissary's Cache",
    steps: cacheSteps,
    points: cachePoints,
    details: ['Guaranteed ' + EMISSARY_CACHE_MARKS + ' Marks per cache.'],
  });

  for (const [delveId, shop] of Object.entries(DELVE_SHOPS)) {
    const litany = delveId.includes('litany');
    const npc = litany ? 'brother_halven_marsh' : 'brother_halven';
    for (const row of shop)
      add(row.itemId, {
        title: DELVES[delveId].name + ' shop',
        points: [
          npcPin('Start', npc, 'Open the Delve Board'),
          npcPin('Reward', npc, 'Shop: buy equipment'),
        ],
        steps: [
          'Earn ' +
            row.marks +
            ' Delve Marks by clearing [[Delves]]. ' +
            (row.gate === 'heroicClear'
              ? 'First complete this delve on Heroic.'
              : delveShopGateClears(row.gate) !== null
                ? 'First finish ' +
                  delveShopGateClears(row.gate) +
                  ' clears of this delve, at either difficulty.'
                : 'This item has no clear-count unlock.'),
          'Talk to ' +
            ref(w, 'npc', npc) +
            ', open the board for ' +
            DELVES[delveId].name +
            ', and choose Shop.',
          'Select ' +
            item(row.itemId) +
            ' and purchase it for ' +
            row.marks +
            ' Delve Marks. The purchase gives one item.',
        ],
        details: ["This is a fixed currency price, not the item's vendor sell value."],
      });
  }
  for (const litany of [false, true]) {
    const resolver = litany ? drownedLitanyChestItemsForTier : delveChestItemsForTier;
    const odds = new Map<string, string[]>();
    for (const cls of classes)
      for (const tier of ['low', 'medium', 'premium', 'bountiful'] as const) {
        const chances = new Map<string, number>();
        // Both authored reward resolvers use at most two chance draws. Enumerate
        // their actual branching probabilities instead of copying their item lists.
        const visit = (decisions: boolean[], weight: number) => {
          const rng = new Rng(1);
          let cursor = 0;
          let pending: number | undefined;
          rng.chance = (p: number) => {
            if (cursor >= decisions.length) {
              pending ??= p;
              return false;
            }
            return decisions[cursor++];
          };
          const rewards = resolver(
            tier === 'bountiful' ? 'premium' : tier,
            cls,
            rng,
            tier === 'bountiful',
          );
          if (pending !== undefined) {
            if (pending > 0) visit([...decisions, true], weight * pending);
            if (pending < 1) visit([...decisions, false], weight * (1 - pending));
            return;
          }
          for (const row of rewards)
            chances.set(row.itemId, (chances.get(row.itemId) ?? 0) + weight);
        };
        visit([], 1);
        for (const [id, chance] of chances)
          odds.set(id, [
            ...(odds.get(id) ?? []),
            ref(w, 'class', cls) + ', ' + tier + ' chest: ' + pct(chance),
          ]);
      }
    for (const [id, details] of odds)
      add(id, {
        title: litany ? 'Drowned Litany reward chest' : 'Collapsed Reliquary reward chest',
        points: delvePoints(litany),
        steps: [
          'Talk to ' +
            ref(w, 'npc', litany ? 'brother_halven_marsh' : 'brother_halven') +
            ' at the marked board. Go solo or as a duo; choose Normal or Heroic and Enter Delve. Minimum level is ' +
            (litany ? '12 on Normal, 14 on Heroic.' : '7 on Normal, 9 on Heroic.'),
          'Follow the current chamber objective, use the opened passage, and defeat the last guardian. ' +
            (litany
              ? 'Interact with the final reliquary, watch the sequence, and repeat it at the shrines. Then interact with the open reliquary to collect the reward.'
              : 'Interact with the final chest. Choose your ante and solve its lock: 3 picks gives low, 2 gives medium, and 1 gives premium loot. Losing every attempt gives consolation low-tier loot. A Bountiful Coffer requires the premium path.'),
        ],
        details: [
          'The following odds are conditional on opening the named chest tier with the stated class. Bountiful runs appear 8% of the time on Normal and 20% on Heroic; their contents are a separate roll. Chamber order changes, so the map shows the starting board and final-room locations.',
          litany
            ? 'Choose rite intensity before the sequence: Easy has 4 touches, 3 attempts and 3 playbacks, capped at low loot. Medium has 5 touches, 2 attempts and 2 playbacks, capped at medium. Hard has 6 touches, 1 attempt and 1 playback; solve without mistakes for premium. Exhausting the allowed attempts yields low loot. Each party member receives their own class-based chest roll.'
            : "The chest gear belongs to the lockpicker and uses that character's class. In a duo, the other player cannot collect the picker's gear. A failed Bountiful lock grants ordinary low-tier consolation instead of Bountiful contents.",
          ...details,
        ],
      });
  }
  addSpecialAcquisitions(w, index);
  return index;
}
