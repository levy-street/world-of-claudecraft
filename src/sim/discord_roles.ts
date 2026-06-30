// Shared, host-agnostic catalog of the staff/special Discord roles that get a
// colored name + a tag in game. Only these four are surfaced (everyone else has
// the default name color and no tag). Pure data so the server, the renderer, and
// the bot all agree on the key set without crossing host boundaries.
//
// `name` is the exact Discord role name the bot matches; `key` is the stable
// wire/storage token; `color` tints the in-world nameplate; the player-facing tag
// LABEL is an i18n key (hudChrome.discord.roleTag.<key>), not stored here.

export interface DiscordSpecialRole {
  /** Stable key used on the wire, in storage, and for the i18n tag label. */
  key: string;
  /** Exact Discord role name the bot resolves (case-insensitive match). */
  name: string;
  /** Nameplate color for a player whose top special role is this one. */
  color: string;
  /** Higher wins when a member holds more than one special role. */
  priority: number;
}

export const DISCORD_SPECIAL_ROLES: readonly DiscordSpecialRole[] = [
  { key: 'levyst', name: 'Levy St', color: '#ff6b6b', priority: 4 },
  { key: 'devs', name: 'Devs', color: '#7c8cff', priority: 3 },
  { key: 'mods', name: 'Mods', color: '#57d98a', priority: 2 },
  { key: 'artists', name: 'Artists', color: '#ff85d8', priority: 1 },
] as const;

const BY_KEY = new Map(DISCORD_SPECIAL_ROLES.map((r) => [r.key, r]));
const BY_NAME = new Map(DISCORD_SPECIAL_ROLES.map((r) => [r.name.toLowerCase(), r]));

/** Look up a special role by its stable key. */
export function specialRoleByKey(key: string | undefined | null): DiscordSpecialRole | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** Resolve a Discord role NAME to a special role (case-insensitive), or undefined. */
export function specialRoleByName(name: string): DiscordSpecialRole | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/**
 * The highest-priority special role among a member's Discord role names, or
 * undefined when they hold none. Used by the bot to pick the one role to surface.
 */
export function topSpecialRole(roleNames: readonly string[]): DiscordSpecialRole | undefined {
  let best: DiscordSpecialRole | undefined;
  for (const n of roleNames) {
    const role = specialRoleByName(n);
    if (role && (!best || role.priority > best.priority)) best = role;
  }
  return best;
}

/** Nameplate color for a stored role key, or null when it is not a special role. */
export function specialRoleColor(key: string | undefined | null): string | null {
  return specialRoleByKey(key)?.color ?? null;
}
