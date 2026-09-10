// The `guild_pledge_settings` command's field validation, pulled out of the
// game.ts dispatch switch so the rule is a pure function a Vitest drives
// directly (docs/prd/guild-pledge-board.md). Every field is re-validated at
// this trust boundary; a malformed frame yields null and the dispatcher
// ignores it, exactly as the inline arm did.
//
// `newPlayerFriendly` is OPTIONAL on the wire on purpose: a client that
// predates guild board categories sends the three original fields, and the
// service then keeps the guild's stored flag rather than silently clearing
// an opt-in the older client never saw.

import type { GuildPledgeSettings } from '../src/world_api/social_graph';

/** The settings write the social service applies; the optional flag means
 *  "leave as stored" (see the header). */
export type GuildPledgeSettingsInput = Omit<GuildPledgeSettings, 'newPlayerFriendly'> & {
  newPlayerFriendly?: boolean;
};

export function parseGuildPledgeSettingsCommand(
  msg: Record<string, unknown>,
): GuildPledgeSettingsInput | null {
  if (typeof msg.enabled !== 'boolean') return null;
  if (typeof msg.minLevel !== 'number' || !Number.isFinite(msg.minLevel)) return null;
  if (typeof msg.note !== 'string') return null;
  const flag = msg.newPlayerFriendly;
  if (flag !== undefined && typeof flag !== 'boolean') return null;
  return {
    enabled: msg.enabled,
    minLevel: msg.minLevel,
    note: msg.note,
    ...(flag === undefined ? {} : { newPlayerFriendly: flag }),
  };
}
