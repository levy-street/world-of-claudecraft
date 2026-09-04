// The bestBy near-tie-CHAIN census, derived from the shipped tables.
//
// src/sim/dev_kit.ts judges a tie inside a RELATIVE epsilon band rather than by
// exact equality, and its header owns the caveat that comes with that: "a CHAIN
// of distinct near-ties about 1.5 bands apart is order-sensitive in principle,
// unreachable from the shipped tables whose pool order (Object.values(ITEMS)) is
// fixed and host-identical". Unreachable is a claim about CONTENT, and content
// is what keeps changing: the claim was last verified by a one-off census, and
// several content phases have shipped since, so it had been quietly aging with
// nothing to say when a new item finally lands inside a band.
//
// This file mechanizes that census. It sweeps every role's real candidate pools,
// scores them with the module's own exported scorer, and asserts that no pool
// contains a chain of in-band neighbours whose ENDPOINTS are out of band, which
// is exactly the shape the caveat names. It tunes nothing and reads nothing but
// the live tables.
//
// TWO MIRRORS, both named rather than imported, because bestBy and
// SCORE_TIE_EPSILON are module-private with no test seam: the epsilon value and
// the band formula. Their job here is narrow (they decide only how wide a "near
// tie" is), and the non-vacuity arm below proves the mirror is live by finding
// real in-band pairs with it. A change to either in dev_kit.ts must be mirrored
// here in the same edit.
import { describe, expect, it } from 'vitest';
import { DEV_KIT_ROLES, type DevKitRole } from '../src/sim/content/dev_kit_roles';
import { ITEMS } from '../src/sim/data';
import { isFreshTwentyItem, roleItemScore } from '../src/sim/dev_kit';
import { canEquipItem, canEquipItemInSlot, isShieldItem } from '../src/sim/equipment_rules';
import { ALL_CLASSES, type EquipSlot, type ItemDef, type PlayerClass } from '../src/sim/types';

// MIRRORED, NOT IMPORTED. Both values below are copies of module-private code in
// src/sim/dev_kit.ts (`SCORE_TIE_EPSILON` and the band expression inside
// `bestBy`), because neither is exported and there is no test seam to reach
// them through. A mirrored constant is a pin that can silently DRIFT: if either
// moves in dev_kit.ts and not here, this whole file keeps passing while
// measuring a band the module no longer uses, and it will say nothing. Two
// consequences follow, and both are deliberate. Editing either one in
// dev_kit.ts means editing it here in the SAME change. And the "band mirror is
// LIVE" case below exists to make the drift expensive rather than silent: it
// fails if this epsilon stops finding real in-band pairs in the shipped pools,
// which is what a mirror gone stale in either direction looks like from here.

/** Mirrors SCORE_TIE_EPSILON (src/sim/dev_kit.ts). See the MIRRORED note above. */
const SCORE_TIE_EPSILON = 1e-9;
/** Mirrors bestBy's band (src/sim/dev_kit.ts): relative to the larger magnitude,
 *  with a floor of 1. See the MIRRORED note above. */
function band(a: number, b: number): number {
  return SCORE_TIE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/** The armour and jewelry slots buildDevKit fills, in its own KIT_SLOTS order. */
const KIT_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
];

interface Pool {
  readonly label: string;
  readonly items: readonly ItemDef[];
}

/** Every candidate pool a kit build for (cls, role) hands to bestBy. */
function poolsFor(cls: PlayerClass, role: DevKitRole): Pool[] {
  const fresh = Object.values(ITEMS).filter((item) => isFreshTwentyItem(cls, item));
  const spec = role.spec;
  const pools: Pool[] = [];
  for (const slot of KIT_SLOTS) {
    pools.push({
      label: `${cls}/${spec} ${slot}`,
      items: fresh.filter((item) => canEquipItemInSlot(cls, item, slot, spec)),
    });
  }
  const weapons = fresh.filter((item) => canEquipItemInSlot(cls, item, 'mainhand', spec));
  pools.push({ label: `${cls}/${spec} mainhand`, items: weapons });
  const oneHanders = weapons.filter((item) => !(item.kind === 'weapon' && item.hand === 'twohand'));
  pools.push({ label: `${cls}/${spec} one-handers`, items: oneHanders });
  pools.push({
    label: `${cls}/${spec} shields`,
    items: fresh.filter(
      (item) => isShieldItem(item) && canEquipItemInSlot(cls, item, 'offhand', spec),
    ),
  });
  pools.push({
    label: `${cls}/${spec} held offhands`,
    items: fresh.filter((item) => item.kind === 'held_offhand' && canEquipItem(cls, item)),
  });
  return pools;
}

interface Chain {
  readonly pool: string;
  readonly low: number;
  readonly high: number;
  readonly members: number;
}

/**
 * A chain is a maximal run of scores where each neighbour is inside the band of
 * the one before it, but the run's own endpoints are NOT. Scores are sorted
 * first, which is what makes adjacency the right relation: if two values are
 * within a band, every value between them is too.
 */
function chainsIn(scores: readonly number[]): Chain[] {
  const sorted = [...scores].sort((a, b) => a - b);
  const found: Chain[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] - sorted[j] <= band(sorted[j], sorted[j + 1])) {
      j += 1;
    }
    if (j > i && sorted[j] - sorted[i] > band(sorted[i], sorted[j])) {
      found.push({ pool: '', low: sorted[i], high: sorted[j], members: j - i + 1 });
    }
    i = j + 1;
  }
  return found;
}

