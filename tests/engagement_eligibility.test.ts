import { describe, expect, it } from 'vitest';
import { evaluateEligibility, EligibilityInput } from '../server/engagement_eligibility';

const ok: EligibilityInput = {
  walletLinked: true,
  balanceWoc: 1000,
  minWoc: 1000,
  antibotPassed: true,
  alreadySpunToday: false,
};

describe('evaluateEligibility', () => {
  it('passes a fully qualified holder at exactly the minimum balance', () => {
    expect(evaluateEligibility(ok, true)).toEqual({ ok: true });
    expect(evaluateEligibility({ ...ok, balanceWoc: 1_000_000 }, true)).toEqual({ ok: true });
  });

  it('reports the single most fundamental failure in precedence order', () => {
    // Feature off wins over everything, even a totally broken input.
    expect(
      evaluateEligibility({ walletLinked: false, balanceWoc: null, minWoc: 1000, antibotPassed: false, alreadySpunToday: true }, false),
    ).toEqual({ ok: false, reason: 'spin_disabled' });
    expect(evaluateEligibility({ ...ok, walletLinked: false }, true).reason).toBe('no_wallet');
    expect(evaluateEligibility({ ...ok, balanceWoc: null }, true).reason).toBe('balance_unknown');
    expect(evaluateEligibility({ ...ok, balanceWoc: 999.999 }, true).reason).toBe('below_min');
    expect(evaluateEligibility({ ...ok, antibotPassed: false }, true).reason).toBe('antibot');
    expect(evaluateEligibility({ ...ok, alreadySpunToday: true }, true).reason).toBe('already_spun');
  });

  it('treats a null (failed-read) balance as ineligible, never as zero or a pass', () => {
    expect(evaluateEligibility({ ...ok, balanceWoc: null }, true)).toEqual({ ok: false, reason: 'balance_unknown' });
  });

  it('honors a custom minimum threshold', () => {
    expect(evaluateEligibility({ ...ok, minWoc: 5000, balanceWoc: 4999 }, true).reason).toBe('below_min');
    expect(evaluateEligibility({ ...ok, minWoc: 5000, balanceWoc: 5000 }, true)).toEqual({ ok: true });
  });
});
