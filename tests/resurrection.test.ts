// The shared death/respawn leaf module (src/sim/resurrection.ts): the level-scaled
// Resurrection Sickness ("The Keeper's Toll") duration and the "which auras survive
// death" predicate, shared by every player death/respawn site so the rule cannot drift.

import { describe, expect, it } from 'vitest';
import {
  aurasSurvivingDeath,
  RES_SICKNESS_DURATION,
  RES_SICKNESS_MIN_DURATION,
  RES_SICKNESS_MIN_LEVEL,
  RESURRECTION_SICKNESS_ID,
  resSicknessDuration,
} from '../src/sim/resurrection';
import { type Aura, MAX_LEVEL } from '../src/sim/types';

// A minimal valid Aura carrying an id; the predicate reads only `id`, the rest satisfies
// the type.
function aura(id: string): Aura {
  return {
    id,
    name: id,
    kind: 'buff_allstats_pct',
    remaining: 10,
    duration: 10,
    value: -0.75,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('resurrection: level-scaled sickness duration', () => {
  it('is zero below the minimum level (classic exemption)', () => {
    expect(resSicknessDuration(1)).toBe(0);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL - 1)).toBe(0);
  });

  it('is exactly the minimum duration at the minimum level', () => {
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL)).toBe(RES_SICKNESS_MIN_DURATION);
  });

  it('is the full duration at max level', () => {
    expect(resSicknessDuration(MAX_LEVEL)).toBe(RES_SICKNESS_DURATION);
  });

  it('scales linearly and monotonically between the bounds', () => {
    const mid = (RES_SICKNESS_MIN_LEVEL + MAX_LEVEL) / 2;
    const expected = Math.round(
      RES_SICKNESS_MIN_DURATION + 0.5 * (RES_SICKNESS_DURATION - RES_SICKNESS_MIN_DURATION),
    );
    expect(resSicknessDuration(mid)).toBe(expected);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL + 1)).toBeGreaterThan(
      RES_SICKNESS_MIN_DURATION,
    );
    expect(resSicknessDuration(MAX_LEVEL - 1)).toBeLessThan(RES_SICKNESS_DURATION);
  });
});

describe('resurrection: aurasSurvivingDeath predicate', () => {
  it('keeps only Resurrection Sickness and drops every other aura', () => {
    const auras = [aura('rejuvenation'), aura(RESURRECTION_SICKNESS_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(RESURRECTION_SICKNESS_ID);
  });

  it('keeps encounter-owned unbreakable control until its script releases it', () => {
    const scriptedStun = { ...aura('scripted_stun'), unbreakableControl: true } as const;

    expect(aurasSurvivingDeath([aura('rejuvenation'), scriptedStun])).toEqual([scriptedStun]);
  });

  it('returns an empty list when nothing survives', () => {
    expect(aurasSurvivingDeath([aura('rejuvenation')])).toEqual([]);
    expect(aurasSurvivingDeath([])).toEqual([]);
  });

  it('does not mutate the input array (immutable filter)', () => {
    const auras = [aura(RESURRECTION_SICKNESS_ID), aura('rejuvenation')];
    aurasSurvivingDeath(auras);
    expect(auras).toHaveLength(2);
  });
});
