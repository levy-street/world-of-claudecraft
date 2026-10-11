// Account-global friendship and privacy edges. Character IDs remain the public
// addressing surface; account IDs are server-only and never enter a social frame.
import type { Pool } from 'pg';
import { createBackgroundDbGate } from './background_db_gate';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  type DbTransactionDeadline,
} from './db_transaction_deadline';
import { REALM } from './realm';
import { createReferralFriendPageReadiness } from './referral_indexes';
import type { CharInfo, CharRef } from './social';

export const ACCOUNT_FRIEND_LIMIT = 50;
export const ACCOUNT_FRIEND_PAGE_SIZE = 50;
export const ACCOUNT_BLOCK_LIMIT = 50;
export const ACCOUNT_BLOCK_CACHE_MAX = 4096;
export const ACCOUNT_BLOCK_RESYNC_BATCH = 25;
export const ACCOUNT_BLOCKS_NOTIFY_CHANNEL = 'account_blocks_changed';
export type AccountFriendResult =
  | 'ok'
  | 'self'
  | 'already'
  | 'blocked'
  | 'full'
  | 'missing'
  | 'busy';
export const ACCOUNT_SOCIAL_MUTATIONS_MAX = 4;
export type AccountSocialDatabaseAdmission = <T>(run: () => Promise<T>) => Promise<T>;
const mutationGate = createBackgroundDbGate(ACCOUNT_SOCIAL_MUTATIONS_MAX, 0);
const mutatingCharacters = new Set<number>();
export type AccountFriendRow = CharInfo & {
  activeTitle: string | null;
  // Optional only for existing character-only test transports. Production supplies both.
  accountId?: number;
  tier?: 'friend' | 'bound';
};

export interface AccountFriendPage {
  friends: AccountFriendRow[];
  // Account-order pagination metadata, never a friendship identity field.
  nextCursor: number | null;
}

export interface AccountBlockPage {
  blocks: CharRef[];
  nextCursor: number | null;
}

