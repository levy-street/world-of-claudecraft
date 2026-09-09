// The localized raid lockout countdown (src/ui/raid_lockout_format.ts): the
// thin t() layer over the pure raid_lockout core. tests/raid_lockout.test.ts
// pins the parts and the shape; this file pins the rendered English string
// each shape produces, including the two details a regression would lose
// quietly: the sub-minute tail never reads "0m", and the digits stay
// ungrouped however long the lockout.

import { describe, expect, it } from 'vitest';
import { formatLockoutDuration } from '../src/ui/raid_lockout_format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatLockoutDuration', () => {
  it('renders the two coarsest units for a multi-day lockout', () => {
    expect(formatLockoutDuration(2 * DAY + 3 * HOUR + 15 * MIN)).toBe('2d 3h');
  });

  it('renders hours and minutes inside a day', () => {
    expect(formatLockoutDuration(5 * HOUR + 12 * MIN)).toBe('5h 12m');
  });

  it('renders bare minutes under an hour', () => {
    expect(formatLockoutDuration(47 * MIN)).toBe('47m');
  });

  it('renders the sub-minute tail as <1m, never 0m, and degrades the same at zero', () => {
    expect(formatLockoutDuration(30_000)).toBe('<1m');
    expect(formatLockoutDuration(0)).toBe('<1m');
  });

  it('keeps the digits ungrouped so a long lockout never gains a thousands separator', () => {
    expect(formatLockoutDuration(1200 * DAY)).toBe('1200d 0h');
  });
});
