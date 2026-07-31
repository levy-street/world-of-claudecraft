import { describe, expect, it } from 'vitest';
import { checkAssembly, heldCount } from '../src/sim/assembly';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { AssemblyRecipe, Entity, InvSlot, PlayerClass, SimEvent } from '../src/sim/types';

// The Assemble action: the pure reagent check (src/sim/assembly.ts) and the sim
// command that spends them (src/sim/items.ts assembleItem). The command half drives
// the real Sim delegate, so the inventory hub, capacity gate and stat rebuild are
// the shipped ones.

const FINGERS = [
  'st_albus_index_finger',
  'st_albus_middle_finger',
  'st_albus_ring_finger',
  'st_albus_pinkie_finger',
  'st_albus_thumb',
] as const;

const RECIPE: AssemblyRecipe = {
  reagents: [
    { itemId: 'a', count: 1 },
    { itemId: 'b', count: 2 },
  ],
  output: { itemId: 'out', count: 1 },
  failText: 'Not yet.',
};

const slot = (itemId: string, count = 1): InvSlot => ({ itemId, count });

function metaOf(sim: Sim, pid: number) {
  return (
    sim as unknown as {
      players: Map<number, { inventory: InvSlot[]; cls: PlayerClass; equipment: object }>;
    }
  ).players.get(pid)!;
}

function logTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
    .map((e) => e.text);
}

// A world with no ambient content: these tests only need a player and their bags.
function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function playerWithBags(sim: Sim, stacks: InvSlot[]) {
  const pid = sim.addPlayer('warrior', 'Aleph');
  const meta = metaOf(sim, pid);
  meta.inventory.length = 0;
  meta.inventory.push(...stacks);
  sim.drainEvents();
  return { pid, meta };
}

describe('checkAssembly', () => {
  it('passes when every reagent is held at or above its count', () => {
    expect(checkAssembly([slot('a'), slot('b', 2)], RECIPE)).toEqual({ ok: true, missing: [] });
    expect(checkAssembly([slot('a', 9), slot('b', 9)], RECIPE).ok).toBe(true);
  });

  it('reports each shortfall with what is required and what is held', () => {
    const result = checkAssembly([slot('b', 1)], RECIPE);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      { itemId: 'a', required: 1, held: 0 },
      { itemId: 'b', required: 2, held: 1 },
    ]);
  });

  it('counts a reagent split across several stacks', () => {
    expect(checkAssembly([slot('a'), slot('b'), slot('b')], RECIPE).ok).toBe(true);
  });

  it('ignores an emptied stack', () => {
    expect(heldCount([slot('a', 0), slot('a', 3)], 'a')).toBe(3);
    expect(checkAssembly([slot('a', 0), slot('b', 2)], RECIPE).ok).toBe(false);
  });
});

