// Regression coverage for #1608 ("Food and potions are rarely worth using"):
// eating now stacks with natural hp regen (combat/auras.ts updateRegen) instead
// of replacing it, and the potionHp/potionMana ladder (content/items.ts) is
// retuned to a documented target fraction of a reference class's HP/mana pool.
// See the design comment above `minor_healing_potion` in content/items.ts for
// the exact methodology this file pins.

import { describe, expect, it } from 'vitest';
import { updateRegen } from '../src/sim/combat/auras';
import { ZONE1_ZONE } from '../src/sim/content/zone1';
import { ZONE2_ZONE } from '../src/sim/content/zone2';
import { ZONE3_ZONE } from '../src/sim/content/zone3';
import { ITEMS } from '../src/sim/data';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Consuming, Entity } from '../src/sim/types';

function makeSim(cls: 'warrior' | 'priest' | 'hunter' | 'mage' = 'warrior', seed = 4242): Sim {
  return new Sim({ seed, playerClass: cls, autoEquip: false });
}

describe('#1608: eating stacks with natural hp regen', () => {
  // Real ctx.tickCount must be a multiple of 40 (the classic 2s regen tick) for
  // updateRegen's early-return to pass; build one real Sim per assertion so the
  // ctx (playerMods, healingTakenMult, ...) is the genuine seam, not a stub.
  function healOverOneTick(sim: Sim, stamina: number, eating: Consuming | null): number {
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.stats.sta = stamina;
    p.inCombat = false;
    p.maxHp = 1_000_000;
    p.hp = 500_000;
    p.eating = eating;
    sim.tickCount = 40;
    const hp0 = p.hp;
    updateRegen(sim.ctx, p, meta);
    return p.hp - hp0;
  }

  function foodTier(foodHp: number): Consuming {
    return {
      itemId: 'test_food',
      kind: 'food',
      hpPer2s: Math.round(foodHp / 9), // CONSUME_TICKS
      manaPer2s: 0,
      remaining: 18,
      ticksElapsed: 0,
    };
  }

  // The exact foodHp tiers named in the issue (61 = baked_bread/tier 1, 117 =
  // the best vendor/fished tier) plus the mid fished tiers and the conjured
  // ladder, so every content/items.ts foodHp value this fix touches is covered.
  const FOOD_TIERS = [45, 61, 90, 117, 243, 552, 980];

  it.each(FOOD_TIERS)(
    'a foodHp:%d tier heals strictly more per tick than standing idle, at every stamina',
    (foodHp) => {
      for (const sta of [0, 16, 20, 37, 50, 100, 300]) {
        const idle = healOverOneTick(makeSim(), sta, null);
        const eating = healOverOneTick(makeSim(), sta, foodTier(foodHp));
        expect(eating).toBeGreaterThan(idle);
      }
    },
  );

  // The issue's own reproduction numbers: tier-1 food (61 foodHp, ~7 hp/2s) used
  // to lose to natural regen from ~16 stamina, and the best vendor/fished tier
  // (117 foodHp, ~13 hp/2s) from ~37 stamina. Both crossover points, and well
  // past them, must now favor eating.
  it('the issue-reported crossover stamina values no longer favor standing idle', () => {
    for (const sta of [16, 37, 200]) {
      const idle = healOverOneTick(makeSim(), sta, null);
      const tier1 = healOverOneTick(makeSim(), sta, foodTier(61));
      const tierBest = healOverOneTick(makeSim(), sta, foodTier(117));
      expect(tier1).toBeGreaterThan(idle);
      expect(tierBest).toBeGreaterThan(idle);
    }
  });

  it('drinking already stacks with mana regen (the behavior food now matches)', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.resourceType = 'mana';
    p.maxResource = 1_000_000;
    p.resource = 500_000;
    p.fiveSecondRule = 10; // clears the mana-regen gate
    p.drinking = {
      itemId: 'test_drink',
      kind: 'drink',
      hpPer2s: 0,
      manaPer2s: 40,
      remaining: 18,
      ticksElapsed: 0,
    };
    sim.tickCount = 40;
    const r0 = p.resource;
    updateRegen(sim.ctx, p, meta);
    // Natural mana regen alone (no drink) for comparison.
    const sim2 = makeSim('mage');
    const p2 = sim2.player;
    const meta2 = sim2.players.get(p2.id) as PlayerMeta;
    p2.resourceType = 'mana';
    p2.maxResource = 1_000_000;
    p2.resource = 500_000;
    p2.fiveSecondRule = 10;
    p2.drinking = null;
    sim2.tickCount = 40;
    const r2_0 = p2.resource;
    updateRegen(sim2.ctx, p2, meta2);
    // Drinking healed for strictly more than the natural tick alone: the drink
    // tick landed ON TOP of natural regen, not instead of it.
    expect(p.resource - r0).toBeGreaterThan(p2.resource - r2_0);
  });

  // sim.ts's startCascadePlaytest/startDevSandbox freeze scripted allies' hp by
  // setting a zero-hpPer2s "eating" session (see the comment above updateRegen's
  // regen gate). That idiom must keep suppressing natural regen, or those dev
  // scenarios silently start healing on their own.
  it('a zero-hpPer2s eating session (the dev freeze idiom) still suppresses natural regen', () => {
    const sim = makeSim();
    sim.player.stats.sta = 100; // would otherwise regen a large, easily-observed amount
    const healed = healOverOneTick(sim, 100, {
      itemId: 'dev_freeze',
      kind: 'food',
      hpPer2s: 0,
      manaPer2s: 0,
      remaining: 1_000_000,
      ticksElapsed: 0,
    });
    expect(healed).toBe(0);
  });
});

