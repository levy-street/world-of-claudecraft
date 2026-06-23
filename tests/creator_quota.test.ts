import { describe, expect, it } from 'vitest';
import {
  hostedSlotQuota, isTrustedCreator, trustApprovalThreshold,
  TRUST_MIN_ACCOUNT_AGE_DAYS,
} from '../server/creator_quota';

describe('hostedSlotQuota — entry-friendly, floored at coppercrest, whale-scaled', () => {
  it('grants 0 slots below the ≥100 $WOC floor (tiers 0-2)', () => {
    for (const t of [-1, 0, 1, 2]) expect(hostedSlotQuota(t)).toBe(0);
  });
  it('follows the published ladder', () => {
    expect(hostedSlotQuota(3)).toBe(2);   // coppercrest ≥100
    expect(hostedSlotQuota(4)).toBe(5);   // silverbound ≥1k
    expect(hostedSlotQuota(5)).toBe(12);  // gilded ≥10k
    expect(hostedSlotQuota(6)).toBe(30);  // vaultwarden ≥100k
    expect(hostedSlotQuota(7)).toBe(80);  // whale ≥1M
    expect(hostedSlotQuota(8)).toBe(200); // leviathan 1%
  });
  it('caps every tier ≥9 (≥2% supply) at the top slot count', () => {
    for (const t of [9, 12, 17, 18]) expect(hostedSlotQuota(t)).toBe(400);
  });
  it('is monotonic non-decreasing across the ladder', () => {
    let prev = -1;
    for (let t = 0; t <= 18; t++) { const q = hostedSlotQuota(t); expect(q).toBeGreaterThanOrEqual(prev); prev = q; }
  });
  it('ignores non-integers', () => {
    expect(hostedSlotQuota(3.5)).toBe(0);
    expect(hostedSlotQuota(NaN)).toBe(0);
  });
});

describe('isTrustedCreator — earned badge, faster at higher tiers, strike-revoked', () => {
  const old = 365; // account age comfortably past the minimum
  it('any strike in the window revokes trust regardless of tier/approvals', () => {
    expect(isTrustedCreator({ approvedCount: 99, tierIndex: 18, accountAgeDays: old, recentStrikes: 1 })).toBe(false);
  });
  it('whale+ (tier ≥7) is trusted on the first clean approval, age-relaxed', () => {
    expect(isTrustedCreator({ approvedCount: 1, tierIndex: 7, accountAgeDays: 0, recentStrikes: 0 })).toBe(true);
    expect(isTrustedCreator({ approvedCount: 0, tierIndex: 7, accountAgeDays: old, recentStrikes: 0 })).toBe(false);
  });
  it('mid-tiers need the per-tier approval count AND the minimum account age', () => {
    // coppercrest needs 5 approvals
    expect(isTrustedCreator({ approvedCount: 4, tierIndex: 3, accountAgeDays: old, recentStrikes: 0 })).toBe(false);
    expect(isTrustedCreator({ approvedCount: 5, tierIndex: 3, accountAgeDays: old, recentStrikes: 0 })).toBe(true);
    // even with enough approvals, too-new accounts aren't trusted
    expect(isTrustedCreator({ approvedCount: 5, tierIndex: 3, accountAgeDays: TRUST_MIN_ACCOUNT_AGE_DAYS - 1, recentStrikes: 0 })).toBe(false);
    // gilded needs only 2
    expect(isTrustedCreator({ approvedCount: 2, tierIndex: 5, accountAgeDays: old, recentStrikes: 0 })).toBe(true);
  });
  it('threshold shrinks as tier rises', () => {
    expect(trustApprovalThreshold(3)).toBe(5);
    expect(trustApprovalThreshold(4)).toBe(3);
    expect(trustApprovalThreshold(5)).toBe(2);
    expect(trustApprovalThreshold(6)).toBe(2);
  });
});
