// The nameplate dot row's pure core: which of an entity's auras become icons on
// its plate, in what order, and how much height the row costs the plate.
//
// The load-bearing claims, each pinned with a case that would fail if the rule
// were dropped: only the LOCAL player's auras, only harmful ones, class-agnostic
// selection, a stable id order that never re-sorts by remaining time, the cap,
// the artwork invalidation on a recycled slot, and the height contract that
// drawBase and drawEmote both consume.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  NAMEPLATE_DOT_SCHOOL_DEFAULT_TINT,
  NAMEPLATE_DOT_SCHOOL_TINTS,
} from '../src/render/nameplate_dot_row';

import {
  clampNameplateDotScale,
  NAMEPLATE_DOT_CAP,
  NAMEPLATE_DOT_DECIMAL_BELOW_SEC,
  NAMEPLATE_DOT_GAP,
  NAMEPLATE_DOT_SCALE_MAX,
  NAMEPLATE_DOT_SCALE_MIN,
  NAMEPLATE_DOT_SIZE,
  type NameplateDotAura,
  nameplateDotRowHeight,
  nameplateDotRowWidth,
  nameplateDotsInto,
  newNameplateDotsPlan,
} from '../src/render/nameplate_dots_core';
import type { AuraKind } from '../src/sim/types';

const MINE = 7;
const THEIRS = 9;

function aura(over: Partial<NameplateDotAura> & { id: string }): NameplateDotAura {
  return {
    kind: 'dot' as AuraKind,
    value: 5,
    remaining: 10,
    duration: 20,
    school: 'shadow',
    sourceId: MINE,
    ...over,
  };
}

const isMine = (a: NameplateDotAura): boolean => a.sourceId === MINE;

