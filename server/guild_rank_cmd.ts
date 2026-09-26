// The guild RANK command dispatch (docs/prd/guild-custom-ranks.md): the wire
// shape checks for the three commands that move members along the guild's
// rank ladder or rewrite the ladder itself, extracted from GameServer's
// message switch the way server/guild_bank_wire.ts took the guild bank cases.
//
// Shape-only checks here: SocialService owns every rule (the rank
// permissions, the strictly-lower reach, the Guild Master gate, the ladder's
// full validation through src/sim/guild_ranks.ts sanitizeGuildRankLadder, and
// the hard-word screen on titles). A frame that fails its shape check is
// dropped silently, exactly as the inline arms did.

import { GUILD_RANK_MAX } from '../src/sim/guild_ranks';
import type { SocialActor } from './social';

export type GuildRankCommandName = 'guild_promote' | 'guild_demote' | 'guild_set_ranks';

/** The SocialService methods the dispatch drives. */
export interface GuildRankCommandTarget {
  guildPromote(actor: SocialActor, name: string): Promise<void>;
  guildDemote(actor: SocialActor, name: string): Promise<void>;
  guildSetRanks(actor: SocialActor, ladder: unknown): Promise<void>;
}

/**
 * Validate one rank command's fields and start the matching service call,
 * routing its rejection to `onError` (GameServer's logSocialErr). Returns the
 * started promise (null when the frame was dropped) so a test can await it.
 * The ladder is bounded here BEFORE the service touches it: at most
 * GUILD_RANK_MAX entries, so an oversized array costs one length check.
 */
export function dispatchGuildRankCommand(
  social: GuildRankCommandTarget,
  actor: SocialActor,
  command: GuildRankCommandName,
  msg: Record<string, unknown>,
  onError: (err: unknown) => void,
): Promise<void> | null {
  let run: Promise<void> | null = null;
  if (command === 'guild_set_ranks') {
    const ranks = msg.ranks;
    if (Array.isArray(ranks) && ranks.length <= GUILD_RANK_MAX) {
      run = social.guildSetRanks(actor, ranks);
    }
  } else if (typeof msg.name === 'string') {
    run =
      command === 'guild_promote'
        ? social.guildPromote(actor, msg.name)
        : social.guildDemote(actor, msg.name);
  }
  return run ? run.catch(onError) : null;
}
