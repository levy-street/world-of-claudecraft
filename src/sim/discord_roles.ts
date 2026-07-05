// Shared, host-agnostic catalog of the staff/special Discord roles that get a
// colored name + a tag in game. Only these five are surfaced (everyone else has
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
  /** Alternate guild role names that resolve to this role (case-insensitive). */
  aliases?: readonly string[];
  /** Nameplate color for a player whose top special role is this one. */
  color: string;
  /** Higher wins when a member holds more than one special role. */
  priority: number;
}

// Matching is by role NAME, so a guild-side rename silently breaks the link
// (that is how Admin and Artist dropped out of the game); every entry now
// carries the rename history and common variants as aliases. The admin color
// stays on the staff green because the guild's Admin role is the renamed Mods
// role and a Discord rename keeps the role's color.
export const DISCORD_SPECIAL_ROLES: readonly DiscordSpecialRole[] = [
  { key: 'levyst', name: 'Levy St', aliases: ['Levy Street'], color: '#ff6b6b', priority: 5 },
  {
    key: 'admin',
    name: 'Admin',
    aliases: ['Admins', 'Administrator', 'Administrators'],
    color: '#57d98a',
    priority: 4,
  },
  {
    key: 'devs',
    name: 'Devs',
    aliases: ['Dev', 'Developer', 'Developers'],
    color: '#7c8cff',
    priority: 3,
  },
  {
    key: 'mods',
    name: 'Mods',
    aliases: ['Mod', 'Moderator', 'Moderators'],
    color: '#57d98a',
    priority: 2,
  },
  { key: 'artists', name: 'Artists', aliases: ['Artist'], color: '#ff85d8', priority: 1 },
] as const;

const BY_KEY = new Map(DISCORD_SPECIAL_ROLES.map((r) => [r.key, r]));
const BY_NAME = new Map(
  DISCORD_SPECIAL_ROLES.flatMap((r) =>
    [r.name, ...(r.aliases ?? [])].map((n) => [n.toLowerCase(), r] as const),
  ),
);

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
