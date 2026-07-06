// Off-chain $WOC governance voting (PR #468). Drives the real routes through the
// real middleware onion (the fail-closed flag gate + requireAccount auth) with an
// INJECTED FakeGovernanceDb, deterministic balances, and a fixed clock, so the
// proposal lifecycle, weighted tally, double-vote / unlinked-wallet / bad-signature
// / after-window rejections, the snapshot boundary, and the flag-off refusal of
// EVERY endpoint are exercised end to end with no Postgres, no RPC, and no HTTP.
//
// server/db.ts constructs a pg Pool at module load and THROWS when DATABASE_URL is
// unset (server/governance.ts pulls it in transitively through requireAccount), so
// set a dummy URL before any import; the pool never connects. The two auth reads
// requireAccount performs (accountAndScopeForToken, moderationStatusForAccount) are
// the only db.ts functions the onion touches, and they are stubbed per test.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';

import type * as http from 'node:http';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return {
    ...actual,
    // The pool is never used (the FakeGovernanceDb replaces every governance read),
    // but db.ts still constructs it at load; a bare object keeps the import safe.
    pool: {},
    accountAndScopeForToken: vi.fn(),
    moderationStatusForAccount: vi.fn(),
  };
});

import { accountAndScopeForToken, moderationStatusForAccount } from '../../server/db';
import {
  configureGovernanceRuntime,
  type GovernanceRuntime,
  resetGovernanceRuntimeForTests,
} from '../../server/governance';
import type { Proposal, ProposalDraft, Vote } from '../../server/governance_core';
import type { CastVoteInput, GovernanceDb, VoteChallenge } from '../../server/governance_db';
import { runOnion } from '../../server/http/compose';
import { buildContext } from '../../server/http/context';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Middleware } from '../../server/http/types';
import { resetWalletLinkRateLimits } from '../../server/ratelimit';
import { FakeRes, makeReq } from './helpers';

// ---------------------------------------------------------------------------
// FakeGovernanceDb: an in-memory GovernanceDb, the seam the route shell depends on.
// It enforces the exact invariants Postgres does (one ballot per wallet via the
// composite key, single-use challenges), so the double-vote path is real, not faked.
// ---------------------------------------------------------------------------

class FakeGovernanceDb implements GovernanceDb {
  private proposals = new Map<number, Proposal>();
  private votes = new Map<string, Vote>(); // key: `${proposalId}:${wallet}`
  private challenges = new Map<string, VoteChallenge & { expiresAt: number }>();
  private nextId = 1;
  clock = 0;

  private voteKey(proposalId: number, wallet: string): string {
    return `${proposalId}:${wallet}`;
  }

