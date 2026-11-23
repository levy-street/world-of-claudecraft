import type { Entity } from '../src/sim/types';
import type { DiscordFlair } from './discord_db';

// The entity half of GameServer.refreshDiscordFlair, moved whole out of
// server/game.ts (the monolith ratchet) so it is a pure function a Vitest drives
// directly. The caller still owns the DB read and the "player left mid-fetch"
// guard; this only copies the linked-Discord flair (status tier, PFP, nickname,
// member-since, top special role) onto the live entity.

/**
 * Stamp one player's linked-Discord flair onto their entity. A null flair (no
 * linked Discord) clears every field. The fields are written only when one of
 * them differs, because the identity diff re-broadcasts the flair to nearby
 * players' nameplates and inspect cards.
 */
export function stampDiscordFlair(e: Entity, flair: DiscordFlair | null): void {
  const tier = flair?.tier ?? 0;
  const avatar = flair?.avatarUrl ?? undefined;
  const name = flair?.name ?? undefined;
  const joined = flair?.joinedAtMs ?? undefined;
  const role = flair?.role ?? undefined;
  if (
    e.discordTier !== tier ||
    e.discordAvatar !== avatar ||
    e.discordName !== name ||
    e.discordJoined !== joined ||
    e.discordRole !== role
  ) {
    // identity diff re-broadcasts the linked-Discord flair to nearby players
    e.discordTier = tier;
    e.discordAvatar = avatar;
    e.discordName = name;
    e.discordJoined = joined;
    e.discordRole = role;
  }
}
