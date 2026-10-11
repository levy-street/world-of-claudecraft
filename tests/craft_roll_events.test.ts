// The sim half of the craft_roll_events audit (src/sim/types.ts craftRoll):
// every chance-based crafting outcome emits exactly one record carrying the
// roll the system actually drew, the effective chance, and the verdict, on
// both arms, and nothing on a denial. The record must never move or add an
// rng draw (the perfecting.ts and crafting.ts draw contracts), so each case
// pins the draw count beside the event.

import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { MASTERWORK_CHANCE_CAP } from '../src/sim/professions/masterwork';
import {
  PERFECTING_ATTEMPT_COST,
  PERFECTING_HEADSTART_RANK,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
  PERFECTING_SUCCESS_CHANCE,
} from '../src/sim/professions/perfecting';
import { type StationType, stationsOfType } from '../src/sim/professions/stations';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { runCraft } from './helpers/enchant_family_cast';
import { EMPTY_TEST_WORLD } from './sim_shared';

type CraftRollEvent = Extract<SimEvent, { type: 'craftRoll' }>;

const APEX_NECK = 'wyrmfall_pendant';

function craftRollsOf(sim: Sim): CraftRollEvent[] {
  return (sim.drainEvents() as SimEvent[]).filter(
    (ev): ev is CraftRollEvent => ev.type === 'craftRoll',
  );
}

/** Force every rng draw to `value` and count the draws (the perfecting.test.ts
 *  idiom); nothing here ticks the sim, so only the action's own draws count. */
function forceRoll(sim: Sim, value: number): () => number {
  let draws = 0;
  (sim.rng as { next: () => number }).next = () => {
    draws += 1;
    return value;
  };
  return () => draws;
}

function perfecter(seed = 5): { sim: Sim; pid: number; meta: PlayerMeta } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  for (const c of PERFECTING_ATTEMPT_COST) sim.addItem(c.itemId, 8, pid);
  sim.addItem(APEX_NECK, 1, pid);
  sim.drainEvents();
  return { sim, pid, meta };
}

function bagRefOf(meta: PlayerMeta, itemId: string): { bag: number; itemId: string } {
  const bag = meta.inventory.findIndex((s) => s.itemId === itemId);
  expect(bag).toBeGreaterThanOrEqual(0);
  return { bag, itemId };
}

describe('Perfecting attempts emit one craftRoll audit record per resolved roll', () => {
  it('a failed attempt records the roll, the chance, success false, and an unmoved rank', () => {
    const { sim, pid, meta } = perfecter(11);
    const draws = forceRoll(sim, 0.95);
    sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
    expect(draws(), 'the audit adds no draw').toBe(1);
    const rolls = craftRollsOf(sim);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toEqual({
      type: 'craftRoll',
      kind: 'perfecting',
      recipeId: `recipe_${APEX_NECK}`,
      itemId: APEX_NECK,
      roll: 0.95,
      chance: PERFECTING_SUCCESS_CHANCE,
      success: false,
      rankBefore: 0,
      rankAfter: 0,
      pid,
    });
  });

  it('a successful attempt records success true and the rank walked to', () => {
    const { sim, pid, meta } = perfecter(12);
    const draws = forceRoll(sim, 0.1);
    sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
    expect(draws()).toBe(1);
    const rolls = craftRollsOf(sim);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      kind: 'perfecting',
      roll: 0.1,
      chance: PERFECTING_SUCCESS_CHANCE,
      success: true,
      rankBefore: 0,
      rankAfter: 1,
    });
    // The record and the piece agree.
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBe(1);
  });

  it('the record tracks the whole walk: the final rank reads PERFECTING_RANKS (Perfected)', () => {
    const { sim, pid, meta } = perfecter(13);
    forceRoll(sim, 0.1);
    const ranks: Array<[number, number]> = [];
    for (let i = 0; i < PERFECTING_RANKS; i++) {
      sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
      const rolls = craftRollsOf(sim);
      expect(rolls, 'exactly one record per attempt').toHaveLength(1);
      ranks.push([rolls[0].rankBefore as number, rolls[0].rankAfter as number]);
    }
    expect(ranks).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, PERFECTING_RANKS],
    ]);
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfected).toBe(true);
  });

  it('the roll and chance are the exact values the success branch compared', () => {
    // The boundary: a roll equal to the chance is the fail arm (strict
    // less-than), and the record says so with the same two numbers.
    const { sim, pid, meta } = perfecter(14);
    forceRoll(sim, PERFECTING_SUCCESS_CHANCE);
    sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
    const [ev] = craftRollsOf(sim);
    expect(ev.roll).toBe(PERFECTING_SUCCESS_CHANCE);
    expect(ev.chance).toBe(PERFECTING_SUCCESS_CHANCE);
    expect(ev.success).toBe(false);
    expect(ev.success).toBe(ev.roll < ev.chance);
  });

  it('a denied attempt emits no record (nothing was rolled)', () => {
    const { sim, pid, meta } = perfecter(15);
    meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ - 1;
    const draws = forceRoll(sim, 0.1);
    sim.perfectItemAs(pid, bagRefOf(meta, APEX_NECK));
    expect(draws()).toBe(0);
    expect(craftRollsOf(sim)).toEqual([]);
  });
});

