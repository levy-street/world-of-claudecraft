// Postgres-backed SocialDb. The schema is appended to the main ensureSchema()
// run in db.ts. All relationships are keyed by character id; the realm column
// on `characters` scopes a character to a world/shard (one realm today, but
// stored now so cross-realm friends/guilds need no migration later).

import type { Pool } from 'pg';
import type { CharInfo, CharRef, GuildDirectoryEntry, GuildRank, JoinRequestEntry, RecruitmentMode, SocialDb } from './social';
import { REALM } from './realm';

// kept as an alias for the schema's column default; the live realm is REALM
export const DEFAULT_REALM = REALM;

export const SOCIAL_SCHEMA = `
ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm TEXT NOT NULL DEFAULT '${DEFAULT_REALM.replace(/'/g, "''")}';
CREATE INDEX IF NOT EXISTS characters_realm ON characters(realm);
-- WoW: character names are unique per realm, not globally. Relax the original
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
-- public guild directory (#110): a guild can opt into a browsable listing and
-- pick how outsiders may join. Existing guilds default to unlisted, so the
-- directory stays empty until a leader opts in. recruitment is only meaningful
-- while is_public is true: 'request' queues a join request for officers to
-- approve; 'open' lets anyone join instantly (still capped + atomic).
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS recruitment TEXT NOT NULL DEFAULT 'request';
CREATE INDEX IF NOT EXISTS guilds_public ON guilds(realm, is_public);

CREATE TABLE IF NOT EXISTS guild_members (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_members_guild ON guild_members(guild_id);

-- pending requests to join a guild (#110). PK on character_id mirrors the
-- single-guild rule: a player has at most one outstanding request at a time.
CREATE TABLE IF NOT EXISTS guild_join_requests (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guild_join_requests_guild ON guild_join_requests(guild_id);
`;

const CHAR_COLS = 'id, name, class AS cls, level, realm';

export class PgSocialDb implements SocialDb {
  constructor(private readonly pool: Pool) {}

  async findCharacterByName(name: string): Promise<CharInfo | null> {
    // scoped to this realm: you can only friend/ignore/invite characters that
    // live on the same world as you. exact case wins; otherwise an unambiguous
    // case-insensitive match
    const exact = await this.pool.query(`SELECT ${CHAR_COLS} FROM characters WHERE name = $1 AND realm = $2`, [name, REALM]);
    if (exact.rows[0]) return exact.rows[0];
    const ci = await this.pool.query(`SELECT ${CHAR_COLS} FROM characters WHERE lower(name) = lower($1) AND realm = $2 LIMIT 2`, [name, REALM]);
    return ci.rows.length === 1 ? ci.rows[0] : null;
  }

  async getCharacter(id: number): Promise<CharInfo | null> {
    const res = await this.pool.query(`SELECT ${CHAR_COLS} FROM characters WHERE id = $1 AND realm = $2`, [id, REALM]);
    return res.rows[0] ?? null;
  }

  async addFriend(charId: number, friendId: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO friendships (character_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [charId, friendId],
    );
  }

  async removeFriend(charId: number, friendId: number): Promise<void> {
    await this.pool.query('DELETE FROM friendships WHERE character_id = $1 AND friend_id = $2', [charId, friendId]);
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
    const res = await this.pool.query('SELECT character_id FROM friendships WHERE friend_id = $1', [charId]);
    return res.rows.map((r) => r.character_id);
  }

  async addBlock(charId: number, blockedId: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO blocks (character_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [charId, blockedId],
    );
  }

  async removeBlock(charId: number, blockedId: number): Promise<void> {
    await this.pool.query('DELETE FROM blocks WHERE character_id = $1 AND blocked_id = $2', [charId, blockedId]);
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
    const res = await this.pool.query('SELECT blocked_id FROM blocks WHERE character_id = $1', [charId]);
    return res.rows.map((r) => r.blocked_id);
  }

  async createGuild(name: string): Promise<number> {
    const res = await this.pool.query(
      'INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id',
      [name, DEFAULT_REALM],
    );
    return res.rows[0].id;
  }

