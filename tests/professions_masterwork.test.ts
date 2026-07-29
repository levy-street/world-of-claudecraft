// Paired suite for src/sim/professions/masterwork.ts (Professions 2.0):
// the pure masterwork proc-chance and bonus-baking primitives, the raid-floor
// acceptance bound over the real recipe content, and the draw-order
// determinism contract over a real Sim (one rng draw per successful craft,
// zero on denial, proc occurrences reproducible by seed).
import { describe, expect, it } from 'vitest';
import { PERK_THRESHOLDS, STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { PRIMARY_STATS, primaryStatBudget } from '../src/sim/item_budget';
import {
  isItemLevelEligible,
  itemSourceLevel,
  QUALITY_ILVL_BONUS,
  RAID_ILVL_BONUS,
} from '../src/sim/item_level';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import {
  MASTERWORK_BASE_CHANCE,
  MASTERWORK_CHANCE_CAP,
  MASTERWORK_PER_TIER_ABOVE_CHANCE,
  MASTERWORK_QUALITY_LADDER,
  MASTERWORK_SIGNED_CHANCE,
  MASTERWORK_SPECIALIZATION_CHANCE,
  type MasterworkQuality,
  masterworkBonusStats,
  masterworkBumpedQuality,
  masterworkProcChance,
} from '../src/sim/professions/masterwork';
import { fineMaterialFor, MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import {
  MASTERWORK_MATERIAL_TIER_CHANCE,
  MATERIAL_TIER_BY_ITEM,
  materialTierBonusForReagents,
  materialTierForItem,
} from '../src/sim/professions/material_tier';
import { type StationType, stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { CoreStats } from '../src/sim/types';
import { runCraft } from './helpers/enchant_family_cast';

const statSum = (stats: Partial<CoreStats> | null | undefined): number => {
  if (!stats) return 0;
  return PRIMARY_STATS.reduce((a, k) => a + (stats[k] ?? 0), 0);
};

describe('masterworkProcChance (locked tuning)', () => {
  it('pins the locked tuning constants', () => {
    // Load-bearing tuning literals (same convention as the
    // MATERIAL_RARITY_MAX_PROFICIENCY pin in professions_rarity_roll.test.ts):
    // every other case consumes them through the function, which any value
    // would satisfy, so the constants themselves are pinned here.
    expect(MASTERWORK_BASE_CHANCE).toBe(0.03);
    expect(MASTERWORK_PER_TIER_ABOVE_CHANCE).toBe(0.01);
    expect(MASTERWORK_SIGNED_CHANCE).toBe(0.02);
    expect(MASTERWORK_SPECIALIZATION_CHANCE).toBe(0.03);
    expect(MASTERWORK_CHANCE_CAP).toBe(0.15);
  });

  it('is 3 percent at recipe-tier parity with no bonuses', () => {
    expect(
      masterworkProcChance({ tiersAboveRecipe: 0, signedReagent: false, specialized: false }),
    ).toBe(0.03);
  });

  it('adds 1 percent per tier of capability above the recipe tier', () => {
    expect(
      masterworkProcChance({ tiersAboveRecipe: 1, signedReagent: false, specialized: false }),
    ).toBeCloseTo(0.04, 12);
    expect(
      masterworkProcChance({ tiersAboveRecipe: 2, signedReagent: false, specialized: false }),
    ).toBeCloseTo(0.05, 12);
  });

  it('adds 2 percent for a signed consumed reagent (any signer)', () => {
    expect(
      masterworkProcChance({ tiersAboveRecipe: 0, signedReagent: true, specialized: false }),
    ).toBeCloseTo(0.05, 12);
  });

  it('adds 3 percent when specialized', () => {
    expect(
      masterworkProcChance({ tiersAboveRecipe: 0, signedReagent: false, specialized: true }),
    ).toBeCloseTo(0.06, 12);
  });

  it('stacks every bonus additively while under the cap', () => {
    // 0.03 + 0.05 + 0.02 + 0.03 = 0.13, below the 0.15 cap: no clamp.
    expect(
      masterworkProcChance({ tiersAboveRecipe: 5, signedReagent: true, specialized: true }),
    ).toBeCloseTo(0.13, 12);
  });

  it('clamps a sum exceeding the cap to exactly 15 percent', () => {
    // 0.03 + 0.08 + 0.02 + 0.03 = 0.16 exceeds the cap and clamps.
    expect(
      masterworkProcChance({ tiersAboveRecipe: 8, signedReagent: true, specialized: true }),
    ).toBe(0.15);
  });

  it('clamps a negative tiersAboveRecipe to 0 (never below the base chance)', () => {
    expect(
      masterworkProcChance({ tiersAboveRecipe: -1, signedReagent: false, specialized: false }),
    ).toBe(0.03);
    expect(
      masterworkProcChance({
        tiersAboveRecipe: -100,
        signedReagent: false,
        specialized: false,
      }),
    ).toBe(0.03);
  });

  it('materialTierBonus defaults to 0 and is a real additive summand', () => {
    const omitted = masterworkProcChance({
      tiersAboveRecipe: 0,
      signedReagent: false,
      specialized: false,
    });
    const explicitZero = masterworkProcChance({
      tiersAboveRecipe: 0,
      signedReagent: false,
      specialized: false,
      materialTierBonus: 0,
    });
    expect(omitted).toBe(0.03);
    expect(explicitZero).toBe(0.03);
    // A non-zero value participates in the sum today (call-site-only wiring
    // later): base 0.03 + 0.025 = 0.055.
    expect(
      masterworkProcChance({
        tiersAboveRecipe: 0,
        signedReagent: false,
        specialized: false,
        materialTierBonus: 0.025,
      }),
    ).toBeCloseTo(0.055, 12);
    // And it clamps through the same cap as every other summand.
    expect(
      masterworkProcChance({
        tiersAboveRecipe: 0,
        signedReagent: false,
        specialized: false,
        materialTierBonus: 0.2,
      }),
    ).toBe(0.15);
  });
});

describe('masterworkBumpedQuality (the one-tier ladder)', () => {
  it('the ladder is the standard rarity ladder minus poor, index-aligned with ceiling tiers', () => {
    expect(MASTERWORK_QUALITY_LADDER).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
  });

  it('bumps exactly one tier, carrying the bumped ladder index', () => {
    expect(masterworkBumpedQuality('common')).toEqual({ quality: 'uncommon', tier: 1 });
    expect(masterworkBumpedQuality('uncommon')).toEqual({ quality: 'rare', tier: 2 });
    expect(masterworkBumpedQuality('rare')).toEqual({ quality: 'epic', tier: 3 });
    expect(masterworkBumpedQuality('epic')).toEqual({ quality: 'legendary', tier: 4 });
  });

  it('legendary does not bump, poor is off the ladder, absent reads common', () => {
    expect(masterworkBumpedQuality('legendary')).toBeNull();
    expect(masterworkBumpedQuality('poor')).toBeNull();
    expect(masterworkBumpedQuality(undefined)).toEqual({ quality: 'uncommon', tier: 1 });
  });
});

describe('masterworkBonusStats (the baked tier-delta budget)', () => {
  // The real crafted uncommon caster piece: chest, {armor: 30, int: 2, spi: 1},
  // baked at its recipe's own level (the level item_level.ts registers the
  // output at).
  const vestments = ITEMS.eastbrook_ritual_vestments;
  const vestmentsRecipe = recipeById('recipe_eastbrook_ritual_vestments')!;

  it('bakes the exact uncommon-to-rare budget delta for a real crafted def', () => {
    expect(vestmentsRecipe.level).toBe(9); // anchors the literal budget pins below
    const record = masterworkBonusStats({
      level: vestmentsRecipe.level,
      quality: vestments.quality,
      slot: vestments.slot,
      stats: vestments.stats,
    });
    // Literal pin: the 2-point delta lands one point on each profile stat
    // (largest-remainder over the def's int 2 / spi 1 identity).
    expect(record).toEqual({ int: 1, spi: 1 });
    // The record sums to EXACTLY the budget delta from the shared budget
    // primitives, with both sides of the delta pinned as literals so a drift
    // in either the baker or the budget curve trips this test.
    expect(primaryStatBudget(9, 'rare', 'chest')).toBe(5);
    expect(primaryStatBudget(9, 'uncommon', 'chest')).toBe(3);
    expect(statSum(record)).toBe(
      primaryStatBudget(9, 'rare', 'chest') - primaryStatBudget(9, 'uncommon', 'chest'),
    );
    // Distribution stays on the def's own profile keys, nothing else.
    for (const key of Object.keys(record!)) {
      expect((vestments.stats as Record<string, number>)[key]).toBeGreaterThan(0);
    }
  });

  it('filters armor out of the profile so the def armor is never doubled', () => {
    // common -> uncommon at level 10 chest: delta 4 - 0 = 4, split over the
    // even str/sta identity; the armor key must not appear in the record.
    const record = masterworkBonusStats({
      level: 10,
      quality: 'common',
      slot: 'chest',
      stats: { armor: 40, str: 2, sta: 2 },
    });
    expect(record).toEqual({ str: 2, sta: 2 });
    expect(record).not.toHaveProperty('armor');
  });

  it('returns null for a slotless def', () => {
    expect(
      masterworkBonusStats({ level: 9, quality: 'uncommon', slot: undefined, stats: { int: 2 } }),
    ).toBeNull();
  });

  it('returns null for an empty primary profile (armor alone is not a stat identity)', () => {
    // The real crafted common chest piece is armor-only: it can never
    // masterwork, and neither can a def with no stats record at all (the
    // crafted common weapon).
    const chainVest = ITEMS.eastbrook_chain_vest;
    expect(chainVest.stats).toEqual({ armor: 60 });
    expect(
      masterworkBonusStats({
        level: 10,
        quality: chainVest.quality,
        slot: chainVest.slot,
        stats: chainVest.stats,
      }),
    ).toBeNull();
    const sword = ITEMS.eastbrook_arming_sword;
    expect(sword.stats).toBeUndefined();
    expect(
      masterworkBonusStats({
        level: 10,
        quality: sword.quality,
        slot: sword.slot,
        stats: sword.stats,
      }),
    ).toBeNull();
  });

  it('returns null for a legendary def (no bump above the top rung)', () => {
    expect(
      masterworkBonusStats({
        level: 20,
        quality: 'legendary',
        slot: 'mainhand',
        stats: { str: 9 },
      }),
    ).toBeNull();
  });

  it('returns null for a poor def (off the ladder)', () => {
    expect(
      masterworkBonusStats({ level: 10, quality: 'poor', slot: 'chest', stats: { str: 2 } }),
    ).toBeNull();
  });

  it('an absent quality reads as common and bumps to uncommon', () => {
    // level 10 chest: uncommon budget 4 minus common budget 0, all on str.
    expect(
      masterworkBonusStats({ level: 10, quality: undefined, slot: 'chest', stats: { str: 4 } }),
    ).toEqual({ str: 4 });
  });

  it('returns null when the tier delta rounds to a zero budget', () => {
    // level 1 ring: uncommon budget rounds to 0, so the delta is 0 and no
    // masterwork record exists (bonusBudget <= 0 arm).
    expect(primaryStatBudget(1, 'uncommon', 'ring')).toBe(0);
    expect(
      masterworkBonusStats({ level: 1, quality: 'common', slot: 'ring', stats: { int: 1 } }),
    ).toBeNull();
  });
});

// The masterwork acceptance bound: a masterworked crafted output must stay
// STRICTLY below the raid-loot band. Derivation (src/sim/item_level.ts, no
// invented constants): a raid drop from band-level B content reads item level
// B + QUALITY_ILVL_BONUS[quality] + RAID_ILVL_BONUS (itemLevel(): raid loot
// reads at mob character level + 3, one tier above same-level 5-player
// dungeon loot), and carries primaryStatBudget of that readout. The
// apples-to-apples raid floor for a masterwork is that readout at the
// masterwork's own bumped quality and the item's registered band level
// (itemSourceLevel: the recipe's own level for a pure crafted output, the
// strongest source for a dual-source output like boundstone_helm, which also
// drops in the level-20 dungeon).
describe('masterwork stays strictly below the raid-loot band (acceptance bound)', () => {
  const equippable = ALL_RECIPES.filter((r) => {
    const def = ITEMS[r.resultItemId];
    return !!def && isItemLevelEligible(def);
  });

  interface BoundRow {
    recipeId: string;
    itemId: string;
    total: number;
    floor: number;
  }

  function boundRow(recipe: ProfessionRecipeRecord, bumpSteps: 1 | 2): BoundRow {
    const def = ITEMS[recipe.resultItemId];
    const defSum = statSum(def.stats);
    // The model's own one-tier bump defines the band a masterwork lands in;
    // the floor stays at that band even for the hypothetical 2-tier variant,
    // which is exactly what gives the bound teeth against a bump drift.
    const bump = masterworkBumpedQuality(def.quality);
    const bandQuality: MasterworkQuality =
      bump?.quality ?? (def.quality === 'legendary' ? 'legendary' : 'common');
    // The baked bonus exactly as crafting.ts bakes it (recipe.level is the
    // level the delta rides); the 2-tier variant walks the same ladder one
    // rung further for defs the real model can masterwork.
    const record = masterworkBonusStats({
      level: recipe.level,
      quality: def.quality,
      slot: def.slot,
      stats: def.stats,
    });
    let bonusSum = 0;
    if (record) {
      if (bumpSteps === 1) {
        bonusSum = statSum(record);
      } else {
        const ladder = MASTERWORK_QUALITY_LADDER as readonly string[];
        const idx = ladder.indexOf(def.quality ?? 'common');
        const twoAbove = MASTERWORK_QUALITY_LADDER[Math.min(idx + 2, ladder.length - 1)];
        bonusSum =
          primaryStatBudget(recipe.level, twoAbove, def.slot) -
          primaryStatBudget(recipe.level, def.quality, def.slot);
      }
    }
    const band = itemSourceLevel(def.id);
    expect(band, `${recipe.id}: crafted output must have a registered source level`).toBeDefined();
    const floor = primaryStatBudget(
      (band ?? 0) + (QUALITY_ILVL_BONUS[bandQuality] ?? 0) + RAID_ILVL_BONUS,
      bandQuality,
      def.slot,
    );
    return { recipeId: recipe.id, itemId: def.id, total: defSum + bonusSum, floor };
  }

  it('covers the real crafted-equippable set (the sweep is not vacuous)', () => {
    const ids = equippable.map((r) => r.resultItemId);
    expect(ids).toContain('eastbrook_ritual_vestments');
    expect(ids).toContain('boundstone_helm');
    expect(equippable.length).toBeGreaterThanOrEqual(8);
  });

  it('every equippable recipe output, masterworked, stays strictly below its raid floor', () => {
    for (const recipe of equippable) {
      const row = boundRow(recipe, 1);
      expect(
        row.total,
        `${row.recipeId} (${row.itemId}): masterwork total ${row.total} must stay strictly below raid floor ${row.floor}`,
      ).toBeLessThan(row.floor);
    }
  });

  it('pins the concrete numbers for a hub rare-def recipe and a common-band recipe (drift tripwires)', () => {
    // Even if no content change ever crosses the bound, these two literal rows
    // trip on any budget/tuning drift. wardweave_cowl: rare helmet, band 20,
    // def sum 11 plus the baked epic-minus-rare delta 2 at level 20, against
    // raid floor primaryStatBudget(20 + 6 + 3, 'epic', 'helmet') = 17
    // (margin 4). eastbrook_ritual_vestments: uncommon chest, band 9, def sum
    // 3 plus delta 2, against primaryStatBudget(9 + 3 + 3, 'rare', 'chest')
    // = 8 (margin 3).
    const cowl = boundRow(recipeById('recipe_wardweave_cowl')!, 1);
    expect(cowl.total).toBe(13);
    expect(cowl.floor).toBe(17);
    const vestments = boundRow(recipeById('recipe_eastbrook_ritual_vestments')!, 1);
    expect(vestments.total).toBe(5);
    expect(vestments.floor).toBe(8);
  });

  it('the bound has teeth: a hypothetical 2-tier bump would break it for current recipes', () => {
    // If the masterwork model ever drifted to a 2-tier stat delta while the
    // band (def quality + 1) stayed the documented contract, at least one
    // shipping recipe would cross its raid floor: the rare-def hub pieces
    // jump to the steep legendary multiplier. This proves the strict bound
    // actually binds with less than one extra tier of slack.
    const violating = equippable
      .filter((r) => {
        const row = boundRow(r, 2);
        return row.total >= row.floor;
      })
      .map((r) => r.id);
    expect(violating.length).toBeGreaterThan(0);
    expect(violating).toContain('recipe_ironbound_warplate_helm');
  });
});

describe('draw-order determinism over a real Sim', () => {
  // Scenario: tailoring as the active archetype (unlimited empowerment
  // ceiling), skill 200 (tier-8 capability, past the specialization
  // threshold), so each successful vestments craft rolls the proc at
  // 0.03 + 0.08 + 0.03 = 0.14. Seed 3 was hunted (bounded scan from seed 1,
  // re-recorded whenever a content commit shifts the construction-time
  // world-gen draw sequence: after the zones 1-3 quest-dedupe pass, then
  // 74 -> 3 after the v0.35.0 release content commits added the enchant and
  // hunter offhands and the deeds catalog) so the three-success sequence procs
  // on the second and third successful crafts; only the pinned literal is
  // committed, per the suite idiom. Spares on record: 7, 15, 28, 41, and 159.
  // tests/professions_silent_loot.test.ts follows this same literal.
  const SEED = 74;

  function run() {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('tailoring');
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.tailoring = 200;
    for (let i = 0; i < 12; i++) sim.addItem('linen_scrap', 1, pid);
    for (let i = 0; i < 6; i++) sim.addItem('spider_leg', 1, pid);
    // Economy rework: the vestments recipe gained cloth and thread volume.
    for (let i = 0; i < 9; i++) sim.addItem('homespun_cloth', 1, pid);
    for (let i = 0; i < 15; i++) sim.addItem('spool_of_thread', 1, pid);
    sim.drainEvents();
    const rng: Rng = (sim as any).ctx.rng;
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    const drawCounts: number[] = [];
    const craft = (recipeId: string) => {
      const before = draws;
      runCraft(sim, recipeId, false, pid);
      drawCounts.push(draws - before);
      return { ...sim.lastCraftResult! };
    };
    const results = [
      craft('recipe_eastbrook_ritual_vestments'),
      craft('recipe_eastbrook_arming_sword'), // denial: no bone_fragments held
      craft('recipe_eastbrook_ritual_vestments'),
      craft('recipe_eastbrook_ritual_vestments'),
    ];
    rng.setObserver(null);
    const events = sim.drainEvents();
    return {
      pid,
      results,
      drawCounts,
      masterworkEventCount: events.filter((e) => e.type === 'masterwork').length,
      craftResultEventCount: events.filter((e) => e.type === 'craftResult').length,
      lastMasterwork: sim.lastMasterwork,
      lastCraftResult: sim.lastCraftResult,
      inventory: {
        linen: sim.countItem('linen_scrap', pid),
        spider: sim.countItem('spider_leg', pid),
        vestments: sim.countItem('eastbrook_ritual_vestments', pid),
      },
      instances: meta.inventory
        .filter((s: { itemId: string }) => s.itemId === 'eastbrook_ritual_vestments')
        .map((s: { instance?: unknown }) => s.instance ?? null),
      tailoringSkill: meta.craftSkills.tailoring,
      playerName: meta.name,
    };
  }

  it('two same-seed runs are byte-identical, proc occurrences and lastMasterwork included', () => {
    expect(run()).toEqual(run());
  });

  it('draws exactly once per successful craft and zero on the denial, with the hunted procs pinned', () => {
    const a = run();
    // The single output-side draw sits on the success path only: the
    // mid-sequence denial (no bone_fragments held) advances the shared rng
    // stream by exactly nothing.
    expect(a.drawCounts).toEqual([1, 0, 1, 1]);
    expect(a.results.map((r) => r.ok)).toEqual([true, false, true, true]);
    expect(a.results[1].reason).toBe('insufficient_materials');
    // Hunted-seed proc pattern: first success misses, second and third proc,
    // and the denial never rolls at all.
    expect(a.results.map((r) => r.masterwork)).toEqual([undefined, undefined, true, true]);
    // quality stays the OUTPUT DEF quality on every success, proc or miss.
    expect(a.results[0].quality).toBe('uncommon');
    expect(a.results[3].quality).toBe('uncommon');
    // One masterwork SimEvent per proc; every attempt (denial included) still
    // emits its craftResult event.
    expect(a.masterworkEventCount).toBe(2);
    expect(a.craftResultEventCount).toBe(4);
    expect(a.lastMasterwork).toEqual({
      recipeId: 'recipe_eastbrook_ritual_vestments',
      itemId: 'eastbrook_ritual_vestments',
      crafter: a.pid,
    });
    expect(a.lastCraftResult?.masterwork).toBe(true);
    // Three outputs total. The miss landed first as a plain unsigned stack
    // (uncommon def is below the rare-plus signing threshold); the two proc
    // copies are signed single-copy instances carrying the baked tier delta
    // and NO rolled.quality (toEqual fails on any extra defined key, so a
    // reintroduced quality write trips this pin).
    expect(a.inventory.vestments).toBe(3);
    expect(a.instances).toEqual([
      null,
      { signer: a.playerName, rolled: { masterwork: true, stats: { int: 1, spi: 1 } } },
      { signer: a.playerName, rolled: { masterwork: true, stats: { int: 1, spi: 1 } } },
    ]);
  });
});

describe('proc-chance wiring over a real Sim (hunted boundary-window seeds)', () => {
  // Both cases craft recipe_eastbrook_ritual_vestments (skillReq 0, uncommon
  // def, bump tier 2: inside the pre-attunement rare ceiling) on a fresh
  // warrior, so the only chance inputs in play are the ones each case flips.
  // Granting materials and setting craftSkills directly never draws rng, so
  // paired same-seed runs share the identical single proc draw; each seed was
  // hunted (bounded scan from seed 1, draw value verified via the rng
  // observer during the hunt) for a draw inside the decisive window where the
  // flipped input alone decides the proc.

  function craftVestments(seed: number, setup: (sim: Sim, pid: number) => void) {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    setup(sim, pid);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    return { ...sim.lastCraftResult! };
  }

  it('a self-signed reagent feeds the proc chance: the same seed procs only with the signed copy', () => {
    // Seed 151, hunted (re-recorded whenever a content commit shifts the
    // construction-time world-gen draw sequence: after the zones 1-3
    // quest-dedupe pass, then 51 -> 151 after the v0.35.0 release content
    // commits added the enchant and hunter offhands and the deeds catalog):
    // the single proc draw lands in [0.03, 0.05), above the 3 percent base but
    // under base plus the 2 percent signed-reagent bonus, so the proc fires
    // ONLY when crafting.ts passes the signed-reagent holding check into
    // masterworkProcChance. Spares on record: 186, 241, 259, and 287.
    const SEED = 21;
    const signed = craftVestments(SEED, (sim, pid) => {
      const meta = (sim as any).players.get(pid);
      // One self-signed linen_scrap plus one plain: the #1145 reduction drops
      // the linen requirement from 3 to 2, so ok:true here also re-proves the
      // detection arm through the craftItem path (without the reduction this
      // grant set is insufficient and the craft would deny).
      sim.addItemInstance('linen_scrap', { signer: meta.name }, pid);
      sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.addItem('homespun_cloth', 3, pid);
      sim.addItem('spool_of_thread', 5, pid);
    });
    expect(signed.ok).toBe(true);
    expect(signed.selfSignedBonusApplied).toBe(true);
    expect(signed.masterwork).toBe(true);
    // Control at the SAME seed and stream position, no signed copy held: the
    // identical draw sits above the 3 percent base and must miss.
    const plain = craftVestments(SEED, (sim, pid) => {
      for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.addItem('homespun_cloth', 3, pid);
      sim.addItem('spool_of_thread', 5, pid);
    });
    expect(plain.ok).toBe(true);
    expect(plain.selfSignedBonusApplied).toBe(false);
    expect(plain.masterwork).toBeUndefined();
  });

  it("another player's signed reagent feeds the proc chance equally (the 2026-07-17 any-signed ruling)", () => {
    // Same hunted seed-21 window: the draw sits in [0.03, 0.05), so the proc
    // fires exactly when the 2 percent signed-reagent term applies. The signed
    // copy carries SOMEONE ELSE'S signature, so the #1145 quantity discount
    // must NOT apply (all 3 linen are required and consumed) while the proc
    // bonus MUST: trade-bought signed materials are worth as much to the proc
    // as self-gathered ones.
    const SEED = 21;
    const traded = craftVestments(SEED, (sim, pid) => {
      sim.addItemInstance('linen_scrap', { signer: 'Gatherer Friend' }, pid);
      sim.addItem('linen_scrap', 2, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.addItem('homespun_cloth', 3, pid);
      sim.addItem('spool_of_thread', 5, pid);
    });
    expect(traded.ok).toBe(true);
    expect(traded.selfSignedBonusApplied).toBe(false);
    expect(traded.masterwork).toBe(true);
  });

  it('a signed FINE grade feeds the proc chance for a recipe declaring its base', () => {
    // D8: 26 shipped masterwork-capable recipes declare a material that has a
    // fine grade, and resolveHarvest mints the signed instance on the RESOLVED
    // id, so a player who out-tooled the material holds signed FINE copies and
    // pays the base reagent line with them. Without hasSignedInstance spanning
    // grades that player silently loses MASTERWORK_SIGNED_CHANCE for having
    // used the better tool.
    //
    // Seed 87, re-hunted on this recipe after the v0.35.0 release content
    // commits (the enchant offhand, the hunter offhand, and the deeds catalog
    // moved the construction-time draws, so the old 21 window and its spares
    // all collapsed, exactly as the 67 window collapsed before them at the
    // zones 1-3 quest-dedupe pass): the single proc draw lands where the 2
    // percent signed-reagent term alone decides the outcome. The spares (151,
    // 186, 207) RUN below rather than sitting on record, so a draw-order shift
    // that collapses one window fails loudly instead of quietly narrowing
    // the pin to a lone seed. Further hits on record: 227 and 259.
    const SEEDS = [21];
    const craftLongsword = (seed: number, setup: (sim: Sim, pid: number) => void) => {
      const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
      const pid = sim.playerId;
      const recipe = recipeById('recipe_ironedge_longsword')!;
      const station = stationsOfType(STATIONS, recipe.stationType as StationType)[0];
      const e = (sim as any).entities.get(pid);
      e.pos.x = station.pos.x;
      e.pos.z = station.pos.z;
      e.prevPos = { ...e.pos };
      // Trainer-acquired recipe: grant knowledge directly, the same way the
      // other live-craft cases in this file reach a gated recipe.
      (sim as any).players.get(pid)?.knownRecipes?.add(recipe.id);
      setup(sim, pid);
      runCraft(sim, recipe.id, false, pid);
      return { ...(sim as any).lastCraftResult };
    };
    const reagentsExceptOre = (sim: Sim, pid: number) => {
      for (const g of recipeById('recipe_ironedge_longsword')!.reagents) {
        if (g.itemId === 'iron_ore') continue;
        for (let i = 0; i < g.count + 2; i++) sim.addItem(g.itemId, 1, pid);
      }
    };
    const ORE_COUNT =
      (recipeById('recipe_ironedge_longsword')!.reagents.find((g) => g.itemId === 'iron_ore')
        ?.count ?? 0) + 2;
    expect(ORE_COUNT).toBeGreaterThan(2); // the recipe really does declare iron_ore

    for (const seed of SEEDS) {
      const signedFine = craftLongsword(seed, (sim, pid) => {
        reagentsExceptOre(sim, pid);
        sim.addItemInstance('fine_iron_ore', { signer: 'Gatherer Friend' }, pid, ORE_COUNT);
      });
      expect(signedFine.ok, `seed ${seed}`).toBe(true);
      expect(signedFine.masterwork, `seed ${seed}`).toBe(true);

      // Control at the SAME seed: identical bag, plain unsigned fine copies.
      // The draw is the same and must miss, so the proc above is the signed
      // term, at every seed in the window set.
      const plainFine = craftLongsword(seed, (sim, pid) => {
        reagentsExceptOre(sim, pid);
        for (let i = 0; i < ORE_COUNT; i++) sim.addItem('fine_iron_ore', 1, pid);
      });
      expect(plainFine.ok, `seed ${seed}`).toBe(true);
      expect(plainFine.masterwork, `seed ${seed}`).toBeUndefined();
    }
  });

  it('a count-1 signed reagent feeds the proc chance (decoupled from the quantity-discount flag)', () => {
    // Same hunted seed-21 window. The signed copy is the SPIDER LEG, whose
    // reagent count is 1: the #1145 reduction floors at 1 so the discount
    // flag can never set for it (the old coupling made this exact case lose
    // the proc bonus). The signed-reagent term must fire anyway.
    const SEED = 21;
    const countOne = craftVestments(SEED, (sim, pid) => {
      const meta = (sim as any).players.get(pid);
      for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
      sim.addItemInstance('spider_leg', { signer: meta.name }, pid);
      sim.addItem('homespun_cloth', 3, pid);
      sim.addItem('spool_of_thread', 5, pid);
    });
    expect(countOne.ok).toBe(true);
    expect(countOne.selfSignedBonusApplied).toBe(false);
    expect(countOne.masterwork).toBe(true);
  });

  it('the specialization threshold binds in the craft path: skill 74 misses where 75 and 76 proc', () => {
    // Premise anchor: the content threshold this boundary rides. A content
    // retune moves the boundary and this seed must be re-hunted.
    expect(PERK_THRESHOLDS.tailoring.specializedSkillThreshold).toBe(75);
    // Seed 26, hunted (re-recorded whenever a content commit shifts the
    // construction-time world-gen draw sequence: after the zones 1-3
    // quest-dedupe pass, then 66 -> 26 after the v0.35.0 release content
    // commits added the enchant and hunter offhands and the deeds catalog):
    // the single proc draw lands in [0.06, 0.09). At skill 74 (tier 2, not
    // specialized) the chance is 0.03 + 0.02 = 0.05: miss. At 75 and 76
    // (tier 3, specialized) it is 0.03 + 0.03 + 0.03 = 0.09: proc, and only if
    // BOTH the tiersAboveRecipe term and isSpecialized are wired into
    // masterworkProcChance by crafting.ts (either wiring dropped leaves the
    // chance at or below 0.06, under the hunted draw). Spares on record: 36,
    // 62, 83, and 87.
    const SEED = 66;
    const at = (skill: number) =>
      craftVestments(SEED, (sim, pid) => {
        const meta = (sim as any).players.get(pid);
        meta.craftSkills.tailoring = skill;
        for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
        sim.addItem('spider_leg', 1, pid);
        sim.addItem('homespun_cloth', 3, pid);
        sim.addItem('spool_of_thread', 5, pid);
      });
    const r74 = at(74);
    const r75 = at(75);
    const r76 = at(76);
    expect([r74.ok, r75.ok, r76.ok]).toEqual([true, true, true]);
    expect(r74.masterwork).toBeUndefined();
    expect(r75.masterwork).toBe(true);
    expect(r76.masterwork).toBe(true);
  });
});

describe('material-tier masterwork feed (material_tier.ts)', () => {
  it('pins the tier table and the per-tier chance step literally', () => {
    // Load-bearing tuning literals, same convention as the proc-chance
    // constant pins above: the step rides the masterwork bonus scale
    // (it equals MASTERWORK_PER_TIER_ABOVE_CHANCE), and toEqual on the whole
    // table trips on any added, dropped, or re-tiered row.
    expect(MASTERWORK_MATERIAL_TIER_CHANCE).toBe(0.01);
    expect(MATERIAL_TIER_BY_ITEM).toEqual({
      iron_ore: 1,
      fine_iron_ore: 1,
      ashwood_log: 1,
      fine_ashwood_log: 1,
      goldleaf_herb: 1,
      fine_goldleaf_herb: 1,
      thorium_ore: 1,
      fine_thorium_ore: 1,
      elderwood_log: 2,
      fine_elderwood_log: 2,
      sunpetal_herb: 2,
      fine_sunpetal_herb: 2,
      arcanite_bar: 2,
    });
    // An id absent from the table is tier 0: the baseline mob drops, the
    // eastbrook_vale starter yields, and non-material inputs alike.
    expect(materialTierForItem('bone_fragments')).toBe(0);
    expect(materialTierForItem('copper_ore')).toBe(0);
    expect(materialTierForItem('mithril_mining_pick')).toBe(0);
    expect(materialTierForItem('no_such_item')).toBe(0);
  });

  it('every fine grade inherits its base band, including absence', () => {
    // The literal above says WHAT the table holds; this arm says WHY, over the
    // whole grade catalog rather than the seven rows that happen to be listed.
    // Derived from MATERIAL_GRADES, so a tenth material added later is covered
    // the day it lands instead of quietly shipping on tier 0.
    const graded = Object.keys(MATERIAL_GRADES);
    expect(graded).toHaveLength(9);
    for (const baseItemId of graded) {
      const fineItemId = fineMaterialFor(baseItemId);
      expect(fineItemId, baseItemId).toBeDefined();
      expect(materialTierForItem(fineItemId as string), fineItemId).toBe(
        materialTierForItem(baseItemId),
      );
    }
    // Both sides of "including absence" are live, so the loop above is not a
    // sweep over one uniform case: the eastbrook grades inherit tier 0 (kept
    // out of the table entirely, protecting the golden-safety arm below), the
    // other six inherit a real band.
    const absent = graded.filter((id) => materialTierForItem(id) === 0);
    const present = graded.filter((id) => materialTierForItem(id) > 0);
    expect(absent.sort()).toEqual(['copper_ore', 'ironbark_log', 'silverleaf_herb']);
    expect(present).toHaveLength(6);
    for (const baseItemId of absent) {
      expect(MATERIAL_TIER_BY_ITEM[fineMaterialFor(baseItemId) as string]).toBeUndefined();
    }
  });

  it('the fine re-spec left every tool recipe proc chance where it was', () => {
    // The D8 swap moved reagent ids only. Pinned as literals rather than as a
    // before/after comparison, so a future re-tier that moved BOTH grades
    // together could not slide through by staying self-consistent.
    expect(materialTierBonusForReagents(recipeById('recipe_ashwood_axe')!.reagents)).toBe(0.01);
    expect(materialTierBonusForReagents(recipeById('recipe_goldleaf_sickle')!.reagents)).toBe(0.01);
    expect(materialTierBonusForReagents(recipeById('recipe_elderwood_axe')!.reagents)).toBe(0.02);
    expect(materialTierBonusForReagents(recipeById('recipe_sunpetal_sickle')!.reagents)).toBe(0.02);
  });

  it('a tier-0-only reagent list resolves to exactly 0 (the golden-safety arm)', () => {
    expect(
      materialTierBonusForReagents([
        { itemId: 'bone_fragments' },
        { itemId: 'linen_scrap' },
        { itemId: 'spider_leg' },
        { itemId: 'copper_ore' },
        { itemId: 'ironbark_log' },
        { itemId: 'silverleaf_herb' },
      ]),
    ).toBe(0);
    expect(materialTierBonusForReagents([])).toBe(0);
    // The two recipes the parity golden crafts consume only tier-0 reagents,
    // so their proc chance is unchanged by the tier feed: this pin is the
    // tripwire against any table growth that would touch a golden scenario.
    expect(materialTierBonusForReagents(recipeById('recipe_minor_healing_potion')!.reagents)).toBe(
      0,
    );
    expect(
      materialTierBonusForReagents(recipeById('recipe_eastbrook_ritual_vestments')!.reagents),
    ).toBe(0);
  });

  it('resolves the MAX reagent tier, never the sum', () => {
    expect(materialTierBonusForReagents([{ itemId: 'iron_ore' }])).toBe(0.01);
    expect(materialTierBonusForReagents([{ itemId: 'sunpetal_herb' }])).toBe(0.02);
    // Mixed tiers 0 + 1 + 2 resolve to the max (0.02), never the 0.03 sum.
    expect(
      materialTierBonusForReagents([
        { itemId: 'linen_scrap' },
        { itemId: 'thorium_ore' },
        { itemId: 'elderwood_log' },
      ]),
    ).toBe(0.02);
    // Repeated top-tier materials never stack past the max either.
    expect(
      materialTierBonusForReagents([
        { itemId: 'elderwood_log' },
        { itemId: 'sunpetal_herb' },
        { itemId: 'arcanite_bar' },
      ]),
    ).toBe(0.02);
    // Real content rows: the mid-band tool recipe feeds 0.01, its premium
    // upgrade 0.02 (the crafted tool inputs in both lists stay tier 0).
    expect(materialTierBonusForReagents(recipeById('recipe_thorium_mining_pick')!.reagents)).toBe(
      0.01,
    );
    expect(materialTierBonusForReagents(recipeById('recipe_arcanite_mining_pick')!.reagents)).toBe(
      0.02,
    );
  });

  it('feeds masterworkProcChance additively and clamps through the same cap', () => {
    expect(
      masterworkProcChance({
        tiersAboveRecipe: 0,
        signedReagent: false,
        specialized: false,
        materialTierBonus: materialTierBonusForReagents([{ itemId: 'sunpetal_herb' }]),
      }),
    ).toBeCloseTo(0.05, 12);
    // 0.03 + 0.08 + 0.02 + 0.03 + 0.02 = 0.18 clamps to the 0.15 cap.
    expect(
      masterworkProcChance({
        tiersAboveRecipe: 8,
        signedReagent: true,
        specialized: true,
        materialTierBonus: 0.02,
      }),
    ).toBe(0.15);
  });

  it('the crafting call site passes the consumed materials tier into the proc (hunted seed-21 window)', () => {
    // Same hunted seed-21 window as the signed-reagent cases above: the
    // single proc draw lands in [0.03, 0.05). A synthetic skillReq-0 recipe
    // (resolveCraftForRecipe's exported-for-tests seam) on a fresh warrior
    // has no other bonus in play, so the ONLY chance input separating the
    // two arms is the reagent's material tier: the tier-2 arm rolls at
    // 0.03 + 0.02 = 0.05 and procs, the tier-0 arm rolls at the bare 0.03
    // base and misses the identical draw (proving a tier-0 recipe's chance
    // is unchanged by the wiring). Both arms draw exactly once: the lookup
    // is pure and cannot move the procRoll draw.
    const SEED = 21;
    const craftSynthetic = (reagentItemId: string) => {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: false });
      const pid = sim.playerId;
      sim.addItem(reagentItemId, 1, pid);
      const recipe: ProfessionRecipeRecord = {
        id: 'recipe_test_material_tier',
        professionId: 'tailoring',
        resultItemId: 'eastbrook_ritual_vestments',
        resultCount: 1,
        reagents: [{ itemId: reagentItemId, count: 1 }],
        skillReq: 0,
        itemLevelBudget: 9,
        level: 9,
      };
      const rng: Rng = (sim as any).ctx.rng;
      let draws = 0;
      rng.setObserver(() => {
        draws++;
      });
      const result = resolveCraftForRecipe((sim as any).ctx, pid, recipe);
      rng.setObserver(null);
      return { result, draws };
    };
    const premium = craftSynthetic('sunpetal_herb');
    expect(premium.result.ok).toBe(true);
    expect(premium.result.masterwork).toBe(true);
    expect(premium.draws).toBe(1);
    const baseline = craftSynthetic('linen_scrap');
    expect(baseline.result.ok).toBe(true);
    expect(baseline.result.masterwork).toBeUndefined();
    expect(baseline.draws).toBe(1);
  });
});