describe('masterwork proc draws emit one craftRoll audit record per eligible craft', () => {
  /** An apex crafter at the recipe's station with the bill in hand (the
   *  perfecting.test.ts apexCrafter shape). */
  const apexCrafter = (seed: number, activeArchetype: string | null) => {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.archetype.activeArchetype = activeArchetype;
    const recipe = recipeById(`recipe_${APEX_NECK}`);
    if (!recipe) throw new Error('the apex neck recipe exists');
    if (recipe.stationType) {
      const station = stationsOfType(STATIONS, recipe.stationType as StationType)[0];
      const e = sim.entities.get(pid) as Entity;
      e.pos.x = station.pos.x;
      e.pos.z = station.pos.z;
      e.prevPos = { ...e.pos };
    }
    meta.knownRecipes?.add(recipe.id);
    for (const g of recipe.reagents) sim.addItem(g.itemId, g.count, pid);
    sim.drainEvents();
    return { sim, pid, meta, recipe };
  };

  it('a forced proc records success true against the effective chance, one draw', () => {
    const { sim, pid, meta, recipe } = apexCrafter(7, 'jewelcrafting');
    const draws = forceRoll(sim, 0);
    runCraft(sim, recipe.id, false, pid);
    expect(draws(), 'exactly the one proc draw').toBe(1);
    const rolls = craftRollsOf(sim);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      kind: 'masterwork',
      recipeId: recipe.id,
      itemId: APEX_NECK,
      roll: 0,
      success: true,
      pid,
    });
    expect(rolls[0].chance).toBeGreaterThan(0);
    expect(rolls[0].chance).toBeLessThanOrEqual(MASTERWORK_CHANCE_CAP);
    expect(rolls[0].rankBefore, 'a craft roll walks no rank').toBeUndefined();
    // The record and the piece agree (the apex proc is the head start).
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBe(PERFECTING_HEADSTART_RANK);
  });

  it('a forced miss records success false with the same chance', () => {
    expect(MASTERWORK_CHANCE_CAP).toBeLessThan(0.999);
    const { sim, pid, recipe } = apexCrafter(8, 'jewelcrafting');
    const draws = forceRoll(sim, 0.999);
    runCraft(sim, recipe.id, false, pid);
    expect(draws()).toBe(1);
    const [ev] = craftRollsOf(sim);
    expect(ev).toMatchObject({ kind: 'masterwork', roll: 0.999, success: false });
    expect(ev.chance).toBeGreaterThan(0);
    expect(ev.success).toBe(ev.roll < ev.chance);
  });

  it('a non-apex craft that bakes a bonus record (the quality-bump proc) records its roll too', () => {
    // The bonusStats arm of the emit guard, distinct from the apex arm above:
    // dropping it would silently stop recording every ordinary masterwork.
    const sim = new Sim({ seed: 53, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
    sim.addItem('spider_leg', 1, pid);
    sim.addItem('homespun_cloth', 3, pid);
    sim.addItem('spool_of_thread', 5, pid);
    sim.drainEvents();
    const draws = forceRoll(sim, 0);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    expect(draws()).toBe(1);
    const rolls = craftRollsOf(sim);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      kind: 'masterwork',
      recipeId: 'recipe_eastbrook_ritual_vestments',
      itemId: 'eastbrook_ritual_vestments',
      roll: 0,
      success: true,
      pid,
    });
    expect(rolls[0].chance).toBeGreaterThan(0);
    const slot = meta.inventory.find((s) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slot?.instance?.rolled?.masterwork, 'the record and the piece agree').toBe(true);
  });

  it('a craft whose output can never proc (a statless consumable) records nothing', () => {
    const sim = new Sim({ seed: 54, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    sim.addItem('linen_scrap', 1, pid);
    sim.addItem('spider_leg', 1, pid);
    sim.addItem('silverleaf_herb', 2, pid);
    sim.drainEvents();
    const draws = forceRoll(sim, 0);
    runCraft(sim, 'recipe_minor_healing_potion', false, pid);
    expect(meta.lastCraftResult?.ok, 'the craft itself succeeded').toBe(true);
    expect(draws(), 'the proc draw is unconditional on the success path').toBe(1);
    expect(craftRollsOf(sim)).toEqual([]);
  });

  it('an effect-gated craft (under the rare ceiling) records chance 0 and success false', () => {
    // No archetype reads the rare ceiling, so the head start never grants;
    // the audit says why in numbers: the effective chance was 0.
    const { sim, pid, meta, recipe } = apexCrafter(9, null);
    const draws = forceRoll(sim, 0);
    runCraft(sim, recipe.id, false, pid);
    expect(draws()).toBe(1);
    const [ev] = craftRollsOf(sim);
    expect(ev).toMatchObject({ kind: 'masterwork', roll: 0, chance: 0, success: false });
    const slot = meta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(slot?.instance?.perfecting).toBeUndefined();
  });
});
