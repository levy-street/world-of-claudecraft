// The live-session credit mirror (server/redesign_credit_session.ts). Extracted
// from GameServer so it drives with a plain fake instead of a live realm, which
// matters because its absence is an ECONOMY bug, not a cosmetic one: without the
// push, an online character's 30 s autosave writes the stale count back and
// refunds the credit the player just spent.

import { describe, expect, it } from 'vitest';
import {
  type RedesignCreditSession,
  type RedesignCreditSimView,
  spendRedesignCreditOnSessions,
} from '../server/redesign_credit_session';

function simWith(metas: Record<number, { redesignCredits?: number }>): RedesignCreditSimView {
  return { players: { get: (pid) => metas[pid] } };
}

const session = (characterId: number | null, pid: number): RedesignCreditSession => ({
  characterId,
  pid,
});

describe('spendRedesignCreditOnSessions', () => {
  it('decrements the live count for the matching character only', () => {
    const metas = { 1: { redesignCredits: 3 }, 2: { redesignCredits: 3 } };
    const pushed = spendRedesignCreditOnSessions(
      simWith(metas),
      [session(10, 1), session(99, 2)],
      10,
    );
    expect(pushed).toBe(true);
    expect(metas[1].redesignCredits).toBe(2);
    // A different character's session is untouched.
    expect(metas[2].redesignCredits).toBe(3);
  });

  it('DROPS the key at the last credit rather than storing a zero', () => {
    // Zero-default omission, matching serializeCharacter: a pushed session and a
    // fresh load must agree byte for byte.
    const metas = { 1: { redesignCredits: 1 } };
    spendRedesignCreditOnSessions(simWith(metas), [session(10, 1)], 10);
    expect(metas[1].redesignCredits).toBeUndefined();
  });

  it('never goes negative when the session already reads zero or absent', () => {
    const metas: Record<number, { redesignCredits?: number }> = {
      1: {},
      2: { redesignCredits: 0 },
    };
    spendRedesignCreditOnSessions(simWith(metas), [session(10, 1), session(10, 2)], 10);
    expect(metas[1].redesignCredits).toBeUndefined();
    expect(metas[2].redesignCredits).toBeUndefined();
  });

  it('reports false when the character is not in world, so the route can no-op', () => {
    const metas = { 1: { redesignCredits: 2 } };
    expect(spendRedesignCreditOnSessions(simWith(metas), [session(99, 1)], 10)).toBe(false);
    expect(metas[1].redesignCredits).toBe(2);
    // ...and with no sessions at all.
    expect(spendRedesignCreditOnSessions(simWith(metas), [], 10)).toBe(false);
  });

  it('skips a session whose pid has no PlayerMeta instead of throwing', () => {
    // A session mid-teardown can outlive its meta; the route must not 500.
    expect(spendRedesignCreditOnSessions(simWith({}), [session(10, 1)], 10)).toBe(false);
  });

  it('handles a character logged in twice, decrementing each live copy', () => {
    // Takeover races can briefly leave two sessions on one character; both hold
    // their own in-memory count and both autosave, so both must be pushed.
    const metas = { 1: { redesignCredits: 2 }, 2: { redesignCredits: 2 } };
    expect(
      spendRedesignCreditOnSessions(simWith(metas), [session(10, 1), session(10, 2)], 10),
    ).toBe(true);
    expect(metas[1].redesignCredits).toBe(1);
    expect(metas[2].redesignCredits).toBe(1);
  });

  it('floors a fractional stored count rather than propagating it', () => {
    const metas = { 1: { redesignCredits: 3.7 } };
    spendRedesignCreditOnSessions(simWith(metas), [session(10, 1)], 10);
    expect(metas[1].redesignCredits).toBe(2);
  });
});