describe('nameplateDotsInto', () => {
  it('keeps only the local player s own auras', () => {
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [aura({ id: 'corruption' }), aura({ id: 'immolate', sourceId: THEIRS })],
      isMine,
    );
    expect(plan.count).toBe(1);
    expect(plan.slots[0].iconKey).toBe('corruption');
  });

  it('drops another caster s copy of the very same aura id', () => {
    // The ownership rule has to survive the case the target strip exists for:
    // two casters maintaining the identical dot on one enemy.
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [
        aura({ id: 'corruption', sourceId: THEIRS, remaining: 18 }),
        aura({ id: 'corruption', remaining: 3 }),
      ],
      isMine,
    );
    expect(plan.count).toBe(1);
    expect(plan.slots[0].remaining).toBe(3);
  });

  it('keeps only harmful auras, not the player s own buffs on the unit', () => {
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [
        aura({ id: 'corruption' }),
        aura({ id: 'blessing', kind: 'buff_ap' as AuraKind, value: 40 }),
      ],
      isMine,
    );
    expect(plan.count).toBe(1);
    expect(plan.slots[0].iconKey).toBe('corruption');
  });

  it('selects across classes without any ability list', () => {
    // One aura from each of four class kits, across four different AuraKinds,
    // all owned and all harmful: the row is class-agnostic or this fails.
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [
        aura({ id: 'corruption', kind: 'dot' as AuraKind, school: 'shadow' }),
        aura({ id: 'crippling_poison', kind: 'slow' as AuraKind, school: 'nature' }),
        aura({ id: 'faerie_fire', kind: 'faerie_fire' as AuraKind, school: 'nature' }),
        aura({ id: 'sunder_armor', kind: 'sunder' as AuraKind, school: 'physical' }),
      ],
      isMine,
      4,
    );
    expect(plan.count).toBe(4);
    expect(plan.slots.slice(0, 4).map((s) => s.iconKey)).toEqual([
      'corruption',
      'crippling_poison',
      'faerie_fire',
      'sunder_armor',
    ]);
  });

  it('drops an aura that has already run out', () => {
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [aura({ id: 'corruption', remaining: 0 })],
      isMine,
    );
    expect(plan.count).toBe(0);
  });

  it('orders by aura id and never re-sorts as time runs down', () => {
    // The whole point of the stable order: a dot ticking toward zero must not
    // move under the player's eyes. Same set, different remaining values, same
    // row order both times.
    const first = nameplateDotsInto(
      newNameplateDotsPlan(),
      [aura({ id: 'zed', remaining: 19 }), aura({ id: 'alpha', remaining: 2 })],
      isMine,
    );
    expect(first.slots.slice(0, 2).map((s) => s.iconKey)).toEqual(['alpha', 'zed']);
    const second = nameplateDotsInto(
      newNameplateDotsPlan(),
      [aura({ id: 'zed', remaining: 1 }), aura({ id: 'alpha', remaining: 18 })],
      isMine,
    );
    expect(second.slots.slice(0, 2).map((s) => s.iconKey)).toEqual(['alpha', 'zed']);
  });

  it('caps the row and keeps the first ids by that order', () => {
    const auras = ['e', 'd', 'c', 'b', 'a'].map((id) => aura({ id }));
    const plan = nameplateDotsInto(newNameplateDotsPlan(), auras, isMine, 3);
    expect(plan.count).toBe(3);
    expect(plan.slots.slice(0, 3).map((s) => s.iconKey)).toEqual(['a', 'b', 'c']);
  });

  it('defaults to the shipped cap', () => {
    const auras = Array.from({ length: NAMEPLATE_DOT_CAP + 3 }, (_, i) => aura({ id: `dot_${i}` }));
    expect(nameplateDotsInto(newNameplateDotsPlan(), auras, isMine).count).toBe(NAMEPLATE_DOT_CAP);
  });

  it('reports the remaining fraction, and reads a permanent aura as full', () => {
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [
        aura({ id: 'a_running', remaining: 5, duration: 20 }),
        aura({ id: 'b_permanent', permanent: true, remaining: 5, duration: 0 }),
      ],
      isMine,
    );
    expect(plan.slots[0].fraction).toBeCloseTo(0.25, 5);
    expect(plan.slots[1].fraction).toBe(1);
  });

  it('asks for a decimal only under the ten-second mark, bracketed at exactly ten', () => {
    // 9.4 and 12 would pass for any threshold between them; these two straddle
    // the constant itself, the shape tests/target_dots_view.test.ts uses.
    expect(NAMEPLATE_DOT_DECIMAL_BELOW_SEC).toBe(10);
    const plan = nameplateDotsInto(
      newNameplateDotsPlan(),
      [
        aura({ id: 'a_under', remaining: NAMEPLATE_DOT_DECIMAL_BELOW_SEC - 0.01 }),
        aura({ id: 'b_at', remaining: NAMEPLATE_DOT_DECIMAL_BELOW_SEC }),
      ],
      isMine,
    );
    expect(plan.slots[0].decimals).toBe(1);
    expect(plan.slots[1].decimals).toBe(0);
  });

  it('invalidates painter-resolved artwork when a slot is recycled', () => {
    // The pooled-record staleness trap: slot 0 must not keep the previous aura's
    // icon when a different aura takes its place.
    const plan = newNameplateDotsPlan();
    nameplateDotsInto(plan, [aura({ id: 'corruption' })], isMine);
    plan.slots[0].iconUrl = 'data:corruption';
    plan.slots[0].timeText = '12';
    plan.slots[0].timeValue = 12;
    nameplateDotsInto(plan, [aura({ id: 'immolate' })], isMine);
    expect(plan.slots[0].iconKey).toBe('immolate');
    // BOTH painter-written fields, not just the artwork: the countdown text is
    // cached against timeValue, so leaving it would print the previous aura's
    // seconds until its own number happened to move.
    expect(plan.slots[0].iconUrl).toBe('');
    expect(plan.slots[0].timeText).toBe('');
    expect(plan.slots[0].timeValue).toBeNaN();
  });

  it('keeps painter-resolved artwork when the same aura stays in its slot', () => {
    const plan = newNameplateDotsPlan();
    nameplateDotsInto(plan, [aura({ id: 'corruption', remaining: 12 })], isMine);
    plan.slots[0].iconUrl = 'data:corruption';
    nameplateDotsInto(plan, [aura({ id: 'corruption', remaining: 11 })], isMine);
    expect(plan.slots[0].iconUrl).toBe('data:corruption');
  });

  it('reuses its slot records across calls', () => {
    const plan = newNameplateDotsPlan();
    nameplateDotsInto(plan, [aura({ id: 'corruption' })], isMine);
    const slot = plan.slots[0];
    nameplateDotsInto(plan, [aura({ id: 'corruption' })], isMine);
    expect(plan.slots[0]).toBe(slot);
  });

  it('empties the plan without shrinking it when nothing qualifies', () => {
    const plan = newNameplateDotsPlan();
    nameplateDotsInto(plan, [aura({ id: 'corruption' })], isMine);
    nameplateDotsInto(plan, [aura({ id: 'corruption', sourceId: THEIRS })], isMine);
    expect(plan.count).toBe(0);
    expect(plan.slots.length).toBe(1);
  });

  it('draws nothing at a zero cap', () => {
    expect(nameplateDotsInto(newNameplateDotsPlan(), [aura({ id: 'x' })], isMine, 0).count).toBe(0);
  });
});