describe('assembleItem (the sim command)', () => {
  it('consumes one of each finger and grants the hand', () => {
    const sim = makeSim();
    const { pid, meta } = playerWithBags(
      sim,
      FINGERS.map((id) => slot(id)),
    );
    sim.assembleItem('st_albus_index_finger', pid);
    for (const id of FINGERS) {
      expect(meta.inventory.some((s) => s.itemId === id)).toBe(false);
    }
    expect(meta.inventory.find((s) => s.itemId === 'hand_of_st_albus')?.count).toBe(1);
  });

  it('rebuilds the stat block, so the charm bonus applies without another action', () => {
    const sim = makeSim();
    const { pid } = playerWithBags(
      sim,
      FINGERS.map((id) => slot(id)),
    );
    const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!;
    const before = p.stats.str;
    sim.assembleItem('st_albus_index_finger', pid);
    expect(p.stats.str).toBe(before + 2);
  });

  it('answers a shortfall with the recipe text and consumes nothing', () => {
    const sim = makeSim();
    const held = [slot('st_albus_index_finger'), slot('st_albus_thumb')];
    const { pid, meta } = playerWithBags(sim, held);
    sim.assembleItem('st_albus_index_finger', pid);
    const events = sim.drainEvents();
    expect(logTexts(events)).toContain('The finger cries out for its brethren!');
    expect(events.some((e) => e.type === 'log' && e.pid === pid)).toBe(true);
    expect(meta.inventory.find((s) => s.itemId === 'st_albus_index_finger')?.count).toBe(1);
    expect(meta.inventory.find((s) => s.itemId === 'st_albus_thumb')?.count).toBe(1);
    expect(meta.inventory.some((s) => s.itemId === 'hand_of_st_albus')).toBe(false);
  });

  it('takes only one copy of each finger, leaving spares in the bags', () => {
    const sim = makeSim();
    const { pid, meta } = playerWithBags(sim, [
      slot('st_albus_index_finger', 3),
      slot('st_albus_middle_finger'),
      slot('st_albus_ring_finger'),
      slot('st_albus_pinkie_finger'),
      slot('st_albus_thumb', 2),
    ]);
    sim.assembleItem('st_albus_index_finger', pid);
    expect(meta.inventory.find((s) => s.itemId === 'st_albus_index_finger')?.count).toBe(2);
    expect(meta.inventory.find((s) => s.itemId === 'st_albus_thumb')?.count).toBe(1);
    expect(meta.inventory.find((s) => s.itemId === 'hand_of_st_albus')?.count).toBe(1);
  });

  it('can be driven from any piece of the set, not just the first', () => {
    const sim = makeSim();
    const { pid, meta } = playerWithBags(
      sim,
      FINGERS.map((id) => slot(id)),
    );
    sim.assembleItem('st_albus_thumb', pid);
    expect(meta.inventory.find((s) => s.itemId === 'hand_of_st_albus')?.count).toBe(1);
  });

  it('does nothing for an item that carries no recipe', () => {
    const sim = makeSim();
    const { pid, meta } = playerWithBags(sim, [slot('worn_sword')]);
    sim.assembleItem('worn_sword', pid);
    expect(meta.inventory).toEqual([slot('worn_sword')]);
  });

  it('refuses when the player does not hold the piece they invoked', () => {
    const sim = makeSim();
    const { pid, meta } = playerWithBags(sim, []);
    sim.assembleItem('st_albus_index_finger', pid);
    expect(sim.drainEvents().some((e) => e.type === 'error' && e.pid === pid)).toBe(true);
    expect(meta.inventory).toEqual([]);
  });
});