  async createProposal(draft: ProposalDraft): Promise<Proposal> {
    const proposal: Proposal = { id: this.nextId++, ...draft };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async listProposals(limit: number): Promise<Proposal[]> {
    return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async getProposal(id: number): Promise<Proposal | null> {
    return this.proposals.get(id) ?? null;
  }

  async votesForProposal(proposalId: number): Promise<Vote[]> {
    return [...this.votes.values()]
      .filter((v) => v.proposalId === proposalId)
      .sort((a, b) => a.castAt - b.castAt);
  }

  async voteByWallet(proposalId: number, wallet: string): Promise<Vote | null> {
    return this.votes.get(this.voteKey(proposalId, wallet)) ?? null;
  }

  async createVoteChallenge(challenge: VoteChallenge, ttlMinutes: number): Promise<void> {
    this.challenges.set(challenge.nonce, {
      ...challenge,
      expiresAt: this.clock + ttlMinutes * 60 * 1000,
    });
  }

  async consumeVoteChallenge(nonce: string, accountId: number): Promise<VoteChallenge | null> {
    const row = this.challenges.get(nonce);
    if (!row || row.accountId !== accountId || row.expiresAt <= this.clock) return null;
    this.challenges.delete(nonce);
    const { expiresAt: _expiresAt, ...challenge } = row;
    return challenge;
  }

  async pruneVoteChallenges(): Promise<void> {
    for (const [nonce, row] of this.challenges) {
      if (row.expiresAt <= this.clock) this.challenges.delete(nonce);
    }
  }

  async castVote(input: CastVoteInput): Promise<boolean> {
    const key = this.voteKey(input.proposalId, input.wallet);
    if (this.votes.has(key)) return false; // the composite PRIMARY KEY conflict
    this.votes.set(key, {
      proposalId: input.proposalId,
      wallet: input.wallet,
      choice: input.choice,
      weight: input.weight,
      castAt: input.castAt,
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// A real ed25519 wallet so the signature path verifies for real (no signature stub).
// ---------------------------------------------------------------------------

const priv = ed25519.utils.randomPrivateKey();
const pubBytes = ed25519.getPublicKey(priv);
const WALLET = bs58.encode(pubBytes);
const OTHER_WALLET = bs58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));

function signMessage(message: string): string {
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
}

// ---------------------------------------------------------------------------
// Runtime + harness.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 7;
const TOKEN = 'a'.repeat(64);
let db: FakeGovernanceDb;
let balances: Map<string, number | null>;
let linkedWallets: Map<number, string | null>;
let admins: Set<number>;
let clock: number;

function installRuntime(): void {
  const rt: GovernanceRuntime = {
    db,
    walletBalance: async (pubkey) => balances.get(pubkey) ?? null,
    linkedWallet: async (accountId) => linkedWallets.get(accountId) ?? null,
    canCreateProposal: async (accountId) => admins.has(accountId),
    now: () => clock,
  };
  configureGovernanceRuntime(rt);
}

/** Run one request through the real onion for the route matching (method, path). */
async function call(
  method: string,
  path: string,
  opts: { body?: unknown; auth?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const match = apiRegistry.resolve(method, path);
  if (match.kind !== 'matched') throw new Error(`no route for ${method} ${path}: ${match.kind}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth) headers.authorization = `Bearer ${TOKEN}`;
  const req = makeReq({ method, url: path, headers, body: opts.body });
  const res = new FakeRes() as unknown as http.ServerResponse;
  const ctx = buildContext(req, res, match);
  const stack: Middleware[] = [
    withErrors({ surface: match.route.meta?.envelope }),
    ...(match.route.middleware ?? []),
    async (c) => {
      await match.route.handler(c);
    },
  ];
  await runOnion(ctx, stack);
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : {} };
}

/** The stable code a problem+json error body carries. */
function code(body: Record<string, unknown>): unknown {
  return body.code;
}

beforeEach(() => {
  process.env.GOVERNANCE_ENABLED = '1';
  db = new FakeGovernanceDb();
  balances = new Map();
  linkedWallets = new Map();
  admins = new Set();
  clock = 1_000_000;
  db.clock = clock;
  resetWalletLinkRateLimits();
  installRuntime();
  // The default authenticated account: a full-scope token, unlocked.
  vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: ACCOUNT_ID, scope: 'full' });
  vi.mocked(moderationStatusForAccount).mockResolvedValue({
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
  });
});

afterEach(() => {
  resetGovernanceRuntimeForTests();
  vi.clearAllMocks();
  process.env.GOVERNANCE_ENABLED = undefined;
});

/** Create a proposal directly through the db (skips the admin-gated endpoint). */
async function seedProposal(overrides: Partial<ProposalDraft> = {}): Promise<Proposal> {
  return db.createProposal({
    category: 'content',
    title: 'Test proposal',
    body: 'Body',
    createdByAccountId: ACCOUNT_ID,
    createdAt: clock,
    opensAt: clock,
    closesAt: clock + 60 * 60 * 1000,
    quorum: 100,
    ...overrides,
  });
}

/** The full challenge + sign + submit vote flow for the linked WALLET. */
async function castVote(
  proposalId: number,
  choice: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const challenge = await call('POST', `/api/governance/proposals/${proposalId}/vote/challenge`, {
    auth: true,
    body: { choice },
  });
  if (challenge.status !== 200) return challenge;
  const signature = signMessage(challenge.body.message as string);
  return call('POST', `/api/governance/proposals/${proposalId}/vote`, {
    auth: true,
    body: { choice, signature, nonce: challenge.body.nonce },
  });
}

describe('proposal lifecycle', () => {
  it('creates a proposal for an admin, lists it, and exposes its tally', async () => {
    admins.add(ACCOUNT_ID);
    const created = await call('POST', '/api/governance/proposals', {
      auth: true,
      body: {
        category: 'treasury',
        title: 'Fund the fountain',
        body: 'why',
        windowHours: 24,
        quorum: 500,
      },
    });
    expect(created.status).toBe(201);
    const proposal = created.body.proposal as Record<string, unknown>;
    expect(proposal.category).toBe('treasury');
    expect(proposal.title).toBe('Fund the fountain');
    expect(proposal.open).toBe(true);

    const list = await call('GET', '/api/governance/proposals', { auth: true });
    expect(list.status).toBe(200);
    expect((list.body.proposals as unknown[]).length).toBe(1);

    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect(tally.status).toBe(200);
    expect(tally.body.tally).toMatchObject({
      for: 0,
      against: 0,
      abstain: 0,
      totalWeight: 0,
      voterCount: 0,
      quorum: 500,
      quorumReached: false,
      open: true,
    });
  });

  it('rejects proposal creation by a non-admin with governance.forbidden', async () => {
    const res = await call('POST', '/api/governance/proposals', {
      auth: true,
      body: { category: 'content', title: 'Sneaky', body: '', windowHours: 24, quorum: 0 },
    });
    expect(res.status).toBe(403);
    expect(code(res.body)).toBe('governance.forbidden');
  });

  it('rejects an invalid proposal (bad category) with governance.invalid_input', async () => {
    admins.add(ACCOUNT_ID);
    const res = await call('POST', '/api/governance/proposals', {
      auth: true,
      body: { category: 'nonsense', title: 'Valid title', body: '', windowHours: 24, quorum: 0 },
    });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('governance.invalid_input');
  });
});

describe('weighted tally exactness', () => {
  it('sums each choice by its frozen weight and reports quorum', async () => {
    const proposal = await seedProposal({ quorum: 300 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    // A second linked voter, on a second account.
    const ACCOUNT_TWO = 8;
    linkedWallets.set(ACCOUNT_TWO, OTHER_WALLET);

    balances.set(WALLET, 250.9); // floors to 250
    const first = await castVote(proposal.id, 'for');
    expect(first.status).toBe(201);
    expect(first.body.weight).toBe(250);

    // The second voter votes AGAINST with weight 75 (a separate signer/account).
    vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: ACCOUNT_TWO, scope: 'full' });
    const priv2 = ed25519.utils.randomPrivateKey();
    const wallet2 = bs58.encode(ed25519.getPublicKey(priv2));
    linkedWallets.set(ACCOUNT_TWO, wallet2);
    balances.set(wallet2, 75);
    const challenge2 = await call(
      'POST',
      `/api/governance/proposals/${proposal.id}/vote/challenge`,
      { auth: true, body: { choice: 'against' } },
    );
    const sig2 = bs58.encode(
      ed25519.sign(new TextEncoder().encode(challenge2.body.message as string), priv2),
    );
    const second = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'against', signature: sig2, nonce: challenge2.body.nonce },
    });
    expect(second.status).toBe(201);
    expect(second.body.weight).toBe(75);

    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect(tally.body.tally).toMatchObject({
      for: 250,
      against: 75,
      abstain: 0,
      totalWeight: 325,
      voterCount: 2,
      quorum: 300,
      quorumReached: true,
    });
  });
});

describe('double-vote rejection', () => {
  it('rejects a second vote by the same wallet with governance.already_voted', async () => {
    const proposal = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const first = await castVote(proposal.id, 'for');
    expect(first.status).toBe(201);

    const second = await castVote(proposal.id, 'against');
    expect(second.status).toBe(409);
    expect(code(second.body)).toBe('governance.already_voted');
  });
});

describe('unlinked-wallet rejection', () => {
  it('rejects a vote challenge when the account has no linked wallet', async () => {
    const proposal = await seedProposal();
    // linkedWallets has no entry for ACCOUNT_ID.
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote/challenge`, {
      auth: true,
      body: { choice: 'for' },
    });
    expect(res.status).toBe(403);
    expect(code(res.body)).toBe('governance.wallet_not_linked');
  });
});

describe('bad-signature rejection', () => {
  it('rejects a vote whose signature does not verify with governance.bad_signature', async () => {
    const proposal = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const challenge = await call(
      'POST',
      `/api/governance/proposals/${proposal.id}/vote/challenge`,
      { auth: true, body: { choice: 'for' } },
    );
    // A valid-shaped but wrong signature (sign a different message).
    const wrongSig = signMessage('a different message entirely');
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature: wrongSig, nonce: challenge.body.nonce },
    });
    expect(res.status).toBe(401);
    expect(code(res.body)).toBe('governance.bad_signature');
  });
});

