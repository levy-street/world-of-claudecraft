import type { Pool, PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import {
  createReferralCard,
  type ReferralCardResult,
  type ReferralCardState,
} from '../src/sim/referral_cards';
import {
  type CharacterSaveAccountLockProof,
  lockCharacterSaveAccountParentOnClient,
} from './bank_ledger_save_effects_db';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  type DbTransactionDeadline,
} from './db_transaction_deadline';
import type { FirstPaidFeedReceipt } from './referral_economy_delivery';
import { referralDiagnostics } from './referral_metrics';
import type { CharacterSaveArgs } from './woc_market_character_save';

export const REFERRAL_PAGE_SIZE = 50;
export const REFERRAL_SQL_TIMEOUT_MS = 5_000;
export const REFERRAL_SUMMON_SECONDS = 30 * 60;

export interface StoredReferral {
  card: ReferralCardState;
  summonAt: readonly [number, number];
}
export interface ReferralPage {
  links: StoredReferral[];
  nextCursor: number | null;
  completedFriends: number;
  rewardedTiers: number[];
  readyCount: number;
  completionNotice?: { count: number; friendName: string };
}
export interface ReferralCommit {
  result: ReferralCardResult;
  saves: { before: CharacterSaveArgs; after: CharacterState }[];
  completedFriends?: number;
  readyCounts?: Record<number, number>;
}
export interface ReferralStorePorts {
  pool: Pick<Pool, 'connect' | 'query'>;
  leaseHolder: string;
  save(
    client: DbTransactionDeadline,
    save: CharacterSaveArgs,
    proof: CharacterSaveAccountLockProof,
  ): Promise<boolean>;
  saveOffline(
    client: DbTransactionDeadline,
    characterId: number,
    state: CharacterState,
    realm: string,
  ): Promise<boolean>;
  grant(
    state: CharacterState,
    linkId: number,
    milestone: import('../src/sim/referral_cards').ReferralMilestone,
  ): CharacterState;
  move(
    from: CharacterState,
    to: CharacterState,
    linkId: number,
  ): { from: CharacterState; to: CharacterState };
  ready?(): Promise<void>;
}
export class ReferralLeaseLost extends Error {}
export class ReferralCommitAmbiguous extends Error {}
export interface ReferralRewardRow {
  receipt: string;
  accountId: number;
  tier: number;
}
export interface ReferralBondRecipient {
  characterId: number;
  name: string;
  realm: string;
}
export interface ReferralBondRow {
  linkId: number;
  accountId: number;
  receipt: string;
  recipient: ReferralBondRecipient | null;
}

/** All reads and writes are finite transactions, including explicit-page reads.
 * The caller admits no more than four jobs before the shared DB permit. */
export class PgReferralStore {
  private activeTransactions = 0;
  constructor(private readonly ports: ReferralStorePorts) {}

  private async transaction<T>(run: (tx: DbTransactionDeadline) => Promise<T>): Promise<T> {
    if (this.activeTransactions >= 4) {
      referralDiagnostics.dbRefused++;
      throw new Error('Referral database admission full');
    }
    referralDiagnostics.dbAdmitted++;
    const started = performance.now();
    this.activeTransactions++;
    let client: PoolClient;
    try {
      client = await this.ports.pool.connect();
    } catch (error) {
      this.activeTransactions--;
      referralDiagnostics.dbFailed++;
      referralDiagnostics.dbDurationMs += performance.now() - started;
      throw error;
    }
    const tx = createDbTransactionDeadline(client, {
      operation: 'referral cards',
      timeoutMs: 10_000,
      cancelBackend: backendCancelViaPool(this.ports.pool),
    });
    let committing = false;
    try {
      await tx.query('BEGIN');
      await tx.query(
        "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '5s'",
      );
      const result = await run(tx);
      committing = true;
      await tx.commit();
      return result;
    } catch (error) {
      referralDiagnostics.dbFailed++;
      if (
        (error as { code?: string })?.code === '57014' ||
        (error as Error)?.name?.includes('Deadline')
      )
        referralDiagnostics.dbTimeouts++;
      await tx.rollback();
      if (committing)
        throw new ReferralCommitAmbiguous('Referral commit outcome unknown', { cause: error });
      throw error;
    } finally {
      tx.release();
      this.activeTransactions--;
      referralDiagnostics.dbDurationMs += performance.now() - started;
    }
  }

