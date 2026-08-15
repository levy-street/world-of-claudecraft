// Transaction-scoped serialization for case-insensitive guild names.
//
// Existing databases may legally contain names that differ only by case
// because the historical constraint is UNIQUE(realm, name). A new expression
// UNIQUE index would make such databases fail boot. Instead, every current
// create/rename writer takes the same advisory lock before checking for a
// lower(name) collision. Historical collisions remain operable and can be
// moderated apart without an unsafe automatic rename.

export const GUILD_NAME_ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

export const GUILD_NAME_COLLISION_SQL = `
SELECT 1
  FROM guilds
 WHERE realm = $1
   AND lower(name) = lower($2)
   AND ($3::int IS NULL OR id <> $3)
 LIMIT 1
`;

export function guildNameLockKey(realm: string, name: string): string {
  return `guild-name:${realm}:${name.toLocaleLowerCase('en-US')}`;
}