describe('nameplate dot row geometry', () => {
  it('costs the plate no height with no dots', () => {
    expect(nameplateDotRowHeight(0)).toBe(0);
    expect(nameplateDotRowWidth(0)).toBe(0);
  });

  it('costs one fixed height for any non-empty row', () => {
    // drawBase and drawEmote both subtract this; a count-dependent height would
    // have to be mirrored in two places, so the contract is deliberately flat.
    expect(nameplateDotRowHeight(1)).toBeGreaterThan(0);
    expect(nameplateDotRowHeight(NAMEPLATE_DOT_CAP)).toBe(nameplateDotRowHeight(1));
  });

  it('measures the row as icons plus the gaps between them', () => {
    expect(nameplateDotRowWidth(1)).toBe(NAMEPLATE_DOT_SIZE);
    expect(nameplateDotRowWidth(3)).toBe(NAMEPLATE_DOT_SIZE * 3 + NAMEPLATE_DOT_GAP * 2);
  });

  it('stays narrower than the base plate at the shipped cap', () => {
    // The reason the cap is what it is: a wider row stops reading as part of the
    // plate. NAMEPLATE_BASE_WIDTH is 80 (nameplate_pick_core).
    expect(nameplateDotRowWidth(NAMEPLATE_DOT_CAP)).toBeLessThan(80);
  });
});

