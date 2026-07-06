// SQL for off-chain $WOC governance (PR #468). The ONLY place governance SQL runs;
// the rules live in governance_core.ts and the route shell in governance.ts.
//
// The GovernanceDb interface is the seam the route shell and tests depend on, so a
// logic test drives an in-memory FakeGovernanceDb (tests/server/helpers) with zero
// pg, mirroring the SocialService/SocialDb and chat_filter/chat_filter_db split.
// PgGovernanceDb is the production implementation over the shared pool; it is the
// only binding that touches Postgres.

import { pool } from './db';
import type {
  GovernanceCategory,
  GovernanceChoice,
  Proposal,
  ProposalDraft,
  Vote,
} from './governance_core';
import { REALM } from './realm';

/** A pending sign-to-vote challenge (the row the DB stores and consumes once). */
export interface VoteChallenge {
  nonce: string;
  accountId: number;
  proposalId: number;
  wallet: string;
  choice: GovernanceChoice;
  message: string;
}

/** The inputs to record one immutable ballot (weight already frozen by the shell). */
export interface CastVoteInput {
  proposalId: number;
  wallet: string;
  accountId: number;
  choice: GovernanceChoice;
  weight: number;
  castAt: number;
}

/**
 * The governance data seam. Every method is realm-scoped by the implementation
 * (one process = one realm), so callers never pass a realm. Times are ms-since-
 * epoch at this boundary; the Pg implementation converts to and from TIMESTAMPTZ.
 */
export interface GovernanceDb {
  /** Insert a validated draft, returning the stored proposal (with its new id). */
  createProposal(draft: ProposalDraft): Promise<Proposal>;
  /** The most recent proposals for this realm, newest first, capped at `limit`. */
  listProposals(limit: number): Promise<Proposal[]>;
  /** One proposal by id (this realm only), or null. */
  getProposal(id: number): Promise<Proposal | null>;
  /** Every ballot cast on a proposal (for the tally). */
  votesForProposal(proposalId: number): Promise<Vote[]>;
  /** The caller's own ballot on a proposal, or null (whether they have voted). */
  voteByWallet(proposalId: number, wallet: string): Promise<Vote | null>;
  /** Store a pending sign-to-vote challenge that expires after `ttlMinutes`. */
  createVoteChallenge(challenge: VoteChallenge, ttlMinutes: number): Promise<void>;
  /**
   * Atomically consume (delete) a challenge by nonce + account, returning it if it
   * was present and unexpired, else null (expired, unknown, or already used).
   */
  consumeVoteChallenge(nonce: string, accountId: number): Promise<VoteChallenge | null>;
  /** Delete expired challenges (housekeeping, called opportunistically). */
  pruneVoteChallenges(): Promise<void>;
  /**
   * Record one ballot. Returns true when inserted, false when the wallet has
   * already voted on this proposal (the PRIMARY KEY conflict), so the handler can
   * surface a double-vote rejection without a prior read race.
   */
  castVote(input: CastVoteInput): Promise<boolean>;
}

interface ProposalRow {
  id: string | number;
  category: string;
  title: string;
  body: string;
  created_by_account_id: number;
  created_at: Date;
  opens_at: Date;
  closes_at: Date;
  quorum: string | number;
}

interface VoteRow {
  proposal_id: string | number;
  wallet: string;
  choice: string;
  weight: string | number;
  cast_at: Date;
}

interface ChallengeRow {
  nonce: string;
  account_id: number;
  proposal_id: string | number;
  wallet: string;
  choice: string;
  message: string;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: Number(row.id),
    category: row.category as GovernanceCategory,
    title: row.title,
    body: row.body,
    createdByAccountId: row.created_by_account_id,
    createdAt: row.created_at.getTime(),
    opensAt: row.opens_at.getTime(),
    closesAt: row.closes_at.getTime(),
    quorum: Number(row.quorum),
  };
}

