// The stamina baseline model guard (src/sim/item_budget.ts, "The stamina baseline
// model"): every item-level-eligible item in the merged catalog carries at least
// its free stamina baseline, and every item with a derivable tier sits exactly on
// its offense-and-resource line, unless it is on the drift allowlist below. The
// allowlist may only shrink. Measurements and the decision record:
// docs/design/gear-stamina-baseline-2026-09-10.md.
import { describe, expect, it } from 'vitest';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  checkStaminaModel,
  expectedLineBudget,
  expectedStatBudget,
  expectedStatTotal,
  isItemLevelEligible,
  normalizeToStaminaModel,
  primaryStatSum,
  realizedLineBudget,
  STAMINA_BASELINE_SHARE,
  slotStatMultForItem,
  staminaBaseline,
  statIdentity,
} from '../src/sim/item_level';
import { craftBonusStatsFor } from '../src/sim/professions/crafting';
import { masterworkLineBudgets } from '../src/sim/professions/masterwork';
import { perfectedBonusStats, perfectedLineBudgets } from '../src/sim/professions/perfecting_bonus';
import type { ItemDef } from '../src/sim/types';

// Two kinds of item sit off their line by the model's exact check, and they are
// kept apart because they mean different things.
//
// The WARFARE honor tier is priced at a deliberate FRACTION of its slot budget
// (content/pvp_honor.ts, tests/pvp_honor_gear.test.ts): off its line by design,
// permanently, and exempt from the exact-line check here. It still meets the
// stamina floor like everything else.
const FRACTIONAL_BY_DESIGN: ReadonlySet<string> = new Set(FURY_STOCK);

// Items whose primary total was off their budget BEFORE the stamina model landed
// (the 2026-09-10 inventory: the level-18 crafted set 1 to 3 over, leveling drift
// of a point or two, and a few outliers such as Kingsbane's Last Oath 21 under
// its legendary budget). They still meet the stamina FLOOR like everything else;
// only the exact-line check is deferred until the drift cleanup. An entry that
// conforms fails "only names items still off budget" so it gets removed, and the
// ratchet below stops the list growing; nothing may be added without a design note.
const STAT_DRIFT_ALLOWLIST: ReadonlySet<string> = new Set([
  'apprentice_staff',
  'arcanite_war_axe',
  'boneglass_shiv',
  'broodmother_silk_robe',
  'burnished_thorium_amulet',
  'crag_warden_cudgel',
  'cragmaw_huntcord',
  'cragmaw_prowlboots',
  'cryptbone_greaves',
  'cryptbone_helm',
  'cryptbone_pauldrons',
  'deacons_cleaver',
  'deathlord_sabatons',
  'drogmar_warboots',
  'drowned_prayer_leggings',
  'drowned_prayer_sandals',
  'drowned_tide_scepter',
  'drownedguard_breastplate',
  'drownedmoon_scepter',
  'drownstep_sabatons',
  'duskfang_dirk',
  'duskhide_wraps',
  'duskwhisper',
  'eastbrook_druids_hide',
  'eastbrook_ritual_vestments',
  'eastbrook_warded_leggings',
  'eelscale_leggings',
  'eelscale_treads',
  'elderwood_battle_staff',
  'emberwing_legguards',
  'fen_reaver_glaive',
  'fenmist_robe',
  'goldweave_leggings',
  'greyjaw_hide_boots',
  'heroic_deathless_heartwood',
  'heroic_kingsbane_last_oath',
  'heroic_moonshroud_robe',
  'hollow_vigil_staff',
  'ironvein_lantern_staff',
  'ironvein_pickblade',
  'kingsbane_last_oath',
  'knight_commanders_greaves',
  'maldrecs_soulbinder',
  'mantle_of_the_unbroken_shore',
  'marrowlord_boneboots',
  'marrowtread_boots',
  'milepost_boots',
  'militia_vest',
  'mirejaw_biteblade',
  'mirejaw_oracle_staff',
  'mirejaw_scale_vest',
  'mirewarden_jerkin',
  'mirewarden_leggings',
  'mirewarden_treads',
  'mistbinder_kris',
  'mistcallers_edge',
  'mistveil_cord',
  'mistveil_grips',
  'moggers_copper_cudgel',
  'moggers_shiv',
  'moggers_stomper_boots',
  'moonshroud_breastplate',
  'moonshroud_robe',
  'moonshroud_tunic',
  'mossy_handwraps',
  'mother_of_pearl',
  'necromancers_legwraps',
  'nhalias_dirgeblade',
  'nhalias_funeral_wraps',
  'ogre_bonecharm_staff',
  'oiled_boots',
  'palecoil_rod',
  'quilted_trousers',
  'ridgestalker_treads',
  'riptide_dirk',
  'sableweb_slippers',
  'saltforged_grips',
  'selthes_seastriders',
  'silkbinders_raiment',
  'skullsmasher_warbelt',
  'sloomtooth_tidefang',
  'sootscale_mantle',
  'staff_of_drowned_prayers',
  'stormshard_leggings',
  'sunweave_mantle',
  'sunweave_treads',
  'thorium_warblade',
  'thoriumscale_cuirass',
  'thoriumscale_greathelm',
  'thoriumscale_leggings',
  'tideglass_dirk',
  'tidereaver_gaff',
  'tidescale_vest',
  'tidewatchers_wraps',
  'trail_leggings',
  'tunnelkings_spade',
  'veilsteel_blade',
  'wardens_oathband',
  'wardweave_cowl',
  'weighted_thorium_band',
  'whetted_iron_dirk',
  'woven_robe',
  'ysols_pearl_greaves',
]);
// The ratchet ceiling for the allowlist above and the count of untiered items the
// proxy floor binds on (see the catalog test).
const STAT_DRIFT_ALLOWLIST_CEILING = 103;
const UNTIERED_WITH_PROXY_FLOOR = 51;
const GENERATED_ITEM_COUNT = 111;
const WARFARE_STOCK_COUNT = 47;
const HEROIC_VARIANT_COUNT = 78;

