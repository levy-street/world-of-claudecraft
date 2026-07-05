import { describe, expect, it } from 'vitest';
import { accountStatusFor } from '../../src/admin/account_status';

describe('accountStatusFor', () => {
  const now = new Date('2026-06-28T12:00:00Z').getTime();

  it('prioritizes a ban over any suspension', () => {
    expect(
      accountStatusFor(
        {
          bannedAt: '2026-06-01T00:00:00Z',
          suspendedUntil: '2026-07-01T00:00:00Z',
        },
        now,
      ),
    ).toBe('banned');
  });

  it('distinguishes active and expired suspensions', () => {
    expect(accountStatusFor({ bannedAt: null, suspendedUntil: '2026-06-29T00:00:00Z' }, now)).toBe(
      'suspended',
    );
    expect(accountStatusFor({ bannedAt: null, suspendedUntil: '2026-06-27T00:00:00Z' }, now)).toBe(
      'active',
    );
    expect(accountStatusFor({ bannedAt: null, suspendedUntil: null }, now)).toBe('active');
  });
});
