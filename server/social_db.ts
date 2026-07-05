// Postgres-backed SocialDb. The schema is appended to the main ensureSchema()
// run in db.ts. All relationships are keyed by character id; the realm column
// on `characters` scopes a character to a world/shard (one realm today, but
// stored now so cross-realm friends/guilds need no migration later).

import type { Pool } from 'pg';
import { REALM } from './realm';
import type { CharInfo, CharRef, GuildEventRow, GuildRank, SocialDb } from './social';

// kept as an alias for the schema's column default; the live realm is REALM
export const DEFAULT_REALM = REALM;

export const SOCIAL_SCHEMA = `
ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm TEXT NOT NULL DEFAULT '${DEFAULT_REALM.replace(/'/g, "''")}';
CREATE INDEX IF NOT EXISTS characters_realm ON characters(realm);
-- Classic MMOs make character names unique per realm, not globally. Relax the original
-- global unique on characters.name to a (realm, name) composite. This is a
-- constraint relaxation, so existing globally-unique rows always satisfy it.
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_name_key;
-- dedupe case-insensitive character names before adding the unique index.
-- The earliest character keeps the display name; later collisions get a
-- temporary suffix and force_rename so the player can choose a new name.
DO $$
DECLARE
  rec RECORD;
  suffix_index INTEGER;
  suffix_value INTEGER;
  suffix TEXT;
  candidate TEXT;
BEGIN
  FOR rec IN
    WITH ranked AS (
      SELECT id, realm, name,
             row_number() OVER (PARTITION BY realm, lower(name) ORDER BY created_at, id) AS rn
      FROM characters
    )
    SELECT id, realm, name FROM ranked WHERE rn > 1 ORDER BY realm, lower(name), rn
  LOOP
    suffix_index := 1;
    LOOP
      suffix_value := suffix_index;
      suffix := '';
      WHILE suffix_value > 0 LOOP
        suffix_value := suffix_value - 1;
        suffix := chr(97 + (suffix_value % 26)) || suffix;
        suffix_value := suffix_value / 26;
      END LOOP;
      candidate := left(rec.name, greatest(1, 16 - char_length(suffix))) || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM characters c
        WHERE c.realm = rec.realm
          AND lower(c.name) = lower(candidate)
          AND c.id <> rec.id
      );
      suffix_index := suffix_index + 1;
    END LOOP;

    UPDATE characters
       SET name = candidate,
           force_rename = TRUE,
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS characters_realm_name ON characters(realm, name);
CREATE UNIQUE INDEX IF NOT EXISTS characters_realm_lower_name_unique
  ON characters (realm, lower(name));
CREATE INDEX IF NOT EXISTS characters_realm_lower_name_prefix
  ON characters (realm, lower(name) text_pattern_ops);

CREATE TABLE IF NOT EXISTS friendships (
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, friend_id),
  CHECK (character_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS friendships_friend ON friendships(friend_id);

CREATE TABLE IF NOT EXISTS blocks (
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  blocked_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, blocked_id),
  CHECK (character_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS guilds (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${DEFAULT_REALM.replace(/'/g, "''")}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- guild names are likewise unique per realm
ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS guilds_realm_name ON guilds(realm, name);

CREATE TABLE IF NOT EXISTS guild_members (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_members_guild ON guild_members(guild_id);

-- Guild calendar events (the in-game event calendar's guild lane). day is the
-- event's UTC calendar date as 'YYYY-MM-DD'; hour is 0-23 UTC, NULL for an
-- all-day event. created_by keeps the author for display and permissions.
CREATE TABLE IF NOT EXISTS guild_events (
  id SERIAL PRIMARY KEY,
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  hour SMALLINT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES characters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_events_guild_day ON guild_events(guild_id, day);
`;

const CHAR_COLS = 'id, name, class AS cls, level, realm';

export class PgSocialDb implements SocialDb {
  constructor(private readonly pool: Pool) {}

