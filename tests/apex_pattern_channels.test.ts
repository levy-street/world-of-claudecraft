// Masterwrought apex pattern CHANNELS (Phase 11, masterwrought R8): the referential contract
// in the recipe-to-channel direction, plus the no-fourth-channel sweep.
//
// tests/apex_pattern_items.test.ts pins the channel-to-content direction (the
// pattern universe both ways, the def contract, the raid group at 0.04, the
// sorted rift list, consumables-in-neither-drop-channel, and the behavioral
// rift draw sample); tests/nythraxis_raid_unit.test.ts pins the raid group's
// TAIL position; tests/farm_pattern_items.test.ts pins the FARM set's own
// channel map (masterwrought Phase 11f). This file pins what none of them do:
//   1. every apex drop recipe is reachable through EXACTLY its assigned
//      channel (no orphan, no double-channel), derived from the live surfaces;
//   2. the three hosting surfaces are live content (the boss spawns in a
//      registered dungeon, the rift draw's exported constants drive the live
//      function, the quartermaster is a registered NPC with resolvable stock);
//   3. NO acquisition surface in live content OUTSIDE the sanctioned host
//      registry carries a pattern id (masterwrought R8: three pillars, no
//      fourth), one sweep per surface so a failure names the leaking surface;
//   4. the phase 02 sweep floor: EXACTLY 34 shipped kind:'recipe' defs, each
//      teaching a drop-acquirable recipe (recipe_pattern_items.test.ts sweeps
//      the shape but is floorless; the literal here is the floor);
//   5. the draw-order documentation pin for the rift ledger comment.
//
// RE-CUT AT PHASE 11f, and the reason is worth stating because the file reads
// as an apex-only contract otherwise. Every sweep here was written when the 28
// were the only patterns in the game, so "the raid group is the sole loot host"
// and "no HEROIC_BOSS_LOOT table carries a pattern id" were true by accident of
// there being one set. Farming's channels include the heroic five-mans, which
// Phase 11 had deliberately left empty. Rather than loosen the sweeps, the
// sanctioned hosts are now an explicit REGISTRY below: each sweep skips exactly
// those and nothing else, a pattern anywhere else is still a leak, and adding a
// channel means adding a row a reader can see.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_COLLECTION_RECIPES,
  CRUCIBLE_COLLECTIONS,
} from '../src/sim/content/crucible_collections';
import { DELVE_SHOPS } from '../src/sim/content/delves';
import { drownedLitanyChestItemsForTier } from '../src/sim/content/delves/drowned_litany_loot';
import { delveChestItemsForTier } from '../src/sim/content/delves/lockpick_tiers';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FARM_HEROIC_PATTERN_GROUP, HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_NPC_ID, HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { CRUCIBLE_VENDOR_NPC_ID, CRUCIBLE_VENDOR_STOCK } from '../src/sim/content/ignivar_loot';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { authoredLettersById } from '../src/sim/content/letters';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  FARM_RECIPES,
  ROD_RECIPES,
  recipeById,
} from '../src/sim/content/recipes';
import {
  RIFT_ESSENCE_ITEM_ID,
  RIFT_GEAR_ITEM_IDS,
  RIFT_GEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
} from '../src/sim/content/rift/items';
import {
  CLASSES,
  DUNGEONS,
  GATHER_NODES,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
} from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { riftHeroicClearPool, riftNormalClearPool } from '../src/sim/rift/loot_pools';
import {
  addRiftClearGearLoot,
  createRiftGearInstance,
  FARM_RIFT_DROP_ITEM_IDS,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_PATTERN_CHANCE,
  RIFT_PATTERN_ITEM_IDS,
} from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, PlayerClass } from '../src/sim/types';

const NYTHRAXIS_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const RAID_GROUP = 'nythraxis_patterns';
const CRUCIBLE_GROUP = 'crucible_profession_patterns';
const CRUCIBLE_BOSS_IDS = [
  'varkhul_forgefather_of_the_last_flame',
  'ignivar_herald_of_the_last_flame',
];
const CRUCIBLE_SCROLL_IDS = [
  ...CRUCIBLE_COLLECTIONS.map((collection) => `pattern_${collection.id}`),
  'formula_lastflame_zeal',
].sort();

