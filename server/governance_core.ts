// Pure (IO-free) core for off-chain $WOC governance voting.
//
// This realizes the design stub in PR #468: advisory, Snapshot-style holder
// voting on content priorities, the cosmetic catalog, and treasury spend. It is
// ADVISORY / off-chain only: no on-chain writes, no keypair usage. The chain is
// read only to weight a vote by the voter's $WOC balance.
//
// Kept separate from server/governance_db.ts (SQL) and server/governance.ts (the
// route shell that reads the DB, the RPC balance, and the request) so all the
// rules here can be unit-tested with no database, no RPC, and no HTTP, mirroring
// the wallet_link.ts (pure) versus wallet.ts (shell) split this repo uses.

/** The subjects a proposal may cover. Advisory, cosmetic-only, never pay-to-win. */
export const GOVERNANCE_CATEGORIES = ['content', 'cosmetic', 'treasury'] as const;
export type GovernanceCategory = (typeof GOVERNANCE_CATEGORIES)[number];

/** The vote choices. A ballot is one of these three. */
export const GOVERNANCE_CHOICES = ['for', 'against', 'abstain'] as const;
export type GovernanceChoice = (typeof GOVERNANCE_CHOICES)[number];

/** Bounds on the proposer-supplied text, enforced before any DB write. */
export const TITLE_MIN_LENGTH = 4;
export const TITLE_MAX_LENGTH = 120;
export const BODY_MAX_LENGTH = 4000;
/** Voting-window bounds, in whole hours, enforced at creation. */
export const MIN_WINDOW_HOURS = 1;
export const MAX_WINDOW_HOURS = 24 * 30; // 30 days

/** A stored proposal (the shape the DB layer returns and the core reasons over). */
export interface Proposal {
  id: number;
  category: GovernanceCategory;
  title: string;
  body: string;
  /** The account that created the proposal (an admin/flag-gated action). */
  createdByAccountId: number;
  /** Proposal creation time (ms since epoch). The snapshot boundary. */
  createdAt: number;
  /** When the voting window opens (equal to createdAt today). */
  opensAt: number;
  /** When the voting window closes; a vote at or after this instant is rejected. */
  closesAt: number;
  /**
   * Total $WOC supply weight required for the tally to reach quorum, in whole
   * $WOC. A tally whose summed FOR+AGAINST+ABSTAIN weight is below this is
   * advisory-but-not-quorate. Frozen at creation.
   */
  quorum: number;
}

/** A single cast ballot. weight is frozen at the instant the wallet first voted. */
export interface Vote {
  proposalId: number;
  /** The linked wallet that cast this ballot (one ballot per wallet per proposal). */
  wallet: string;
  choice: GovernanceChoice;
  /**
   * The voter's $WOC balance at the moment they cast the ballot, in whole $WOC,
   * FROZEN here. A later balance change does not alter this recorded weight: this
   * is the snapshot the tally sums, so weight is stable once cast (PR #468's
   * "snapshotted" semantics, realized per-voter at vote time since no historical
   * RPC exists).
   */
  weight: number;
  castAt: number;
}

/** The weighted tally the tally endpoint returns. */
export interface Tally {
  proposalId: number;
  /** Summed frozen weight per choice, in whole $WOC. */
  for: number;
  against: number;
  abstain: number;
  /** for + against + abstain. The figure compared against quorum. */
  totalWeight: number;
  /** Distinct wallets that have voted. */
  voterCount: number;
  /** The proposal's quorum threshold, echoed for the client. */
  quorum: number;
  /** True when totalWeight >= quorum. */
  quorumReached: boolean;
  /** True when now < closesAt (the window is still open). */
  open: boolean;
}

/** The reason a create-proposal request is rejected. Maps to governance.invalid_input. */
export type GovernanceReject =
  | 'invalid_category'
  | 'invalid_title'
  | 'invalid_body'
  | 'invalid_window'
  | 'invalid_quorum';

/** A validated, normalized proposal draft ready for the DB insert. */
export interface ProposalDraft {
  category: GovernanceCategory;
  title: string;
  body: string;
  createdByAccountId: number;
  createdAt: number;
  opensAt: number;
  closesAt: number;
  quorum: number;
}

/** True for a value that is one of the known categories. */
export function isGovernanceCategory(value: unknown): value is GovernanceCategory {
  return typeof value === 'string' && (GOVERNANCE_CATEGORIES as readonly string[]).includes(value);
}

