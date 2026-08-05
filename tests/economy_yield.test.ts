// Guards the open-world farm ECONOMY: the per-cluster gold and XP ceilings, the
// coin-per-level curve, and the harvest-tag standard for coinless families.
// Model: tests/helpers/farm_yield.ts.
import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { CAMPS, MOBS, zoneContaining } from '../src/sim/data';
import type { MobTemplate } from '../src/sim/types';
import { mobXpValue } from '../src/sim/types';
import { coinEvPerKill, itemEvPerKill, worldFarmClusters, xpPerKill } from './helpers/farm_yield';

// Budgets are pinned ~25% above the shipped maxima, so ordinary content tuning
// has room while a structural regression (a respawn tier cut, a coin fill an
// order of magnitude off, a camp merge) trips the guard.

/** Protects the richest cluster: Thornpeak's Glimmermere corridor at 27.5 gold/hr. */
const MAX_CLUSTER_COPPER_PER_HOUR = 344_000;
/** Protects the fastest XP cluster: the same corridor at 183k XP/hr. */
const MAX_CLUSTER_XP_PER_HOUR = 229_000;

/** Coin-carrying families: things that plausibly hold a purse. */
const COIN_FAMILIES = new Set([
  'humanoid',
  'undead',
  'troll',
  'ogre',
  'kobold',
  'murloc',
  'mudfin',
  'dragonkin',
  'demon',
  'elemental',
  'burrower',
]);
/** Families that pay in harvestable components rather than coin. */
const HARVEST_FAMILIES = new Set(['beast', 'spider', 'reptile']);
/**
 * Evergarden and Galecrest topiary are garden CONSTRUCTS typed as beasts: they
 * are clipped hedge, so they carry coin (the gardeners' lost pay) and have no
 * hide or meat to take. The only sanctioned exception to the harvest rule.
 */
const HEDGE_CONSTRUCTS = new Set(['topiary_stag', 'topiary_wolf', 'the_topiary_bull']);

/** The population the zone respawn tiers govern (see tests/camp_density.test.ts). */
function isTrash(template: MobTemplate): boolean {
  return (
    !template.rare &&
    !template.boss &&
    !template.dummy &&
    !template.ambient &&
    template.respawnMult === undefined
  );
}

/** Every distinct camp-spawned template, with the zone its camp sits in. */
function campTemplates(): { template: MobTemplate; zoneLevelCap: number; zoneId: string }[] {
  const seen = new Set<string>();
  const out: { template: MobTemplate; zoneLevelCap: number; zoneId: string }[] = [];
  for (const camp of CAMPS) {
    const template = MOBS[camp.mobId];
    if (!template || seen.has(camp.mobId)) continue;
    const zone = zoneContaining(camp.center.x, camp.center.z);
    if (!zone) continue;
    seen.add(camp.mobId);
    out.push({ template, zoneLevelCap: zone.levelRange[1], zoneId: zone.id });
  }
  return out;
}

