// A small per-guildId cache over the guild roster JOIN (PgSocialDb.guildMembers,
// guild_members joined to characters). Within a single guild action the roster
// is read more than once for the SAME guild: guildKick and guildSetRank each
// call broadcastGuild then pushGuild back to back, guildLeave reads it once to
// size the guild before the leave and again in both of those, and guildChat /
// officerChat re-derive their whole audience from it on every message. Every
// one of those calls is the identical JOIN for the identical guild a few
// milliseconds apart.
//
// Rides the shared cached-read seam (server/cached_read.ts) already used by the
// guild bank activity log (server/guild_bank_log.ts): a bounded per-key TTL
// cache with single-flight (two concurrent reads of the same guild share ONE
// query) and LRU eviction at the cap, since guild ids are player-created
// (SocialDb.createGuildWithLeader) and not a small, fixed set the way e.g. a
// mob's cosmetic scale bucket would be.
//
// Freshness rests on the BUST, not the TTL. Every PgSocialDb method that writes
// guild_members (join, leave, kick, disband, a rank change, a leader transfer)
// busts the guild it just changed before returning, so the short TTL below is
// only the ceiling on staleness if a bust were ever missed, never the freshness
// mechanism. That matters for one caller in particular:
// GameServer.guildBankSaveCarrier (server/game.ts) reads guildMembers()
// specifically because the session's membership stamp "can lag a kick", and a
// stale carrier ends up quarantined and disconnected by a refused escrow save.
// Busting synchronously right after the write commits means any read that
// starts after that point sees a cold entry and re-queries, so this cache
// serves the same "fresh as of the last completed write" answer an uncached
// query would; it only removes the cost of asking twice for an answer that has
// not changed.
//
// Guild membership is written in exactly one place (every guild_members INSERT/
// UPDATE/DELETE lives in PgSocialDb, server/social_db.ts) and one process owns
// one realm's guilds, so a same-process bust is complete, never best-effort,
// the same reasoning guild_bank_log.ts relies on for its own bust.
//
// Held PER PgSocialDb INSTANCE, not as a module singleton: production
// constructs exactly one PgSocialDb per realm process (server/game.ts), so an
// instance field behaves like a singleton there, but a test that builds its own
// PgSocialDb against a fresh fake pool also gets its own cold cache instead of
// sharing state (and possibly a colliding guild id) with whichever other test
// happened to run first in the same file.

import { KeyedCachedRead, type KeyedCachedReadStats } from './cached_read';

export const GUILD_ROSTER_CACHE_TTL_MS = 4_000;

// A guild's roster is read far more often than a guild is created, but guild
// ids are unbounded (any player can found one), so this needs the same LRU cap
// the guild bank log carries: without it a long-running realm would grow this
// map by roughly one entry per guild ever created and never shrink it.
export const GUILD_ROSTER_CACHE_MAX_ENTRIES = 1_000;

export interface GuildRosterCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Injected clock for tests; production omits it (Date.now). */
  now?: () => number;
}

/** Per-guildId TTL + single-flight cache over one roster reader. */
export class GuildRosterCache<T> {
  private readonly cache: KeyedCachedRead<T>;

  constructor(reader: (guildId: number) => Promise<T>, opts: GuildRosterCacheOptions = {}) {
    this.cache = new KeyedCachedRead<T>(reader, {
      ttlMs: opts.ttlMs ?? GUILD_ROSTER_CACHE_TTL_MS,
      maxEntries: opts.maxEntries ?? GUILD_ROSTER_CACHE_MAX_ENTRIES,
      now: opts.now,
    });
  }

  read(guildId: number): Promise<T> {
    return this.cache.read(guildId);
  }

  /** Drop one guild's cached roster; its next read re-queries. Called by every
   *  PgSocialDb method that writes guild_members for that guild. */
  bust(guildId: number): void {
    this.cache.bust(guildId);
  }

  stats(): KeyedCachedReadStats {
    return this.cache.stats();
  }
}
