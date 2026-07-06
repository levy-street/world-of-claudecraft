// Pure unit tests for the governance rule core (server/governance_core.ts). No IO,
// no DB, no RPC: every function is deterministic given an injected `now`.

import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_LENGTH,
  buildVoteMessage,
  computeTally,
  isGovernanceCategory,
  isGovernanceChoice,
  isWindowOpen,
  MAX_WINDOW_HOURS,
  type Proposal,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  type Vote,
  validateProposalDraft,
  weightForBalance,
} from '../../server/governance_core';

const NOW = 1_000_000;

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 1,
    category: 'content',
    title: 'Title',
    body: 'Body',
    createdByAccountId: 1,
    createdAt: NOW,
    opensAt: NOW,
    closesAt: NOW + 60 * 60 * 1000,
    quorum: 100,
    ...overrides,
  };
}

function vote(choice: Vote['choice'], weight: number, castAt = NOW): Vote {
  return { proposalId: 1, wallet: `w-${choice}-${weight}`, choice, weight, castAt };
}

describe('type guards', () => {
  it('accepts only known categories', () => {
    expect(isGovernanceCategory('content')).toBe(true);
    expect(isGovernanceCategory('cosmetic')).toBe(true);
    expect(isGovernanceCategory('treasury')).toBe(true);
    expect(isGovernanceCategory('other')).toBe(false);
    expect(isGovernanceCategory(3)).toBe(false);
  });

  it('accepts only known choices', () => {
    expect(isGovernanceChoice('for')).toBe(true);
    expect(isGovernanceChoice('against')).toBe(true);
    expect(isGovernanceChoice('abstain')).toBe(true);
    expect(isGovernanceChoice('maybe')).toBe(false);
  });
});

describe('validateProposalDraft', () => {
  const base = {
    category: 'content',
    title: 'A valid title',
    body: 'body',
    windowHours: 24,
    quorum: 10,
  };

  it('accepts a valid draft and computes the window', () => {
    const r = validateProposalDraft(base, 5, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.draft).toMatchObject({
      category: 'content',
      title: 'A valid title',
      body: 'body',
      createdByAccountId: 5,
      createdAt: NOW,
      opensAt: NOW,
      closesAt: NOW + 24 * 60 * 60 * 1000,
      quorum: 10,
    });
  });

  it('trims the title and body', () => {
    const r = validateProposalDraft({ ...base, title: '  spaced  ', body: '  b  ' }, 1, NOW);
    expect(r.ok && r.draft.title).toBe('spaced');
    expect(r.ok && r.draft.body).toBe('b');
  });

  it('rejects a bad category', () => {
    expect(validateProposalDraft({ ...base, category: 'x' }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_category',
    });
  });

  it('rejects a too-short and too-long title', () => {
    expect(
      validateProposalDraft({ ...base, title: 'a'.repeat(TITLE_MIN_LENGTH - 1) }, 1, NOW),
    ).toEqual({ ok: false, reason: 'invalid_title' });
    expect(
      validateProposalDraft({ ...base, title: 'a'.repeat(TITLE_MAX_LENGTH + 1) }, 1, NOW),
    ).toEqual({ ok: false, reason: 'invalid_title' });
  });

  it('rejects an over-long body', () => {
    expect(
      validateProposalDraft({ ...base, body: 'a'.repeat(BODY_MAX_LENGTH + 1) }, 1, NOW),
    ).toEqual({
      ok: false,
      reason: 'invalid_body',
    });
  });

  it('rejects a non-integer / out-of-range window', () => {
    expect(validateProposalDraft({ ...base, windowHours: 0 }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_window',
    });
    expect(validateProposalDraft({ ...base, windowHours: 1.5 }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_window',
    });
    expect(validateProposalDraft({ ...base, windowHours: MAX_WINDOW_HOURS + 1 }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_window',
    });
  });

  it('rejects a negative or non-integer quorum', () => {
    expect(validateProposalDraft({ ...base, quorum: -1 }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_quorum',
    });
    expect(validateProposalDraft({ ...base, quorum: 1.5 }, 1, NOW)).toEqual({
      ok: false,
      reason: 'invalid_quorum',
    });
    expect(validateProposalDraft({ ...base, quorum: 0 }, 1, NOW).ok).toBe(true);
  });
});

describe('isWindowOpen', () => {
  it('is open inside [opensAt, closesAt) and closed at or after closesAt', () => {
    const p = proposal();
    expect(isWindowOpen(p, p.opensAt)).toBe(true);
    expect(isWindowOpen(p, p.closesAt - 1)).toBe(true);
    expect(isWindowOpen(p, p.closesAt)).toBe(false);
    expect(isWindowOpen(p, p.opensAt - 1)).toBe(false);
  });
});

describe('weightForBalance', () => {
  it('floors to a whole token and clamps null/negative/non-finite to 0', () => {
    expect(weightForBalance(250.9)).toBe(250);
    expect(weightForBalance(0)).toBe(0);
    expect(weightForBalance(null)).toBe(0);
    expect(weightForBalance(-5)).toBe(0);
    expect(weightForBalance(Number.NaN)).toBe(0);
    expect(weightForBalance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(weightForBalance(1)).toBe(1);
  });
});

describe('computeTally', () => {
  it('sums each choice exactly and reports quorum + open', () => {
    const p = proposal({ quorum: 300 });
    const votes = [vote('for', 250), vote('for', 100), vote('against', 75), vote('abstain', 10)];
    const tally = computeTally(p, votes, NOW);
    expect(tally).toEqual({
      proposalId: 1,
      for: 350,
      against: 75,
      abstain: 10,
      totalWeight: 435,
      voterCount: 4,
      quorum: 300,
      quorumReached: true,
      open: true,
    });
  });

  it('reports quorum not reached and closed after the window', () => {
    const p = proposal({ quorum: 1000 });
    const tally = computeTally(p, [vote('for', 10)], p.closesAt + 1);
    expect(tally.quorumReached).toBe(false);
    expect(tally.open).toBe(false);
  });

  it('is exact with zero votes', () => {
    const tally = computeTally(proposal({ quorum: 0 }), [], NOW);
    expect(tally.totalWeight).toBe(0);
    expect(tally.quorumReached).toBe(true); // 0 >= 0
    expect(tally.voterCount).toBe(0);
  });
});

describe('buildVoteMessage', () => {
  it('binds account, wallet, proposal, choice, and nonce and states it is advisory', () => {
    const msg = buildVoteMessage({
      domain: 'example.com',
      accountId: 7,
      wallet: 'WALLET',
      proposalId: 42,
      choice: 'for',
      nonce: 'abc',
      issuedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(msg).toContain('Account: #7');
    expect(msg).toContain('Wallet: WALLET');
    expect(msg).toContain('Proposal: #42');
    expect(msg).toContain('Choice: for');
    expect(msg).toContain('Nonce: abc');
    expect(msg).toContain('advisory and off-chain');
    expect(msg).toContain('authorizes no transaction');
  });
});
