import { describe, expect, it } from 'vitest';
import { AccountAdmissionTracker, accountAdmissionsFor } from '../server/account_admission';

const authority = (accountId: number, scope = 'full') => ({ accountId, scope });

describe('account admission invalidation', () => {
  it('requires a live full-scope token for the same account', () => {
    const tracker = new AccountAdmissionTracker();
    const pending = tracker.begin(1);
    expect(pending.allows(authority(1))).toBe(true);
    expect(pending.allows(null)).toBe(false);
    expect(pending.allows(authority(2))).toBe(false);
    expect(pending.allows(authority(1, 'read'))).toBe(false);
    expect(pending.allows(authority(1, 'unknown'))).toBe(false);
    pending.release();
    expect(pending.allows(authority(1))).toBe(false);
  });

  it('invalidates every pending login for only the disconnected account', () => {
    const tracker = new AccountAdmissionTracker();
    const first = tracker.begin(1);
    const second = tracker.begin(1);
    const other = tracker.begin(2);
    tracker.invalidate(1);
    expect(first.allows(authority(1))).toBe(false);
    expect(second.allows(authority(1))).toBe(false);
    expect(other.allows(authority(2))).toBe(true);
    first.release();
    second.release();
    other.release();
    expect(tracker.activeAccounts).toBe(0);
  });

  it('permits a later login without reviving an older invalidated probe', () => {
    const tracker = new AccountAdmissionTracker();
    const old = tracker.begin(1);
    tracker.invalidate(1);
    const fresh = tracker.begin(1);
    old.release();
    old.release();
    expect(tracker.activeAccounts).toBe(1);
    expect(old.allows(authority(1))).toBe(false);
    expect(fresh.allows(authority(1))).toBe(true);
    tracker.invalidate(1);
    expect(fresh.allows(authority(1))).toBe(false);
    fresh.release();
    expect(tracker.activeAccounts).toBe(0);
  });

  it('retains no history for disconnected or completed accounts', () => {
    const tracker = new AccountAdmissionTracker();
    for (let accountId = 1; accountId <= 1000; accountId++) {
      tracker.invalidate(accountId);
      const probe = tracker.begin(accountId);
      probe.release();
    }
    expect(tracker.activeAccounts).toBe(0);
  });

  it('shares a tracker within one game and isolates separate game instances', () => {
    const game = {};
    const otherGame = {};
    const pending = accountAdmissionsFor(game).begin(1);
    accountAdmissionsFor(otherGame).invalidate(1);
    expect(pending.allows(authority(1))).toBe(true);
    accountAdmissionsFor(game).invalidate(1);
    expect(pending.allows(authority(1))).toBe(false);
    pending.release();
  });
});
