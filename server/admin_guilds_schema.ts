// Dependency-free guild moderation DDL. Keeping this separate from
// admin_guilds_db.ts avoids the db.ts -> schema -> db.ts import cycle.

// Moderation audit rows are intentionally retained for the lifetime of the
// database. guild_id is a snapshot identifier rather than a foreign key so a
// later guild deletion cannot erase the moderation record.
export const ADMIN_GUILDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS guild_moderation_actions (
  id BIGSERIAL PRIMARY KEY,
  guild_id INT NOT NULL,
  realm TEXT NOT NULL,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Additive (v0.34.x): the action this row records. Every pre-existing row is a
-- rename, which is exactly the literal the realm-wide moderation union used to
-- hardcode, so the DEFAULT backfills them correctly and the union now selects
-- the column instead. 'guild_bank_purge' rows are the operator dormant-slot
-- escape hatch (server/game.ts adminPurgeGuildBankSlot); they leave old_name
-- and new_name equal because a purge never renames.
ALTER TABLE guild_moderation_actions
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'guild_rename';
CREATE INDEX IF NOT EXISTS guild_moderation_actions_guild_created
  ON guild_moderation_actions(realm, guild_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS guild_moderation_actions_admin_account
  ON guild_moderation_actions(admin_account_id);
-- The realm-wide Moderation history page unions this table in ordered by
-- (created_at DESC, id DESC) with no guild filter, so the guild-keyed index above
-- cannot serve it. Mirrors account_moderation_actions_created.
CREATE INDEX IF NOT EXISTS guild_moderation_actions_realm_created
  ON guild_moderation_actions(realm, created_at DESC, id DESC);

-- Enforce folded-name uniqueness for every writer, including an older binary
-- still serving during a rolling deploy. This trigger does not scan or rewrite
-- historical case-only collisions: it guards only new inserts and name/realm
-- changes, allowing moderators to rename existing collisions apart safely.
CREATE OR REPLACE FUNCTION guard_guild_folded_name()
RETURNS trigger
LANGUAGE plpgsql
AS $guild_name_guard$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('guild-name:' || NEW.realm || ':' || lower(NEW.name), 0)
  );
  IF EXISTS (
    SELECT 1
      FROM guilds existing
     WHERE existing.realm = NEW.realm
       AND lower(existing.name) = lower(NEW.name)
       AND (NEW.id IS NULL OR existing.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'guild name is already taken',
      CONSTRAINT = 'guilds_realm_lower_name_guard';
  END IF;
  RETURN NEW;
END;
$guild_name_guard$;

DO $guild_name_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'guilds_folded_name_guard'
       AND tgrelid = 'guilds'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER guilds_folded_name_guard
      BEFORE INSERT OR UPDATE OF name, realm ON guilds
      FOR EACH ROW EXECUTE FUNCTION guard_guild_folded_name();
  END IF;
END
$guild_name_trigger$;
`;

export const GUILDS_REALM_LOWER_NAME_PREFIX_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS guilds_realm_lower_name_prefix
  ON guilds(realm, lower(name) text_pattern_ops);
`;

export const GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('guilds_realm_lower_name_prefix')
   AND NOT i.indisvalid
`;

export const GUILDS_REALM_LOWER_NAME_PREFIX_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS guilds_realm_lower_name_prefix';

export const GUILDS_REALM_CREATED_ID_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS guilds_realm_created_id
  ON guilds(realm, created_at, id);
`;

export const GUILDS_REALM_CREATED_ID_INVALID_INDEX_CHECK_SQL = `
SELECT 1
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('guilds_realm_created_id')
   AND NOT i.indisvalid
`;

export const GUILDS_REALM_CREATED_ID_INVALID_INDEX_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS guilds_realm_created_id';