  async page(accountId: number, after = 0, characterId?: number): Promise<ReferralPage> {
    await this.ports.ready?.();
    return this.transaction(async (tx) => {
      // Each arm is index-addressed, keyset paged, and bounded before the union.
      const result = await tx.query<{
        referee_account_id: number;
        referrer_account_id: number;
        state: ReferralCardState | null;
        inviter_summon_at: Date | null;
        invitee_summon_at: Date | null;
      }>(
        `WITH links AS (
        (SELECT referee_account_id, referrer_account_id FROM referrals
          WHERE referrer_account_id = $1 AND referee_account_id > $2 ORDER BY referee_account_id LIMIT 51)
        UNION ALL
        (SELECT referee_account_id, referrer_account_id FROM referrals
          WHERE referee_account_id = $1 AND referee_account_id > $2 LIMIT 1)
      ) SELECT l.*, c.state, c.inviter_summon_at, c.invitee_summon_at FROM links l
        LEFT JOIN referral_cards c ON c.link_id = l.referee_account_id
        ORDER BY l.referee_account_id LIMIT 51`,
        [accountId, after],
      );
      const progress = await tx.query<{
        completed_count: number;
        rewarded_mask: number;
        noticed_count: number;
        latest_friend_name: string;
      }>(
        'SELECT completed_count, rewarded_mask, noticed_count, latest_friend_name FROM referral_progress WHERE account_id = $1',
        [accountId],
      );
      const character = characterId
        ? await tx.query<{ ready_count: number }>(
            'SELECT ready_count FROM referral_character_progress WHERE character_id=$1',
            [characterId],
          )
        : null;
      const rows = result.rows.slice(0, REFERRAL_PAGE_SIZE);
      return {
        links: rows.map((r) => ({
          card:
            r.state ??
            createReferralCard(r.referee_account_id, r.referrer_account_id, r.referee_account_id),
          summonAt: [r.inviter_summon_at?.getTime() ?? 0, r.invitee_summon_at?.getTime() ?? 0],
        })),
        nextCursor:
          result.rows.length > REFERRAL_PAGE_SIZE ? rows.at(-1)!.referee_account_id : null,
        completedFriends: progress.rows[0]?.completed_count ?? 0,
        readyCount: character?.rows[0]?.ready_count ?? 0,
        completionNotice:
          progress.rows[0] && progress.rows[0].completed_count > progress.rows[0].noticed_count
            ? {
                count: progress.rows[0].completed_count,
                friendName: progress.rows[0].latest_friend_name,
              }
            : undefined,
        rewardedTiers: [1, 2, 3, 4, 5].filter(
          (tier) => (progress.rows[0]?.rewarded_mask ?? 0) & (1 << (tier - 1)),
        ),
      };
    });
  }
  async accountRewards(accountId: number): Promise<number> {
    return this.transaction(async (tx) => {
      const row = await tx.query<{ rewarded_mask: number }>(
        'SELECT rewarded_mask FROM referral_progress WHERE account_id=$1',
        [accountId],
      );
      return row.rows[0]?.rewarded_mask ?? 0;
    });
  }
  async acknowledgeCompletion(accountId: number, count: number): Promise<void> {
    return this.transaction(async (tx) => {
      await tx.query(
        `UPDATE referral_progress SET noticed_count=GREATEST(noticed_count,LEAST(completed_count,$2))
        WHERE account_id=$1`,
        [accountId, count],
      );
    });
  }

