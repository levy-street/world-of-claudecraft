// Masterwrought apex pattern CHANNELS (Phase 11, R8): the referential contract
// in the recipe-to-channel direction, plus the no-fourth-channel sweep.
//
// tests/apex_pattern_items.test.ts pins the channel-to-content direction (the
// 28-id universe both ways, the def contract, the raid group at 0.04, the
// sorted rift list, consumables-in-neither-drop-channel, and the behavioral
// rift draw sample); tests/nythraxis_raid_unit.test.ts pins the raid group's
// TAIL position. This file pins what neither does:
//   1. every apex drop recipe is reachable through EXACTLY its assigned
//      channel (no orphan, no double-channel), derived from the live surfaces;
//   2. the three hosting surfaces are live content (the boss spawns in a
//      registered dungeon, the rift draw's exported constants drive the live
//      function, the quartermaster is a registered NPC with resolvable stock);
//   3. NO other acquisition surface in live content carries a pattern id (R8:
//      three pillars, no fourth), one sweep per surface so a failure names the
//      leaking surface;
//   4. the phase 02 sweep floor: EXACTLY 28 shipped kind:'recipe' defs, each
//      teaching a drop-acquirable recipe (recipe_pattern_items.test.ts sweeps
//      the shape but is floorless; the literal here is the floor);
//   5. the draw-order documentation pin for the rift ledger comment.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_NPC_ID, HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  recipeById,
} from '../src/sim/content/recipes';
import { RIFT_LEGENDARY_ITEM_IDS } from '../src/sim/content/rift/items';
import { DUNGEONS, GATHER_NODES, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { riftHeroicClearPool, riftNormalClearPool } from '../src/sim/rift/loot_pools';
import {
  addRiftClearGearLoot,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_REINS,
  RIFT_PATTERN_CHANCE,
  RIFT_PATTERN_ITEM_IDS,
} from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

const NYTHRAXIS_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const RAID_GROUP = 'nythraxis_patterns';

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
  !!id && (PATTERN_IDS.has(id) || id.startsWith('pattern_'));

// The three channel surfaces, read live (never from the recipe tables, so this
// file checks the recipe-to-channel direction independently).
const RAID_CHANNEL_IDS = new Set(
  MOBS[NYTHRAXIS_BOSS_ID].loot
    .filter((entry) => entry.rollGroup === RAID_GROUP)
    .flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
);
const RIFT_CHANNEL_IDS = new Set<string>(RIFT_PATTERN_ITEM_IDS);
const VENDOR_CHANNEL_IDS = new Set(HEROIC_VENDOR_STOCK.map((offer) => offer.itemId));

describe('R8 referential contract: every apex recipe reaches exactly its channel', () => {
  // The drop-acquisition set in ALL_RECIPES is the recipe-side universe; 28 is
  // a LITERAL floor (the recorded phase decision), never re-derived.
  const apexDropRecipes = ALL_RECIPES.filter((recipe) => recipe.acquisition?.includes('drop'));

  it('the drop-acquisition recipe set partitions 10 gear / 10 armor / 8 consumable', () => {
    expect(apexDropRecipes).toHaveLength(28);
    const gear = apexDropRecipes.filter((r) => APEX_GEAR_RECIPES.includes(r));
    const armor = apexDropRecipes.filter((r) => APEX_ARMOR_RECIPES.includes(r));
    const consumable = apexDropRecipes.filter((r) => APEX_CONSUMABLE_RECIPES.includes(r));
    expect(gear).toHaveLength(10);
    expect(armor).toHaveLength(10);
    expect(consumable).toHaveLength(8);
    // No drop recipe outside the three families: a 29th drop recipe with no
    // assigned channel would slip every family loop, so it fails here.
    expect(gear.length + armor.length + consumable.length).toBe(apexDropRecipes.length);
  });

  it('every recipe teaching pattern appears in EXACTLY the channel its family assigns', () => {
    for (const recipe of apexDropRecipes) {
      const patternId = `pattern_${recipe.resultItemId}`;
      const assigned = APEX_GEAR_RECIPES.includes(recipe)
        ? 'raid'
        : APEX_ARMOR_RECIPES.includes(recipe)
          ? 'rift'
          : 'vendor';
      const channels: string[] = [];
      if (RAID_CHANNEL_IDS.has(patternId)) channels.push('raid');
      if (RIFT_CHANNEL_IDS.has(patternId)) channels.push('rift');
      if (VENDOR_CHANNEL_IDS.has(patternId)) channels.push('vendor');
      // Size exactly 1 AND the right one: an orphan recipe reads [], a
      // double-channel reads two entries, a mis-channeled one reads the wrong
      // name; all three red with the recipe and pattern named.
      expect(channels, `${recipe.id} via ${patternId}`).toEqual([assigned]);
    }
  });
});

describe('the hosting surfaces are live content', () => {
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
    // this channel the chase pillar R8 assigns the gear patterns to.
    expect(DUNGEONS.nythraxis_boss_arena.suggestedPlayers).toBe(10);
  });

  it('the rift draw is wired live: the exported chance and list drive addRiftClearGearLoot', () => {
    // The recorded rate is a literal, never re-derived (state.md phase 11
    // ledger); the statistical arm lives in apex_pattern_items.test.ts.
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
    for (const id of hits) {
      expect(RIFT_CHANNEL_IDS.has(id), `${id} shed by the live draw but not in the list`).toBe(
        true,
      );
    }
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

describe('the no-fourth-channel sweep (R8: three pillars, no fourth)', () => {
  it('no other mob loot table carries a pattern id (the raid group is the sole loot host)', () => {
    // Non-vacuity floors near the real counts, so a refactor that emptied the
    // walked surface cannot leave the sweep green over nothing.
    const mobIds = Object.keys(MOBS);
    expect(mobIds.length).toBeGreaterThanOrEqual(230);
    let entriesWalked = 0;
    const leaks: string[] = [];
    for (const mobId of mobIds) {
      for (const entry of MOBS[mobId].loot ?? []) {
        entriesWalked++;
        // The one sanctioned host: the nythraxis_patterns group on the
        // nythraxis base table. Everything else on that table sweeps too.
        if (mobId === NYTHRAXIS_BOSS_ID && entry.rollGroup === RAID_GROUP) continue;
        if (isPatternId(entry.itemId)) leaks.push(`MOBS.${mobId}: ${entry.itemId}`);
      }
    }
    expect(entriesWalked).toBeGreaterThanOrEqual(645);
    expect(leaks).toEqual([]);
  });

  it('no HEROIC_BOSS_LOOT table carries a pattern id', () => {
    const tables = Object.keys(HEROIC_BOSS_LOOT);
    expect(tables.length).toBeGreaterThanOrEqual(7);
    let entriesWalked = 0;
    const leaks: string[] = [];
    for (const bossId of tables) {
      for (const entry of HEROIC_BOSS_LOOT[bossId]) {
        entriesWalked++;
        if (isPatternId(entry.itemId)) leaks.push(`HEROIC_BOSS_LOOT.${bossId}: ${entry.itemId}`);
      }
    }
    expect(entriesWalked).toBeGreaterThanOrEqual(48);
    expect(leaks).toEqual([]);
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
    expect(rowsWalked).toBeGreaterThanOrEqual(18);
    expect(leaks).toEqual([]);
  });
});

describe('the phase 02 sweep floor', () => {
  it('EXACTLY 28 shipped kind:recipe defs, each teaching a drop-acquirable recipe', () => {
    // recipe_pattern_items.test.ts sweeps every kind:'recipe' def for this
    // shape but is deliberately floorless (it predates shipped content); the
    // literal 28 here is the floor, and the referential arms above make it
    // un-gameable (a 29th def would also have to seat a channel to pass them).
    const recipeDefs = Object.values(ITEMS).filter((def) => def.kind === 'recipe');
    expect(recipeDefs).toHaveLength(28);
    for (const def of recipeDefs) {
      if (def.kind !== 'recipe') continue; // narrow for teachesRecipeId
      const recipe = recipeById(def.teachesRecipeId);
      expect(recipe, `${def.id} teaches ${def.teachesRecipeId}`).toBeDefined();
      expect(recipe?.acquisition, def.id).toContain('drop');
    }
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
    // behavioral half (the draw actually running last, after the mount roll)
    // lives in tests/apex_pattern_items.test.ts.
    const source = readFileSync(new URL('../src/sim/rift/progression.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/Draw order \(APPEND-ONLY/);
    expect(source).toMatch(/6\. B\/A\/S: one apex-pattern roll \(RIFT_PATTERN_CHANCE/);
    expect(source).toMatch(/pick over the sorted RIFT_PATTERN_ITEM_IDS/);
  });
});
