// Off-chain $WOC governance voting: the RouteDef shell (PR #468).
//
// Advisory, Snapshot-style holder voting on content priorities, the cosmetic
// catalog, and treasury spend. ADVISORY / off-chain ONLY: this module never writes
// on-chain and never touches a keypair. It reads a wallet's $WOC balance (through
// the EXISTING holder-balance pipeline, server/woc_balance.ts) purely to weight a
// vote, and it authenticates a ballot with the SAME signed-message pattern the
// wallet-link flow uses (server/wallet_link.ts verifySolanaSignature).
//
// Every endpoint is behind the governanceEnabled() flag, DEFAULT OFF, and FAILS
// CLOSED: the governanceGate middleware refuses every route with a coded 503 when
// the flag is off, before any auth or DB work. The flag reads GOVERNANCE_ENABLED
// from the server env at request time (like ALLOW_DEV_COMMANDS), so a deploy can
// flip it without a rebuild.
//
// The rules are pure (governance_core.ts, unit-tested with no IO); the SQL is
// governance_db.ts (behind the GovernanceDb seam so tests inject a FakeGovernanceDb);
// this file is the thin request layer, mirroring wallet_link.ts (pure) / wallet.ts
// (shell) and leaderboard.ts's configure<Domain>Runtime injection.

import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import {
  buildVoteMessage,
  computeTally,
  type GovernanceChoice,
  isGovernanceChoice,
  isWindowOpen,
  type Proposal,
  type Tally,
  validateProposalDraft,
  weightForBalance,
} from './governance_core';
import type { GovernanceDb } from './governance_db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { rateLimit, WALLET_LINK_POLICY } from './http/middleware/rate_limit';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { verifySolanaSignature } from './wallet_link';

/** How many proposals the list endpoint returns (newest first). */
const PROPOSAL_LIST_LIMIT = 50;
/** How long a sign-to-vote challenge stays valid (mirrors the wallet-link TTL). */
const VOTE_CHALLENGE_TTL_MINUTES = 10;

/**
 * Whether off-chain governance is enabled. DEFAULT OFF: only the exact string '1'
 * turns it on, so a stray 'true'/'0'/'' cannot accidentally enable it. Read live
 * per request (like the /api/perf ALLOW_DEV_COMMANDS gate) so a deploy toggles it
 * without a rebuild. Exported for the client-facing status surface and the tests.
 */
export function governanceEnabled(): boolean {
  return process.env.GOVERNANCE_ENABLED === '1';
}

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module load,
// before main.ts has booted, so the handlers cannot import the live db/RPC/admin
// reads directly (a cycle, and woc_balance/db construct heavy singletons). main.ts
// injects a GovernanceRuntime once at boot; a request never arrives before that runs.
// A unit test installs a fake runtime (fake db + deterministic balances + a fixed
// clock) via configureGovernanceRuntime and clears it with resetGovernanceRuntimeForTests.
// ---------------------------------------------------------------------------

/** The main.ts-owned dependencies the governance handlers need. */
export interface GovernanceRuntime {
  /** The governance data seam (PgGovernanceDb in production, a fake in tests). */
  db: GovernanceDb;
  /**
   * The wallet's whole-token $WOC balance via the existing holder-balance pipeline
   * (server/woc_balance.ts cachedWocBalance). null on an RPC failure so the caller
   * can reject rather than silently record a zero-weight vote.
   */
  walletBalance(pubkey: string): Promise<number | null>;
  /** The account's linked wallet pubkey, or null (server/db.ts walletForAccount). */
  linkedWallet(accountId: number): Promise<string | null>;
  /** True when the account may create a proposal (admin, server/db.ts isAdminAccount). */
  canCreateProposal(accountId: number): Promise<boolean>;
  /** The current time in ms (Date.now in production; a fixed clock in tests). */
  now(): number;
}

let runtime: GovernanceRuntime | null = null;

