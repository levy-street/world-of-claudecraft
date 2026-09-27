// The signpost guild board's roster drill-in decoder for ClientWorld
// (online.ts guildRoster), in the wire-decode sibling idiom (src/net/CLAUDE.md):
// DOM-free, ClientWorld-free, every field re-validated at this trust boundary
// (numbers coerced, rank narrowed to the public roster's three labels) so a
// version-skewed or malformed body never lands `undefined` in the view core.
// Moved verbatim out of online.ts.

import type { GuildRosterEntry, GuildRosterInfo } from '../sim/leaderboard_page';

/** Decode a GET /api/guilds/roster body. Throws on a body that is not a
 *  roster at all, so the window shows its retry state instead of misreading
 *  a broken answer as an empty board. */
export function decodeGuildRoster(data: unknown): GuildRosterInfo {
  const body = data as { guild?: unknown; members?: unknown } | null;
  if (typeof body?.guild !== 'string' || !Array.isArray(body?.members)) {
    throw new Error('guild roster read returned a malformed body');
  }
  const members = (body.members as Record<string, unknown>[]).map(
    (m): GuildRosterEntry => ({
      name: String(m.name ?? ''),
      class: String(m.class ?? ''),
      rank: m.rank === 'leader' || m.rank === 'officer' ? m.rank : 'member',
      level: Number(m.level) || 0,
      lifetimeXp: Number(m.lifetimeXp) || 0,
    }),
  );
  return { guild: body.guild, members };
}