  /** Exact live party pairs, never an inviter's entire referral history. */
  async pairs(accounts: readonly number[]): Promise<StoredReferral[]> {
    const ids = [...new Set(accounts)].slice(0, 10);
    if (ids.length < 2) return [];
    return this.transaction(async (tx) => {
      const result = await tx.query<{
        referee_account_id: number;
        referrer_account_id: number;
        state: ReferralCardState | null;
        inviter_summon_at: Date | null;
        invitee_summon_at: Date | null;
      }>(
        `SELECT r.referee_account_id, r.referrer_account_id, c.state, c.inviter_summon_at, c.invitee_summon_at
         FROM referrals r LEFT JOIN referral_cards c ON c.link_id = r.referee_account_id
         WHERE r.referee_account_id = ANY($1::int[]) AND r.referrer_account_id = ANY($1::int[])
         LIMIT 45`,
        [ids],
      );
      return result.rows.map((r) => ({
        card:
          r.state ??
          createReferralCard(r.referee_account_id, r.referrer_account_id, r.referee_account_id),
        summonAt: [r.inviter_summon_at?.getTime() ?? 0, r.invitee_summon_at?.getTime() ?? 0],
      }));
    });
  }

  /** Caller holds the destination character FIFO and captures inside that FIFO.
   * Reducer is evaluated under the row lock, so simultaneous accept/redeem/credit
   * cannot lose bits. Ownership comes from the immutable registration referral. */
  async mutate(
    linkId: number,
    accountId: number,
    reduce: (state: ReferralCardState) => ReferralCardResult,
    capture?: () => CharacterSaveArgs | null,
  ): Promise<ReferralCommit> {
    return this.transaction(async (tx) => {
      const link = await tx.query<{ referrer_account_id: number }>(
        `SELECT referrer_account_id FROM referrals WHERE referee_account_id = $1
         AND (referrer_account_id = $2 OR referee_account_id = $2)`,
        [linkId, accountId],
      );
      if (!link.rows[0]) throw new Error('Referral link unavailable');
      const inviter = link.rows[0].referrer_account_id;
      let proof: CharacterSaveAccountLockProof | undefined;
      for (const id of [inviter, linkId].sort((a, b) => a - b)) {
        const locked = await lockCharacterSaveAccountParentOnClient(tx, id);
        if (id === accountId) proof = locked;
      }
      const initial = createReferralCard(linkId, inviter, linkId);
      await tx.query(
        `INSERT INTO referral_cards(link_id, inviter_account_id, state)
        VALUES ($1, $2, $3::jsonb) ON CONFLICT(link_id) DO NOTHING`,
        [linkId, inviter, JSON.stringify(initial)],
      );
      const row = await tx.query<{ state: ReferralCardState }>(
        'SELECT state FROM referral_cards WHERE link_id = $1 FOR UPDATE',
        [linkId],
      );
      const current = row.rows[0].state;
      const result = reduce(current);
      const committed: ReferralCommit = { result, saves: [] };
      if (result.error || result.state === current) return committed;
      if (result.state.linkId !== linkId || result.state.revision !== current.revision + 1)
        throw new Error('Invalid referral transition');
      for (const intent of result.intents) {
        if (intent.type === 'friendCompleted') {
          const insert = await tx.query(
            `INSERT INTO referral_completions(link_id, inviter_account_id)
            VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING link_id`,
            [linkId, inviter],
          );
          if (!insert.rowCount) continue;
          const summary = await tx.query<{ completed_count: number }>(
            `INSERT INTO referral_progress(account_id,completed_count,latest_friend_name)
            VALUES ($1,1,$2) ON CONFLICT(account_id) DO UPDATE SET completed_count = referral_progress.completed_count + 1,
            latest_friend_name=EXCLUDED.latest_friend_name
            RETURNING completed_count`,
            [inviter, result.state.participants[1].characterName],
          );
          const count = summary.rows[0].completed_count;
          committed.completedFriends = count;
          if (count <= 5)
            await tx.query(
              `INSERT INTO referral_reward_outbox(receipt,account_id,tier)
            VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
              [`referral:${inviter}:tier:${count}`, inviter, count],
            );
          continue;
        }
        const before = capture?.();
        if (!before || !before.leaseNonce)
          throw new ReferralLeaseLost('No live referral reward snapshot');
        if (intent.accountId !== accountId) throw new Error('Invalid referral reward owner');
        if (intent.type === 'grant') {
          if (before.characterId !== intent.characterId)
            throw new ReferralLeaseLost('Referral character changed');
          const after = this.ports.grant(before.state, linkId, intent.milestone);
          await tx.query('SELECT id FROM characters WHERE id=$1 AND account_id=$2 FOR UPDATE', [
            before.characterId,
            accountId,
          ]);
          await this.lockLease(tx, before);
          if (!(await this.ports.save(tx, { ...before, state: after }, proof!)))
            throw new ReferralLeaseLost('Referral lease lost');
          committed.saves.push({ before, after });
        } else {
          if (before.characterId !== intent.toCharacterId)
            throw new ReferralLeaseLost('Referral destination changed');
          // Lock old/new character rows before inspecting a lease. The FK lock on
          // lease acquisition blocks a concurrent insertion until this commit.
          const characters = await tx.query<{ id: number; state: CharacterState; realm: string }>(
            `SELECT id,state,realm FROM characters WHERE id = ANY($1::int[]) AND account_id=$2
             ORDER BY id FOR UPDATE`,
            [[intent.fromCharacterId, intent.toCharacterId].sort((a, b) => a - b), accountId],
          );
          const old = characters.rows.find((c) => c.id === intent.fromCharacterId);
          if (characters.rows.length !== 2 || !old)
            throw new ReferralLeaseLost('Referral character unavailable');
          const leased = await tx.query(
            `SELECT character_id FROM character_leases WHERE character_id=$1
            AND expires_at >= now() FOR UPDATE`,
            [intent.fromCharacterId],
          );
          if (leased.rowCount)
            throw new ReferralLeaseLost('Previous referral character still loaded');
          await tx.query(
            'DELETE FROM character_leases WHERE character_id=$1 AND expires_at < now()',
            [intent.fromCharacterId],
          );
          const moved = this.ports.move(old.state, before.state, linkId);
          if (!(await this.ports.saveOffline(tx, intent.fromCharacterId, moved.from, old.realm)))
            throw new ReferralLeaseLost('Previous referral character lease changed');
          await this.lockLease(tx, before);
          if (!(await this.ports.save(tx, { ...before, state: moved.to }, proof!)))
            throw new ReferralLeaseLost('Referral destination lease lost');
          committed.saves.push({ before, after: moved.to });
        }
      }
      const ready = new Map<number, number>();
      const add = (card: ReferralCardState, sign: number) => {
        for (const p of card.participants) {
          if (!p.characterId) continue;
          let bits = p.credited & ~p.redeemed;
          let count = 0;
          while (bits) {
            count += bits & 1;
            bits >>>= 1;
          }
          ready.set(p.characterId, (ready.get(p.characterId) ?? 0) + sign * count);
        }
      };
      add(current, -1);
      add(result.state, 1);
      for (const [characterId, delta] of [...ready].sort(([a], [b]) => a - b)) {
        if (delta === 0) continue;
        const updated = await tx.query<{ ready_count: number }>(
          `INSERT INTO referral_character_progress(character_id,ready_count) SELECT id,GREATEST(0,$2) FROM characters WHERE id=$1
          ON CONFLICT(character_id) DO UPDATE SET ready_count=GREATEST(0,referral_character_progress.ready_count+$2)
          RETURNING ready_count`,
          [characterId, delta],
        );
        committed.readyCounts ??= {};
        if (updated.rows[0]) committed.readyCounts[characterId] = updated.rows[0].ready_count;
      }
      for (const participant of result.state.participants) {
        if (participant.characterId && !participant.locked) {
          await tx.query(
            `INSERT INTO referral_transfer_characters(link_id,account_id,character_id)
            VALUES($1,$2,$3) ON CONFLICT(link_id,account_id) DO UPDATE SET character_id=EXCLUDED.character_id`,
            [linkId, participant.accountId, participant.characterId],
          );
        } else
          await tx.query(
            'DELETE FROM referral_transfer_characters WHERE link_id=$1 AND account_id=$2',
            [linkId, participant.accountId],
          );
      }
      await tx.query(
        `UPDATE referral_cards SET state=$2::jsonb,revision=$3,updated_at=now()
        WHERE link_id=$1 AND revision=$4`,
        [linkId, JSON.stringify(result.state), result.state.revision, current.revision],
      );
      return committed;
    });
  }

  async summon(linkId: number, accountId: number): Promise<boolean> {
    return this.transaction(async (tx) => {
      const referral = await tx.query<{ referrer_account_id: number }>(
        `SELECT referrer_account_id FROM referrals
        WHERE referee_account_id=$1 AND (referrer_account_id=$2 OR referee_account_id=$2)
        AND NOT EXISTS(SELECT 1 FROM account_blocks WHERE
          (account_id=referrer_account_id AND blocked_account_id=referee_account_id) OR
          (account_id=referee_account_id AND blocked_account_id=referrer_account_id))`,
        [linkId, accountId],
      );
      if (!referral.rows[0]) return false;
      const inviter = referral.rows[0].referrer_account_id;
      await tx.query(
        `INSERT INTO referral_cards(link_id,inviter_account_id,state) VALUES($1,$2,$3::jsonb)
        ON CONFLICT DO NOTHING`,
        [linkId, inviter, JSON.stringify(createReferralCard(linkId, inviter, linkId))],
      );
      const result = await tx.query(
        `UPDATE referral_cards c SET
          inviter_summon_at = CASE WHEN inviter_account_id=$2 THEN now() ELSE inviter_summon_at END,
          invitee_summon_at = CASE WHEN link_id=$2 THEN now() ELSE invitee_summon_at END
        WHERE link_id=$1 AND (inviter_account_id=$2 OR link_id=$2)
          AND COALESCE(CASE WHEN inviter_account_id=$2 THEN inviter_summon_at ELSE invitee_summon_at END,
            '-infinity'::timestamptz) <= now() - interval '30 minutes'
        RETURNING link_id`,
        [linkId, accountId],
      );
      return !!result.rowCount;
    });
  }
  private async lockLease(tx: DbTransactionDeadline, save: CharacterSaveArgs): Promise<void> {
    const row = await tx.query(
      `SELECT character_id FROM character_leases
      WHERE character_id=$1 AND nonce=$2 AND holder=$3 AND expires_at>now() FOR UPDATE`,
      [save.characterId, save.leaseNonce, this.ports.leaseHolder],
    );
    if (!row.rowCount) throw new ReferralLeaseLost('Referral destination lease changed');
  }

  async claimRewards(): Promise<ReferralRewardRow[]> {
    return this.transaction(async (tx) => {
      const rows = await tx.query<{
        receipt: string;
        account_id: number;
        tier: number;
      }>(`WITH picked AS (
        SELECT receipt FROM referral_reward_outbox WHERE delivered_at IS NULL AND available_at <= now()
        ORDER BY available_at,receipt LIMIT 25 FOR UPDATE SKIP LOCKED)
        UPDATE referral_reward_outbox o SET available_at=now()+interval '60 seconds',attempts=attempts+1
        FROM picked p WHERE o.receipt=p.receipt RETURNING o.receipt,o.account_id,o.tier`);
      return rows.rows.map((r) => ({ receipt: r.receipt, accountId: r.account_id, tier: r.tier }));
    });
  }
  async settleReward(row: ReferralRewardRow): Promise<number> {
    return this.transaction(async (tx) => {
      await lockCharacterSaveAccountParentOnClient(tx, row.accountId);
      const receipt = await tx.query<{ delivered_at: Date | null }>(
        `SELECT delivered_at FROM referral_reward_outbox
        WHERE receipt=$1 AND account_id=$2 AND tier=$3 FOR UPDATE`,
        [row.receipt, row.accountId, row.tier],
      );
      if (!receipt.rows[0]) throw new Error('Referral reward receipt unavailable');
      if (!receipt.rows[0].delivered_at) {
        if (row.tier === 5)
          await tx.query(
            `INSERT INTO account_buddies AS current(account_id,owned)
          VALUES($1,ARRAY['sapling']::text[]) ON CONFLICT(account_id) DO UPDATE SET owned=ARRAY(
          SELECT DISTINCT key FROM unnest(current.owned || EXCLUDED.owned) AS key ORDER BY key)`,
            [row.accountId],
          );
        await tx.query(
          'UPDATE referral_progress SET rewarded_mask=rewarded_mask | $2 WHERE account_id=$1',
          [row.accountId, 1 << (row.tier - 1)],
        );
        await tx.query('UPDATE referral_reward_outbox SET delivered_at=now() WHERE receipt=$1', [
          row.receipt,
        ]);
      }
      const progress = await tx.query<{ rewarded_mask: number }>(
        'SELECT rewarded_mask FROM referral_progress WHERE account_id=$1',
        [row.accountId],
      );
      return progress.rows[0]?.rewarded_mask ?? 0;
    });
  }
  async membershipCandidates(accountIds: readonly number[]): Promise<number[]> {
    if (accountIds.length > 25) throw new Error('Referral membership batch exceeds 25');
    if (!accountIds.length) return [];
    return this.transaction(async (tx) => {
      const rows = await tx.query<{ referee_account_id: number }>(
        `SELECT r.referee_account_id FROM referrals r
        WHERE r.referee_account_id=ANY($1::int[]) AND NOT EXISTS(
          SELECT 1 FROM referral_membership_bonds b WHERE b.link_id=r.referee_account_id) LIMIT 25`,
        [accountIds],
      );
      return rows.rows.map((r) => r.referee_account_id);
    });
  }
  async membershipFeedCursor(realm: string): Promise<string> {
    return this.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO referral_membership_feed_cursor(realm) VALUES($1) ON CONFLICT DO NOTHING',
        [realm],
      );
      const row = await tx.query<{ cursor: string }>(
        'SELECT cursor FROM referral_membership_feed_cursor WHERE realm=$1',
        [realm],
      );
      return row.rows[0].cursor;
    });
  }
  async bookMembershipFeed(
    realm: string,
    after: string,
    next: string,
    receipts: readonly FirstPaidFeedReceipt[],
  ): Promise<boolean> {
    if (
      receipts.length > 25 ||
      !/^\d{1,19}$/.test(after) ||
      !/^\d{1,19}$/.test(next) ||
      BigInt(next) < BigInt(after)
    )
      throw new Error('Invalid referral membership feed batch');
    return this.transaction(async (tx) => {
      const row = await tx.query<{ cursor: string }>(
        'SELECT cursor FROM referral_membership_feed_cursor WHERE realm=$1 FOR UPDATE',
        [realm],
      );
      if (row.rows[0]?.cursor !== after) return false;
      const paid = receipts
        .filter((r) => r.firstPaid && !r.firstPaid.reversed)
        .map((r) => ({ account_id: r.accountId, paid_receipt: r.firstPaid!.receiptId }));
      if (paid.length)
        await tx.query(
          `INSERT INTO referral_membership_bonds(link_id,account_id,paid_receipt)
        SELECT r.referee_account_id,r.referrer_account_id,p.paid_receipt
        FROM jsonb_to_recordset($1::jsonb) AS p(account_id INT,paid_receipt TEXT)
        JOIN referrals r ON r.referee_account_id=p.account_id
        ON CONFLICT(link_id) DO NOTHING`,
          [JSON.stringify(paid)],
        );
      await tx.query(
        'UPDATE referral_membership_feed_cursor SET cursor=$2::bigint WHERE realm=$1',
        [realm, next],
      );
      return true;
    });
  }
  async bookMembershipBond(accountId: number, paidReceipt: string): Promise<void> {
    if (!paidReceipt || paidReceipt.length > 256)
      throw new Error('Invalid first paid membership receipt');
    return this.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO referral_membership_bonds(link_id,account_id,paid_receipt)
        SELECT referee_account_id,referrer_account_id,$2 FROM referrals WHERE referee_account_id=$1
        ON CONFLICT(link_id) DO NOTHING`,
        [accountId, paidReceipt],
      );
    });
  }
  async claimBonds(
    realm: string,
    localAccountIds: readonly number[] = [],
  ): Promise<ReferralBondRow[]> {
    if (localAccountIds.length > 25) throw new Error('Referral local bond batch exceeds 25');
    return this.transaction(async (tx) => {
      const rows = await tx.query<{
        link_id: number;
        account_id: number;
        recipient_character_id: number | null;
        recipient_name: string | null;
        recipient_realm: string | null;
      }>(
        `WITH candidate AS MATERIALIZED (
          (SELECT link_id,available_at FROM referral_membership_bonds
           WHERE recipient_realm=$1 AND delivered_at IS NULL AND available_at<=now()
           ORDER BY available_at,link_id LIMIT 25)
          UNION ALL
          (SELECT local.link_id,local.available_at FROM unnest($2::int[]) AS account(id)
           CROSS JOIN LATERAL (SELECT link_id,available_at FROM referral_membership_bonds
             WHERE account_id=account.id AND recipient_realm IS NULL AND delivered_at IS NULL AND available_at<=now()
             ORDER BY available_at,link_id LIMIT 25) local
           ORDER BY available_at,link_id LIMIT 25)
        ), picked AS (
          SELECT b.link_id FROM referral_membership_bonds b JOIN candidate c USING(link_id)
          WHERE b.delivered_at IS NULL AND b.available_at<=now()
          ORDER BY b.available_at,b.link_id LIMIT 25 FOR UPDATE OF b SKIP LOCKED)
        UPDATE referral_membership_bonds b SET available_at=now()+interval '60 seconds'
        FROM picked p WHERE b.link_id=p.link_id RETURNING b.link_id,b.account_id,b.recipient_character_id,b.recipient_name,b.recipient_realm`,
        [realm, localAccountIds],
      );
      // Receipt is tied to the immutable signup link, never a character or the
      // mutable delivery recipient. A retry after timeout cannot mint another bond.
      return rows.rows.map((r) => ({
        linkId: r.link_id,
        accountId: r.account_id,
        receipt: `referral_membership_bond_${r.link_id}`,
        recipient:
          r.recipient_character_id && r.recipient_name && r.recipient_realm
            ? {
                characterId: r.recipient_character_id,
                name: r.recipient_name,
                realm: r.recipient_realm,
              }
            : null,
      }));
    });
  }
  async bindBondRecipient(
    row: ReferralBondRow,
    recipient: ReferralBondRecipient,
  ): Promise<ReferralBondRecipient | null> {
    return this.transaction(async (tx) => {
      await lockCharacterSaveAccountParentOnClient(tx, row.accountId);
      const bound = await tx.query<{
        recipient_character_id: number;
        recipient_name: string;
        recipient_realm: string;
      }>(
        `UPDATE referral_membership_bonds b SET recipient_character_id=$3,recipient_name=c.name,recipient_realm=c.realm
         FROM characters c WHERE b.link_id=$1 AND b.account_id=$2 AND b.recipient_character_id IS NULL
         AND c.id=$3 AND c.account_id=$2 AND c.realm=$4
         RETURNING b.recipient_character_id,b.recipient_name,b.recipient_realm`,
        [row.linkId, row.accountId, recipient.characterId, recipient.realm],
      );
      const result =
        bound.rows[0] ??
        (
          await tx.query<{
            recipient_character_id: number;
            recipient_name: string;
            recipient_realm: string;
          }>(
            `SELECT recipient_character_id,recipient_name,recipient_realm FROM referral_membership_bonds
          WHERE link_id=$1 AND account_id=$2 AND recipient_character_id IS NOT NULL`,
            [row.linkId, row.accountId],
          )
        ).rows[0];
      if (result)
        await tx.query(
          `INSERT INTO referral_bond_delivery_characters(link_id,account_id,character_id)
        SELECT link_id,account_id,recipient_character_id FROM referral_membership_bonds
        WHERE link_id=$1 AND account_id=$2 AND delivered_at IS NULL AND recipient_character_id IS NOT NULL
        ON CONFLICT(link_id) DO NOTHING`,
          [row.linkId, row.accountId],
        );
      return result
        ? {
            characterId: result.recipient_character_id,
            name: result.recipient_name,
            realm: result.recipient_realm,
          }
        : null;
    });
  }
  async settleBond(row: ReferralBondRow): Promise<void> {
    return this.transaction(async (tx) => {
      await lockCharacterSaveAccountParentOnClient(tx, row.accountId);
      await tx.query(
        `UPDATE referral_membership_bonds SET delivered_at=now()
        WHERE link_id=$1 AND account_id=$2 AND delivered_at IS NULL`,
        [row.linkId, row.accountId],
      );
      await tx.query(
        'DELETE FROM referral_bond_delivery_characters WHERE link_id=$1 AND account_id=$2',
        [row.linkId, row.accountId],
      );
    });
  }
}