// THE SANCTIONED HOST REGISTRY. Every place in live content a pattern id is
// allowed to appear, one row per recorded channel decision. The no-fourth-
// channel sweeps below skip exactly these; everything else is a leak.
//
//   nythraxis_patterns  the phase 11 apex GEAR raid group
//   nythraxis_farm      the phase 11f farming raid group (the feast pattern
//                       plus the tier-4 seeds; only its pattern member is a
//                       pattern id, the seeds sweep as ordinary junk)
//   heroic_farm_patterns  the phase 11f farming DUNGEON group, on every heroic
//                       five-man final boss. Phase 11 left HEROIC_BOSS_LOOT
//                       pattern-free on purpose; 11f's DECISION E is what puts
//                       a pattern there, so the exception is named rather than
//                       the sweep being dropped.
const FARM_RAID_GROUP = 'nythraxis_farm';
const FARM_HEROIC_GROUP = FARM_HEROIC_PATTERN_GROUP;
const SANCTIONED_MOB_LOOT_GROUPS = new Set([RAID_GROUP, FARM_RAID_GROUP]);
const SANCTIONED_HEROIC_GROUPS = new Set([FARM_HEROIC_GROUP]);

// The 28 shipped pattern ids, derived from the def table (the universe pin in
// apex_pattern_items.test.ts holds this equal to the recipe-derived set). The
// startsWith arm makes the sweeps catch a STRAY pattern_* id too: one that
// slipped onto a surface without ever registering a def would otherwise pass
// every set-membership check while still being a fourth channel in the making.
const PATTERN_IDS = new Set(
  Object.values(ITEMS)
    .filter((def) => def.kind === 'recipe')
    .map((def) => def.id),
);
const isPatternId = (id: string | undefined): boolean =>
  !!id && (PATTERN_IDS.has(id) || id.startsWith('pattern_') || id.startsWith('formula_'));

// The three channel surfaces, read live (never from the recipe tables, so this
// file checks the recipe-to-channel direction independently).
const RAID_CHANNEL_IDS = new Set(
  MOBS[NYTHRAXIS_BOSS_ID].loot
    .filter((entry) => entry.rollGroup === RAID_GROUP)
    .flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
);
const RIFT_CHANNEL_IDS = new Set<string>(RIFT_PATTERN_ITEM_IDS);
const VENDOR_CHANNEL_IDS = new Set(HEROIC_VENDOR_STOCK.map((offer) => offer.itemId));
const CRUCIBLE_RAID_CHANNEL_IDS = new Set(
  CRUCIBLE_BOSS_IDS.flatMap((bossId) => MOBS[bossId].loot)
    .filter((entry) => entry.rollGroup === CRUCIBLE_GROUP)
    .flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
);
const CRUCIBLE_VENDOR_CHANNEL_IDS = new Set(CRUCIBLE_VENDOR_STOCK.map((offer) => offer.itemId));

// The farm set's three surfaces, read live the same way. Each is filtered to
// PATTERN ids: the raid and rift channels carry seeds too, which are ordinary
// junk and sweep as such everywhere else in this file.
const FARM_RAID_CHANNEL_IDS = new Set(
  MOBS[NYTHRAXIS_BOSS_ID].loot
    .filter((entry) => entry.rollGroup === FARM_RAID_GROUP)
    .flatMap((entry) => (entry.itemId && isPatternId(entry.itemId) ? [entry.itemId] : [])),
);
const FARM_DUNGEON_CHANNEL_IDS = new Set(
  Object.values(HEROIC_BOSS_LOOT)
    .flat()
    .filter((entry) => entry.rollGroup === FARM_HEROIC_GROUP)
    .flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
);
const FARM_RIFT_CHANNEL_IDS = new Set(
  (FARM_RIFT_DROP_ITEM_IDS as readonly string[]).filter((id) => isPatternId(id)),
);

