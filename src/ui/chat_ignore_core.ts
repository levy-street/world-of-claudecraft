// Pure resolution of the per-player social flags the player context menus need,
// plus the offline ignore-list storage helpers.
//
// Two PLAYER tiers, and keeping them straight is the whole point of this module:
//   - IGNORE is chat-only. It hides the player's public chat (and their overhead
//            bubble) from you. Their whispers, rolls, invites and mail still land.
//   - BLOCK  is the heavy tool. It also drops invites, whispers and mail, and
//            makes you mutually invisible in /who.
//
// Neither is a MUTE: in this game a mute is the ADMIN account silence, a staff
// action taken against a player, and nothing a player applies to someone else.
//
// Online, both lists live on the server and arrive on the `social` frame. Offline
// there is no social graph at all, so the ignore list falls back to a local, name
// keyed set that the Hud persists; blocking is simply unavailable.
//
// DOM-free, i18n-free, storage-free by contract (registered in UI_PURE_CORES):
// the caller owns the localStorage read/write and passes the parsed set in.

import type { SocialInfo } from '../world_api';

export interface PlayerSocialFlags {
  ignored: boolean;
  blocked: boolean;
  isFriend: boolean;
  canGuildInvite: boolean;
  alreadyGuilded: boolean;
  /** false offline: friends, blocks and guilds need an account and a server. */
  online: boolean;
}

/** Names are matched case-insensitively; this is the one canonical key. */
export function ignoreKey(name: string): string {
  return name.trim().toLowerCase();
}

function hasName(list: readonly { name: string }[] | undefined, name: string): boolean {
  const key = ignoreKey(name);
  return !!list?.some((entry) => ignoreKey(entry.name) === key);
}

export function resolvePlayerSocialFlags(
  name: string,
  social: SocialInfo | null,
  localIgnores: ReadonlySet<string>,
): PlayerSocialFlags {
  // Offline: no server graph. The local set is the only ignore store, and there
  // is nothing to block, friend, or guild-invite.
  if (!social) {
    return {
      ignored: localIgnores.has(ignoreKey(name)),
      blocked: false,
      isFriend: false,
      canGuildInvite: false,
      alreadyGuilded: false,
      online: false,
    };
  }
  return {
    ignored: hasName(social.ignores, name),
    blocked: hasName(social.blocks, name),
    isFriend: hasName(social.friends, name),
    canGuildInvite: !!social.guild && social.guild.rank !== 'member',
    alreadyGuilded: hasName(social.guild?.members, name),
    online: true,
  };
}

// --- offline ignore-list storage (the Hud owns the localStorage read/write) ---

export function parseIgnoreList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is string => typeof n === 'string').map(ignoreKey));
  } catch {
    return new Set();
  }
}

export function serializeIgnoreList(names: ReadonlySet<string>): string {
  return JSON.stringify([...names]);
}