describe('nameplate dot scale', () => {
  it('clamps to the slider bounds and survives a corrupt stored value', () => {
    expect(clampNameplateDotScale(2)).toBe(2);
    expect(clampNameplateDotScale(0.2)).toBe(NAMEPLATE_DOT_SCALE_MIN);
    expect(clampNameplateDotScale(99)).toBe(NAMEPLATE_DOT_SCALE_MAX);
    // Every NON-FINITE value reads as the minimum, Infinity included: a garbage
    // stored value must fall back to the smallest row, never the largest.
    expect(clampNameplateDotScale(Number.NaN)).toBe(NAMEPLATE_DOT_SCALE_MIN);
    expect(clampNameplateDotScale(Number.POSITIVE_INFINITY)).toBe(NAMEPLATE_DOT_SCALE_MIN);
    expect(clampNameplateDotScale(Number.NEGATIVE_INFINITY)).toBe(NAMEPLATE_DOT_SCALE_MIN);
  });

  it('grows the row in both axes with the scale', () => {
    const height = nameplateDotRowHeight(3, 1);
    const width = nameplateDotRowWidth(3, 1);
    expect(nameplateDotRowHeight(3, 2)).toBeCloseTo(height * 2, 5);
    expect(nameplateDotRowWidth(3, 2)).toBeCloseTo(width * 2, 5);
  });

  it('scales the height the two draw walks reserve by the SAME rule as the width', () => {
    // drawBase subtracts this height and drawEmote mirrors it; a width that grew
    // without the height would push the icons through the name row above.
    for (const scale of [1, 1.5, 3]) {
      expect(nameplateDotRowHeight(2, scale) / nameplateDotRowHeight(2, 1)).toBeCloseTo(scale, 5);
      expect(nameplateDotRowWidth(2, scale) / nameplateDotRowWidth(2, 1)).toBeCloseTo(scale, 5);
    }
  });

  it('costs no height at any scale when the row is empty', () => {
    expect(nameplateDotRowHeight(0, 3)).toBe(0);
    expect(nameplateDotRowWidth(0, 3)).toBe(0);
  });

  it('clamps an out-of-range scale at the geometry too, not only at the setting', () => {
    expect(nameplateDotRowWidth(2, 99)).toBe(nameplateDotRowWidth(2, NAMEPLATE_DOT_SCALE_MAX));
    expect(nameplateDotRowHeight(2, 0)).toBe(nameplateDotRowHeight(2, NAMEPLATE_DOT_SCALE_MIN));
  });

  it('defaults a fresh plan to the minimum scale', () => {
    expect(newNameplateDotsPlan().scale).toBe(NAMEPLATE_DOT_SCALE_MIN);
  });
});

describe('nameplate dot row artwork', () => {
  // The plate row is canvas, so it cannot read a CSS custom property: it
  // re-declares the school hexes as literals. That is a real duplication, and
  // this is what keeps it honest. A tokens.css recolour without the matching
  // edit here would otherwise desync the plate row from the DOM aura strips and
  // the Target dots frame, all of which are meant to read as one school.
  const TOKENS_CSS = readFileSync(
    join(fileURLToPath(new URL('..', import.meta.url)), 'src/styles/tokens.css'),
    'utf8',
  );

  function tokenHex(name: string): string {
    const match = TOKENS_CSS.match(
      new RegExp(`--color-debuff-${name}:[ ]*(#[0-9a-fA-F]{3,8})[ ]*;`),
    );
    if (!match) throw new Error(`--color-debuff-${name} is not declared in tokens.css`);
    return match[1].toLowerCase();
  }

  it('tints each school with the same hex the CSS tokens ship', () => {
    for (const school of ['fire', 'frost', 'arcane', 'shadow', 'nature', 'holy'] as const) {
      expect(NAMEPLATE_DOT_SCHOOL_TINTS[school]).toBe(tokenHex(school));
    }
  });

  it('falls back to the base debuff token for physical and for an unknown school', () => {
    const base = (TOKENS_CSS.match(/--color-debuff:\s*(#[0-9a-fA-F]{3,8})\s*;/) ?? [])[1];
    expect(base).toBeDefined();
    expect(NAMEPLATE_DOT_SCHOOL_TINTS.physical).toBe((base as string).toLowerCase());
    expect(NAMEPLATE_DOT_SCHOOL_DEFAULT_TINT).toBe((base as string).toLowerCase());
  });

  it('covers every school the DOM strips tint, and no more', () => {
    // Drift in either direction is a desync: a school the strips tint and the
    // plate does not falls back to red, and one only the plate knows is dead.
    const cssSchools = [...TOKENS_CSS.matchAll(/--color-debuff-([a-z]+):/g)]
      .map((m) => m[1])
      .sort();
    expect(Object.keys(NAMEPLATE_DOT_SCHOOL_TINTS).sort()).toEqual(
      [...cssSchools, 'physical'].sort(),
    );
  });
});
