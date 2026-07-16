import { describe, expect, it } from 'vitest';
import {
  CRAFT_RING,
  CRAFTING_HUB_MIN_LEVEL,
  CRAFTING_HUB_POS,
  CRAFTING_HUB_RADIUS,
  CRAFTING_HUB_STATIONS,
  CRAFTING_HUB_ZONE_ID,
} from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  COMBO_RECIPES,
  COMMON_RECIPES,
  TOOL_RECIPES,
} from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { craftItem, resolveCraft } from '../src/sim/professions/crafting';
import {
  canUseCraftingHubStation,
  isAtCraftingHub,
  meetsCraftingHubLevel,
} from '../src/sim/professions/crafting_hub';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

function placeAtHub(sim: Sim, pid: number) {
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = CRAFTING_HUB_POS.x;
  entity.pos.z = CRAFTING_HUB_POS.z;
  entity.prevPos = { ...entity.pos };
}

function placeFarFromHub(sim: Sim, pid: number) {
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = CRAFTING_HUB_POS.x + CRAFTING_HUB_RADIUS * 10;
  entity.pos.z = CRAFTING_HUB_POS.z + CRAFTING_HUB_RADIUS * 10;
  entity.prevPos = { ...entity.pos };
}

describe('crafting hub content (#1297)', () => {
  it('sits in the level-20 zone (thornpeak_heights) matching CRAFTING_HUB_MIN_LEVEL', () => {
    expect(CRAFTING_HUB_ZONE_ID).toBe('thornpeak_heights');
    expect(CRAFTING_HUB_MIN_LEVEL).toBe(20);
  });

  it('hosts exactly one station per craft on CRAFT_RING, all within the hub radius', () => {
    expect(CRAFTING_HUB_STATIONS.length).toBe(CRAFT_RING.length);
    const craftIds = new Set(CRAFTING_HUB_STATIONS.map((s) => s.craftId));
    expect(craftIds.size).toBe(CRAFT_RING.length);
    for (const craft of CRAFT_RING) expect(craftIds.has(craft.id)).toBe(true);
    for (const station of CRAFTING_HUB_STATIONS) {
      const dist = Math.hypot(station.offset.x, station.offset.z);
      expect(dist).toBeLessThanOrEqual(CRAFTING_HUB_RADIUS);
    }
  });

  it('marks every TOOL_RECIPES entry as station-bound, and no COMMON/COMBO recipe', () => {
    for (const recipe of TOOL_RECIPES) {
      expect(recipe.requiresHubStation).toBe(true);
    }
    // The negative arm iterates BOTH full lists, not exemplars: a stray
    // requiresHubStation on any starter recipe would gate low-level crafting
    // on a level-20 hub.
    for (const recipe of [...COMMON_RECIPES, ...COMBO_RECIPES]) {
      expect(recipe.requiresHubStation, `${recipe.id} must stay field-craftable`).toBeUndefined();
    }
  });
});

describe('crafting hub gate (#1297)', () => {
  it('isAtCraftingHub is true within the radius, false outside it', () => {
    expect(isAtCraftingHub({ x: CRAFTING_HUB_POS.x, z: CRAFTING_HUB_POS.z })).toBe(true);
    expect(
      isAtCraftingHub({
        x: CRAFTING_HUB_POS.x + CRAFTING_HUB_RADIUS * 5,
        z: CRAFTING_HUB_POS.z,
      }),
    ).toBe(false);
  });

  it('meetsCraftingHubLevel is true at and above the min level, false below it', () => {
    expect(meetsCraftingHubLevel(CRAFTING_HUB_MIN_LEVEL)).toBe(true);
    expect(meetsCraftingHubLevel(CRAFTING_HUB_MIN_LEVEL + 5)).toBe(true);
    expect(meetsCraftingHubLevel(CRAFTING_HUB_MIN_LEVEL - 1)).toBe(false);
  });

  it('canUseCraftingHubStation requires BOTH position and level', () => {
    const at = { x: CRAFTING_HUB_POS.x, z: CRAFTING_HUB_POS.z };
    const far = { x: CRAFTING_HUB_POS.x + CRAFTING_HUB_RADIUS * 5, z: CRAFTING_HUB_POS.z };
    expect(canUseCraftingHubStation(at, CRAFTING_HUB_MIN_LEVEL)).toBe(true);
    expect(canUseCraftingHubStation(at, CRAFTING_HUB_MIN_LEVEL - 1)).toBe(false);
    expect(canUseCraftingHubStation(far, CRAFTING_HUB_MIN_LEVEL)).toBe(false);
  });
});

describe('resolveCraft gates station-bound recipes on hub presence + level (#1297)', () => {
  const recipeId = 'recipe_thorium_mining_pick';

  it('denies with not_at_hub when the player is at the hub but under level', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(CRAFTING_HUB_MIN_LEVEL - 1);
    placeAtHub(sim, pid);
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'mithril_mining_pick', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_at_hub');
    // no side effect: reagents untouched on denial
    expect(sim.countItem('thorium_ore', pid)).toBe(4);
  });

  it('denies with not_at_hub when the player is high enough level but far from the hub', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(CRAFTING_HUB_MIN_LEVEL);
    placeFarFromHub(sim, pid);
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'mithril_mining_pick', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_at_hub');
  });

  it('succeeds once both the hub-presence and level gates are met', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(CRAFTING_HUB_MIN_LEVEL);
    placeAtHub(sim, pid);
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'mithril_mining_pick', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_ore', pid)).toBe(0);
  });

  it('never gates a common-tier recipe on hub presence', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(1);
    placeFarFromHub(sim, pid);
    grantItem(sim, 'bone_fragments', 2, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, 'recipe_eastbrook_arming_sword');

    expect(result.ok).toBe(true);
  });
});

