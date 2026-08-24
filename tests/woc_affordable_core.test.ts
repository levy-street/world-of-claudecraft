// The one affordability predicate every $WOC paying surface shares.
//
// Small enough to look self-evident, which is exactly why it is pinned: the
// interesting behaviour is what it does with a MISSING operand, and the whole
// reason it is one module is that three copies of that judgement would drift.

import { describe, expect, it } from 'vitest';
import { overWalletBalance } from '../src/ui/woc_affordable_core';

describe('overWalletBalance', () => {
  it('is true only when the price genuinely exceeds the balance', () => {
    expect(overWalletBalance(101, 100)).toBe(true);
    expect(overWalletBalance(99, 100)).toBe(false);
  });

  it('treats exactly the whole balance as affordable', () => {
    // Short is short; equal is not. Spending your last token is allowed.
    expect(overWalletBalance(100, 100)).toBe(false);
  });

  it('fails OPEN on an unknown balance, never treating null as zero', () => {
    // The read is async and goes missing for reasons that say nothing about
    // what the player holds. Refusing here would block someone who can pay.
    expect(overWalletBalance(1_000_000, null)).toBe(false);
  });

  it('fails OPEN before the price has been quoted', () => {
    expect(overWalletBalance(null, 0)).toBe(false);
  });

  it('is false when NEITHER side is known', () => {
    expect(overWalletBalance(null, null)).toBe(false);
  });

  it('handles a zero balance as a real number, not as absent', () => {
    // The one case where the fail-open rule must NOT swallow the answer: a
    // wallet holding nothing is known information.
    expect(overWalletBalance(1, 0)).toBe(true);
    expect(overWalletBalance(0, 0)).toBe(false);
  });
});
