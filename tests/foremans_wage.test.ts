// The Foreman's Wage and the reins: what makes a Balgath kill worth turning up for.
//
// Two claims a screenshot cannot show. The level gate on the wage rows has to be real in
// BOTH directions (a level eight receives wage gear and a level twenty never does), and the
// item-level derivation has to follow the gate rather than the boss, or three "level-13
// rares" silently budget and level-gate as level-20 loot the moment they land on his
// table. The mount row is pinned as the one world-boss mount path there is.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, ITEMS, MOBS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemLevel,
  itemSourceLevel,
  primaryStatSum,
} from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, LootEntry, WorldContent } from '../src/sim/types';

const BALGATH = 'balgath_cyclops';
const WAGE = ['foremans_wage_band', 'mirelight_locket', 'fenwright_grips'] as const;
const SPOILS = ['foremans_barrowmaul', 'barrowhide_pauldrons', 'mirestone_stride', 'loomshard_eye'];
const REINS = 'reins_drakemaw_raptor';

const WAGE_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function table(): LootEntry[] {
  const loot = MOBS[BALGATH]?.loot;
  if (!loot) throw new Error('balgath_cyclops has no loot table');
  return loot;
}

describe('the wage rows on his table', () => {
  it('are level-gated to the zone, one exclusive group, and listed before the epics', () => {
    const rows = table();
    const wage = rows.filter((r) => r.rollGroup === 'foremans_wage');
    expect(wage.map((r) => r.itemId).sort()).toEqual([...WAGE].sort());
    for (const row of wage) {
      // Mirefen Marsh is level 6 to 13: the gate IS the zone's top level.
      expect(row.maxPlayerLevel).toBe(13);
      expect(row.chance).toBe(0.3);
    }
    // Nine kills in ten pay a local something; never more than one (a partition).
    const total = wage.reduce((sum, r) => sum + r.chance, 0);
    expect(total).toBeCloseTo(0.9, 9);
    // Ordered first, so the one-gear-item cap hands a local the blue they can wear
    // rather than a level-20 epic they cannot.
    const firstWage = rows.findIndex((r) => r.rollGroup === 'foremans_wage');
    const firstSpoil = rows.findIndex((r) => r.rollGroup === 'balgath_spoils');
    expect(firstWage).toBeGreaterThanOrEqual(0);
    expect(firstWage).toBeLessThan(firstSpoil);
    // The epics themselves carry no gate: they are for everyone who fought.
    for (const row of rows.filter((r) => r.rollGroup === 'balgath_spoils')) {
      expect(row.maxPlayerLevel).toBeUndefined();
    }
  });

  it('carries the reins as an ungrouped one-percent personal draw for everyone', () => {
    const row = table().find((r) => r.itemId === REINS);
    expect(row).toBeDefined();
    expect(row?.chance).toBe(0.01);
    expect(row?.rollGroup).toBeUndefined();
    expect(row?.maxPlayerLevel).toBeUndefined();
    expect(ITEMS[REINS]?.kind).toBe('mount');
  });

  it('keeps the wage items on exactly one table, so the gate stays their only source', () => {
    // item_level.ts keeps the HIGHEST source across every table an item sits on, so a second
    // ungated table anywhere would silently re-level all three back to that source's level.
    for (const id of WAGE) {
      const tables = Object.values(MOBS).filter((m) => m.loot.some((r) => r.itemId === id));
      expect(
        tables.map((m) => m.id),
        id,
      ).toEqual([BALGATH]);
    }
  });

  it('is the only table in the game using the personal level gate', () => {
    // The gate is honored by rollWorldBossLoot alone; an ordinary mob's rollLoot ignores
    // it, so a gated row anywhere else would be a silent no-op.
    for (const mob of Object.values(MOBS)) {
      for (const row of mob.loot) {
        if (row.maxPlayerLevel === undefined) continue;
        expect(mob.worldBoss, `${mob.id} gates ${row.itemId} but is not a world boss`).toBe(true);
      }
    }
  });
});