describe('per-cluster farm ceilings stay under budget', () => {
  it('keeps every cluster under the gold ceiling', () => {
    const over = worldFarmClusters()
      .filter((c) => c.copperPerHour > MAX_CLUSTER_COPPER_PER_HOUR)
      .map((c) => `${c.mobIds.join(', ')}: ${(c.copperPerHour / 10_000).toFixed(1)}g/hr`);
    expect(over).toEqual([]);
  });

  it('keeps every cluster under the XP ceiling', () => {
    const over = worldFarmClusters()
      .filter((c) => c.xpPerHour > MAX_CLUSTER_XP_PER_HOUR)
      .map((c) => `${c.mobIds.join(', ')}: ${Math.round(c.xpPerHour)} xp/hr`);
    expect(over).toEqual([]);
  });

  it('has real headroom rather than budgets set above anything reachable', () => {
    // Guards the opposite failure: a budget so loose it can never trip. The
    // shipped maxima must sit within 40% of their ceilings.
    const clusters = worldFarmClusters();
    const gold = Math.max(...clusters.map((c) => c.copperPerHour));
    const xp = Math.max(...clusters.map((c) => c.xpPerHour));
    expect(gold).toBeGreaterThan(MAX_CLUSTER_COPPER_PER_HOUR * 0.6);
    expect(xp).toBeGreaterThan(MAX_CLUSTER_XP_PER_HOUR * 0.6);
  });

  it('would trip on BOTH dimensions if a tier were cut back to the old flat timer', () => {
    // Negative control: the pre-change 25s respawn made Thornpeak's corridor pay
    // multiples of both budgets, which is the regression these ceilings exist
    // for. Both arms are checked; a control that only exercised copper would
    // leave the XP ceiling with no proof it can ever trip.
    const asIfFlat = worldFarmClusters().map((c) => {
      const scale = (y: (typeof c.camps)[number]) => (y.camp.count / 25) * 3600;
      return {
        copper: c.camps.reduce(
          (n, y) => n + scale(y) * (coinEvPerKill(y.template) + itemEvPerKill(y.template)),
          0,
        ),
        xp: c.camps.reduce((n, y) => n + scale(y) * xpPerKill(y.template, y.level), 0),
      };
    });
    expect(Math.max(...asIfFlat.map((c) => c.copper))).toBeGreaterThan(MAX_CLUSTER_COPPER_PER_HOUR);
    expect(Math.max(...asIfFlat.map((c) => c.xp))).toBeGreaterThan(MAX_CLUSTER_XP_PER_HOUR);
  });
});

describe('coin-family trash sits on the coin curve', () => {
  // About 5 copper per mob level: the curve the pre-expansion zones were built
  // on, now applied to every zone past the starter bands.
  const MIN_COPPER_PER_LEVEL = 3.5;
  const MAX_COPPER_PER_LEVEL = 7.0;

  const governed = () =>
    campTemplates().filter(
      ({ template, zoneLevelCap }) =>
        isTrash(template) && COIN_FAMILIES.has(template.family) && zoneLevelCap >= 8,
    );

  it('checks a real population, not an empty set', () => {
    // 52 ship today; the floor sits at the real count, not comfortably under it.
    expect(governed().length).toBeGreaterThanOrEqual(52);
  });

  it('pays every coin-family trash mob within the curve band', () => {
    const off = governed()
      .map(({ template, zoneId }) => {
        const level = (template.minLevel + template.maxLevel) / 2;
        return { id: template.id, zoneId, perLevel: coinEvPerKill(template) / level };
      })
      .filter((r) => r.perLevel < MIN_COPPER_PER_LEVEL || r.perLevel > MAX_COPPER_PER_LEVEL)
      .map((r) => `${r.id} (${r.zoneId}): ${r.perLevel.toFixed(2)} c/level`);
    expect(off).toEqual([]);
  });

  it('pays that coin as a GUARANTEED drop, not a lottery', () => {
    // A 5%-chance 2000c entry would average onto the curve while playing nothing
    // like it; require a certain coin entry on every governed mob.
    const missing = governed()
      .filter(({ template }) => !template.loot.some((l) => l.copper && l.chance === 1))
      .map(({ template }) => template.id);
    expect(missing).toEqual([]);
  });

  it('rejects an over-curve AND an under-curve template, so both edges bite', () => {
    // Per-dimension negative controls. Without the second one, setting
    // MIN_COPPER_PER_LEVEL to 0 would leave every assertion above green, so the
    // "a coin fill an order of magnitude off" regression is caught one way only.
    const crusher = MOBS.ogre_crusher;
    const level = (crusher.minLevel + crusher.maxLevel) / 2;
    expect(coinEvPerKill(crusher) / level).toBeGreaterThanOrEqual(MIN_COPPER_PER_LEVEL);
    expect(coinEvPerKill(crusher) / level).toBeLessThanOrEqual(MAX_COPPER_PER_LEVEL);
    // The pre-trim value was over the top of the band...
    expect(200 / level).toBeGreaterThan(MAX_COPPER_PER_LEVEL);
    // ...and a tenth of the shipped fill would be under the bottom of it.
    expect(coinEvPerKill(crusher) / 10 / level).toBeLessThan(MIN_COPPER_PER_LEVEL);
  });
});

