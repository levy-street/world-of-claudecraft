// durationText (src/ui/duration_text.ts): the shared multi-unit phrase behind
// the Exchange countdowns, the claim_cooldown retry line, and the p2p payment
// hold note. Pinned against the Intl unit formatter itself, never against a
// restated English literal, so a locale switch cannot fake a pass; the one
// literal pin is the shape the module exists to prevent (a raw seconds count
// for a half-hour cooldown).
import { describe, expect, it } from 'vitest';
import { durationText } from '../src/ui/duration_text';
import { formatDuration, formatNumber } from '../src/ui/i18n';

const unit = (value: number, unitName: 'day' | 'hour' | 'minute') =>
  formatNumber(value, { style: 'unit', unit: unitName, unitDisplay: 'long' });

describe('durationText', () => {
  it('picks the largest whole unit that fits', () => {
    expect(durationText(45)).toBe(formatDuration(45));
    expect(durationText(60)).toBe(unit(1, 'minute'));
    expect(durationText(1_800)).toBe(unit(30, 'minute'));
    expect(durationText(3_599)).toBe(unit(59, 'minute'));
    expect(durationText(3_600)).toBe(unit(1, 'hour'));
    expect(durationText(5_400), 'truncates to whole hours').toBe(unit(1, 'hour'));
    expect(durationText(172_799)).toBe(unit(47, 'hour'));
    expect(durationText(172_800)).toBe(unit(2, 'day'));
  });

  it('never renders a raw seconds count for a half-hour cooldown', () => {
    // The claim_cooldown retry line used to say "Try again in 1,800 seconds".
    expect(durationText(1_800)).not.toContain('1,800');
    expect(durationText(1_800)).not.toContain('1800');
  });

  it('rounds up to a whole second and floors at zero', () => {
    expect(durationText(0.2)).toBe(formatDuration(1));
    expect(durationText(-5)).toBe(formatDuration(0));
  });
});