describe('masterwrought R8 referential contract: every drop recipe reaches exactly its channel', () => {
  // The drop-acquisition set in ALL_RECIPES is the recipe-side universe. The
  // counts are LITERAL floors (the recorded phase decisions), never re-derived.
  const apexDropRecipes = ALL_RECIPES.filter((recipe) => recipe.acquisition?.includes('drop'));

  it('the drop-acquisition recipe set partitions the legacy families plus 33 Crucible recipes', () => {
    // 38 since masterwrought Phase 11i: three angler cooking rows plus the
    // apex rod's schematic, the first pattern teaching a row outside the
    // three APEX_* tables. 40 since masterwrought Phase 11k, which retired
    // 11i's capstone feast row and minted three apex role feasts in its place.
    expect(apexDropRecipes).toHaveLength(73);
    const gear = apexDropRecipes.filter((r) => APEX_GEAR_RECIPES.includes(r));
    const armor = apexDropRecipes.filter((r) => APEX_ARMOR_RECIPES.includes(r));
    const consumable = apexDropRecipes.filter((r) => APEX_CONSUMABLE_RECIPES.includes(r));
    const farm = apexDropRecipes.filter((r) => FARM_RECIPES.includes(r));
    // A FIFTH family since masterwrought Phase 11i, and it is the reason the
    // partition needed re-deriving rather than re-counting: the apex rod's
    // rung is the first drop recipe in the game that lives OUTSIDE the three
    // APEX_* tables and outside FARM_RECIPES. It sits in ROD_RECIPES, so a
    // four-term sum would have come up one short against the total no matter
    // how the consumable literal moved.
    const rod = apexDropRecipes.filter((r) => ROD_RECIPES.includes(r));
    const crucible = apexDropRecipes.filter((r) => CRUCIBLE_COLLECTION_RECIPES.includes(r));
    expect(gear).toHaveLength(10);
    expect(armor).toHaveLength(10);
    // THIRTEEN: the eight phase-11 consumables, 11i's two surviving angler
    // rows, and Phase 11k's three apex role feasts.
    expect(consumable).toHaveLength(13);
    expect(farm).toHaveLength(6);
    expect(rod).toHaveLength(1);
    expect(crucible).toHaveLength(33);
    // No drop recipe outside the five families: one with no assigned channel
    // would slip every family loop, so it fails here.
    expect(
      gear.length + armor.length + consumable.length + farm.length + rod.length + crucible.length,
    ).toBe(apexDropRecipes.length);
    // And the families are DISJOINT, which a bare sum cannot show: a recipe
    // counted by two filters would balance the equality above while meaning
    // something quite different.
    const familyIds = [...gear, ...armor, ...consumable, ...farm, ...rod, ...crucible].map(
      (r) => r.id,
    );
    expect(new Set(familyIds).size).toBe(familyIds.length);
  });

  it('every recipe teaching pattern appears in EXACTLY the channels its family assigns', () => {
    // The apex families each get ONE channel. The FARM family deliberately
    // gets two: a drop pillar AND the marks valve, because masterwrought D13
    // forbids a luck-gated trigger being the only faucet for a pattern, so the
    // deterministic route is what makes the drop arms legal. The expectation
    // is therefore a SET per family rather than a single name, and the farm
    // rows are still pinned to exactly one DROP pillar apiece.
    for (const recipe of apexDropRecipes) {
      const isCrucible = CRUCIBLE_COLLECTION_RECIPES.includes(recipe);
      const patternId = `pattern_${isCrucible ? ITEMS[recipe.resultItemId].set : recipe.resultItemId}`;
      const isFarm = FARM_RECIPES.includes(recipe);
      const channels: string[] = [];
      if (RAID_CHANNEL_IDS.has(patternId)) channels.push('raid');
      if (FARM_RAID_CHANNEL_IDS.has(patternId)) channels.push('raid');
      if (FARM_DUNGEON_CHANNEL_IDS.has(patternId)) channels.push('dungeon');
      if (RIFT_CHANNEL_IDS.has(patternId)) channels.push('rift');
      if (FARM_RIFT_CHANNEL_IDS.has(patternId)) channels.push('rift');
      if (VENDOR_CHANNEL_IDS.has(patternId)) channels.push('vendor');
      if (CRUCIBLE_RAID_CHANNEL_IDS.has(patternId)) channels.push('crucible_raid');
      if (CRUCIBLE_VENDOR_CHANNEL_IDS.has(patternId)) channels.push('crucible_vendor');
      if (isCrucible) {
        expect(channels, `${recipe.id} via ${patternId}`).toEqual([
          'crucible_raid',
          'crucible_vendor',
        ]);
        continue;
      }
      if (!isFarm) {
        const assigned = APEX_GEAR_RECIPES.includes(recipe)
          ? 'raid'
          : APEX_ARMOR_RECIPES.includes(recipe)
            ? 'rift'
            : 'vendor';
        // Size exactly 1 AND the right one: an orphan recipe reads [], a
        // double-channel reads two entries, a mis-channeled one reads the
        // wrong name; all three red with the recipe and pattern named.
        expect(channels, `${recipe.id} via ${patternId}`).toEqual([assigned]);
        continue;
      }
      const dropChannels = channels.filter((c) => c !== 'vendor');
      expect(dropChannels, `${recipe.id} must ride exactly one drop pillar`).toHaveLength(1);
      expect(channels.includes('vendor'), `${recipe.id} needs the deterministic valve (D13)`).toBe(
        true,
      );
    }
  });
});