// Items with no derivable source (vendor, starter and quest oddities) have no
// tier to price against; their floor is taken from their own authored line, the
// caster line divided by three, the physical line divided by two (a physical line
// is two thirds of a budget whose baseline is a third: 1.5 * L / 3 = L / 2).
function proxyBaseline(item: ItemDef): number {
  const s = item.stats ?? {};
  return statIdentity(s) === 'caster'
    ? Math.round(((s.int ?? 0) + (s.spi ?? 0)) / 3)
    : Math.round(((s.str ?? 0) + (s.agi ?? 0)) / 2);
}

const eligible = (Object.values(ITEMS) as ItemDef[]).filter(isItemLevelEligible);
const tiered = eligible.filter((item) => expectedLineBudget(item) !== undefined);
const untiered = eligible.filter((item) => expectedLineBudget(item) === undefined);

function describeFailure(item: ItemDef, detail: string): string {
  return `${item.id} (${item.slot}, ${item.quality}): ${detail} ${JSON.stringify(item.stats ?? {})}`;
}

describe('stamina baseline model: primitives', () => {
  it('takes a third of the budget, rounded, and nothing from a zero budget', () => {
    expect(STAMINA_BASELINE_SHARE).toBeCloseTo(1 / 3, 6);
    expect(staminaBaseline(0)).toBe(0);
    expect(staminaBaseline(1)).toBe(0);
    expect(staminaBaseline(2)).toBe(1);
    expect(staminaBaseline(3)).toBe(1);
    expect(staminaBaseline(4)).toBe(1);
    expect(staminaBaseline(5)).toBe(2);
    expect(staminaBaseline(25)).toBe(8);
    expect(staminaBaseline(33)).toBe(11);
  });

  it('prices Intellect or Spirit bearers on the caster line and everything else physical', () => {
    expect(statIdentity({ int: 17, spi: 8 })).toBe('caster');
    expect(statIdentity({ int: 17, sta: 8 })).toBe('caster');
    expect(statIdentity({ str: 17, sta: 8 })).toBe('physical');
    expect(statIdentity({ sta: 5 })).toBe('physical');
    // The all-stat hybrid prices physical-style: its stamina was inside its budget.
    expect(statIdentity({ str: 8, agi: 8, int: 8, sta: 18 })).toBe('physical');
    expect(statIdentity(undefined)).toBe('physical');
  });

  it('expects a caster total of budget plus baseline and a physical total of the budget', () => {
    expect(expectedStatTotal(25, 'caster')).toBe(33);
    expect(expectedStatTotal(25, 'physical')).toBe(25);
  });

  it('reads the four archetypes against a 25-point chest', () => {
    // Physical DPS: stamina inside the budget, on the line, at the floor.
    const dps = checkStaminaModel({ str: 17, sta: 8 }, 25);
    expect(dps).toMatchObject({
      identity: 'physical',
      baseline: 8,
      extra: 0,
      line: 17,
      expectedLine: 17,
      meetsFloor: true,
      onLine: true,
    });
    // Tank: seven stamina above the floor bought from the line one for one.
    const tank = checkStaminaModel({ str: 10, sta: 15 }, 25);
    expect(tank).toMatchObject({
      extra: 7,
      line: 10,
      expectedLine: 10,
      meetsFloor: true,
      onLine: true,
    });
    // Caster raid piece as authored: on its line, under the floor.
    const raid = checkStaminaModel({ int: 17, spi: 8 }, 25);
    expect(raid).toMatchObject({
      identity: 'caster',
      line: 25,
      expectedLine: 25,
      meetsFloor: false,
      onLine: true,
      expectedTotal: 33,
    });
    // The same piece with its baseline placed: on the model.
    const fixed = checkStaminaModel({ int: 17, spi: 8, sta: 8 }, 25);
    expect(fixed).toMatchObject({ meetsFloor: true, onLine: true, total: 33 });
    // A stamina-free physical neck: over its line and under the floor.
    const neck = checkStaminaModel({ str: 8, agi: 7 }, 15);
    expect(neck).toMatchObject({
      baseline: 5,
      line: 15,
      expectedLine: 10,
      meetsFloor: false,
      onLine: false,
    });
  });

  it('normalizes generated profiles onto the model', () => {
    // Caster profile: line on the budget, baseline on top, armor untouched.
    expect(normalizeToStaminaModel({ int: 2, spi: 1, armor: 90 }, 25)).toEqual({
      armor: 90,
      int: 17,
      spi: 8,
      sta: 8,
    });
    // Physical DPS profile keeps its authored split (stamina inside the budget).
    expect(normalizeToStaminaModel({ str: 2, sta: 1 }, 25)).toEqual({ str: 17, sta: 8 });
    // Tank profile keeps its extra stamina and pays for it from the line.
    const tank = normalizeToStaminaModel({ str: 10, sta: 15 }, 25);
    expect(tank.sta).toBe(15);
    expect((tank.str ?? 0) + (tank.sta ?? 0)).toBe(25);
    // A stamina-free physical profile is lifted to the floor and fitted to the line.
    expect(normalizeToStaminaModel({ str: 1, agi: 1 }, 15)).toEqual({ str: 5, agi: 5, sta: 5 });
    // Zero budget: armor only.
    expect(normalizeToStaminaModel({ str: 3, armor: 40 }, 0)).toEqual({ armor: 40 });
    // A caster profile carrying stamina above its share keeps the extra and
    // pays for it from the line one for one: 2:3 on 25 scales to 13/20 on the
    // model total of 33, the 12 above the baseline of 8 comes off the line.
    expect(normalizeToStaminaModel({ int: 2, sta: 3 }, 25)).toEqual({ int: 13, sta: 20 });
    // An empty profile has no identity to scale: only the baseline is placed.
    // No generator feeds one (stat-less items are whites with a zero budget);
    // pinned so the arm is a known shape, not a surprise.
    expect(normalizeToStaminaModel({}, 25)).toEqual({ sta: 8 });
  });
});

