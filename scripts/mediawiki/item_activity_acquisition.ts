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
    'Watch realm chat for a message that a natural [[Rifts|rift]] has opened. Go to the zone it names and enter the open portal of the rank you need. The portal is in a different spot each time it opens.',
    "Clear every floor. On each floor, defeat the enemies, solve the puzzle, then use the way down that opens. Your group must be the first group to defeat this natural rift's final boss. Only that group gets these first-clear extras.",
    'Loot the final boss where it falls. Shared items follow the group loot rules, so one shared drop is not a copy for everyone. Personal bands, Essence and gems are on the same corpse, kept for the player each one belongs to.',
  ];
  const rift = (id: string, odds: string) =>
    add(id, {
      title: 'Natural rift first-clear reward',
      steps: riftSteps,
      details: [
        odds,
        'A hoard you dig up with a treasure map does not give these rift extras. The portal, rooms and boss spots are made new for each run, so follow the live map and the floor tracker.',
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
          ': the boss always drops one shared gear piece. It is picked from ' +
          ids.length +
          ' pieces, each equally likely. So the chance of this item is ' +
          pct(1 / ids.length) +
          ' for each gear piece.' +
          (ranks !== 'C'
            ? ' Rank S also has a 35% chance to drop a second gear piece, picked separately.'
            : ''),
      );
  for (const id of RIFT_LEGENDARY_ITEM_IDS)
    rift(
      id,
      'Rank S: ' +
        pct(RIFT_LEGENDARY_CHANCE_S) +
        ' chance for this legendary. Each legendary gets its own separate roll.',
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
          ' chance that one of these ' +
          ids.length +
          ' items drops, each equally likely. So the chance of this item is ' +
          pct(chance / ids.length) +
          ' per first clear, before the group loot rules decide who gets it.',
      );
  rift(
    RIFT_ESSENCE_ITEM_ID,
    'Personal reward. With the standard loot multiplier, rank C gives 1 Essence, B gives 2, A gives 3 and S gives 4. A custom multiplier is first kept between 0.5 and 2. Multiply the rank amount by it and round to the nearest whole number. The result is then kept between 1 and 8.',
  );
  for (const id of RIFT_GEM_IDS)
    rift(
      id,
      'A personal gem reward on rank A or S, or when the crafting-material bias is 0.5 or more. The colors are handed out in turn down the list of players. There is no separate percent roll for each color.',
    );
  for (const [id, cls] of [
    ['riftbound_band_of_might', 'Warrior, Paladin or Shaman'],
    ['riftbound_band_of_guile', 'Rogue, Hunter or Druid'],
    ['riftbound_band_of_insight', 'Mage, Priest or Warlock'],
  ])
    rift(
      id,
      'A guaranteed personal band for each ' +
        cls +
        ' who can get it. The rift rank sets the tier the band starts at.',
    );

  const board = npcPin('Start', 'npc_wq_taskmaster', 'Show me the world quest board');
  const boardSteps = [
    'Talk to ' +
      ref(w, 'npc', 'npc_wq_taskmaster') +
      ' at the marked location. Select “Show me the world quest board.”',
    "Look at the assignments on offer right now. Go to each one's marked area and do what it asks. Each assignment's own quest page has a map of its objective.",
    'When you finish an assignment, collect its reward. Look for it in your bags, or in Ravenpost if your bags were full.',
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
          ' or higher, finish every rotating zone assignment on your current board that counts. The dailies that are always open are optional. Use the objective map for each assignment you get.',
        'When you finish the last one, you get one map for that cycle. Check your bags, or Ravenpost if your bags are full. You do not need to hand anything in to an NPC for the map.',
      ],
      details: [
        pct(TREASURE_MAP_DROP_WEIGHTS[rarity] / mapWeight) +
          ' chance that the map is this rarity. You get one map per cycle. Where you need to go depends on which assignments you get.',
      ],
    });
  for (const [cls, ids] of Object.entries(WORLD_QUEST_CLASS_LOOT))
    for (const id of ids)
      add(id, {
        title: 'Rotating world-quest equipment',
        points: [board],
        steps: boardSteps,
        details: [
          'For ' +
            ref(w, 'class', cls) +
            ' at level ' +
            WORLD_QUEST_ITEM_MIN_LEVEL +
            ' or higher. Each cycle, ' +
            WORLD_QUEST_ITEM_SLOTS_PER_CYCLE +
            ' zones give equipment. Check the reward before you start. The piece is set by the zone, the class and the cycle. It is not a random monster drop that you can roll again.',
        ],
      });

  const hoardPoints = TREASURE_SITES.map((s) =>
    worldPin(
      2,
      s.x,
      s.z,
      'Possible dig site: ' + ref(w, 'zone', s.zoneId) + '. Only dig at the X your own map shows.',
      TREASURE_DIG_RADIUS,
    ),
  );
  const hoardSteps = (rarity: (typeof TREASURE_MAP_RARITIES)[number], boss?: string) => [
    'Reach level ' +
      HOARD_MIN_LEVEL +
      '. Get ' +
      item(TREASURE_MAP_ITEM_IDS[rarity]) +
      ', or join the party of a player who has one. Use the map in your bags to see where its dig site is.',
    'Go within ' +
      TREASURE_DIG_RADIUS +
      " yards of that map's X and use the same map again to dig. The map below shows all the possible sites. You do not need to visit them all. Enter the portal that opens at your site.",
    'Go through your private hoard to its guardian and defeat ' +
      (boss ? ref(w, 'mob', boss) : 'the guardian') +
      '. ' +
      (boss
        ? 'Each map picks its own guardian. A map of this rarity will not always give you this boss.'
        : 'See [[Hoard encounters]] for its attacks.'),
    'Open the reward chest that appears once the hoard is cleared. Each player who can loot it gets their own reward. The room and chest are made new each time, so they have no fixed spot on the world map.',
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
        'map owner ' +
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
        ' for this item. This assumes you get this guardian (or pool) and this map rarity.',
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
              ' chance of a gear piece. A guest who can loot: ' +
              pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
              '.',
            'If you win a gear piece, ' +
              pct(HOARD_LOOT_CLASS_BIAS) +
              " of the time it is picked only from this boss's pieces for your class (if it has any). Otherwise it is picked from all " +
              ids.length +
              ' pieces, each equally likely. So your chance for this item depends on your class and on which guardian your map gives you.',
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
          'Cave guardians all share one pool of ' +
            HOARD_BASE_ITEM_IDS.length +
            ' hoard pieces: ' +
            CAVE_THEMES.map((theme) => ref(w, 'mob', theme.boss)).join(', ') +
            '.',
          'The map owner has a ' +
            pct(payout.gearChance) +
            ' chance of a gear piece. A guest who can loot has ' +
            pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
            '. If you win a gear piece, ' +
            pct(HOARD_LOOT_CLASS_BIAS) +
            ' of the time it is picked only from pieces for your class (if there are any). Otherwise it is picked from the whole pool, each piece equally likely. So your chance for this item depends on your class.',
          ...hoardOdds(HOARD_BASE_ITEM_IDS, base, rarity),
        ]);
    for (const id of VAULT_MATERIAL_POOL)
      hoard(id, rarity, [
        pct(1 / VAULT_MATERIAL_POOL.length) +
          ' chance to get ' +
          payout.materials +
          ' of this material. Each reward picks one material, each equally likely.',
      ]);
    hoard(HEROIC_MARK_CURRENCY_ID, rarity, [
      pct(payout.markChance) + ' chance for ' + payout.marks + ' Heroic Marks.',
    ]);
    hoard(CASKET_MOUNT_REINS_ITEM_ID, rarity, [
      pct(payout.mountChance) + ' chance, rolled just for you, if you do not own the mount yet.',
    ]);
    const next = nextTreasureMapRarity(rarity);
    if (next)
      hoard(TREASURE_MAP_ITEM_IDS[next], rarity, [
        pct(payout.nextMapChance) + ' chance for one map of the next rarity.',
      ]);
  }

  const casketSteps = [
    'Get ' +
      item(TREASURE_CASKET_ITEM_ID) +
      ' by finishing a [[Clue hunts|clue hunt]]. The hunt page lists every stop and where to dig at the end.',
    'Open the Treasure Casket from your bags. This uses up one casket and gives you its rewards right where you are.',
  ];
  add(TREASURE_CASKET_ITEM_ID, {
    title: 'Finish a clue hunt',
    steps: [
      'You need two Clue Scrolls you already have in your bags. Use one to start a hunt. That scroll is used up. New rotating quest slates give treasure maps, not scrolls.',
      'Open [[Clue hunts]] and find the hunt that matches your riddle. Visit its stops on the map in order. At each stop, do the action it names and wait for the tracker to move on.',
      'At the last dig spot, stand within 12 yards and use your other scroll. Digging does not use up this scroll. You get the casket at the dig site.',
    ],
    details: [
      'Follow the map for the hunt you got. One example hunt is not the route for every scroll.',
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
          (id === CASKET_MOUNT_REINS_ITEM_ID ? ', but only if you do not own the mount yet.' : '.'),
      ],
    });
  for (const id of ['reliquary_legs', 'reliquary_shoulder'])
    add(id, {
      title: 'Open a Treasure Casket',
      steps: casketSteps,
      details: [
        pct(CASKET_GEAR_CHANCE) +
          ' chance for low-tier delve gear. That gear is one of two pieces, each equally likely. So the chance of this item is ' +
          pct(CASKET_GEAR_CHANCE / 2) +
          '.',
      ],
    });

  const emissary = WEEKLY_EMISSARY_NPC_DEF;
  const cacheSteps = [
    'Go to ' +
      ref(w, 'npc', emissary.id) +
      ' in Eastbrook Vale at x ' +
      emissary.pos.x +
      ', z ' +
      emissary.pos.z +
      '. Open the weekly charge window and pick one charge for the week.',
    "Finish the charge you picked: 3 dungeon clears, 1 raid clear, 3 battleground matches, or 1 world boss kill. That activity's wiki page shows how to get in or join its queue.",
    'When you finish, ' +
      item(EMISSARY_CACHE_ITEM_ID) +
      ' goes straight into your bags (or Ravenpost if your bags are full). Open the cache in your bags. It gives one Normal raid piece your class can use, plus ' +
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
        'When you finish, one cache goes straight into your bags (or Ravenpost if your bags are full). You do not need to go back and hand anything in for it. Claiming a faction commendation later is a separate step.',
      ),
    points: cachePoints,
    details: [
      'You can pick one charge each reset week. The map shows the NPC where you start. Where you go after that depends on the activity you picked.',
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
          ' pieces for that class)',
      ]);
  }
  for (const [id, odds] of cacheOdds)
    add(id, {
      title: "Open an Emissary's Cache",
      steps: cacheSteps,
      points: cachePoints,
      details: [
        'The pool depends on the class of the character who opens the cache. You get exactly one gear piece, and every piece in the pool is equally likely.',
        ...odds,
      ],
    });
  add(HEROIC_MARK_CURRENCY_ID, {
    title: "Open an Emissary's Cache",
    steps: cacheSteps,
    points: cachePoints,
    details: ['Each cache always gives ' + EMISSARY_CACHE_MARKS + ' Marks.'],
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
              ? 'You must clear this delve on Heroic first.'
              : delveShopGateClears(row.gate) !== null
                ? 'You must first clear this delve ' +
                  delveShopGateClears(row.gate) +
                  ' times, on either difficulty.'
                : 'You do not need a set number of clears to unlock this item.'),
          'Talk to ' +
            ref(w, 'npc', npc) +
            ', open the board for ' +
            DELVES[delveId].name +
            ', and choose Shop.',
          'Pick ' +
            item(row.itemId) +
            ' and buy it for ' +
            row.marks +
            ' Delve Marks. You get one item.',
        ],
        details: [
          'This is a set price in Delve Marks. It is not what a vendor pays you for the item.',
        ],
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
            ' at the board on the map. Go alone or with one other player. Choose Normal or Heroic, then Enter Delve. You need level ' +
            (litany ? '12 for Normal or 14 for Heroic.' : '7 for Normal or 9 for Heroic.'),
          'Do what each room asks, go through the passage that opens, and defeat the last guardian. ' +
            (litany
              ? 'Click the final reliquary and watch the pattern. Then repeat it at the shrines. After that, click the open reliquary to collect your reward.'
              : 'Click the final chest. Choose your ante and solve its lock: 3 picks gives low loot, 2 gives medium and 1 gives premium. If every attempt fails, you still get low loot. A Bountiful Coffer needs the premium path.'),
        ],
        details: [
          'The odds below assume you open that chest tier as that class. A run is Bountiful 8% of the time on Normal and 20% on Heroic. What a Bountiful chest holds is a separate roll. The rooms come in a different order each time, so the map shows only the starting board and the final room.',
          litany
            ? 'Pick how hard the rite is before the pattern starts. Easy: 4 touches, 3 tries and 3 replays, and the best you can get is low loot. Medium: 5 touches, 2 tries and 2 replays, and the best is medium loot. Hard: 6 touches, 1 try and 1 replay; solve it with no mistakes for premium loot. If you use up all your tries, you get low loot. Each player in the party gets their own chest roll, based on their class.'
            : "The chest gear goes to the player who picks the lock, and it is based on that player's class. In a duo, the other player cannot take the picker's gear. If you fail a Bountiful lock, you get normal low loot instead of the Bountiful rewards.",
          ...details,
        ],
      });
  }
  addSpecialAcquisitions(w, index);
  return index;
}