describe('vote-after-window rejection', () => {
  it('rejects a vote challenge once the window has closed', async () => {
    const proposal = await seedProposal({ closesAt: clock + 1000 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    // Advance the clock past closesAt.
    clock = proposal.closesAt + 1;
    db.clock = clock;
    installRuntime();
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote/challenge`, {
      auth: true,
      body: { choice: 'for' },
    });
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('governance.window_closed');
  });

  it('rejects submitting a signed vote if the window closed between challenge and submit', async () => {
    // A short 5-minute window (shorter than the 10-minute challenge TTL) so the
    // challenge is still valid when the window closes: the submit-time window check
    // is what must reject, not challenge expiry.
    const proposal = await seedProposal({ closesAt: clock + 5 * 60 * 1000 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const challenge = await call(
      'POST',
      `/api/governance/proposals/${proposal.id}/vote/challenge`,
      { auth: true, body: { choice: 'for' } },
    );
    const signature = signMessage(challenge.body.message as string);
    // Close the window before the submit lands (still inside the challenge TTL).
    clock = proposal.closesAt + 1;
    db.clock = clock;
    installRuntime();
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature, nonce: challenge.body.nonce },
    });
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('governance.window_closed');
  });
});

describe('snapshot boundary', () => {
  it('freezes the vote weight at cast time; a later balance change does not alter the tally', async () => {
    const proposal = await seedProposal({ quorum: 0 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 500);
    const cast = await castVote(proposal.id, 'for');
    expect(cast.status).toBe(201);
    expect(cast.body.weight).toBe(500);

    // The wallet's balance changes AFTER the snapshot.
    balances.set(WALLET, 5);
    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect((tally.body.tally as Record<string, unknown>).for).toBe(500);
    expect((tally.body.tally as Record<string, unknown>).totalWeight).toBe(500);
  });

  it('rejects a vote presenting a wallet that is not the linked one', async () => {
    const proposal = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    // Issue a challenge for the linked wallet, then relink to a different wallet
    // before submit: the submit-time link check must reject.
    const challenge = await call(
      'POST',
      `/api/governance/proposals/${proposal.id}/vote/challenge`,
      { auth: true, body: { choice: 'for' } },
    );
    const signature = signMessage(challenge.body.message as string);
    linkedWallets.set(ACCOUNT_ID, OTHER_WALLET);
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature, nonce: challenge.body.nonce },
    });
    expect(res.status).toBe(403);
    expect(code(res.body)).toBe('governance.wallet_mismatch');
  });
});

describe('flag-off refusal of every endpoint (fail-closed)', () => {
  const cases: Array<[string, string, unknown]> = [
    [
      'POST',
      '/api/governance/proposals',
      { category: 'content', title: 'x', body: '', windowHours: 1, quorum: 0 },
    ],
    ['GET', '/api/governance/proposals', undefined],
    ['GET', '/api/governance/proposals/1/tally', undefined],
    ['POST', '/api/governance/proposals/1/vote/challenge', { choice: 'for' }],
    ['POST', '/api/governance/proposals/1/vote', { choice: 'for', signature: 's', nonce: 'n' }],
  ];

  it('refuses every governance endpoint with a 503 governance.disabled when the flag is off', async () => {
    process.env.GOVERNANCE_ENABLED = '0';
    for (const [method, path, body] of cases) {
      const res = await call(method, path, { auth: true, body });
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(code(res.body), `${method} ${path}`).toBe('governance.disabled');
    }
  });

  it('also refuses when GOVERNANCE_ENABLED is unset (default off)', async () => {
    process.env.GOVERNANCE_ENABLED = undefined;
    const res = await call('GET', '/api/governance/proposals', { auth: true });
    expect(res.status).toBe(503);
    expect(code(res.body)).toBe('governance.disabled');
  });
});

describe('challenge single-use and binding', () => {
  it('rejects a replayed nonce (a challenge is consumed once)', async () => {
    const proposal = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const challenge = await call(
      'POST',
      `/api/governance/proposals/${proposal.id}/vote/challenge`,
      { auth: true, body: { choice: 'for' } },
    );
    const signature = signMessage(challenge.body.message as string);
    const first = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature, nonce: challenge.body.nonce },
    });
    expect(first.status).toBe(201);
    // Replaying the SAME nonce must fail: the challenge was consumed.
    const replay = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature, nonce: challenge.body.nonce },
    });
    expect(replay.status).toBe(400);
    expect(code(replay.body)).toBe('governance.challenge_invalid');
  });

  it('rejects an unknown nonce with governance.challenge_invalid', async () => {
    const proposal = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const res = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature: 'deadbeef', nonce: 'never-issued' },
    });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('governance.challenge_invalid');
  });

  it('rejects a challenge submitted against a different proposal id', async () => {
    const a = await seedProposal();
    const b = await seedProposal();
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 10);
    const challenge = await call('POST', `/api/governance/proposals/${a.id}/vote/challenge`, {
      auth: true,
      body: { choice: 'for' },
    });
    const signature = signMessage(challenge.body.message as string);
    // Submit the proposal-a challenge on proposal b's path: the id-binding check rejects.
    const res = await call('POST', `/api/governance/proposals/${b.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature, nonce: challenge.body.nonce },
    });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('governance.challenge_invalid');
  });
});