describe('the shipped St. Albus collection', () => {
  it('every finger carries the same five-piece recipe and refusal', () => {
    for (const id of FINGERS) {
      const recipe = ITEMS[id].assembly;
      expect(recipe, `${id} has no assembly recipe`).toBeDefined();
      expect(recipe?.reagents.map((r) => r.itemId)).toEqual([...FINGERS]);
      expect(recipe?.reagents.every((r) => r.count === 1)).toBe(true);
      expect(recipe?.output).toEqual({ itemId: 'hand_of_st_albus', count: 1 });
      expect(recipe?.failText).toBe('The finger cries out for its brethren!');
    }
  });

  it('the pieces are epic artifacts worth a gold, and the hand carries no recipe', () => {
    for (const id of FINGERS) {
      expect(ITEMS[id].kind).toBe('artifact');
      expect(ITEMS[id].quality).toBe('epic');
      expect(ITEMS[id].sellValue).toBe(10000);
    }
    expect(ITEMS.hand_of_st_albus.assembly).toBeUndefined();
  });

  it('every shipped recipe carries a real refusal and a resolvable output', () => {
    // failText is a required field, so it cannot be forgotten, but it CAN be
    // satisfied with an empty string, which would refuse an assembly with a blank
    // chat line and no explanation. Checked across the whole catalog rather than
    // this collection, so a future recipe inherits the guarantee.
    const recipes = Object.values(ITEMS).flatMap((item) =>
      item.assembly ? [[item.id, item.assembly] as const] : [],
    );
    expect(recipes.length).toBeGreaterThan(0);
    for (const [id, recipe] of recipes) {
      expect(recipe.failText.trim(), `${id} must explain why it will not assemble`).not.toBe('');
      expect(recipe.reagents.length, `${id} must consume something`).toBeGreaterThan(0);
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId], `${id} reagent ${reagent.itemId} must exist`).toBeTruthy();
        expect(reagent.count, `${id} reagent ${reagent.itemId} count`).toBeGreaterThan(0);
      }
      expect(ITEMS[recipe.output.itemId], `${id} output must exist`).toBeTruthy();
      expect(recipe.output.count, `${id} output count`).toBeGreaterThan(0);
    }
  });

  it('binds the assembled hand but leaves the pieces tradeable', () => {
    // The pieces trade so a collector can buy the boss that will not drop for
    // them; the charm they assemble into stays with the character that earned it.
    expect(ITEMS.hand_of_st_albus.soulbound).toBe(true);
    for (const id of FINGERS) {
      expect(ITEMS[id].soulbound, `${id} should stay tradeable`).toBeUndefined();
    }
  });

  it('drops one finger per HEROIC final boss, in clear order, at 1% each', () => {
    // Difficulty order: Hollow Crypt (10), Sunken Bastion (13), Drowned Temple (18),
    // Gravewyrm Sanctum (20), then the ten-player raid finale.
    const sources: [string, string][] = [
      ['morthen', 'st_albus_index_finger'],
      ['vael_the_mistcaller', 'st_albus_middle_finger'],
      ['ysolei', 'st_albus_ring_finger'],
      ['korzul_the_gravewyrm', 'st_albus_pinkie_finger'],
      ['nythraxis_scourge_of_thornpeak', 'st_albus_thumb'],
    ];
    for (const [mobId, itemId] of sources) {
      const entries = (HEROIC_BOSS_LOOT[mobId] ?? []).filter((e) => e.itemId === itemId);
      expect(entries, `heroic ${mobId} should drop ${itemId}`).toHaveLength(1);
      expect(entries[0].chance).toBe(0.01);
      // An independent draw, never a slot in a guaranteed *_heroic group.
      expect(entries[0].rollGroup).toBeUndefined();
    }
  });

  it('never drops a finger on a normal difficulty table', () => {
    // The whole ladder is heroic-gated: a finger on any mob's normal loot would
    // open a route that skips the difficulty entirely.
    for (const id of FINGERS) {
      const droppers = Object.values(MOBS).filter((m) =>
        (m.loot ?? []).some((e) => e.itemId === id),
      );
      expect(
        droppers.map((m) => m.id),
        `${id} must not drop on a normal table`,
      ).toEqual([]);
    }
    // And exactly one heroic source each, so no boss is a second route to a piece.
    for (const id of FINGERS) {
      const heroicSources = Object.entries(HEROIC_BOSS_LOOT).filter(([, entries]) =>
        entries.some((e) => e.itemId === id),
      );
      expect(
        heroicSources.map(([mobId]) => mobId),
        `${id} should have one source`,
      ).toHaveLength(1);
    }
  });

  it('never pushes a shared roll group past a full partition', () => {
    // A rollGroup is one partitioned draw, so its chances must not sum past 1.0 or
    // the tail entries become unreachable.
    const sums = new Map<string, number>();
    for (const mob of Object.values(MOBS)) {
      for (const entry of mob.loot ?? []) {
        if (!entry.rollGroup) continue;
        const key = `${mob.id}:${entry.rollGroup}`;
        sums.set(key, (sums.get(key) ?? 0) + entry.chance);
      }
    }
    for (const [key, sum] of sums) {
      expect(sum, `${key} sums past a full partition`).toBeLessThanOrEqual(1.0000001);
    }
  });

  it('is excluded from the vendor junk sweep and the disenchant/salvage paths', () => {
    // Both gates are quality/kind based: the sweep takes only 'poor', and
    // disenchant/salvage only weapons and armor. Pinned so a later quality edit
    // cannot quietly make a collection piece auto-sellable.
    for (const id of [...FINGERS, 'hand_of_st_albus']) {
      expect(ITEMS[id].quality).not.toBe('poor');
      expect(['weapon', 'armor']).not.toContain(ITEMS[id].kind);
    }
  });
});
