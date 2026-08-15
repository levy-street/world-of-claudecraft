import type { PoolClient } from 'pg';
import { GUILD_BANK_PURGE_ACTION } from './admin_db';
import { bustAdminGuildListReads, normalizeAdminGuildSearch } from './admin_guilds_read';
import type { AdminGuildSort, AdminGuildSortDirection } from './admin_guilds_sort';
import { pool } from './db';
import {
  GUILD_NAME_ADVISORY_LOCK_SQL,
  GUILD_NAME_COLLISION_SQL,
  guildNameLockKey,
} from './guild_name_db';
import { REALM } from './realm';
import { GUILD_MEMBER_LIMIT, validateGuildName } from './social';

const ADMIN_GUILD_HISTORY_LIMIT = 100;
export const ADMIN_GUILD_REASON_MAX = 500;

export interface AdminGuildSummary {
  id: number;
  name: string;
  realm: string;
  createdAt: string;
  memberCount: number;
  leaderName: string | null;
}

export interface AdminGuildMember {
  characterId: number;
  characterName: string;
  accountId: number;
  username: string;
  class: string;
  level: number;
  rank: string;
  joinedAt: string;
  lastLogin: string | null;
}

export interface AdminGuildDetail {
  guild: {
    id: number;
    name: string;
    realm: string;
    createdAt: string;
    memberCount: number;
  };
  members: AdminGuildMember[];
}

export interface AdminGuildHistoryRow {
  id: number;
  /** What the row records: 'guild_rename' or 'guild_bank_purge'. */
  action: string;
  oldName: string;
  newName: string;
  reason: string;
  createdAt: string;
  adminAccountId: number | null;
  adminUsername: string | null;
}

export interface AdminGuildRenameResult {
  guildId: number;
  oldName: string;
  newName: string;
  memberCharacterIds: number[];
}

export type AdminGuildRenameError =
  | 'invalid_name'
  | 'invalid_reason'
  | 'not_found'
  | 'same_name'
  | 'name_taken'
  | 'member_limit_exceeded';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function listAdminGuilds(
  search: string,
  page: number,
  limit: number,
  sort: AdminGuildSort = 'name',
  dir: AdminGuildSortDirection = sort === 'name' ? 'asc' : 'desc',
): Promise<{ rows: AdminGuildSummary[]; total: number; page: number; limit: number }> {
  const normalizedSearch = normalizeAdminGuildSearch(search);
  const prefix = `${escapeLike(normalizedSearch.toLocaleLowerCase('en-US'))}%`;
  const offset = (page - 1) * limit;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  if (sort === 'member_count') {
    const result = await pool.query(
      `WITH candidates AS MATERIALIZED (
         SELECT g.id, g.name, g.realm, g.created_at,
                count(gm.character_id)::int AS member_count
           FROM guilds g
           LEFT JOIN guild_members gm ON gm.guild_id = g.id
          WHERE g.realm = $1
            AND lower(g.name) LIKE $2 ESCAPE '\\'
          GROUP BY g.id, g.name, g.realm, g.created_at
       ),
       page AS (
         SELECT id, name, realm, created_at, member_count
           FROM candidates
          ORDER BY member_count ${direction}, lower(name), id
          LIMIT $3 OFFSET $4
       ),
       total AS (
         SELECT count(*)::int AS total FROM candidates
       )
       SELECT page.id, page.name, page.realm, page.created_at, page.member_count,
              max(c.name) FILTER (WHERE page_gm.rank = 'leader') AS leader_name,
              total.total
         FROM total
         LEFT JOIN page ON true
         LEFT JOIN guild_members page_gm ON page_gm.guild_id = page.id
         LEFT JOIN characters c ON c.id = page_gm.character_id AND c.realm = page.realm
        GROUP BY page.id, page.name, page.realm, page.created_at, page.member_count, total.total
        ORDER BY page.member_count ${direction}, lower(page.name), page.id`,
      [REALM, prefix, limit, offset],
    );
    return {
      rows: result.rows
        .filter((row) => row.id !== null)
        .map((row) => ({
          id: Number(row.id),
          name: String(row.name),
          realm: String(row.realm),
          createdAt: row.created_at,
          memberCount: Number(row.member_count),
          leaderName: row.leader_name ?? null,
        })),
      total: Number(result.rows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  const pageOrder =
    sort === 'created_at'
      ? `created_at ${direction}, id ${direction}`
      : `lower(name) ${direction}, id ${direction}`;
  const resultOrder =
    sort === 'created_at'
      ? `page.created_at ${direction}, page.id ${direction}`
      : `lower(page.name) ${direction}, page.id ${direction}`;
  const result = await pool.query(
    `WITH page AS (
         SELECT id, name, realm, created_at
           FROM guilds
          WHERE realm = $1
            AND lower(name) LIKE $2 ESCAPE '\\'
          ORDER BY ${pageOrder}
          LIMIT $3 OFFSET $4
       ),
       total AS (
         SELECT count(*)::int AS total
           FROM guilds
          WHERE realm = $1
            AND lower(name) LIKE $2 ESCAPE '\\'
       )
       SELECT page.id, page.name, page.realm, page.created_at,
              count(gm.character_id)::int AS member_count,
              max(c.name) FILTER (WHERE gm.rank = 'leader') AS leader_name,
              total.total
         FROM total
         LEFT JOIN page ON true
         LEFT JOIN guild_members gm ON gm.guild_id = page.id
         LEFT JOIN characters c ON c.id = gm.character_id AND c.realm = page.realm
        GROUP BY page.id, page.name, page.realm, page.created_at, total.total
        ORDER BY ${resultOrder}`,
    [REALM, prefix, limit, offset],
  );
  return {
    rows: result.rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        realm: String(row.realm),
        createdAt: row.created_at,
        memberCount: Number(row.member_count),
        leaderName: row.leader_name ?? null,
      })),
    total: Number(result.rows[0]?.total ?? 0),
    page,
    limit,
  };
}