it('recovers the realized line budget from a stat line, and takes the larger side of a cycle', () => {
  // On the model: a 25-point physical chest and a caster chest with its
  // baseline placed both read 25; the Deathless Heartwood (int 21, spi 43,
  // sta 23) reads 65, its extra stamina bought from the line.
  expect(realizedLineBudget({ str: 17, sta: 8 })).toBe(25);
  expect(realizedLineBudget({ int: 17, spi: 8, sta: 8 })).toBe(25);
  expect(realizedLineBudget({ int: 21, spi: 43, sta: 23 })).toBe(65);
  // The one-point line with one stamina alternates 1, 2, 1, 2 under the
  // iteration; the larger value wins, never a bound-parity accident.
  expect(realizedLineBudget({ int: 1, sta: 1 })).toBe(2);
  expect(realizedLineBudget({ spi: 3, sta: 5 })).toBeGreaterThanOrEqual(3);
});

describe('stamina baseline model: the merged catalog', () => {
  it('covers the whole combat-gear catalog', () => {
    expect(eligible.length).toBeGreaterThanOrEqual(800);
    expect(tiered.length).toBeGreaterThanOrEqual(700);
    // The untiered floor is a proxy from the item's own line, so it cannot see a
    // proportional shrink; pin how many of them the proxy actually binds on, so
    // the arm cannot erode to nothing without a reviewer noticing.
    expect(untiered.filter((item) => proxyBaseline(item) > 0)).toHaveLength(
      UNTIERED_WITH_PROXY_FLOOR,
    );
  });

  it('the drift allowlist is a ratchet: it can only shrink', () => {
    // Lower this number when an entry conforms and is removed; never raise it
    // without a design note. Adding an id would otherwise silence the exact-line
    // check for that item with nothing failing.
    // Exact, not at-most: removing a conformed entry without lowering the
    // ceiling would mint a permanent slot of slack.
    expect(STAT_DRIFT_ALLOWLIST.size).toBe(STAT_DRIFT_ALLOWLIST_CEILING);
  });

  it('every eligible item meets its stamina floor', () => {
    const failures: string[] = [];
    for (const item of tiered) {
      const check = checkStaminaModel(item.stats, expectedLineBudget(item) as number);
      if (!check.meetsFloor)
        failures.push(
          describeFailure(
            item,
            `sta ${check.sta} < baseline ${check.baseline} on line ${check.budget}`,
          ),
        );
    }
    for (const item of untiered) {
      const baseline = proxyBaseline(item);
      const sta = item.stats?.sta ?? 0;
      if (sta < baseline)
        failures.push(
          describeFailure(item, `sta ${sta} < proxy baseline ${baseline} (no derived tier)`),
        );
    }
    expect(
      failures,
      `${failures.length} items under their stamina floor:\n${failures.slice(0, 40).join('\n')}`,
    ).toEqual([]);
  });

  it('every tiered item off the drift allowlist sits exactly on its line and total', () => {
    const failures: string[] = [];
    for (const item of tiered) {
      if (STAT_DRIFT_ALLOWLIST.has(item.id) || FRACTIONAL_BY_DESIGN.has(item.id)) continue;
      const check = checkStaminaModel(item.stats, expectedLineBudget(item) as number);
      if (!check.onLine)
        failures.push(
          describeFailure(
            item,
            `${check.identity} line ${check.line} != ${check.expectedLine} (budget ${check.budget}, extra sta ${check.extra})`,
          ),
        );
      else if (primaryStatSum(item) !== expectedStatBudget(item))
        failures.push(
          describeFailure(item, `total ${primaryStatSum(item)} != ${expectedStatBudget(item)}`),
        );
    }
    expect(
      failures,
      `${failures.length} items off their line:\n${failures.slice(0, 40).join('\n')}`,
    ).toEqual([]);
  });

  it('the WARFARE exemption is real: every honor piece is off its line and not on the drift list', () => {
    // Pinned exactly: a new honor piece must not join the exemption unseen.
    expect(FRACTIONAL_BY_DESIGN.size).toBe(WARFARE_STOCK_COUNT);
    for (const id of FRACTIONAL_BY_DESIGN) {
      expect(STAT_DRIFT_ALLOWLIST.has(id), `${id} is on both lists`).toBe(false);
      const item = ITEMS[id];
      const line = expectedLineBudget(item);
      expect(line, `${id} has a tier`).toBeDefined();
      const check = checkStaminaModel(item.stats, line as number);
      expect(check.meetsFloor, `${id} floor`).toBe(true);
      expect(check.onLine, `${id} is priced at a fraction, so off its line`).toBe(false);
    }
  });

  it('the drift allowlist only names real items that are still off their line', () => {
    const stale: string[] = [];
    for (const id of STAT_DRIFT_ALLOWLIST) {
      const item = ITEMS[id];
      if (!item) {
        stale.push(`${id}: not in the catalog`);
        continue;
      }
      const line = expectedLineBudget(item);
      if (line === undefined) {
        stale.push(`${id}: no derived tier, does not need an allowlist entry`);
        continue;
      }
      const check = checkStaminaModel(item.stats, line);
      if (check.onLine && primaryStatSum(item) === expectedStatBudget(item))
        stale.push(`${id}: now on its line, remove it`);
    }
    expect(stale).toEqual([]);
  });

  it('generated heroic variants and crucible collection pieces are on the model', () => {
    const failures: string[] = [];
    const generated = tiered.filter(
      (item) => item.id.startsWith('heroic_') || item.id.startsWith('crucible_'),
    );
    // Cardinality first, so a prefix change cannot make the sweep vacuous.
    expect(generated.length).toBe(GENERATED_ITEM_COUNT);
    for (const item of generated) {
      if (STAT_DRIFT_ALLOWLIST.has(item.id) || FRACTIONAL_BY_DESIGN.has(item.id)) continue;
      const check = checkStaminaModel(item.stats, expectedLineBudget(item) as number);
      if (!check.meetsFloor || !check.onLine)
        failures.push(
          describeFailure(
            item,
            `floor ${check.meetsFloor} line ${check.line}/${check.expectedLine}`,
          ),
        );
    }
    expect(failures).toEqual([]);
  });

  it('a heroic variant never carries less of any stat than the item it upgrades', () => {
    // The variant generator reads the base's realized line, so an off-budget
    // base (the drift allowlist) upgrades from what it actually has; a variant
    // with one point less Intellect than its base would be a downgrade in disguise.
    const failures: string[] = [];
    const variants = eligible.filter((item) => item.heroicOf && ITEMS[item.heroicOf]);
    expect(variants.length).toBe(HEROIC_VARIANT_COUNT);
    for (const item of variants) {
      const base = ITEMS[item.heroicOf as string];
      for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
        if ((item.stats?.[stat] ?? 0) < (base.stats?.[stat] ?? 0))
          failures.push(
            `${item.id} ${stat} ${item.stats?.[stat] ?? 0} < base ${base.stats?.[stat] ?? 0}`,
          );
      }
    }
    expect(failures).toEqual([]);
  });
  it('a masterwork or Perfecting bump keeps every copy at the floor of its new line', () => {
    // The guard sweeps ItemDefs; the bumped copy lives in an instance payload,
    // so it is rebuilt here from the same generators the craft path uses and
    // held to the floor of the line it lands on (the double-rounding case:
    // a 16-to-17 physical bump over 11/5 must not leave stamina at 5).
    const failures: string[] = [];
    let checked = 0;
    for (const recipe of ALL_RECIPES) {
      const def = ITEMS[recipe.resultItemId];
      if (!def || !isItemLevelEligible(def) || !def.stats) continue;
      const bonus = craftBonusStatsFor(def, recipe);
      const lines = masterworkLineBudgets({
        level: recipe.level,
        quality: def.quality,
        slot: def.slot,
        stats: def.stats,
        slotStatMult: slotStatMultForItem(def),
        twoHand: def.kind === 'weapon' && def.hand === 'twohand',
      });
      if (bonus && lines) {
        checked += 1;
        const sta = (def.stats.sta ?? 0) + (bonus.sta ?? 0);
        if (sta < staminaBaseline(lines.after))
          failures.push(
            `${def.id} masterworked: sta ${sta} < floor ${staminaBaseline(lines.after)} on line ${lines.after}`,
          );
      }
      const perfected = perfectedBonusStats(def, recipe);
      const perfectedLines = perfectedLineBudgets(def, recipe);
      if (perfected && perfectedLines) {
        checked += 1;
        const sta = (def.stats.sta ?? 0) + (perfected.sta ?? 0);
        if (sta < staminaBaseline(perfectedLines.after))
          failures.push(
            `${def.id} Perfected: sta ${sta} < floor ${staminaBaseline(perfectedLines.after)} on line ${perfectedLines.after}`,
          );
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
    expect(failures).toEqual([]);
  });
});