describe('#1608: potionHp/potionMana ladder', () => {
  // The reference class per resource type is the one with the SMALLEST base
  // (no-gear) pool at that resource, per the design comment above
  // minor_healing_potion in content/items.ts: priest for hp, hunter for mana.
  function basePoolAt(
    cls: 'priest' | 'paladin',
    level: number,
  ): { maxHp: number; maxResource: number } {
    const sim = new Sim({ seed: 1, playerClass: cls, autoEquip: false, noPlayer: true });
    const pid = sim.addPlayer(cls, 'Ref');
    sim.setPlayerLevel(level, pid);
    const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid) as Entity;
    return { maxHp: p.maxHp, maxResource: p.maxResource };
  }

  // Non-null reads of the item table's optional potionHp/potionMana fields:
  // every id below is a real potion in content/items.ts or profession_items.ts,
  // so a missing field here is itself a real defect worth throwing on.
  function potionHp(itemId: string): number {
    const v = ITEMS[itemId].potionHp;
    if (v == null) throw new Error(`${itemId} has no potionHp`);
    return v;
  }
  function potionMana(itemId: string): number {
    const v = ITEMS[itemId].potionMana;
    if (v == null) throw new Error(`${itemId} has no potionMana`);
    return v;
  }

  const HP_TIERS: [string, number][] = [
    ['minor_healing_potion', ZONE1_ZONE.levelRange[1]],
    ['lesser_healing_potion', ZONE2_ZONE.levelRange[1]],
    ['healing_potion', ZONE3_ZONE.levelRange[1]],
  ];
  const MANA_TIERS: [string, number][] = [
    ['minor_mana_potion', ZONE1_ZONE.levelRange[1]],
    ['lesser_mana_potion', ZONE2_ZONE.levelRange[1]],
    ['mana_potion', ZONE3_ZONE.levelRange[1]],
  ];

  it.each(HP_TIERS)(
    "%s restores a meaningful, documented fraction (0.60-1.00) of a priest's base hp pool at its bracket top",
    (itemId, topLevel) => {
      const { maxHp } = basePoolAt('priest', topLevel);
      const fraction = potionHp(itemId) / maxHp;
      expect(fraction).toBeGreaterThanOrEqual(0.6);
      expect(fraction).toBeLessThanOrEqual(1.0);
    },
  );

  it.each(MANA_TIERS)(
    // Hunters run on focus on this line (the hunter overhaul), so the potion
    // floor's subject is the smallest MANA pool: the paladin.
    "%s restores a meaningful, documented fraction (0.55-0.85) of a paladin's base mana pool at its bracket top",
    (itemId, topLevel) => {
      const { maxResource } = basePoolAt('paladin', topLevel);
      const fraction = potionMana(itemId) / maxResource;
      expect(fraction).toBeGreaterThanOrEqual(0.55);
      expect(fraction).toBeLessThanOrEqual(0.85);
    },
  );

  it('each hp/mana tier is a strict upgrade over the previous tier', () => {
    expect(potionHp('lesser_healing_potion')).toBeGreaterThan(potionHp('minor_healing_potion'));
    expect(potionHp('healing_potion')).toBeGreaterThan(potionHp('lesser_healing_potion'));
    expect(potionMana('lesser_mana_potion')).toBeGreaterThan(potionMana('minor_mana_potion'));
    expect(potionMana('mana_potion')).toBeGreaterThan(potionMana('lesser_mana_potion'));
  });

  // Golden pin: catches an accidental future edit to the tuned ladder without a
  // deliberate matching change to this test's target-fraction assertions above.
  it('pins the exact retuned values', () => {
    expect(potionHp('minor_healing_potion')).toBe(110);
    expect(potionHp('lesser_healing_potion')).toBe(190);
    expect(potionHp('healing_potion')).toBe(320);
    expect(potionMana('minor_mana_potion')).toBe(145);
    expect(potionMana('lesser_mana_potion')).toBe(250);
    expect(potionMana('mana_potion')).toBe(410);
  });

  // The crafted alchemy ladder (profession_items.ts) documents itself as a
  // strict upgrade over the matching vendor tier; guard that relationship so a
  // future vendor retune can't silently invert it (#1608 moved both in lockstep).
  it('the crafted alchemy top tier stays a strict upgrade over the vendor top tier', () => {
    expect(potionHp('sunpetal_healing_draught')).toBeGreaterThan(potionHp('healing_potion'));
    expect(potionMana('sunpetal_mana_draught')).toBeGreaterThan(potionMana('mana_potion'));
    expect(potionHp('silverleaf_healing_draught')).toBeGreaterThan(
      potionHp('minor_healing_potion'),
    );
    expect(potionMana('silverleaf_mana_draught')).toBeGreaterThan(potionMana('minor_mana_potion'));
    expect(potionHp('goldleaf_healing_draught')).toBeGreaterThan(potionHp('lesser_healing_potion'));
    expect(potionMana('goldleaf_mana_draught')).toBeGreaterThan(potionMana('lesser_mana_potion'));
  });
});