/** Inject the main.ts runtime the handlers need. Called once at boot (and in tests). */
export function configureGovernanceRuntime(rt: GovernanceRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetGovernanceRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): GovernanceRuntime {
  if (runtime === null) {
    throw new Error('governance runtime is not configured; call configureGovernanceRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// The fail-closed flag gate. Mounted FIRST on every governance route, before the
// auth guard and before any DB or RPC work, so a flag-off deployment refuses the
// whole surface with a coded 503 and never reads a body, a token, or the chain.
// ---------------------------------------------------------------------------

/** Refuse every governance endpoint when the flag is off (fail-closed 503). */
const governanceGate: Middleware = async (_ctx, next) => {
  if (!governanceEnabled()) throw new HttpError(503, 'governance.disabled');
  await next();
};

// The bearer guards. Reads need an authenticated (read-scope) account; the mutating
// routes (create, vote) need a mutation-scope token, matching the wallet-link flow.
const readAccount = requireAccount({ scope: 'read' });
const activeAccount = requireAccount({ scope: 'active' });

/** The request domain for the signed message (mirrors wallet.ts requestDomain). */
function requestDomain(req: http.IncomingMessage): string {
  const host = (req.headers.host ?? '').split(':')[0];
  return host || 'world-of-claudecraft';
}

/** Parse a :id path param to a positive integer proposal id, or throw 404. */
function proposalIdParam(ctx: Ctx): number {
  const raw = ctx.params.id ?? '';
  if (!/^[1-9]\d*$/.test(raw)) throw new HttpError(404, 'governance.not_found');
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new HttpError(404, 'governance.not_found');
  return id;
}

/** Load a proposal by id or throw the coded 404 (this realm only). */
async function loadProposal(rt: GovernanceRuntime, id: number): Promise<Proposal> {
  const proposal = await rt.db.getProposal(id);
  if (!proposal) throw new HttpError(404, 'governance.not_found');
  return proposal;
}

/** The public JSON shape for a proposal (the linked wallet is never exposed). */
function proposalJson(proposal: Proposal, now: number): unknown {
  return {
    id: proposal.id,
    category: proposal.category,
    title: proposal.title,
    body: proposal.body,
    createdAt: proposal.createdAt,
    opensAt: proposal.opensAt,
    closesAt: proposal.closesAt,
    quorum: proposal.quorum,
    open: isWindowOpen(proposal, now),
  };
}

/** The public JSON shape for a tally (already fully computed). */
function tallyJson(tally: Tally): unknown {
  return {
    proposalId: tally.proposalId,
    for: tally.for,
    against: tally.against,
    abstain: tally.abstain,
    totalWeight: tally.totalWeight,
    voterCount: tally.voterCount,
    quorum: tally.quorum,
    quorumReached: tally.quorumReached,
    open: tally.open,
  };
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** POST /api/governance/proposals: create a proposal (admin/flag-gated). */
async function createProposalHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  if (!(await rt.canCreateProposal(accountId))) {
    throw new HttpError(403, 'governance.forbidden');
  }
  const body = await readBody(ctx.req);
  const validated = validateProposalDraft(
    {
      category: body.category,
      title: body.title,
      body: body.body,
      windowHours: body.windowHours,
      quorum: body.quorum,
    },
    accountId,
    rt.now(),
  );
  if (!validated.ok) throw new HttpError(400, 'governance.invalid_input');
  const proposal = await rt.db.createProposal(validated.draft);
  json(ctx.res, 201, { proposal: proposalJson(proposal, rt.now()) });
}

/** GET /api/governance/proposals: the newest proposals for this realm. */
async function listProposalsHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const now = rt.now();
  const proposals = await rt.db.listProposals(PROPOSAL_LIST_LIMIT);
  json(ctx.res, 200, { proposals: proposals.map((p) => proposalJson(p, now)) });
}

/** GET /api/governance/proposals/:id/tally: the weighted tally + quorum. */
async function tallyHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const id = proposalIdParam(ctx);
  const proposal = await loadProposal(rt, id);
  const votes = await rt.db.votesForProposal(id);
  json(ctx.res, 200, { tally: tallyJson(computeTally(proposal, votes, rt.now())) });
}

/**
 * The shared preconditions for a vote request: the proposal exists, its window is
 * open, the caller has a linked wallet, and the presented wallet matches that link.
 * Returns the validated { proposal, wallet, choice }. Throws the coded rejection for
 * any failure (window closed, no wallet, wallet mismatch, bad choice).
 */
async function resolveVoteContext(
  ctx: Ctx,
  rt: GovernanceRuntime,
  accountId: number,
  rawChoice: unknown,
): Promise<{ proposal: Proposal; wallet: string; choice: GovernanceChoice }> {
  const id = proposalIdParam(ctx);
  const proposal = await loadProposal(rt, id);
  if (!isWindowOpen(proposal, rt.now())) throw new HttpError(409, 'governance.window_closed');
  if (!isGovernanceChoice(rawChoice)) throw new HttpError(400, 'governance.invalid_input');
  // A voter always votes with their own linked wallet: resolve it here (single read)
  // rather than trusting a client-presented address. No wallet linked -> reject.
  const wallet = await rt.linkedWallet(accountId);
  if (wallet === null) throw new HttpError(403, 'governance.wallet_not_linked');
  return { proposal, wallet, choice: rawChoice };
}

/**
 * POST /api/governance/proposals/:id/vote/challenge { choice }: issue the message
 * the wallet must sign to cast this ballot. Binds account, wallet, proposal, and
 * choice so a signature cannot be replayed onto a different ballot.
 */
async function voteChallengeHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  const body = await readBody(ctx.req);
  const { proposal, wallet, choice } = await resolveVoteContext(ctx, rt, accountId, body.choice);
  // Reject up front if this wallet has already voted, so the player is not asked to
  // sign a message that would then be rejected at submit time.
  if (await rt.db.voteByWallet(proposal.id, wallet)) {
    throw new HttpError(409, 'governance.already_voted');
  }
  await rt.db.pruneVoteChallenges();
  const nonce = randomBytes(16).toString('hex');
  const message = buildVoteMessage({
    domain: requestDomain(ctx.req),
    accountId,
    wallet,
    proposalId: proposal.id,
    choice,
    nonce,
    issuedAt: new Date(rt.now()).toISOString(),
  });
  await rt.db.createVoteChallenge(
    { nonce, accountId, proposalId: proposal.id, wallet, choice, message },
    VOTE_CHALLENGE_TTL_MINUTES,
  );
  json(ctx.res, 200, { nonce, message });
}