describe('the wage items are level-13 content, not re-levelled boss loot', () => {
  it('derives its source level from the gate, and levels and budgets as ilvl 16 rares', () => {
    for (const id of WAGE) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(item.quality).toBe('rare');
      expect(itemSourceLevel(id), `${id} source level`).toBe(13);
      expect(itemLevel(item), `${id} item level`).toBe(16);
      // Budget-exact, so the level-band sweep stays honest for this tier too.
      expect(primaryStatSum(item), `${id} budget`).toBe(expectedStatBudget(item));
      // The classic blue rule (item level minus five), written down as the explicit
      // override the derivation would otherwise put at the source level (13).
      expect(requiredLevelFor(item), `${id} required level`).toBe(11);
    }
    // And the epics still derive from the boss himself.
    for (const id of SPOILS) expect(itemSourceLevel(id), id).toBe(20);
  });
});

describe('the personal roll honors the gate in both directions', () => {
  function world() {
    const sim = new Sim({
      seed: 11,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      world: WAGE_TEST_WORLD,
    });
    const lowbie = sim.addPlayer('rogue', 'Local');
    const raider = sim.addPlayer('warrior', 'Raider');
    sim.setPlayerLevel(8, lowbie);
    sim.setPlayerLevel(20, raider);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, 128, 262);
    const boss = sim.entities.get(id) as Entity;
    const metas = [lowbie, raider].map((pid) => sim.players.get(pid) as PlayerMeta);
    return { sim, boss, lowbie, raider, metas };
  }

  it('hands wage gear only to the local, epics to anyone, and never two gear pieces', () => {
    const { sim, boss, lowbie, metas } = world();
    const roll = (sim as unknown as { rollWorldBossLoot(m: Entity, c: PlayerMeta[]): void })
      .rollWorldBossLoot;
    const counts = { lowbieWage: 0, lowbieEpic: 0, raiderWage: 0, raiderEpic: 0, reins: 0 };
    for (let kill = 0; kill < 400; kill++) {
      boss.loot = { copper: 0, items: [] };
      boss.lootable = false;
      roll.call(sim, boss, metas);
      const perPlayer = new Map<number, string[]>();
      for (const slot of boss.loot.items) {
        for (const pid of slot.personalFor ?? []) {
          const list = perPlayer.get(pid) ?? [];
          list.push(slot.itemId);
          perPlayer.set(pid, list);
        }
      }
      for (const [pid, items] of perPlayer) {
        const wage = items.filter((i) => (WAGE as readonly string[]).includes(i)).length;
        const epic = items.filter((i) => SPOILS.includes(i)).length;
        // At most ONE gear item per contributor per kill, whichever group it came from.
        expect(wage + epic, `kill ${kill}: two gear items for ${pid}`).toBeLessThanOrEqual(1);
        if (pid === lowbie) {
          counts.lowbieWage += wage;
          counts.lowbieEpic += epic;
        } else {
          counts.raiderWage += wage;
          counts.raiderEpic += epic;
        }
        counts.reins += items.filter((i) => i === REINS).length;
      }
    }
    // The gate, both ways, over enough kills that a leak of either kind would show.
    expect(counts.raiderWage).toBe(0);
    expect(counts.lowbieWage).toBeGreaterThan(300); // ~90% of 400
    // The wage roll is listed first, so the local's epic wins are the ~10% of kills the
    // wage roll missed; the raider's are the ordinary 38%.
    expect(counts.lowbieEpic).toBeGreaterThan(0);
    expect(counts.lowbieEpic).toBeLessThan(counts.raiderEpic);
    expect(counts.raiderEpic).toBeGreaterThan(100);
    // At 1% per contributor per kill, 800 draws produce a handful; zero would mean the row
    // is not being rolled at all.
    expect(counts.reins).toBeGreaterThan(0);
    expect(counts.reins).toBeLessThan(40);
  });
});