  async deleteGuild(id: number): Promise<void> {
    await this.pool.query('DELETE FROM guilds WHERE id = $1', [id]);
  }

  async guildMembership(charId: number): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const res = await this.pool.query(
      `SELECT gm.guild_id, g.name AS guild_name, gm.rank
       FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id
       WHERE gm.character_id = $1`,
      [charId],
    );
    const row = res.rows[0];
    return row ? { guildId: row.guild_id, guildName: row.guild_name, rank: row.rank } : null;
  }

  async addGuildMember(guildId: number, charId: number, rank: GuildRank): Promise<void> {
    await this.pool.query(
      `INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, $3)
       ON CONFLICT (character_id) DO NOTHING`,
      [guildId, charId, rank],
    );
  }

  async removeGuildMember(charId: number): Promise<void> {
    await this.pool.query('DELETE FROM guild_members WHERE character_id = $1', [charId]);
  }

  async setGuildRank(charId: number, rank: GuildRank): Promise<void> {
    await this.pool.query('UPDATE guild_members SET rank = $2 WHERE character_id = $1', [charId, rank]);
  }

  async guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]> {
    const res = await this.pool.query(
      `SELECT c.id, c.name, c.class AS cls, c.level, c.realm, gm.rank
       FROM guild_members gm JOIN characters c ON c.id = gm.character_id
       WHERE gm.guild_id = $1 ORDER BY gm.joined_at`,
      [guildId],
    );
    return res.rows;
  }

  // ---- public directory + request-to-join (#110) -------------------------

  async setGuildListing(guildId: number, isPublic: boolean, recruitment: RecruitmentMode): Promise<void> {
    await this.pool.query(
      'UPDATE guilds SET is_public = $2, recruitment = $3 WHERE id = $1',
      [guildId, isPublic, recruitment],
    );
  }

  async guildListing(guildId: number): Promise<{ isPublic: boolean; recruitment: RecruitmentMode } | null> {
    const res = await this.pool.query('SELECT is_public, recruitment FROM guilds WHERE id = $1', [guildId]);
    const row = res.rows[0];
    return row ? { isPublic: row.is_public, recruitment: row.recruitment } : null;
  }

  async guildDirectory(): Promise<GuildDirectoryEntry[]> {
    // public guilds on this realm, with live member count and the leader's name.
    const res = await this.pool.query(
      `SELECT g.id, g.name, g.recruitment,
              COUNT(gm.character_id)::int AS member_count,
              MAX(CASE WHEN gm.rank = 'leader' THEN lc.name END) AS leader_name
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id
       LEFT JOIN characters lc ON lc.id = gm.character_id
       WHERE g.realm = $1 AND g.is_public = true
       GROUP BY g.id, g.name, g.recruitment
       ORDER BY member_count DESC, g.name`,
      [REALM],
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      recruitment: r.recruitment,
      memberCount: r.member_count,
      leaderName: r.leader_name ?? null,
    }));
  }

  async addJoinRequest(guildId: number, charId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO guild_join_requests (guild_id, character_id) VALUES ($1, $2)
       ON CONFLICT (character_id) DO UPDATE SET guild_id = EXCLUDED.guild_id, created_at = now()`,
      [guildId, charId],
    );
  }

  async removeJoinRequest(charId: number): Promise<void> {
    await this.pool.query('DELETE FROM guild_join_requests WHERE character_id = $1', [charId]);
  }

  async joinRequest(charId: number): Promise<{ guildId: number } | null> {
    const res = await this.pool.query('SELECT guild_id FROM guild_join_requests WHERE character_id = $1', [charId]);
    const row = res.rows[0];
    return row ? { guildId: row.guild_id } : null;
  }

  async joinRequests(guildId: number): Promise<JoinRequestEntry[]> {
    const res = await this.pool.query(
      `SELECT c.id, c.name, c.class AS cls, c.level, c.realm
       FROM guild_join_requests r JOIN characters c ON c.id = r.character_id
       WHERE r.guild_id = $1 ORDER BY r.created_at`,
      [guildId],
    );
    return res.rows;
  }
}
