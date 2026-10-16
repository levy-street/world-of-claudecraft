import type { Client } from 'pg';

export const ACCOUNT_SOCIAL_MIGRATION_BATCH = 500;
const MIGRATION_LOCK = 1742389021;

// Keep write targets literal so the auth-guard writer census can classify every table.
const FRIEND_MIGRATION_PAGE_SQL = `WITH progress AS (
  SELECT character_id, target_id, complete FROM account_social_migration_progress WHERE name = $1
), page AS MATERIALIZED (
  SELECT f.character_id, f.friend_id AS target_id, f.created_at
  FROM friendships f
  WHERE NOT (SELECT complete FROM progress)
    AND (f.character_id, f.friend_id) >
      (SELECT character_id, target_id FROM progress)
  ORDER BY f.character_id, f.friend_id LIMIT $2
), copied AS (
  INSERT INTO account_friendships (account_id, friend_account_id, display_character_id, created_at)
  SELECT owner.account_id, other.account_id, min(other.id), min(p.created_at)
  FROM page p JOIN characters owner ON owner.id = p.character_id
  JOIN characters other ON other.id = p.target_id
  WHERE owner.account_id <> other.account_id
  GROUP BY owner.account_id, other.account_id
  ON CONFLICT (account_id, friend_account_id) DO UPDATE SET
    display_character_id = LEAST(account_friendships.display_character_id, EXCLUDED.display_character_id),
    created_at = LEAST(account_friendships.created_at, EXCLUDED.created_at)
), tail AS (SELECT character_id, target_id FROM page ORDER BY character_id DESC, target_id DESC LIMIT 1)
UPDATE account_social_migration_progress SET
  character_id = COALESCE((SELECT character_id FROM tail), character_id),
  target_id = COALESCE((SELECT target_id FROM tail), target_id),
  complete = (SELECT count(*) FROM page) < $2
WHERE name = $1 RETURNING complete`;

const BLOCK_MIGRATION_PAGE_SQL = `WITH progress AS (
  SELECT character_id, target_id, complete FROM account_social_migration_progress WHERE name = $1
), page AS MATERIALIZED (
  SELECT f.character_id, f.blocked_id AS target_id, f.created_at
  FROM blocks f
  WHERE NOT (SELECT complete FROM progress)
    AND (f.character_id, f.blocked_id) >
      (SELECT character_id, target_id FROM progress)
  ORDER BY f.character_id, f.blocked_id LIMIT $2
), copied AS (
  INSERT INTO account_blocks (account_id, blocked_account_id, display_character_id, created_at)
  SELECT owner.account_id, other.account_id, min(other.id), min(p.created_at)
  FROM page p JOIN characters owner ON owner.id = p.character_id
  JOIN characters other ON other.id = p.target_id
  WHERE owner.account_id <> other.account_id
  GROUP BY owner.account_id, other.account_id
  ON CONFLICT (account_id, blocked_account_id) DO UPDATE SET
    display_character_id = LEAST(account_blocks.display_character_id, EXCLUDED.display_character_id),
    created_at = LEAST(account_blocks.created_at, EXCLUDED.created_at)
), tail AS (SELECT character_id, target_id FROM page ORDER BY character_id DESC, target_id DESC LIMIT 1)
UPDATE account_social_migration_progress SET
  character_id = COALESCE((SELECT character_id FROM tail), character_id),
  target_id = COALESCE((SELECT target_id FROM tail), target_id),
  complete = (SELECT count(*) FROM page) < $2
WHERE name = $1 RETURNING complete`;

/** Forward-only startup migration. All legacy writers must remain stopped until
 * every realm uses account edges. Each checkpoint commits with its edge page,
 * so a crash resumes without rescanning history or resurrecting removed edges.
 * The caller owns a dedicated connected client, outside any transaction. */
export async function migrateLegacyAccountSocial(client: Pick<Client, 'query'>): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
  try {
    const done = await client.query(
      "SELECT 1 FROM account_social_migrations WHERE name = 'character-edges-v1'",
    );
    if (done.rows.length) return;
    for (const [source, pageSql] of [
      ['friendships', FRIEND_MIGRATION_PAGE_SQL],
      ['blocks', BLOCK_MIGRATION_PAGE_SQL],
    ] as const) {
      let complete = false;
      while (!complete) {
        await client.query('BEGIN');
        try {
          await client.query(
            "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '1s'; SET LOCAL idle_in_transaction_session_timeout = '5s'",
          );
          await client.query(
            'INSERT INTO account_social_migration_progress (name) VALUES ($1) ON CONFLICT DO NOTHING',
            [source],
          );
          const result = await client.query(pageSql, [source, ACCOUNT_SOCIAL_MIGRATION_BATCH]);
          complete = result.rows[0].complete;
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }
    await client.query(
      "INSERT INTO account_social_migrations (name) VALUES ('character-edges-v1') ON CONFLICT DO NOTHING",
    );
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  }
}