describe('hub reagent sourcing (prog_tools_of_the_trade completability)', () => {
  const HUB_REAGENTS = [
    'thorium_ore',
    'arcanite_bar',
    'ashwood_log',
    'elderwood_log',
    'goldleaf_herb',
    'sunpetal_herb',
  ] as const;

  // Every id a player can actually buy: on some NPC's vendor list AND carrying
  // the buyValue the live buy path requires (items.ts buyItem checks both).
  const vendorSold = new Set<string>();
  for (const npc of Object.values(NPCS)) {
    for (const id of npc.vendorItems ?? []) if (ITEMS[id]?.buyValue) vendorSold.add(id);
  }

  function acquirable(itemId: string, seen: Set<string> = new Set()): boolean {
    if (vendorSold.has(itemId)) return true;
    if (seen.has(itemId)) return false;
    seen.add(itemId);
    // Each sibling reagent branch gets its own copy of the path: `seen` is a
    // cycle guard, not a global visited set, so a craftable intermediate
    // shared by two siblings is not wrongly reported unreachable.
    return ALL_RECIPES.some(
      (r) =>
        r.resultItemId === itemId && r.reagents.every((g) => acquirable(g.itemId, new Set(seen))),
    );
  }

  it('every station-bound recipe reagent chain bottoms out at a live vendor', () => {
    // The deed needs one hub craft, so at least one recipe must be completable;
    // this pins ALL six, reagents and base tools alike, so no future recipe or
    // stock edit can silently strand the deed again.
    for (const recipe of TOOL_RECIPES) {
      for (const reagent of recipe.reagents) {
        expect(
          acquirable(reagent.itemId),
          `${recipe.id} reagent ${reagent.itemId} has no live source`,
        ).toBe(true);
      }
    }
  });

  it('Quartermaster Bree sells all six reagents from inside the hub circle', () => {
    const bree = NPCS.quartermaster_bree;
    for (const id of HUB_REAGENTS) {
      expect(bree.vendorItems, `${id} missing from Bree's stock`).toContain(id);
    }
    // Buying and crafting happen at the same hub: Bree's counter is inside the
    // station circle, so the shopping trip and the craft share one location.
    const distToHub = Math.hypot(bree.pos.x - CRAFTING_HUB_POS.x, bree.pos.z - CRAFTING_HUB_POS.z);
    expect(distToHub).toBeLessThanOrEqual(CRAFTING_HUB_RADIUS);
    // Per-item price pins (literals, not derived): the trade-goods 4x staple
    // markup, and buy stays above sell so there is no vendor arbitrage loop. A
    // price-tier change on any single reagent must fail here, not slip past a
    // shared range check.
    const REAGENT_PRICES: Record<(typeof HUB_REAGENTS)[number], [number, number]> = {
      thorium_ore: [60, 15],
      arcanite_bar: [160, 40],
      ashwood_log: [60, 15],
      elderwood_log: [160, 40],
      goldleaf_herb: [60, 15],
      sunpetal_herb: [160, 40],
    };
    for (const id of HUB_REAGENTS) {
      const def = ITEMS[id];
      // Reagents are common (white), NOT a rarity color: a material must never fall
      // into the junk sweep (sellAllJunk vendors quality 'poor'). The tier lives in
      // the price, not the color.
      expect(def.quality, `${id} quality`).toBe('common');
      const [buyValue, sellValue] = REAGENT_PRICES[id];
      expect(def.buyValue, `${id} buyValue`).toBe(buyValue);
      expect(def.sellValue, `${id} sellValue`).toBe(sellValue);
    }
  });

  it('vendor purchases alone complete the deed: shop at Wilkes and Bree, craft, grant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(CRAFTING_HUB_MIN_LEVEL);
    const anySim = sim as any;
    const meta = anySim.players.get(pid);
    meta.copper = 390; // mithril_mining_pick 150 + four thorium_ore at 60, exact

    const npcEntity = (templateId: string) =>
      [...anySim.entities.values()].find((e: any) => e.templateId === templateId);
    const placeAt = (pos: { x: number; z: number }) => {
      const e = anySim.entities.get(pid);
      e.pos.x = pos.x;
      e.pos.z = pos.z;
      e.prevPos = { ...e.pos };
    };

    // Every recipe input comes from a real vendor purchase, nothing granted:
    // the base tool from Trader Wilkes in Eastbrook, the ore from Bree.
    const wilkes = npcEntity('trader_wilkes');
    placeAt(wilkes.pos);
    sim.buyItem(wilkes.id, 'mithril_mining_pick');
    expect(sim.countItem('mithril_mining_pick', pid)).toBe(1);

    const bree = npcEntity('quartermaster_bree');
    placeAt(bree.pos);
    for (let i = 0; i < 4; i++) sim.buyItem(bree.id, 'thorium_ore');
    expect(sim.countItem('thorium_ore', pid)).toBe(4);
    expect(meta.copper).toBe(0); // both price literals held

    // Bree stands inside the hub circle, so the craft resolves right there.
    const result = craftItem(anySim.ctx, 'recipe_thorium_mining_pick', pid);
    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
    expect(sim.countItem('thorium_ore', pid)).toBe(0);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(true);
  });
});
