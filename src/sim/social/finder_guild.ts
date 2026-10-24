// Guild Parties: a premade listing tagged FINDER_GUILD_TAG seats only players who
// share the leader's CURRENT guild. Guild membership is a server social system;
// the sim reads the mirrored guild name every player entity carries, so the
// check holds identically on all three hosts (offline nobody has a guild, so no
// Guild Party can be created there).
import { FINDER_GUILD_TAG, type FinderListingTag } from '../content/dungeon_finder';
import type { SimContext } from '../sim_context';

export function finderGuildOf(ctx: SimContext, pid: number): string {
  return ctx.entities.get(pid)?.guild ?? '';
}

export function isGuildParty(tags: readonly FinderListingTag[]): boolean {
  return tags.includes(FINDER_GUILD_TAG);
}

/** Whether `pid` may sit in a Guild Party led by `leaderPid`. */
export function sharesLeaderGuild(ctx: SimContext, leaderPid: number, pid: number): boolean {
  const guild = finderGuildOf(ctx, leaderPid);
  return guild !== '' && finderGuildOf(ctx, pid) === guild;
}

/** Create-time admission: the leader has a guild and every current member shares it. */
export function guildPartyCreateError(
  ctx: SimContext,
  leaderPid: number,
  members: readonly number[],
): string | null {
  if (finderGuildOf(ctx, leaderPid) === '')
    return 'You must be in a guild to create a Guild Party.';
  if (members.some((pid) => !sharesLeaderGuild(ctx, leaderPid, pid)))
    return 'Every member of a Guild Party must be in your guild.';
  return null;
}