describe('DB-level double-vote conflict (not the pre-read)', () => {
  it('rejects the SECOND submit when two challenges race to cast the same wallet ballot', async () => {
    const proposal = await seedProposal({ quorum: 0 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 42);
    // Issue TWO challenges (two nonces) BEFORE either vote is recorded, so the
    // voteChallengeHandler pre-read (voteByWallet) sees no prior ballot for both.
    // This forces the SECOND submit down to the DB castVote conflict path
    // (castVote returns false -> 409 already_voted), the real one-vote-per-wallet guard.
    const c1 = await call('POST', `/api/governance/proposals/${proposal.id}/vote/challenge`, {
      auth: true,
      body: { choice: 'for' },
    });
    const c2 = await call('POST', `/api/governance/proposals/${proposal.id}/vote/challenge`, {
      auth: true,
      body: { choice: 'against' },
    });
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    const s1 = signMessage(c1.body.message as string);
    const s2 = signMessage(c2.body.message as string);
    const first = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'for', signature: s1, nonce: c1.body.nonce },
    });
    expect(first.status).toBe(201);
    const second = await call('POST', `/api/governance/proposals/${proposal.id}/vote`, {
      auth: true,
      body: { choice: 'against', signature: s2, nonce: c2.body.nonce },
    });
    expect(second.status).toBe(409);
    expect(code(second.body)).toBe('governance.already_voted');
    // Only the first ballot exists, at its frozen weight; the tally is unchanged.
    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect(tally.body.tally).toMatchObject({ for: 42, against: 0, voterCount: 1 });
  });
});