/** True for a value that is one of the known vote choices. */
export function isGovernanceChoice(value: unknown): value is GovernanceChoice {
  return typeof value === 'string' && (GOVERNANCE_CHOICES as readonly string[]).includes(value);
}

/** The raw, still-untrusted create-proposal input from the request body. */
export interface CreateProposalInput {
  category: unknown;
  title: unknown;
  body: unknown;
  windowHours: unknown;
  quorum: unknown;
}

/**
 * Validate and normalize a create-proposal request into a draft, or return the
 * first failing reason. Pure: `now` is injected so the test controls the clock.
 * Every field is checked at this boundary; the DB layer trusts the draft.
 */
export function validateProposalDraft(
  input: CreateProposalInput,
  createdByAccountId: number,
  now: number,
): { ok: true; draft: ProposalDraft } | { ok: false; reason: GovernanceReject } {
  if (!isGovernanceCategory(input.category)) return { ok: false, reason: 'invalid_category' };
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) {
    return { ok: false, reason: 'invalid_title' };
  }
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length > BODY_MAX_LENGTH) return { ok: false, reason: 'invalid_body' };
  if (
    typeof input.windowHours !== 'number' ||
    !Number.isInteger(input.windowHours) ||
    input.windowHours < MIN_WINDOW_HOURS ||
    input.windowHours > MAX_WINDOW_HOURS
  ) {
    return { ok: false, reason: 'invalid_window' };
  }
  if (
    typeof input.quorum !== 'number' ||
    !Number.isFinite(input.quorum) ||
    input.quorum < 0 ||
    !Number.isInteger(input.quorum)
  ) {
    return { ok: false, reason: 'invalid_quorum' };
  }
  return {
    ok: true,
    draft: {
      category: input.category,
      title,
      body,
      createdByAccountId,
      createdAt: now,
      opensAt: now,
      closesAt: now + input.windowHours * 60 * 60 * 1000,
      quorum: input.quorum,
    },
  };
}

/** True when `now` is inside the proposal's [opensAt, closesAt) voting window. */
export function isWindowOpen(proposal: Proposal, now: number): boolean {
  return now >= proposal.opensAt && now < proposal.closesAt;
}

/**
 * The exact human-readable text a voter's wallet is asked to sign to authorize a
 * ballot. Binds the account, wallet, proposal, choice, and nonce so a signature
 * for one ballot cannot be replayed onto another. The wording mirrors the
 * wallet-link challenge (buildLinkMessage) and states plainly that signing
 * authorizes no transaction.
 */
export function buildVoteMessage(opts: {
  domain: string;
  accountId: number;
  wallet: string;
  proposalId: number;
  choice: GovernanceChoice;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${opts.domain} wants you to cast an advisory $WOC governance vote.`,
    '',
    `Account: #${opts.accountId}`,
    `Wallet: ${opts.wallet}`,
    `Proposal: #${opts.proposalId}`,
    `Choice: ${opts.choice}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
    '',
    'This vote is advisory and off-chain. Signing is free and authorizes no transaction.',
  ].join('\n');
}

/**
 * Sum the frozen ballot weights into the weighted tally. Pure over the proposal
 * plus its votes; `now` decides only the `open` flag. Exact integer arithmetic:
 * each vote carries a whole-$WOC frozen weight, so the sums never drift.
 */
export function computeTally(proposal: Proposal, votes: readonly Vote[], now: number): Tally {
  let forWeight = 0;
  let againstWeight = 0;
  let abstainWeight = 0;
  for (const vote of votes) {
    if (vote.choice === 'for') forWeight += vote.weight;
    else if (vote.choice === 'against') againstWeight += vote.weight;
    else abstainWeight += vote.weight;
  }
  const totalWeight = forWeight + againstWeight + abstainWeight;
  return {
    proposalId: proposal.id,
    for: forWeight,
    against: againstWeight,
    abstain: abstainWeight,
    totalWeight,
    voterCount: votes.length,
    quorum: proposal.quorum,
    quorumReached: totalWeight >= proposal.quorum,
    open: isWindowOpen(proposal, now),
  };
}

/**
 * The whole-$WOC voting weight for a wallet, from its raw balance. Floors to a
 * whole token so the frozen weight is an exact integer (the tally sums integers),
 * and clamps a negative or non-finite reading to 0. This is the snapshot value
 * frozen onto the vote row at cast time.
 */
export function weightForBalance(balance: number | null): number {
  if (balance === null || !Number.isFinite(balance) || balance <= 0) return 0;
  return Math.floor(balance);
}