export async function adminGuildDetail(guildId: number): Promise<AdminGuildDetail | null> {
  const result = await pool.query(
    `SELECT g.id AS guild_id, g.name AS guild_name, g.realm, g.created_at,
            count(gm.character_id) OVER ()::int AS member_count,
            c.id AS character_id, c.name AS character_name, c.account_id,
            a.username, c.class, c.level, gm.rank, gm.joined_at, c.last_login
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id
       LEFT JOIN characters c ON c.id = gm.character_id AND c.realm = g.realm
       LEFT JOIN accounts a ON a.id = c.account_id
      WHERE g.id = $1 AND g.realm = $2
      ORDER BY CASE gm.rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
               lower(c.name), c.id
      LIMIT $3`,
    [guildId, REALM, GUILD_MEMBER_LIMIT],
  );
  const first = result.rows[0];
  if (!first) return null;
  return {
    guild: {
      id: Number(first.guild_id),
      name: String(first.guild_name),
      realm: String(first.realm),
      createdAt: first.created_at,
      memberCount: Number(first.member_count),
    },
    members: result.rows
      .filter((row) => row.character_id !== null)
      .map((row) => ({
        characterId: Number(row.character_id),
        characterName: String(row.character_name),
        accountId: Number(row.account_id),
        username: String(row.username),
        class: String(row.class),
        level: Number(row.level),
        rank: String(row.rank),
        joinedAt: row.joined_at,
        lastLogin: row.last_login ?? null,
      })),
  };
}

export async function listAdminGuildHistory(
  guildId: number,
): Promise<AdminGuildHistoryRow[] | null> {
  const guild = await pool.query('SELECT 1 FROM guilds WHERE id = $1 AND realm = $2', [
    guildId,
    REALM,
  ]);
  if (!guild.rows[0]) return null;
  const result = await pool.query(
    `SELECT action.id, action.action, action.old_name, action.new_name, action.reason,
            action.created_at, action.admin_account_id, admin.username AS admin_username
       FROM guild_moderation_actions action
       LEFT JOIN accounts admin ON admin.id = action.admin_account_id
      WHERE action.guild_id = $1 AND action.realm = $2
      ORDER BY action.created_at DESC, action.id DESC
      LIMIT $3`,
    [guildId, REALM, ADMIN_GUILD_HISTORY_LIMIT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    action: String(row.action ?? 'guild_rename'),
    oldName: String(row.old_name),
    newName: String(row.new_name),
    reason: String(row.reason),
    createdAt: row.created_at,
    adminAccountId: row.admin_account_id === null ? null : Number(row.admin_account_id),
    adminUsername: row.admin_username ?? null,
  }));
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => {});
}

