import { describe, expect, it } from 'vitest';
import {
  lockoutBadgeUnit,
  lockoutParts,
  lockoutShape,
  soonestLockout,
} from '../src/ui/raid_lockout';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('lockoutParts', () => {
  it('splits a span into whole days/hours/minutes', () => {
    expect(lockoutParts(2 * DAY + 3 * HOUR + 15 * MIN)).toEqual({ days: 2, hours: 3, minutes: 15 });
    expect(lockoutParts(5 * HOUR + 12 * MIN)).toEqual({ days: 0, hours: 5, minutes: 12 });
    expect(lockoutParts(47 * MIN)).toEqual({ days: 0, hours: 0, minutes: 47 });
  });

  it('rounds the minute UP so a partial minute never reads as 0m while locked', () => {
    expect(lockoutParts(30_000)).toEqual({ days: 0, hours: 0, minutes: 1 }); // 30s -> 1m
    expect(lockoutParts(HOUR + 1)).toEqual({ days: 0, hours: 1, minutes: 1 }); // 1h + 1ms -> rounds the trailing ms up
  });

  it('clamps a non-positive span to zero', () => {
    expect(lockoutParts(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(lockoutParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe('lockoutShape', () => {
  it('picks the two coarsest non-zero units', () => {
    expect(lockoutShape(2 * DAY + 3 * HOUR)).toBe('daysHours');
    expect(lockoutShape(5 * HOUR + 12 * MIN)).toBe('hoursMinutes');
    expect(lockoutShape(47 * MIN)).toBe('minutes');
  });

  it('uses lessThanMinute for a sub-minute tail', () => {
    expect(lockoutShape(30_000)).toBe('lessThanMinute');
    expect(lockoutShape(0)).toBe('lessThanMinute');
  });
});

describe('lockoutBadgeUnit', () => {
  it('returns the single coarsest unit for the badge glyph', () => {
    expect(lockoutBadgeUnit(2 * DAY + 3 * HOUR)).toEqual({ value: 2, unit: 'd' });
    expect(lockoutBadgeUnit(5 * HOUR + 12 * MIN)).toEqual({ value: 5, unit: 'h' });
    expect(lockoutBadgeUnit(47 * MIN)).toEqual({ value: 47, unit: 'm' });
  });

  it('never shows 0m while still locked (floors at 1m)', () => {
    expect(lockoutBadgeUnit(20_000)).toEqual({ value: 1, unit: 'm' });
  });
});

describe('soonestLockout', () => {
  it('returns null for no lockouts', () => {
    expect(soonestLockout([])).toBeNull();
    expect(soonestLockout([{ id: 'a', msRemaining: 0 }])).toBeNull();
  });

  it('returns the smallest positive remaining', () => {
    const set = [
      { id: 'nythraxis_boss_arena', msRemaining: 5 * HOUR },
      { id: 'abyssal_maw', msRemaining: 2 * HOUR },
    ];
    expect(soonestLockout(set)?.id).toBe('abyssal_maw');
  });

  it('breaks ties by id for determinism', () => {
    const set = [
      { id: 'zeta', msRemaining: HOUR },
      { id: 'alpha', msRemaining: HOUR },
    ];
    expect(soonestLockout(set)?.id).toBe('alpha');
  });
});
