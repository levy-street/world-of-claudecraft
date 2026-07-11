import { describe, expect, it } from 'vitest';
import {
  CRAFT_RING,
  CRAFTING_HUB_MIN_LEVEL,
  CRAFTING_HUB_POS,
  CRAFTING_HUB_RADIUS,
  CRAFTING_HUB_STATIONS,
  CRAFTING_HUB_ZONE_ID,
} from '../src/sim/content/professions';
import { COMBO_RECIPES, COMMON_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import { resolveCraft } from '../src/sim/professions/crafting';
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