export async function renameAdminGuild(
  guildId: number,
  requestedName: string,
  requestedReason: string,
  adminAccountId: number,
): Promise<{ result: AdminGuildRenameResult } | { error: AdminGuildRenameError }> {
  const newName = validateGuildName(requestedName);
  if (!newName) return { error: 'invalid_name' };
  const reason = String(requestedReason ?? '').trim();
  if (!reason || reason.length > ADMIN_GUILD_REASON_MAX) return { error: 'invalid_reason' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT id, name FROM guilds WHERE id = $1 AND realm = $2 FOR UPDATE',
      [guildId, REALM],
    );
    const guild = locked.rows[0];
    if (!guild) {
      await rollback(client);
      return { error: 'not_found' };
    }
    // Exact comparison, not folded: re-casing a name IS a rename here. It is the
    // least disruptive remediation for the historical case-only collisions the
    // folded-name trigger deliberately leaves in place (admin_guilds_schema.ts),
    // and both the collision check and the trigger exclude the row itself, so a
    // case-only update never trips the folded-name guard.
    if (String(guild.name) === newName) {
      await rollback(client);
      return { error: 'same_name' };
    }

    await client.query(GUILD_NAME_ADVISORY_LOCK_SQL, [guildNameLockKey(REALM, newName)]);
    const collision = await client.query(GUILD_NAME_COLLISION_SQL, [REALM, newName, guildId]);
    if (collision.rows[0]) {
      await rollback(client);
      return { error: 'name_taken' };
    }

    try {
      await client.query('UPDATE guilds SET name = $1 WHERE id = $2 AND realm = $3', [
        newName,
        guildId,
        REALM,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        await rollback(client);
        return { error: 'name_taken' };
      }
      throw error;
    }

    // Read cap + 1: enough to detect an overflow, never an unbounded roster read.
    // These rows become the fan-out list SocialService.guildRenamed walks, and it
    // bounds the same cap again on its side, so neither module depends on the
    // other still bounding. Refusing above the cap rather than truncating keeps a
    // roster that somehow grew past it from being renamed with members unnotified.
    const members = await client.query(
      `SELECT character_id
         FROM guild_members
        WHERE guild_id = $1
        ORDER BY character_id
        LIMIT $2`,
      [guildId, GUILD_MEMBER_LIMIT + 1],
    );
    if (members.rows.length > GUILD_MEMBER_LIMIT) {
      await rollback(client);
      return { error: 'member_limit_exceeded' };
    }
    await client.query(
      `INSERT INTO guild_moderation_actions
         (guild_id, realm, action, old_name, new_name, reason, admin_account_id)
       VALUES ($1, $2, 'guild_rename', $3, $4, $5, $6)`,
      [guildId, REALM, guild.name, newName, reason, adminAccountId],
    );
    await client.query('COMMIT');
    bustAdminGuildListReads();
    return {
      result: {
        guildId,
        oldName: String(guild.name),
        newName,
        memberCharacterIds: members.rows.map((row) => Number(row.character_id)),
      },
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/** The audited row for an operator dormant-slot guild bank purge (server/game.ts
 *  adminPurgeGuildBankSlot). The rename precedent, minus the rename: a purge
 *  never changes the name, so old_name and new_name both carry the guild's
 *  current name and the row is distinguished by action = 'guild_bank_purge'.
 *  What was removed is appended to the operator's reason so the realm-wide
 *  moderation history (which renders reason, not the bank_ledger) is readable
 *  on its own; the machine-readable evidence stays on the bank_ledger
 *  admin_purge row (item id, count, and the real instance payload).
 *  Throws on a DB failure: the caller reports it rather than un-removing the
 *  item, which it cannot do. */
export async function recordAdminGuildBankPurge(input: {
  guildId: number;
  reason: string;
  adminAccountId: number;
  itemId: string;
  count: number;
  slotIndex: number;
}): Promise<void> {
  const guild = await pool.query('SELECT name FROM guilds WHERE id = $1 AND realm = $2', [
    input.guildId,
    REALM,
  ]);
  // A guild row can vanish between the purge and this write (a disband racing
  // the operator); the audit row is a snapshot identifier, not a foreign key,
  // so record it anyway with an empty name rather than losing the audit.
  const name = guild.rows[0] ? String(guild.rows[0].name) : '';
  const detail = `removed guild bank slot ${input.slotIndex} (${input.count}x ${input.itemId}): ${input.reason}`;
  await pool.query(
    `INSERT INTO guild_moderation_actions
       (guild_id, realm, action, old_name, new_name, reason, admin_account_id)
     VALUES ($1, $2, $6, $3, $3, $4, $5)`,
    [
      input.guildId,
      REALM,
      name,
      detail.slice(0, ADMIN_GUILD_REASON_MAX),
      input.adminAccountId,
      // The shared constant, never a second copy of the literal: the dashboard
      // label table and the history union key off the same value.
      GUILD_BANK_PURGE_ACTION,
    ],
  );
}