describe('balance-unavailable rejection (RPC failure is not a zero vote)', () => {
  it('rejects a vote and records NO ballot when the balance read fails (null)', async () => {
    const proposal = await seedProposal({ quorum: 0 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, null); // simulate an RPC failure
    const res = await castVote(proposal.id, 'for');
    expect(res.status).toBe(503);
    expect(code(res.body)).toBe('governance.balance_unavailable');
    // No ballot was recorded, so the voter can retry once the RPC recovers.
    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect((tally.body.tally as Record<string, unknown>).voterCount).toBe(0);
    balances.set(WALLET, 100);
    const retry = await castVote(proposal.id, 'for');
    expect(retry.status).toBe(201);
    expect(retry.body.weight).toBe(100);
  });

  it('records a genuine ZERO balance as a zero-weight ballot (not rejected)', async () => {
    const proposal = await seedProposal({ quorum: 0 });
    linkedWallets.set(ACCOUNT_ID, WALLET);
    balances.set(WALLET, 0);
    const res = await castVote(proposal.id, 'abstain');
    expect(res.status).toBe(201);
    expect(res.body.weight).toBe(0);
    const tally = await call('GET', `/api/governance/proposals/${proposal.id}/tally`, {
      auth: true,
    });
    expect((tally.body.tally as Record<string, unknown>).voterCount).toBe(1);
  });
});

describe('authentication', () => {
  it('rejects an unauthenticated list request before any governance work', async () => {
    const res = await call('GET', '/api/governance/proposals', { auth: false });
    expect(res.status).toBe(401);
  });
});