// Relationships are kept until explicitly removed or an account is deleted.
// The migration marker is kept forever: reboot must not resurrect removed edges.
// Run after legacy friendships/blocks DDL, under ensureSchema's advisory lock.
export const ACCOUNT_FRIENDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_friendships (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  friend_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, friend_account_id),
  CHECK (account_id <> friend_account_id)
);
CREATE INDEX IF NOT EXISTS account_friendships_reverse ON account_friendships(friend_account_id, account_id);
CREATE INDEX IF NOT EXISTS account_friendships_display ON account_friendships(display_character_id);
CREATE TABLE IF NOT EXISTS account_blocks (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, blocked_account_id),
  CHECK (account_id <> blocked_account_id)
);
CREATE INDEX IF NOT EXISTS account_blocks_reverse ON account_blocks(blocked_account_id, account_id);
CREATE INDEX IF NOT EXISTS account_blocks_display ON account_blocks(display_character_id);
CREATE TABLE IF NOT EXISTS account_social_migrations (name TEXT PRIMARY KEY);
-- Keep the finite restart checkpoints until the final marker is committed.
CREATE TABLE IF NOT EXISTS account_social_migration_progress (
  name TEXT PRIMARY KEY,
  character_id INT NOT NULL DEFAULT 0,
  target_id INT NOT NULL DEFAULT 0,
  complete BOOLEAN NOT NULL DEFAULT false
);
`;

// Each arm uses a leading-key index. Bound status comes ONLY from referral
// signup evidence, never a mutable friend tier or an ordinary friendship add.
const BOUND_PAIR_SQL = `SELECT 1 FROM referrals WHERE referee_account_id = $1 AND referrer_account_id = $2
  UNION ALL SELECT 1 FROM referrals WHERE referee_account_id = $2 AND referrer_account_id = $1`;

export class PgAccountFriendsDb {
  private readonly friendsReady: () => Promise<void>;
  constructor(
    private readonly pool: Pool,
    private readonly database: AccountSocialDatabaseAdmission = (run) => run(),
  ) {
    this.friendsReady = createReferralFriendPageReadiness((sql) => this.query(sql));
  }

  private query(sql: string, values?: unknown[]) {
    return this.database(() => this.pool.query(sql, values));
  }

  private async pair(
    db: DbTransactionDeadline,
    charId: number,
    otherId: number,
  ): Promise<[number, number] | null> {
    const res = await db.query(
      `SELECT owner.account_id AS owner_id, target.account_id AS target_id
       FROM characters owner JOIN characters target ON target.id = $2
       WHERE owner.id = $1 AND owner.realm = $3 AND target.realm = $3`,
      [charId, otherId, REALM],
    );
    const row = res.rows[0];
    return row ? [row.owner_id, row.target_id] : null;
  }

  async addFriend(charId: number, otherId: number): Promise<AccountFriendResult> {
    return this.mutate(charId, otherId, () => this.addEdge('friend', charId, otherId));
  }

  async addBlock(charId: number, otherId: number): Promise<AccountFriendResult> {
    return this.mutate(charId, otherId, () => this.addEdge('block', charId, otherId));
  }

  // Immediate process-wide admission, before pool checkout. Repeated commands
  // involving the same character do not queue more transactions; cross-alt
  // account conflicts are serialized by the ordered account locks below.
  private async mutate<T>(
    charId: number,
    otherId: number,
    run: () => Promise<T>,
  ): Promise<T | 'busy'> {
    if (mutatingCharacters.has(charId) || mutatingCharacters.has(otherId)) return 'busy';
    const permit = mutationGate.tryAcquire();
    if (!permit) return 'busy';
    mutatingCharacters.add(charId);
    mutatingCharacters.add(otherId);
    try {
      return await this.database(run);
    } finally {
      mutatingCharacters.delete(charId);
      mutatingCharacters.delete(otherId);
      permit.release();
    }
  }

  private async addEdge(
    kind: 'friend' | 'block',
    charId: number,
    otherId: number,
  ): Promise<AccountFriendResult> {
    const client = createDbTransactionDeadline(await this.pool.connect(), {
      operation: 'account social mutation',
      timeoutMs: 5000,
      cancelBackend: backendCancelViaPool(this.pool),
    });
    try {
      await client.query('BEGIN');
      await client.query(
        "SET LOCAL statement_timeout = '2s'; SET LOCAL lock_timeout = '1s'; SET LOCAL idle_in_transaction_session_timeout = '2s'",
      );
      const pair = await this.pair(client, charId, otherId);
      if (!pair || pair[0] === pair[1]) {
        await client.rollback();
        return pair ? 'self' : 'missing';
      }
      // Lock both accounts in stable order. Owner lock serializes the cap;
      // target lock serializes a racing reverse block with a friendship add.
      await client.query(
        'SELECT id FROM accounts WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
        [[...pair].sort((a, b) => a - b)],
      );
      const table = kind === 'friend' ? 'account_friendships' : 'account_blocks';
      const column = kind === 'friend' ? 'friend_account_id' : 'blocked_account_id';
      const existing = await client.query(
        `SELECT 1 FROM ${table} WHERE account_id = $1 AND ${column} = $2`,
        pair,
      );
      const bound = kind === 'friend' ? await client.query(BOUND_PAIR_SQL, pair) : null;
      if (existing.rows.length || bound?.rows.length) {
        await client.rollback();
        return 'already';
      }
      if (kind === 'friend') {
        const blocks = await client.query(
          `SELECT 1 FROM account_blocks WHERE account_id = $1 AND blocked_account_id = $2
           UNION ALL SELECT 1 FROM account_blocks WHERE account_id = $2 AND blocked_account_id = $1`,
          pair,
        );
        if (blocks.rows.length) {
          await client.rollback();
          return 'blocked';
        }
      }
      const ordinaryOnly =
        kind === 'friend'
          ? `AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referee_account_id = ${table}.friend_account_id AND r.referrer_account_id = $1)
           AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_account_id = ${table}.friend_account_id AND r.referee_account_id = $1)`
          : '';
      const count = await client.query(
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${table} WHERE account_id = $1 ${ordinaryOnly} LIMIT $2) capped`,
        [pair[0], kind === 'friend' ? ACCOUNT_FRIEND_LIMIT : ACCOUNT_BLOCK_LIMIT],
      );
      if (count.rows[0].n >= (kind === 'friend' ? ACCOUNT_FRIEND_LIMIT : ACCOUNT_BLOCK_LIMIT)) {
        await client.rollback();
        return 'full';
      }
      await client.query(
        kind === 'friend'
          ? 'INSERT INTO account_friendships (account_id, friend_account_id, display_character_id) VALUES ($1, $2, $3)'
          : 'INSERT INTO account_blocks (account_id, blocked_account_id, display_character_id) VALUES ($1, $2, $3)',
        [...pair, otherId],
      );
      if (kind === 'block') {
        await client.query(
          'DELETE FROM account_friendships WHERE account_id = $1 AND friend_account_id = $2',
          pair,
        );
        await client.query('SELECT pg_notify($1, $2)', [
          ACCOUNT_BLOCKS_NOTIFY_CHANNEL,
          JSON.stringify({ accountId: pair[0] }),
        ]);
      }
      await client.commit();
      return 'ok';
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  }

  async removeFriend(
    charId: number,
    otherId: number,
  ): Promise<'removed' | 'missing' | 'bound' | 'busy'> {
    return this.mutate(charId, otherId, () => this.removeFriendMutation(charId, otherId));
  }

  private async removeFriendMutation(
    charId: number,
    otherId: number,
  ): Promise<'removed' | 'missing' | 'bound'> {
    const client = createDbTransactionDeadline(await this.pool.connect(), {
      operation: 'account social mutation',
      timeoutMs: 5000,
      cancelBackend: backendCancelViaPool(this.pool),
    });
    try {
      await client.query('BEGIN');
      await client.query(
        "SET LOCAL statement_timeout = '2s'; SET LOCAL lock_timeout = '1s'; SET LOCAL idle_in_transaction_session_timeout = '2s'",
      );
      const pair = await this.pair(client, charId, otherId);
      if (!pair) {
        await client.rollback();
        return 'missing';
      }
      if ((await client.query(BOUND_PAIR_SQL, pair)).rows.length) {
        await client.rollback();
        return 'bound';
      }
      const res = await client.query(
        'DELETE FROM account_friendships WHERE account_id = $1 AND friend_account_id = $2 RETURNING account_id',
        pair,
      );
      await client.commit();
      return res.rows.length ? 'removed' : 'missing';
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  }

  async removeBlock(charId: number, otherId: number): Promise<'ok' | 'busy'> {
    return this.mutate(charId, otherId, async () => {
      const client = createDbTransactionDeadline(await this.pool.connect(), {
        operation: 'account block removal',
        timeoutMs: 5000,
        cancelBackend: backendCancelViaPool(this.pool),
      });
      try {
        await client.query('BEGIN');
        await client.query(
          "SET LOCAL statement_timeout = '2s'; SET LOCAL lock_timeout = '1s'; SET LOCAL idle_in_transaction_session_timeout = '2s'",
        );
        const removed = await client.query(
          `DELETE FROM account_blocks b USING characters owner, characters target
          WHERE owner.id = $1 AND target.id = $2 AND owner.realm = $3 AND target.realm = $3
            AND b.account_id = owner.account_id AND b.blocked_account_id = target.account_id
          RETURNING b.account_id`,
          [charId, otherId, REALM],
        );
        if (removed.rows[0])
          await client.query('SELECT pg_notify($1, $2)', [
            ACCOUNT_BLOCKS_NOTIFY_CHANNEL,
            JSON.stringify({ accountId: removed.rows[0].account_id }),
          ]);
        await client.commit();
        return 'ok' as const;
      } catch (error) {
        await client.rollback();
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async listFriends(charId: number): Promise<AccountFriendRow[]> {
    return (await this.listFriendPage(charId)).friends;
  }

  async listFriendPage(charId: number, afterCursor = 0): Promise<AccountFriendPage> {
    await this.friendsReady();
    // Each ordered index arm yields one page plus a sentinel. The outer merge
    // and character state projection never process the full referral history.
    const res = await this.query(
      `
      WITH owner AS (SELECT account_id FROM characters WHERE id = $1 AND realm = $2),
      cursor AS (SELECT $3::int AS account_id),
      edges AS (
        (SELECT f.friend_account_id AS account_id, f.display_character_id, false AS bound
          FROM account_friendships f JOIN owner o ON o.account_id = f.account_id
          WHERE f.friend_account_id > (SELECT account_id FROM cursor)
          ORDER BY f.friend_account_id LIMIT $4)
        UNION ALL
        (SELECT r.referee_account_id, NULL::int, true FROM referrals r JOIN owner o ON r.referrer_account_id = o.account_id
          WHERE r.referee_account_id > (SELECT account_id FROM cursor)
          ORDER BY r.referee_account_id LIMIT $4)
        UNION ALL
        (SELECT r.referrer_account_id, NULL::int, true FROM referrals r JOIN owner o ON r.referee_account_id = o.account_id
          WHERE r.referrer_account_id > (SELECT account_id FROM cursor)
          ORDER BY r.referrer_account_id LIMIT $4)
      ), grouped AS (
        SELECT account_id, min(display_character_id) AS display_character_id, bool_or(bound) AS bound
        FROM edges GROUP BY account_id ORDER BY account_id LIMIT $4
      )
      SELECT c.id, c.name, c.class AS cls, c.level, c.realm, g.account_id AS "accountId",
        c.state->>'activeTitle' AS "activeTitle", CASE WHEN g.bound THEN 'bound' ELSE 'friend' END AS tier
      FROM grouped g LEFT JOIN LATERAL (
        SELECT c.* FROM characters c WHERE c.account_id = g.account_id AND c.realm = $2
        ORDER BY (c.id = g.display_character_id) DESC NULLS LAST, c.id LIMIT 1
      ) c ON true ORDER BY g.account_id`,
      [charId, REALM, afterCursor, ACCOUNT_FRIEND_PAGE_SIZE + 1],
    );
    const candidates = res.rows.slice(0, ACCOUNT_FRIEND_PAGE_SIZE);
    return {
      nextCursor:
        res.rows.length > ACCOUNT_FRIEND_PAGE_SIZE
          ? candidates[candidates.length - 1].accountId
          : null,
      friends: candidates
        .filter((row) => row.id !== null)
        .map((row) => ({ ...row, activeTitle: row.activeTitle || null })),
    };
  }

  // Reverse notification lookup is one indexed query, not one lookup per alt.
  async whoFriended(charId: number, onlineCharacterIds?: readonly number[]): Promise<number[]> {
    // Production supplies the realm's bounded online session set, so a popular
    // referrer never loads every historical referee merely to discard offline alts.
    if (onlineCharacterIds) {
      if (onlineCharacterIds.length === 0) return [];
      const result = await this.query(
        `SELECT candidate.id FROM characters owner
        JOIN characters candidate ON candidate.id = ANY($3::int[]) AND candidate.realm = $2
        WHERE owner.id = $1 AND owner.realm = $2 AND (
          EXISTS (SELECT 1 FROM account_friendships f WHERE f.account_id = candidate.account_id AND f.friend_account_id = owner.account_id)
          OR EXISTS (SELECT 1 FROM referrals r WHERE r.referee_account_id = candidate.account_id AND r.referrer_account_id = owner.account_id)
          OR EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_account_id = candidate.account_id AND r.referee_account_id = owner.account_id)
        )`,
        [charId, REALM, [...onlineCharacterIds]],
      );
      return result.rows.map((row) => row.id);
    }
    const res = await this.query(
      `
      WITH owner AS (SELECT account_id FROM characters WHERE id = $1 AND realm = $2), watchers AS (
        SELECT f.account_id FROM account_friendships f JOIN owner o ON f.friend_account_id = o.account_id
        UNION SELECT r.referee_account_id FROM referrals r JOIN owner o ON r.referrer_account_id = o.account_id
        UNION SELECT r.referrer_account_id FROM referrals r JOIN owner o ON r.referee_account_id = o.account_id
      ) SELECT c.id FROM watchers w JOIN characters c ON c.account_id = w.account_id WHERE c.realm = $2`,
      [charId, REALM],
    );
    return res.rows.map((row) => row.id);
  }

  async listBlocks(charId: number): Promise<CharRef[]> {
    return (await this.listBlockPage(charId)).blocks;
  }

  async listBlockPage(charId: number, afterCursor = 0): Promise<AccountBlockPage> {
    const res = await this.query(
      `WITH page AS (
        SELECT b.blocked_account_id, b.display_character_id FROM characters owner
        JOIN account_blocks b ON b.account_id = owner.account_id
        WHERE owner.id = $1 AND owner.realm = $2 AND b.blocked_account_id > $3
        ORDER BY b.blocked_account_id LIMIT $4
      ) SELECT c.id, c.name, b.blocked_account_id FROM page b
      LEFT JOIN LATERAL (SELECT target.id, target.name FROM characters target
        WHERE target.account_id = b.blocked_account_id AND target.realm = $2
        ORDER BY (target.id = b.display_character_id) DESC NULLS LAST, target.id LIMIT 1) c ON true
      ORDER BY b.blocked_account_id`,
      [charId, REALM, afterCursor, ACCOUNT_BLOCK_LIMIT + 1],
    );
    const page = res.rows.slice(0, ACCOUNT_BLOCK_LIMIT);
    return {
      blocks: page.filter((row) => row.id !== null).map((row) => ({ id: row.id, name: row.name })),
      nextCursor:
        res.rows.length > ACCOUNT_BLOCK_LIMIT ? page[page.length - 1].blocked_account_id : null,
    };
  }

  async blockedIds(charId: number, candidates?: readonly number[]): Promise<number[]> {
    if (candidates?.length === 0) return [];
    const res = await this.query(
      `SELECT target.id FROM characters owner
      JOIN account_blocks b ON b.account_id = owner.account_id
      JOIN characters target ON target.account_id = b.blocked_account_id
      WHERE owner.id = $1 AND owner.realm = $2 AND target.realm = $2
        ${candidates ? 'AND target.id = ANY($3::int[])' : ''}`,
      candidates ? [charId, REALM, [...candidates]] : [charId, REALM],
    );
    return res.rows.map((row) => row.id);
  }

  async blockedAccountIds(charId: number): Promise<number[]> {
    const res = await this.query(
      `SELECT b.blocked_account_id AS id FROM account_blocks b
      JOIN characters owner ON owner.account_id = b.account_id WHERE owner.id = $1 AND owner.realm = $2
      ORDER BY b.blocked_account_id LIMIT $3`,
      [charId, REALM, ACCOUNT_BLOCK_CACHE_MAX + 1],
    );
    return res.rows.map((row) => row.id);
  }

  async blockedAccountIdsForAccounts(
    accountIds: readonly number[],
  ): Promise<Map<number, number[]>> {
    if (accountIds.length > ACCOUNT_BLOCK_RESYNC_BATCH)
      throw new Error('Account block resync batch exceeded');
    const result = new Map<number, number[]>(accountIds.map((id) => [id, []]));
    if (accountIds.length === 0) return result;
    const res = await this.query(
      `SELECT owner.account_id, b.blocked_account_id FROM unnest($1::int[]) owner(account_id)
       CROSS JOIN LATERAL (SELECT blocked_account_id FROM account_blocks WHERE account_id = owner.account_id
         ORDER BY blocked_account_id LIMIT $2) b`,
      [[...accountIds], ACCOUNT_BLOCK_CACHE_MAX + 1],
    );
    for (const row of res.rows) result.get(row.account_id)?.push(row.blocked_account_id);
    return result;
  }
}