describe('the hosting surfaces are live content', () => {
  it('both Crucible bosses carry exactly the manuals and formula in either difficulty, with a core vendor fallback', () => {
    expect(CRUCIBLE_SCROLL_IDS).toHaveLength(12);
    for (const bossId of CRUCIBLE_BOSS_IDS) {
      const entries = MOBS[bossId].loot.filter((entry) => entry.rollGroup === CRUCIBLE_GROUP);
      expect(entries.map((entry) => entry.itemId).sort(), bossId).toEqual(CRUCIBLE_SCROLL_IDS);
      expect(
        Object.values(DUNGEONS).filter((dungeon) =>
          dungeon.spawns.some((spawn) => spawn.mobId === bossId),
        ),
        bossId,
      ).toHaveLength(1);
      for (const entry of entries) {
        expect(entry.chance, entry.itemId).toBe(0.025);
        expect(entry.normalOnly ?? false, entry.itemId).toBe(false);
        expect(entry.questId, entry.itemId).toBeUndefined();
      }
      expect(entries.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(0.3, 10);
    }
    const stock = CRUCIBLE_VENDOR_STOCK.filter((offer) => isPatternId(offer.itemId));
    expect(stock.map((offer) => offer.itemId).sort()).toEqual(CRUCIBLE_SCROLL_IDS);
    for (const offer of stock) expect(offer.sigilId, offer.itemId).toBe('lastflame_core');
    expect(NPCS[CRUCIBLE_VENDOR_NPC_ID].crucibleVendor).toBe(true);
  });

  it('the raid group rides the boss template that exactly one registered dungeon spawns', () => {
    const entries = MOBS[NYTHRAXIS_BOSS_ID].loot.filter((entry) => entry.rollGroup === RAID_GROUP);
    expect(entries).toHaveLength(10);
    // The template is not shelf content: walk the merged DUNGEONS table and
    // require the boss in exactly one def's spawn list, the registered raid.
    const hosts = Object.values(DUNGEONS)
      .filter((dungeon) => dungeon.spawns.some((spawn) => spawn.mobId === NYTHRAXIS_BOSS_ID))
      .map((dungeon) => dungeon.id);
    expect(hosts).toEqual(['nythraxis_boss_arena']);
    // The raid pillar, not a five-man: the ten-player format is what makes
    // this channel the chase pillar masterwrought R8 assigns the gear patterns to.
    expect(DUNGEONS.nythraxis_boss_arena.suggestedPlayers).toBe(10);
  });

  it('the rift draw is wired live: the exported chance and list drive addRiftClearGearLoot', () => {
    // The shipped rate is pinned as a literal here, never re-derived; the
    // statistical arm lives in apex_pattern_items.test.ts.
    expect(RIFT_PATTERN_CHANCE).toBe(0.08);
    // Exercise the LIVE function: winning B clears across a fixed seed range
    // must shed at least one pattern, and every pattern shed must be a member
    // of the exported list, so the constants provably feed the shipped draw.
    const hits: string[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(seed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, 22);
      for (const slot of boss.loot?.items ?? []) {
        if (isPatternId(slot.itemId)) hits.push(slot.itemId ?? '');
      }
    }
    expect(hits.length).toBeGreaterThan(0);
    // TWO rift pattern lists now feed this function (draw 6 apex, draw 7 farm),
    // so a pattern the live draw sheds must belong to one of them. Kept as a
    // union rather than widened to "any pattern": a pattern from the RAID or
    // DUNGEON channel appearing here would still be a mis-wired draw.
    for (const id of hits) {
      expect(
        RIFT_CHANNEL_IDS.has(id) || FARM_RIFT_CHANNEL_IDS.has(id),
        `${id} shed by the live draw but in neither rift list`,
      ).toBe(true);
    }
    // Both lists are really reachable through the live function, so neither
    // draw can be dead while the other carries the arm.
    expect(
      hits.some((id) => RIFT_CHANNEL_IDS.has(id)),
      'the apex draw fires',
    ).toBe(true);
    expect(
      hits.some((id) => FARM_RIFT_CHANNEL_IDS.has(id)),
      'the farm draw fires',
    ).toBe(true);
  });

  it('the vendor channel host is live: stock resolves and the quartermaster is registered', () => {
    // Every stock row (jewelry, wyrmfall_core, and the eight patterns alike)
    // names a def in the merged item catalog: no dead vendor row.
    for (const offer of HEROIC_VENDOR_STOCK) {
      expect(ITEMS[offer.itemId], offer.itemId).toBeDefined();
    }
    // The NPC the buy path requires standing at (buyHeroicVendorItem checks
    // templateId HEROIC_VENDOR_NPC_ID) is registered in the merged NPC table.
    const npc = NPCS[HEROIC_VENDOR_NPC_ID];
    expect(npc).toBeDefined();
    expect(npc.id).toBe('heroic_quartermaster');
    expect(npc.heroicVendor).toBe(true);
    // Not dynamic: the generic world-init loop spawns him, so he exists in
    // every live world (the live-purchase proof is tests/heroic_vendor.test.ts).
    expect(npc.dynamic ?? false).toBe(false);
  });
});

describe('the no-fourth-channel sweep (masterwrought R8: three pillars, no fourth)', () => {
  it('no other mob loot table carries a pattern id (the raid group is the sole loot host)', () => {
    // Non-vacuity floors near the real counts, so a refactor that emptied the
    // walked surface cannot leave the sweep green over nothing.
    const mobIds = Object.keys(MOBS);
    expect(mobIds.length).toBeGreaterThanOrEqual(230);
    let entriesWalked = 0;
    const sanctionedByGroup = new Map<string, number>();
    const crucibleByBoss = new Map<string, number>();
    const leaks: string[] = [];
    for (const mobId of mobIds) {
      for (const entry of MOBS[mobId].loot ?? []) {
        entriesWalked++;
        if (CRUCIBLE_BOSS_IDS.includes(mobId) && entry.rollGroup === CRUCIBLE_GROUP) {
          expect(CRUCIBLE_SCROLL_IDS, `${mobId}: ${entry.itemId}`).toContain(entry.itemId);
          crucibleByBoss.set(mobId, (crucibleByBoss.get(mobId) ?? 0) + 1);
          continue;
        }
        // The sanctioned hosts: the two appended pattern groups on the
        // nythraxis base table (registry above). Everything else on that
        // table, and every other mob, sweeps.
        if (
          mobId === NYTHRAXIS_BOSS_ID &&
          entry.rollGroup !== undefined &&
          SANCTIONED_MOB_LOOT_GROUPS.has(entry.rollGroup)
        ) {
          sanctionedByGroup.set(entry.rollGroup, (sanctionedByGroup.get(entry.rollGroup) ?? 0) + 1);
          continue;
        }
        if (isPatternId(entry.itemId)) leaks.push(`MOBS.${mobId}: ${entry.itemId}`);
      }
    }
    expect(entriesWalked).toBeGreaterThanOrEqual(645);
    expect(leaks).toEqual([]);
    // The skip is not a hole, the same arm its heroic sibling below carries:
    // both sanctioned groups must really be on the table, or this sweep would
    // be exempting a channel that has already left and would go quietly
    // vacuous. PER GROUP, not a total: a single sum of 15 is satisfied by
    // fifteen apex rows and zero farm rows, which is the exact state the arm
    // exists to catch.
    expect(sanctionedByGroup.get(RAID_GROUP), 'the apex gear group').toBe(10);
    expect(sanctionedByGroup.get(FARM_RAID_GROUP), 'the farming raid group').toBe(5);
    for (const bossId of CRUCIBLE_BOSS_IDS) expect(crucibleByBoss.get(bossId), bossId).toBe(12);
  });

  it('no HEROIC_BOSS_LOOT table carries a pattern id outside the sanctioned farm group', () => {
    // Phase 11 kept these tables pattern-free outright. Phase 11f's DECISION E
    // opens exactly ONE group on them, so the sweep skips that group by name
    // and still fails on a pattern anywhere else in any heroic table.
    const tables = Object.keys(HEROIC_BOSS_LOOT);
    expect(tables.length).toBeGreaterThanOrEqual(7);
    let entriesWalked = 0;
    let sanctioned = 0;
    const leaks: string[] = [];
    for (const bossId of tables) {
      for (const entry of HEROIC_BOSS_LOOT[bossId]) {
        entriesWalked++;
        if (entry.rollGroup !== undefined && SANCTIONED_HEROIC_GROUPS.has(entry.rollGroup)) {
          sanctioned++;
          continue;
        }
        if (isPatternId(entry.itemId)) leaks.push(`HEROIC_BOSS_LOOT.${bossId}: ${entry.itemId}`);
      }
    }
    expect(entriesWalked).toBeGreaterThanOrEqual(58);
    expect(leaks).toEqual([]);
    // The skip is not a hole: the sanctioned group must actually be present,
    // or this arm would be sweeping a surface the channel silently left.
    expect(sanctioned, 'the sanctioned farm group must really be on these tables').toBe(10);
  });

  it('the rift clear pools carry no pattern id (patterns have no slot, so they cannot enter)', () => {
    // The pools are slot-gated derivations, so a pattern CANNOT enter; assert
    // the premise (no slot on any pattern def) and the conclusion anyway, so a
    // future pool rewrite that dropped the slot gate still fails here.
    for (const id of PATTERN_IDS) {
      expect(ITEMS[id].slot, `${id} must carry no slot`).toBeUndefined();
    }
    const normal = riftNormalClearPool();
    const heroic = riftHeroicClearPool();
    expect(normal.length).toBeGreaterThan(0);
    expect(heroic.length).toBeGreaterThan(0);
    expect(normal.filter((id) => isPatternId(id))).toEqual([]);
    expect(heroic.filter((id) => isPatternId(id))).toEqual([]);
  });

  it('the rift legendary and reins lists carry no pattern id', () => {
    for (const [surface, list] of [
      ['RIFT_LEGENDARY_ITEM_IDS', RIFT_LEGENDARY_ITEM_IDS],
      ['RIFT_GREEN_MOUNT_REINS', RIFT_GREEN_MOUNT_REINS],
      ['RIFT_BLUE_MOUNT_REINS', RIFT_BLUE_MOUNT_REINS],
      ['RIFT_EPIC_MOUNT_REINS', RIFT_EPIC_MOUNT_REINS],
    ] as const) {
      expect(list.length, surface).toBeGreaterThanOrEqual(2);
      expect(
        [...list].filter((id) => isPatternId(id)),
        surface,
      ).toEqual([]);
    }
  });

  it('no quest itemRewards entry carries a pattern id', () => {
    const quests = Object.values(QUESTS);
    expect(quests.length).toBeGreaterThanOrEqual(204);
    let rewardIdsWalked = 0;
    const leaks: string[] = [];
    for (const quest of quests) {
      for (const itemId of Object.values(quest.itemRewards ?? {})) {
        rewardIdsWalked++;
        if (isPatternId(itemId)) leaks.push(`QUESTS.${quest.id}: ${itemId}`);
      }
    }
    expect(rewardIdsWalked).toBeGreaterThanOrEqual(148);
    expect(leaks).toEqual([]);
  });

  it('no NPC vendorItems list carries a pattern id', () => {
    // The quartermaster's marks stock is NOT a vendorItems list (he carries
    // none); a pattern in any coin vendorItems row would be a fourth channel.
    const vendors = Object.values(NPCS).filter((npc) => (npc.vendorItems?.length ?? 0) > 0);
    expect(vendors.length).toBeGreaterThanOrEqual(17);
    let idsWalked = 0;
    const leaks: string[] = [];
    for (const npc of vendors) {
      for (const itemId of npc.vendorItems ?? []) {
        idsWalked++;
        if (isPatternId(itemId)) leaks.push(`NPCS.${npc.id}: ${itemId}`);
      }
    }
    expect(idsWalked).toBeGreaterThanOrEqual(205);
    expect(leaks).toEqual([]);
  });

  it('no gather node material resolves to a pattern id', () => {
    expect(GATHER_NODES.length).toBeGreaterThanOrEqual(156);
    const leaks: string[] = [];
    for (const node of GATHER_NODES) {
      const material = nodeMaterialFor(node.type, node.zoneId).itemId;
      if (isPatternId(material)) leaks.push(`GATHER_NODES ${node.id}: ${material}`);
    }
    expect(leaks).toEqual([]);
  });

  it('the PvP honor stock carries no pattern id', () => {
    expect(FURY_STOCK.length).toBeGreaterThanOrEqual(47);
    expect(FURY_STOCK.filter((id) => isPatternId(id))).toEqual([]);
  });

  it('no delve shop carries a pattern id', () => {
    const shops = Object.keys(DELVE_SHOPS);
    expect(shops.length).toBeGreaterThanOrEqual(2);
    let rowsWalked = 0;
    const leaks: string[] = [];
    for (const delveId of shops) {
      for (const entry of DELVE_SHOPS[delveId]) {
        rowsWalked++;
        if (isPatternId(entry.itemId)) leaks.push(`DELVE_SHOPS.${delveId}: ${entry.itemId}`);
      }
    }
    expect(rowsWalked).toBeGreaterThanOrEqual(26);
    expect(leaks).toEqual([]);
  });

  it('no fishing table entry resolves to a pattern id', () => {
    // Three proficiency bands, each a per-zone table (the eastbrook row
    // doubles as the fallback for zones without their own).
    expect(FISHING_TABLES_BY_BAND.length).toBeGreaterThanOrEqual(3);
    let entriesWalked = 0;
    const leaks: string[] = [];
    for (let band = 0; band < FISHING_TABLES_BY_BAND.length; band++) {
      for (const [zoneId, table] of Object.entries(FISHING_TABLES_BY_BAND[band])) {
        for (const entry of table) {
          entriesWalked++;
          // itemId: null is the empty-hook row, not an item grant.
          if (isPatternId(entry.itemId ?? undefined)) {
            leaks.push(`FISHING_TABLES_BY_BAND[${band}].${zoneId}: ${entry.itemId}`);
          }
        }
      }
    }
    expect(entriesWalked).toBeGreaterThanOrEqual(48);
    expect(leaks).toEqual([]);
  });

  it('no mail letter attachment carries a pattern id', () => {
    // authoredLettersById() is the one merged registry both client letter
    // registries build from, so the walked corpus is every authored letter.
    // Only static items rows sweep here: the marks/cores reward letter bases
    // deliberately carry none (the PostOffice fills those stacks per kill).
    const letters = Object.values(authoredLettersById());
    expect(letters.length).toBeGreaterThanOrEqual(37);
    let attachmentIdsWalked = 0;
    const leaks: string[] = [];
    for (const letter of letters) {
      for (const slot of letter.items ?? []) {
        attachmentIdsWalked++;
        if (isPatternId(slot.itemId)) leaks.push(`letters ${letter.letterId}: ${slot.itemId}`);
      }
    }
    expect(attachmentIdsWalked).toBeGreaterThanOrEqual(1);
    expect(leaks).toEqual([]);
  });

  it('no ground-object pickup carries a pattern id (overworld or dungeon object lists)', () => {
    expect(GROUND_OBJECTS.length).toBeGreaterThanOrEqual(43);
    let idsWalked = 0;
    const leaks: string[] = [];
    for (const obj of GROUND_OBJECTS) {
      idsWalked++;
      if (isPatternId(obj.itemId)) leaks.push(`GROUND_OBJECTS: ${obj.itemId}`);
    }
    // Dungeon defs seed their own object spawns (doors and encounter
    // interactables included; every row carries an item id, so all sweep).
    for (const dungeon of Object.values(DUNGEONS)) {
      for (const obj of dungeon.objects ?? []) {
        idsWalked++;
        if (isPatternId(obj.itemId)) leaks.push(`DUNGEONS.${dungeon.id} objects: ${obj.itemId}`);
      }
    }
    expect(idsWalked).toBeGreaterThanOrEqual(52);
    expect(leaks).toEqual([]);
  });

  it('no delve cache draw resolves to a pattern id (lockpick chests, the Drowned Reliquary)', () => {
    // Both cache surfaces are draw FUNCTIONS, not static tables: enumerate
    // the reachable id corpus by running the live draws across every tier,
    // class, and coffer arm over a fixed seed range (deterministic, and wide
    // enough that every chance() branch, the 3 percent epic included, lands).
    const ids = new Set<string>();
    const classes = Object.keys(CLASSES) as PlayerClass[];
    expect(classes.length).toBeGreaterThanOrEqual(9);
    for (const tier of ['premium', 'medium', 'low'] as const) {
      for (const cls of classes) {
        for (const bountiful of [false, true]) {
          for (let seed = 1; seed <= 200; seed++) {
            for (const row of delveChestItemsForTier(tier, cls, new Rng(seed), bountiful)) {
              ids.add(row.itemId);
            }
            for (const row of drownedLitanyChestItemsForTier(tier, cls, new Rng(seed), bountiful)) {
              ids.add(row.itemId);
            }
          }
        }
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(20);
    const leaks = [...ids].filter((id) => isPatternId(id));
    expect(leaks).toEqual([]);
  });

  it('the rift first-clear personal loot mints no pattern id (rings, essence, gems)', () => {
    // addRiftProgressionLoot is the OTHER rift grant beside the clear draw:
    // per-winner ring + Rift Essence + an A/S gem, all from static id lists.
    // The forge verbs (upgrade/enchant/socket) mutate an existing copy's
    // payload and never mint an item id, so these lists are the whole surface.
    const staticIds = [...RIFT_GEAR_ITEM_IDS, RIFT_ESSENCE_ITEM_ID, ...RIFT_GEM_IDS];
    expect(staticIds.length).toBeGreaterThanOrEqual(7);
    expect(staticIds.filter((id) => isPatternId(id))).toEqual([]);
    // The live ring picker must stay inside the swept static list, so the
    // sweep provably covers what the function grants for every class.
    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const shellId = createRiftGearInstance('sweep_probe', 'S', cls, 1).itemId;
      expect(RIFT_GEAR_ITEM_IDS as readonly string[], `${cls} ring ${shellId}`).toContain(shellId);
    }
  });

  it('no recipe RESULT is a pattern id (crafting can never mint a fourth channel)', () => {
    // Patterns TEACH recipes; a recipe whose resultItemId were itself a
    // pattern would make crafting a craftable-pattern fourth channel that no
    // loot, vendor, or drop sweep sees. The recipe-side universe is the whole
    // merged ALL_RECIPES table.
    const leaks: string[] = [];
    let walked = 0;
    for (const recipe of ALL_RECIPES) {
      walked++;
      if (isPatternId(recipe.resultItemId)) leaks.push(`${recipe.id}: ${recipe.resultItemId}`);
    }
    expect(walked).toBeGreaterThanOrEqual(132);
    expect(leaks).toEqual([]);
  });

  it('no class starter kit carries a pattern id', () => {
    // CLASSES[*].startItems is a static grant table (rations today); a
    // pattern seeded there would be a free fourth channel at character
    // creation.
    const leaks: string[] = [];
    let itemsWalked = 0;
    const classes = Object.keys(CLASSES) as PlayerClass[];
    expect(classes.length).toBeGreaterThanOrEqual(9);
    for (const cls of classes) {
      for (const row of CLASSES[cls].startItems) {
        itemsWalked++;
        if (isPatternId(row.itemId)) leaks.push(`CLASSES.${cls} startItems: ${row.itemId}`);
      }
    }
    expect(itemsWalked).toBeGreaterThanOrEqual(9);
    expect(leaks).toEqual([]);
  });
});

describe('the phase 02 sweep floor', () => {
  it('every shipped pattern teaches drop-acquirable recipes, and only the Zeal formula teaches an enchant', () => {
    // recipe_pattern_items.test.ts sweeps every kind:'recipe' def for this
    // shape but is deliberately floorless (it predates shipped content); the
    // literal here is the floor, and the referential arms above make it
    // un-gameable (a 35th def would also have to seat a channel to pass them).
    // 28 apex plus the 6 farming patterns Phase 11f added.
    const recipeDefs = Object.values(ITEMS).filter((def) => def.kind === 'recipe');
    // 38 since masterwrought Phase 11i (the angler's endgame block), 40 since
    // Phase 11k (three apex feast recipes in, 11i's capstone feast out).
    expect(recipeDefs).toHaveLength(52);
    expect(recipeDefs.filter((def) => !CRUCIBLE_SCROLL_IDS.includes(def.id))).toHaveLength(40);
    let recipesTaught = 0;
    let enchantsTaught = 0;
    for (const def of recipeDefs) {
      if (def.kind !== 'recipe') continue; // narrow for teachesRecipeId
      if (def.teachesEnchantId !== undefined) {
        expect(def.id).toBe('formula_lastflame_zeal');
        expect(def.teachesEnchantId).toBe('enchant_weapon_lastflame_zeal');
        expect(ENCHANTS[def.teachesEnchantId]?.acquisition).toBe('drop');
        enchantsTaught++;
        continue;
      }
      for (const recipeId of def.teachesRecipeIds ?? [def.teachesRecipeId]) {
        const recipe = recipeById(recipeId);
        expect(recipe, `${def.id} teaches ${recipeId}`).toBeDefined();
        expect(recipe?.acquisition, def.id).toContain('drop');
        recipesTaught++;
      }
    }
    expect(recipesTaught).toBe(73);
    expect(enchantsTaught).toBe(1);
  });
});

describe('draw-order documentation', () => {
  // The raid half of the draw-order story (the pattern group's entries at
  // strictly higher array indexes than every non-pattern entry) is pinned by
  // tests/nythraxis_raid_unit.test.ts ("appends the ten apex gear patterns as
  // one tail rollGroup at 0.04 each"); not duplicated here.
  it('the progression.ts draw-order ledger records the pattern roll as draw 6', () => {
    // Source-text pin, acceptable ONLY for the comment's existence: the ledger
    // is the documented append contract, and a rewrite that dropped or
    // renumbered the pattern line would strand the recorded decision. The
    // behavioral half (the draw's STREAM POSITION after the mount roll) is
    // pinned by the rift_clear_rewards parity golden (tests/parity), which
    // reds on an insertion above draw 6 on the A-rank path; the statistical
    // arms in tests/apex_pattern_items.test.ts are draw-order-insensitive
    // by construction and pin rates, never position.
    const source = readFileSync(new URL('../src/sim/rift/progression.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/Draw order \(APPEND-ONLY/);
    expect(source).toMatch(/6\. B\/A\/S: one apex-pattern roll \(RIFT_PATTERN_CHANCE/);
    expect(source).toMatch(/pick over the sorted RIFT_PATTERN_ITEM_IDS/);
    // Draw 7, the masterwrought Phase 11f farming append, held to the same
    // standard as draw 6: the ledger is append-only, so every appended draw
    // owes a line here or the next append renumbers on top of a record nobody
    // is guarding.
    expect(source).toMatch(/7\. B\/A\/S: one FARMING roll \(FARM_RIFT_DROP_CHANCE/);
    expect(source).toMatch(/pick\s+\*?\s*over the sorted FARM_RIFT_DROP_ITEM_IDS/);
  });
});