  async findCharacterByName(name: string): Promise<CharInfo | null> {
    // scoped to this realm: you can only friend/ignore/invite characters that
    // live on the same world as you. exact case wins; otherwise an unambiguous
    // case-insensitive match
    const exact = await this.pool.query(
      `SELECT ${CHAR_COLS} FROM characters WHERE name = $1 AND realm = $2`,
      [name, REALM],
    );
    if (exact.rows[0]) return exact.rows[0];
    const ci = await this.pool.query(
      `SELECT ${CHAR_COLS} FROM characters WHERE lower(name) = lower($1) AND realm = $2 LIMIT 2`,
      [name, REALM],
    );
    return ci.rows.length === 1 ? ci.rows[0] : null;
  }

  async getCharacter(id: number): Promise<CharInfo | null> {
    const res = await this.pool.query(
      `SELECT ${CHAR_COLS} FROM characters WHERE id = $1 AND realm = $2`,
      [id, REALM],
    );
    return res.rows[0] ?? null;
  }

  async addFriend(charId: number, friendId: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO friendships (character_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [charId, friendId],
    );
  }

  async removeFriend(charId: number, friendId: number): Promise<void> {
    await this.pool.query('DELETE FROM friendships WHERE character_id = $1 AND friend_id = $2', [
      charId,
      friendId,
    ]);
  }

  async listFriends(charId: number): Promise<CharInfo[]> {
    const res = await this.pool.query(
      `SELECT c.id, c.name, c.class AS cls, c.level, c.realm
       FROM friendships f JOIN characters c ON c.id = f.friend_id
       WHERE f.character_id = $1 ORDER BY c.name`,
      [charId],
    );
    return res.rows;
  }

  async whoFriended(charId: number): Promise<number[]> {
    const res = await this.pool.query('SELECT character_id FROM friendships WHERE friend_id = $1', [
      charId,
    ]);
    return res.rows.map((r) => r.character_id);
  }

  async addBlock(charId: number, blockedId: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO blocks (character_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [charId, blockedId],
    );
  }

  async removeBlock(charId: number, blockedId: number): Promise<void> {
    await this.pool.query('DELETE FROM blocks WHERE character_id = $1 AND blocked_id = $2', [
      charId,
      blockedId,
    ]);
  }

  async listBlocks(charId: number): Promise<CharRef[]> {
    const res = await this.pool.query(
      `SELECT c.id, c.name FROM blocks b JOIN characters c ON c.id = b.blocked_id
       WHERE b.character_id = $1 ORDER BY c.name`,
      [charId],
    );
    return res.rows;
  }

  async blockedIds(charId: number): Promise<number[]> {
    const res = await this.pool.query('SELECT blocked_id FROM blocks WHERE character_id = $1', [
      charId,
    ]);
    return res.rows.map((r) => r.blocked_id);
  }