function toVote(row: VoteRow): Vote {
  return {
    proposalId: Number(row.proposal_id),
    wallet: row.wallet,
    choice: row.choice as GovernanceChoice,
    weight: Number(row.weight),
    castAt: row.cast_at.getTime(),
  };
}

/** The production GovernanceDb over the shared pool, realm-scoped throughout. */
export class PgGovernanceDb implements GovernanceDb {
  async createProposal(draft: ProposalDraft): Promise<Proposal> {
    const res = await pool.query<ProposalRow>(
      `INSERT INTO governance_proposals
         (realm, category, title, body, created_by_account_id, created_at, opens_at, closes_at, quorum)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0), $9)
       RETURNING id, category, title, body, created_by_account_id, created_at, opens_at, closes_at, quorum`,
      [
        REALM,
        draft.category,
        draft.title,
        draft.body,
        draft.createdByAccountId,
        draft.createdAt,
        draft.opensAt,
        draft.closesAt,
        draft.quorum,
      ],
    );
    return toProposal(res.rows[0]);
  }

  async listProposals(limit: number): Promise<Proposal[]> {
    const res = await pool.query<ProposalRow>(
      `SELECT id, category, title, body, created_by_account_id, created_at, opens_at, closes_at, quorum
         FROM governance_proposals
        WHERE realm = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [REALM, limit],
    );
    return res.rows.map(toProposal);
  }

  async getProposal(id: number): Promise<Proposal | null> {
    const res = await pool.query<ProposalRow>(
      `SELECT id, category, title, body, created_by_account_id, created_at, opens_at, closes_at, quorum
         FROM governance_proposals
        WHERE realm = $1 AND id = $2`,
      [REALM, id],
    );
    return res.rows[0] ? toProposal(res.rows[0]) : null;
  }

  async votesForProposal(proposalId: number): Promise<Vote[]> {
    const res = await pool.query<VoteRow>(
      `SELECT proposal_id, wallet, choice, weight, cast_at
         FROM governance_votes
        WHERE proposal_id = $1
        ORDER BY cast_at ASC`,
      [proposalId],
    );
    return res.rows.map(toVote);
  }

  async voteByWallet(proposalId: number, wallet: string): Promise<Vote | null> {
    const res = await pool.query<VoteRow>(
      `SELECT proposal_id, wallet, choice, weight, cast_at
         FROM governance_votes
        WHERE proposal_id = $1 AND wallet = $2`,
      [proposalId, wallet],
    );
    return res.rows[0] ? toVote(res.rows[0]) : null;
  }

  async createVoteChallenge(challenge: VoteChallenge, ttlMinutes: number): Promise<void> {
    await pool.query(
      `INSERT INTO governance_vote_challenges
         (nonce, account_id, proposal_id, wallet, choice, message, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)`,
      [
        challenge.nonce,
        challenge.accountId,
        challenge.proposalId,
        challenge.wallet,
        challenge.choice,
        challenge.message,
        String(ttlMinutes),
      ],
    );
  }

  async consumeVoteChallenge(nonce: string, accountId: number): Promise<VoteChallenge | null> {
    const res = await pool.query<ChallengeRow>(
      `DELETE FROM governance_vote_challenges
        WHERE nonce = $1 AND account_id = $2 AND expires_at > now()
        RETURNING nonce, account_id, proposal_id, wallet, choice, message`,
      [nonce, accountId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      nonce: row.nonce,
      accountId: row.account_id,
      proposalId: Number(row.proposal_id),
      wallet: row.wallet,
      choice: row.choice as GovernanceChoice,
      message: row.message,
    };
  }

  async pruneVoteChallenges(): Promise<void> {
    await pool.query('DELETE FROM governance_vote_challenges WHERE expires_at <= now()');
  }

  async castVote(input: CastVoteInput): Promise<boolean> {
    const res = await pool.query(
      `INSERT INTO governance_votes (proposal_id, wallet, account_id, choice, weight, cast_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       ON CONFLICT (proposal_id, wallet) DO NOTHING`,
      [input.proposalId, input.wallet, input.accountId, input.choice, input.weight, input.castAt],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