interface GapStats {
  /** Neighbour pairs whose scores are bit-identical. */
  readonly exactTies: number;
  /** Neighbour pairs inside the band but NOT equal: the ulp case. */
  readonly nearTies: number;
  /** The largest such near gap, the step size a chain would have to climb by. */
  readonly largestNearGap: number;
  /** The smallest gap that is a real difference rather than a tie. */
  readonly smallestOutOfBand: number;
  /** The widest band any comparison in the sweep opens. */
  readonly widestBand: number;
}

/** One walk over every role pool, classifying every sorted neighbour gap. */
function gapStats(): GapStats {
  let exactTies = 0;
  let nearTies = 0;
  let largestNearGap = 0;
  let smallestOutOfBand = Number.POSITIVE_INFINITY;
  let widestBand = 0;
  for (const { cls, role } of everyRole()) {
    for (const pool of poolsFor(cls, role)) {
      const sorted = pool.items.map((item) => roleItemScore(role, item)).sort((a, b) => a - b);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const gap = sorted[i + 1] - sorted[i];
        const width = band(sorted[i], sorted[i + 1]);
        widestBand = Math.max(widestBand, width);
        if (gap > width) {
          smallestOutOfBand = Math.min(smallestOutOfBand, gap);
        } else if (gap === 0) {
          exactTies += 1;
        } else {
          nearTies += 1;
          largestNearGap = Math.max(largestNearGap, gap);
        }
      }
    }
  }
  return { exactTies, nearTies, largestNearGap, smallestOutOfBand, widestBand };
}

function everyRole(): { cls: PlayerClass; role: DevKitRole }[] {
  const out: { cls: PlayerClass; role: DevKitRole }[] = [];
  for (const cls of ALL_CLASSES) {
    for (const role of DEV_KIT_ROLES[cls] ?? []) out.push({ cls, role });
  }
  return out;
}

describe('dev kit bestBy: the near-tie-chain census', () => {
  it('the census really sweeps the shipped roles and non-empty pools', () => {
    // Non-vacuity for the sweep below: a census over 0 roles or empty pools is
    // the way this class of guard goes green while covering nothing.
    const roles = everyRole();
    expect(roles.length, 'roles swept').toBe(27);
    let populated = 0;
    let biggest = 0;
    for (const { cls, role } of roles) {
      for (const pool of poolsFor(cls, role)) {
        if (pool.items.length > 1) populated += 1;
        biggest = Math.max(biggest, pool.items.length);
      }
    }
    expect(populated, 'pools with something to compare').toBeGreaterThan(200);
    expect(biggest, 'the largest candidate pool').toBeGreaterThan(10);
  });

  it('NO role pool holds a chain of distinct near-ties (the dev_kit.ts caveat)', () => {
    const chains: string[] = [];
    for (const { cls, role } of everyRole()) {
      for (const pool of poolsFor(cls, role)) {
        const scores = pool.items.map((item) => roleItemScore(role, item));
        for (const chain of chainsIn(scores)) {
          chains.push(
            `${pool.label}: ${chain.members} scores chained from ${chain.low} to ${chain.high}`,
          );
        }
      }
    }
    expect(
      chains,
      `these pools now hold an order-sensitive near-tie chain: ${chains.join('; ')}`,
    ).toEqual([]);
  });

  it('the band mirror is LIVE: the shipped pools really produce in-band pairs', () => {
    // Without this the chain arm would be satisfied by a band of zero, or by a
    // scorer whose values never come close, and would prove nothing about the
    // caveat. Both halves of the tie population are asserted: the exact ties the
    // scorer produces by construction, AND the ulp-apart pairs that are the
    // whole reason dev_kit judges ties inside a band instead of by equality (the
    // header's rung-25 ring against the rung-50 loop, both exactly 1.8 under the
    // agility weights but one float step apart depending on term order).
    const stats = gapStats();
    expect(stats.exactTies, 'exact ties across the shipped pools').toBeGreaterThan(100);
    expect(stats.nearTies, 'ulp-apart in-band pairs, the case the band exists for').toBeGreaterThan(
      0,
    );
    expect(stats.widestBand, 'the widest band in the sweep').toBeGreaterThan(0);
  });

  it('the gap population is SEPARATED, which is what makes a chain unreachable', () => {
    // The mechanism behind "unreachable", derived rather than asserted. Every
    // neighbour gap in the whole sweep is one of two things, with nothing in
    // between: a tie at float resolution, or a real difference three orders of
    // magnitude ABOVE the widest band. A chain needs a rung in the gap between
    // those populations, and there is none.
    const stats = gapStats();
    expect(
      stats.smallestOutOfBand / stats.widestBand,
      `smallest real gap ${stats.smallestOutOfBand} against widest band ${stats.widestBand}`,
    ).toBeGreaterThan(1e3);
    // And from the other side: an in-band pair is never merely near. The widest
    // band is astronomically many float steps wide, so a chain spanning one
    // would need that many DISTINCT members, which no catalog can hold.
    expect(
      stats.widestBand / stats.largestNearGap,
      `members a chain would need to span one band (near gap ${stats.largestNearGap})`,
    ).toBeGreaterThan(1e6);
  });
});
