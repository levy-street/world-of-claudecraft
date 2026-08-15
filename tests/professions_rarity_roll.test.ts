import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  MATERIAL_RARITY_MAX_PROFICIENCY,
  type MaterialRarity,
  resolveHarvest,
  rollMaterialRarity,
} from '../src/sim/professions/gathering';
import { canGatherTier, slotEffect, type ToolEffectSlot } from '../src/sim/professions/tools';
import { Rng } from '../src/sim/rng';
import { type PlayerMeta, Sim } from '../src/sim/sim';

const TIERS: MaterialRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function tally(proficiency: number, trials: number, seed: number): Record<MaterialRarity, number> {
  const rng = new Rng(seed);
  const counts: Record<MaterialRarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
  };
  for (let i = 0; i < trials; i++) {
    counts[rollMaterialRarity(proficiency, rng)]++;
  }
  return counts;
}

describe('material rarity roll (#1122)', () => {
  it('is a pure function of (proficiency, rng): same seed and proficiency reproduce identical results', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const rollsA = Array.from({ length: 50 }, () => rollMaterialRarity(40, a));
    const rollsB = Array.from({ length: 50 }, () => rollMaterialRarity(40, b));
    expect(rollsA).toEqual(rollsB);
  });

  it('draws exactly one rng value per roll', () => {
    let draws = 0;
    const rng = new Rng(1);
    rng.setObserver(() => {
      draws++;
    });
    rollMaterialRarity(50, rng);
    expect(draws).toBe(1);
  });

  it('a denied harvest never draws rng (the roll happens only on a grant)', () => {
    // The roll pulls from the SHARED sim rng, so a draw on a denial would
    // advance the whole sim's rng stream and desync everything downstream.
    // Pin the ordering: readiness is checked before any draw.
    const node = GATHER_NODES[0];
    // Only the fields resolveHarvest touches; the full PlayerMeta shape is not
    // needed for this leaf-level pin (same convention as AnySim/AnyEntity).
    // `inventory` is one of those fields since D8: the material grade is
    // resolved from the player's best matching tool.
    const meta = {
      gatheringProficiency: { mining: 50, logging: 50, herbalism: 50 },
      nodeHarvestReadyAt: { [node.id]: 1000 },
      pendingGatherGrants: [],
      inventory: [{ itemId: 'copper_mining_pick', count: 1 }],
    } as unknown as PlayerMeta;
    let draws = 0;
    const rng = new Rng(1);
    rng.setObserver(() => {
      draws++;
    });
    const denied = resolveHarvest(meta, node, 500, rng);
    expect(denied.granted).toBe(false);
    expect(denied.rarity).toBeUndefined();
    expect(denied.qty).toBeUndefined();
    expect(denied.rareEvent).toBeUndefined();
    expect(draws).toBe(0);
    // The same rng then serves the granted path with exactly TWO draws (the
    // pinned draw-order contract: draw #1 rollMaterialRarity, draw #2
    // rollGatherRareEvent; see tests/gather_rare_events.test.ts for the
    // order pin).
    const granted = resolveHarvest(meta, node, 1000, rng);
    expect(granted.granted).toBe(true);
    expect(draws).toBe(2);
  });

  it('the proficiency ceiling is pinned to 100', () => {
    // Load-bearing tuning constant: the proficiency at which rarity odds cap
    // and the scale of the common weight. Every other test consumes it as an
    // argument, which any value would satisfy, so pin the literal here.
    expect(MATERIAL_RARITY_MAX_PROFICIENCY).toBe(100);
  });

  it('at proficiency 0, every roll is common', () => {
    const counts = tally(0, 2000, 42);
    expect(counts.common).toBe(2000);
    expect(counts.uncommon + counts.rare + counts.epic + counts.legendary).toBe(0);
  });

  it('a negative or NaN proficiency clamps the same as 0 (every roll is common)', () => {
    const negative = tally(-50, 500, 42);
    expect(negative.common).toBe(500);
    // NaN survives Math.max/Math.min, so the clamp pins it to 0 explicitly; an
    // unclamped NaN would fail every weight comparison and land legendary.
    const nan = tally(Number.NaN, 500, 42);
    expect(nan.common).toBe(500);
    expect(nan).toEqual(negative);
  });

  it('at high proficiency, non-trivial chances of uncommon, rare, epic, and legendary appear', () => {
    const counts = tally(MATERIAL_RARITY_MAX_PROFICIENCY, 20000, 99);
    // Exact fixed-seed pin, matching the documented weight shares at p=100
    // (common 0, uncommon 60, rare 30, epic 8, legendary 2 out of 100).
    expect(counts).toEqual({ common: 0, uncommon: 11958, rare: 6026, epic: 1617, legendary: 399 });
  });

  it('at mid proficiency, the fixed-seed tally matches the documented weight shift', () => {
    const counts = tally(50, 20000, 123);
    // Exact fixed-seed pin at p=50 (common 50, uncommon 30, rare 15, epic 4,
    // legendary 1 out of 100). Unlike the p=max pin above, this distribution
    // shifts if MATERIAL_RARITY_MAX_PROFICIENCY or any share changes, so it
    // pins the mid-ladder shape the monotonic sweep only bounds loosely.
    expect(counts).toEqual({ common: 9952, uncommon: 6009, rare: 3050, epic: 761, legendary: 228 });
  });

  it('proficiency above the max clamps to the max (identical distribution)', () => {
    const atMax = tally(MATERIAL_RARITY_MAX_PROFICIENCY, 5000, 11);
    const overMax = tally(MATERIAL_RARITY_MAX_PROFICIENCY * 10, 5000, 11);
    expect(overMax).toEqual(atMax);
  });

  it('higher proficiency strictly does not decrease the chance of every non-common tier', () => {
    const sampleProficiencies = [0, 10, 25, 50, 75, 100];
    const trials = 40000;
    const seed = 2024;
    let prevRates: Record<MaterialRarity, number> | null = null;
    for (const p of sampleProficiencies) {
      const counts = tally(p, trials, seed);
      const rates = Object.fromEntries(TIERS.map((t) => [t, counts[t] / trials])) as Record<
        MaterialRarity,
        number
      >;
      if (prevRates) {
        for (const tier of ['uncommon', 'rare', 'epic', 'legendary'] as const) {
          // Generous tolerance for sampling noise: a strictly monotonic formula
          // should never regress by more than a hair below the previous sample.
          expect(rates[tier]).toBeGreaterThanOrEqual(prevRates[tier] - 0.01);
        }
      }
      prevRates = rates;
    }
  });

  it('the weight formula keeps the tier set fixed to the standard item rarity ladder minus poor', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const tier = rollMaterialRarity(50, rng);
      expect(TIERS).toContain(tier);
    }
  });
});