  async createGuildWithLeader(
    name: string,
    leaderId: number,
  ): Promise<{ guildId: number } | { error: 'name_taken' | 'already_in_guild' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let guildId: number;
      try {
        const res = await client.query(
          'INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id',
          [name, DEFAULT_REALM],
        );
        guildId = res.rows[0].id;
      } catch (err) {
        await client.query('ROLLBACK');
        if ((err as { code?: string }).code === '23505') return { error: 'name_taken' }; // unique (realm, name)
        throw err;
      }
      // guild_members.character_id is the PK, so this seats the leader only if
      // they are not already in a guild; 0 rows => roll the new guild back so no
      // orphaned, leaderless guild is left behind.
      const mem = await client.query(
        `INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 'leader')
         ON CONFLICT (character_id) DO NOTHING`,
        [guildId, leaderId],
      );
      if (mem.rowCount === 0) {
        await client.query('ROLLBACK');
        return { error: 'already_in_guild' };
      }
      await client.query('COMMIT');
      return { guildId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteGuild(id: number): Promise<void> {
    await this.pool.query('DELETE FROM guilds WHERE id = $1', [id]);
  }

  async guildMembership(
    charId: number,
  ): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const res = await this.pool.query(
      `SELECT gm.guild_id, g.name AS guild_name, gm.rank
       FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id
       WHERE gm.character_id = $1`,
      [charId],
    );
    const row = res.rows[0];
    return row ? { guildId: row.guild_id, guildName: row.guild_name, rank: row.rank } : null;
  }

  async addGuildMemberAtomic(
    guildId: number,
    charId: number,
    rank: GuildRank,
    limit: number,
  ): Promise<'ok' | 'full' | 'already_member' | 'no_guild'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // lock the guild row so concurrent accepts serialize — without this the
      // count-then-insert races and N pending invitees can all pass the cap.
      const g = await client.query('SELECT id FROM guilds WHERE id = $1 FOR UPDATE', [guildId]);
      if (g.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'no_guild';
      }
      const existing = await client.query('SELECT 1 FROM guild_members WHERE character_id = $1', [
        charId,
      ]);
      if ((existing.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return 'already_member';
      }
      const cnt = await client.query(
        'SELECT count(*)::int AS n FROM guild_members WHERE guild_id = $1',
        [guildId],
      );
      if (cnt.rows[0].n >= limit) {
        await client.query('ROLLBACK');
        return 'full';
      }
      // ON CONFLICT guards the gap between the membership check above and this
      // insert: if the character joined a guild concurrently, the character_id
      // PK conflicts -> 0 rows -> report already_member instead of throwing.
      const ins = await client.query(
        `INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, $3)
         ON CONFLICT (character_id) DO NOTHING`,
        [guildId, charId, rank],
      );
      if (ins.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'already_member';
      }
      await client.query('COMMIT');
      return 'ok';
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async removeGuildMember(charId: number): Promise<void> {
    await this.pool.query('DELETE FROM guild_members WHERE character_id = $1', [charId]);
  }

  async setGuildRank(charId: number, rank: GuildRank): Promise<void> {
    await this.pool.query('UPDATE guild_members SET rank = $2 WHERE character_id = $1', [
      charId,
      rank,
    ]);
  }

  async guildMembers(
    guildId: number,
  ): Promise<(CharInfo & { rank: GuildRank; lastLogin: string | null })[]> {
    const res = await this.pool.query(
      `SELECT c.id, c.name, c.class AS cls, c.level, c.realm, c.last_login AS "lastLogin", gm.rank
       FROM guild_members gm JOIN characters c ON c.id = gm.character_id
       WHERE gm.guild_id = $1 ORDER BY gm.joined_at`,
      [guildId],
    );
    // last_login is a TIMESTAMPTZ; serialize to an ISO string for the wire (never a
    // raw Date), null when the character has never entered the world.
    return res.rows.map((r) => ({
      ...r,
      lastLogin: r.lastLogin ? new Date(r.lastLogin).toISOString() : null,
    }));
  }

  async guildEvents(guildId: number, fromDay: string): Promise<GuildEventRow[]> {
    const res = await this.pool.query(
      `SELECT e.id, e.day, e.hour, e.title, e.note, COALESCE(c.name, '') AS created_by
       FROM guild_events e LEFT JOIN characters c ON c.id = e.created_by
       WHERE e.guild_id = $1 AND e.day >= $2
       ORDER BY e.day, e.hour NULLS FIRST, e.id`,
      [guildId, fromDay],
    );
    return res.rows.map((r) => ({
      id: r.id,
      day: r.day,
      hour: r.hour === null ? null : Number(r.hour),
      title: r.title,
      note: r.note,
      createdBy: r.created_by,
    }));
  }

  async guildEventCount(guildId: number, fromDay: string): Promise<number> {
    const res = await this.pool.query(
      'SELECT count(*)::int AS n FROM guild_events WHERE guild_id = $1 AND day >= $2',
      [guildId, fromDay],
    );
    return res.rows[0].n;
  }

  async createGuildEvent(
    guildId: number,
    creatorId: number,
    day: string,
    hour: number | null,
    title: string,
    note: string,
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO guild_events (guild_id, created_by, day, hour, title, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [guildId, creatorId, day, hour, title, note],
    );
    return res.rows[0].id;
  }

  async deleteGuildEvent(eventId: number, guildId: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM guild_events WHERE id = $1 AND guild_id = $2', [
      eventId,
      guildId,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async pruneGuildEvents(guildId: number, beforeDay: string): Promise<void> {
    await this.pool.query('DELETE FROM guild_events WHERE guild_id = $1 AND day < $2', [
      guildId,
      beforeDay,
    ]);
  }
}