/**
 * POST /api/governance/proposals/:id/vote { choice, signature, nonce }: verify the
 * signature over the stored challenge, snapshot the wallet's $WOC weight, and record
 * one immutable ballot. Weight is FROZEN here, so a later balance change never alters
 * the recorded vote (PR #468 snapshot semantics). One vote per wallet is enforced by
 * the DB PRIMARY KEY, so a concurrent double-submit is rejected without a read race.
 */
async function voteHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  const body = await readBody(ctx.req);
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!nonce || !signature) throw new HttpError(400, 'governance.invalid_input');

  // Consume the challenge FIRST (single-use, replay protection): it carries the
  // exact message that was signed, the wallet, the proposal, and the choice, so the
  // client cannot substitute a different ballot after signing.
  const challenge = await rt.db.consumeVoteChallenge(nonce, accountId);
  if (!challenge) throw new HttpError(400, 'governance.challenge_invalid');

  const id = proposalIdParam(ctx);
  if (challenge.proposalId !== id) throw new HttpError(400, 'governance.challenge_invalid');
  if (!verifySolanaSignature(challenge.message, signature, challenge.wallet)) {
    throw new HttpError(401, 'governance.bad_signature');
  }

  // Re-check the wallet link and window at submit time (the challenge may have been
  // issued moments before the wallet was unlinked or the window closed).
  const linked = await rt.linkedWallet(accountId);
  if (linked === null || linked !== challenge.wallet) {
    throw new HttpError(403, 'governance.wallet_mismatch');
  }
  const proposal = await loadProposal(rt, id);
  if (!isWindowOpen(proposal, rt.now())) throw new HttpError(409, 'governance.window_closed');

  // Snapshot the weight from the live balance and FREEZE it onto the ballot. A null
  // balance is an RPC failure, NOT a zero holding: recording it would freeze the
  // voter permanently at weight 0 (the one-vote-per-wallet PK bars a re-vote), so
  // reject with a retryable 503 and record no ballot. A genuine zero balance reads
  // as 0 (a real number), casts a zero-weight vote, and is not rejected here.
  const balance = await rt.walletBalance(challenge.wallet);
  if (balance === null) throw new HttpError(503, 'governance.balance_unavailable');
  const weight = weightForBalance(balance);
  const inserted = await rt.db.castVote({
    proposalId: id,
    wallet: challenge.wallet,
    accountId,
    choice: challenge.choice,
    weight,
    castAt: rt.now(),
  });
  if (!inserted) throw new HttpError(409, 'governance.already_voted');
  json(ctx.res, 201, { voted: true, choice: challenge.choice, weight });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. governanceGate is
// mounted FIRST on EVERY route (fail-closed 503 when the flag is off, before auth
// or any IO); then the bearer guard; then, on the two sign-flow routes, the shared
// wallet-link rate limiter (ip+account, so it sits after the auth guard that sets
// ctx.account). All routes are problem+json (the surface default 'api' envelope).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/governance/proposals',
    surface: 'api',
    middleware: [governanceGate, activeAccount],
    handler: createProposalHandler,
  },
  {
    method: 'GET',
    path: '/api/governance/proposals',
    surface: 'api',
    middleware: [governanceGate, readAccount],
    handler: listProposalsHandler,
  },
  {
    method: 'GET',
    path: '/api/governance/proposals/:id/tally',
    surface: 'api',
    middleware: [governanceGate, readAccount],
    handler: tallyHandler,
    // Resolved by numeric id with no ownership concept (a proposal is realm-public
    // to any authenticated member), so it is an intentional public-read :param.
    meta: { publicRead: true },
  },
  {
    method: 'POST',
    path: '/api/governance/proposals/:id/vote/challenge',
    surface: 'api',
    middleware: [governanceGate, activeAccount, rateLimit(WALLET_LINK_POLICY)],
    handler: voteChallengeHandler,
    meta: { publicRead: true },
  },
  {
    method: 'POST',
    path: '/api/governance/proposals/:id/vote',
    surface: 'api',
    middleware: [governanceGate, activeAccount, rateLimit(WALLET_LINK_POLICY)],
    handler: voteHandler,
    meta: { publicRead: true },
  },
];