// A slotted tool effect must be invisible to the rng stream. The harvest path
// is pinned at exactly two draws per granted harvest and zero on a denial, and
// that pin is only worth having if it holds for EVERY player: an effect that
// spent a draw would mean two players standing at the same vein walked
// different streams depending on what one of them had slotted.
describe('a slotted tool effect changes the yield and never the draw stream', () => {
  const ORE_NODE = GATHER_NODES.find((n) => n.type === 'ore' && n.zoneId === 'eastbrook_vale');

  function metaWith(slot?: ToolEffectSlot): PlayerMeta {
    return {
      gatheringProficiency: { mining: 50, logging: 50, herbalism: 50 },
      nodeHarvestReadyAt: {},
      pendingGatherGrants: [],
      inventory: [{ itemId: 'copper_mining_pick', count: 1 }],
      ...(slot ? { toolEffectSlots: { mining: slot } } : {}),
    } as unknown as PlayerMeta;
  }

  function drawsFor(slot: ToolEffectSlot | undefined, seed: number): number[] {
    const values: number[] = [];
    const rng = new Rng(seed);
    rng.setObserver((v) => values.push(v));
    resolveHarvest(metaWith(slot), ORE_NODE!, 0, rng);
    rng.setObserver(null);
    return values;
  }

  it('draws the same VALUES, not merely the same count, with and without a slot', () => {
    if (!ORE_NODE) throw new Error('no eastbrook ore node');
    const without = drawsFor(undefined, 4242);
    expect(without).toHaveLength(2); // the pinned contract itself
    // The charm row below builds a state the live game can no longer reach
    // (R9 refuses it at the mint and drops it at load); it stays as defense
    // in depth for the slotEffect leaf itself, not as live-path coverage, so
    // do not delete it as dead or mistake it for one.
    for (const effectId of ['gatherers_cache', 'artisans_eye', 'quickening_charm'] as const) {
      const withSlot = drawsFor(slotEffect(effectId, { toolRarity: 'epic' }), 4242);
      expect(withSlot, `${effectId} moved the stream`).toEqual(without);
    }
  });

  it('a denial still draws nothing when an effect is slotted', () => {
    if (!ORE_NODE) throw new Error('no eastbrook ore node');
    const meta = metaWith(slotEffect('gatherers_cache'));
    meta.nodeHarvestReadyAt[ORE_NODE.id] = 1000;
    let draws = 0;
    const rng = new Rng(7);
    rng.setObserver(() => {
      draws += 1;
    });
    const result = resolveHarvest(meta, ORE_NODE, 0, rng);
    rng.setObserver(null);
    expect(result.granted).toBe(false);
    expect(draws).toBe(0);
    // And the refused harvest spent no charge either.
    expect(meta.toolEffectSlots?.mining?.durability).toBe(slotEffect('gatherers_cache').durability);
  });

  it('a quantity effect adds units at the resolver and spends NOTHING there (R42)', () => {
    if (!ORE_NODE) throw new Error('no eastbrook ore node');
    const plain = resolveHarvest(metaWith(), ORE_NODE, 0, new Rng(4242));
    const slot = slotEffect('gatherers_cache', { toolRarity: 'rare' });
    const before = slot.durability;
    const meta = metaWith(slot);
    const bonused = resolveHarvest(meta, ORE_NODE, 0, new Rng(4242));
    expect(bonused.qty).toBe((plain.qty ?? 0) + 1);
    // The charge settle moved to the command boundary, which alone can see
    // whether the extra unit survived capacity truncation (R42): the bare
    // resolver never spends, and it hands the boundary the same-draw
    // counterfactual instead. The boundary-side spend and keep arms live in
    // tests/gather_node_harvest.test.ts.
    expect(slot.durability).toBe(before);
    expect(bonused.effectApplied).toBe(true);
    expect(bonused.baseQty).toBe(plain.qty);
    expect(bonused.baseItemId).toBe(plain.itemId);
  });

  it('a quality effect yields the fine grade, and still opens no node the tool cannot', () => {
    if (!ORE_NODE) throw new Error('no eastbrook ore node');
    // A tier-1 pick at a tier-1 Eastbrook vein does NOT outclass the material,
    // so the plain grade is what it yields. The quality effect is what tips it.
    const plain = resolveHarvest(metaWith(), ORE_NODE, 0, new Rng(4242));
    expect(plain.itemId).toBe('copper_ore');
    const withEye = resolveHarvest(
      metaWith(slotEffect('artisans_eye')),
      ORE_NODE,
      0,
      new Rng(4242),
    );
    expect(withEye.itemId).toBe('fine_copper_ore');
    // Access is untouched, proven through the REAL command rather than the
    // helper in isolation: the old pin here called canGatherTier(1, 2), which
    // stays false even if harvestNode started feeding the BOOSTED tier into
    // the access gate, the exact regression it claimed to guard. Drive the
    // command: a tier-1 pick with a slotted quality effect at a tier-2 vein
    // must be denied at harvestNode, with the denial naming the real tier.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Access');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const slotted = (sim.players.get(pid) as PlayerMeta).toolEffectSlots?.mining;
    expect(slotted?.effectId, 'the effect really is slotted').toBe('artisans_eye');
    const t2 = GATHER_NODES.find((n) => n.id === 'ore_mirefen_t2');
    if (!t2) throw new Error('missing ore_mirefen_t2');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player entity');
    p.pos.x = t2.pos.x;
    p.pos.z = t2.pos.z;
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    expect(sim.harvestNode(t2.id, undefined, pid)).toBe(false);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid, surface: 'node', professionId: 'mining', requiredTier: 2 },
    ]);
    // The helper-level statement of the same separation still holds.
    expect(canGatherTier(1, 2)).toBe(false);
  });
});