describe('harvest-family trash carries usable components instead of coin', () => {
  const governed = () =>
    campTemplates().filter(
      ({ template }) =>
        isTrash(template) &&
        HARVEST_FAMILIES.has(template.family) &&
        !HEDGE_CONSTRUCTS.has(template.id),
    );

  it('checks a real population, per family, so no arm is silently empty', () => {
    const byFamily = new Map<string, number>();
    for (const { template } of governed())
      byFamily.set(template.family, (byFamily.get(template.family) ?? 0) + 1);
    // 16 beasts and 4 spiders ship as camp trash today; floors sit at the real
    // counts so thinning the population fails here instead of going unnoticed.
    // Gloam Strider moved from beast to reptile (#2672), so reptile now has a
    // camp-spawned member too.
    expect(byFamily.get('beast') ?? 0).toBeGreaterThanOrEqual(16);
    expect(byFamily.get('spider') ?? 0).toBeGreaterThanOrEqual(4);
    expect(byFamily.get('reptile') ?? 0).toBeGreaterThanOrEqual(1);
    expect(governed().length).toBeGreaterThanOrEqual(21);
  });

  it('gives every beast, spider and reptile at least one HARVESTABLE tag', () => {
    // Mapped in HARVEST_COMPONENT_ITEMS specifically: unmapped tags like claw and
    // tusk are dead weight the corpse-harvest command cannot turn into an item.
    const bare = governed()
      .filter(
        ({ template }) =>
          !(template.componentTags ?? []).some((tag) => tag in HARVEST_COMPONENT_ITEMS),
      )
      .map(({ template, zoneId }) => `${template.id} (${zoneId})`);
    expect(bare).toEqual([]);
  });

  it('rejects an unmapped-only tag set, running the same predicate as the rule', () => {
    // Negative control that actually exercises the check above rather than
    // restating the map's contents: a synthetic mob carrying only unmapped tags
    // must be reported as bare, and one carrying a mapped tag must not.
    const bareOf = (tags: string[]) =>
      [{ componentTags: tags }].filter(
        (t) => !(t.componentTags ?? []).some((tag) => tag in HARVEST_COMPONENT_ITEMS),
      ).length;
    expect(bareOf(['claw', 'tusk'])).toBe(1);
    expect(bareOf(['hide'])).toBe(0);
    expect(bareOf(['claw', 'hide'])).toBe(0);
    expect(bareOf([])).toBe(1);
  });

  it('keeps the hedge constructs on coin, the one sanctioned exception', () => {
    for (const id of HEDGE_CONSTRUCTS) {
      const template = MOBS[id];
      expect(template, id).toBeDefined();
      expect(coinEvPerKill(template), id).toBeGreaterThan(0);
    }
  });
});

describe('the yield model matches the sim it is modelling', () => {
  it('prices kill XP the way the damage core grants it', () => {
    // Mirrors combat/damage.ts: mobXpValue(level, level) * (elite ? 2 : 1) * xpMult.
    const wolf = MOBS.forest_wolf;
    expect(xpPerKill(wolf, 2)).toBe(mobXpValue(2, 2));
    const elite = MOBS.ogre_crusher;
    expect(elite.elite).toBe(true);
    expect(xpPerKill(elite, 17)).toBe(mobXpValue(17, 17) * 2);
  });

  it('counts guaranteed and chance coin, and ignores quest-only drops', () => {
    const wader = MOBS.glimmermere_wader;
    expect(coinEvPerKill(wader)).toBe(70);
    // Quest entries never contribute to sustainable income.
    const questOnly = MOBS.gilded_stag;
    expect(questOnly.loot.every((l) => !l.copper)).toBe(true);
    expect(coinEvPerKill(questOnly)).toBe(0);
    expect(itemEvPerKill(questOnly)).toBe(0);
  });
});
