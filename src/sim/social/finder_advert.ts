// Group listing adverts: the leader's one-click "LFM" post to General chat or
// to Discord. The text is built from the authoritative listing projection, so
// a client never authors it, and both hosts share one cooldown book shape:
// the offline Sim keys it by player on the sim clock, the online server keys it
// by ACCOUNT on wall-clock seconds (server/community_relay.ts), so switching
// characters never resets a Discord cooldown.
//
// The text is English on purpose: it is posted as the player's own chat line
// (General) and as a Discord embed, the same sinks a typed "!lfg" line reaches.
// The General form leads with a group link token in place of the content name,
// so a reader can click straight through to the listing (finderAdvertChatLine).
import { finderActivity } from '../content/dungeon_finder';
import type { Role } from '../content/talents';
import { DUNGEONS } from '../data';

export type FinderAdvertTarget = 'general' | 'discord';

export const FINDER_ADVERT_TARGETS: readonly FinderAdvertTarget[] = ['general', 'discord'];

export const FINDER_ADVERT_COOLDOWN_SECONDS: Readonly<Record<FinderAdvertTarget, number>> = {
  general: 5 * 60,
  discord: 30 * 60,
};

export function isFinderAdvertTarget(value: unknown): value is FinderAdvertTarget {
  return (FINDER_ADVERT_TARGETS as readonly unknown[]).includes(value);
}

/** Whole MINUTES (rounded up) until each advert target is usable again (0 =
 *  ready). Minutes, not seconds, so the personal snapshot changes once a
 *  minute while a cooldown runs instead of every wire tick. */
export interface FinderAdvertCooldownView {
  general: number;
  discord: number;
  // False offline: there is no server to hand the post to the Discord bot.
  discordAvailable: boolean;
}

const ROLE_WORDS: Record<Role, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };

export interface FinderAdvertListing {
  activityId: string;
  size: number;
  capacity: number;
  needed: Readonly<Record<Role, number>> | null;
  guildOnly: boolean;
}

// "4/10 - Healer/DPS needed[ - Guild only]", the part both forms share.
// `needed` null means the activity does not enforce roles, so any role is
// welcome. A Guild Party says so, since only guildmates can apply.
function advertDetail(listing: FinderAdvertListing): string[] {
  const roles = listing.needed
    ? (Object.keys(ROLE_WORDS) as Role[]).filter((role) => (listing.needed?.[role] ?? 0) > 0)
    : [];
  const parts = [
    `${listing.size}/${listing.capacity}`,
    roles.length > 0
      ? `${roles.map((role) => ROLE_WORDS[role]).join('/')} needed`
      : 'Any role needed',
  ];
  if (listing.guildOnly) parts.push('Guild only');
  return parts;
}

/**
 * "LFM - Nythraxis Raid Arena - Heroic - 4/10 - Healer/DPS needed": the plain
 * line the Groups window previews and the Discord post carries.
 */
export function finderAdvertText(listing: FinderAdvertListing): string | null {
  const activity = finderActivity(listing.activityId);
  const dungeon = activity ? DUNGEONS[activity.dungeonId] : undefined;
  if (!activity || !dungeon) return null;
  return [
    'LFM',
    dungeon.name,
    activity.difficulty === 'heroic' ? 'Heroic' : 'Normal',
    ...advertDetail(listing),
  ].join(' - ');
}

// The id charsets the client chat parser accepts for a group link
// (src/ui/hud/quest/quest_link.ts); pinned against it by tests/quest_link.test.ts.
const GROUP_LINK_ACTIVITY_RE = /^[A-Za-z0-9_]+$/;
const GROUP_LINK_MAX_LISTING_ID = 999_999_999;

/**
 * The chat token for one group listing, `[[g:<listingId>:<activityId>]]`. The
 * client renders it as a clickable "[LFM: <dungeon> (<difficulty>)]" link that
 * opens the Groups window on that listing. The label is built client-side from
 * the activity catalogue, never from the wire, so a forged token cannot
 * misrepresent its content. Null when an id falls outside the parser's charset
 * (the tryEncode guard: never ship a token the parser would show as raw text).
 */
export function finderGroupLinkToken(listingId: number, activityId: string): string | null {
  if (!Number.isInteger(listingId) || listingId < 1 || listingId > GROUP_LINK_MAX_LISTING_ID)
    return null;
  if (!GROUP_LINK_ACTIVITY_RE.test(activityId)) return null;
  return `[[g:${listingId}:${activityId}]]`;
}

/**
 * The General chat form of the advert: the clickable group link, then the
 * shared detail ("[[g:12:hollow_crypt_normal]] 1/5 - Healer/DPS needed"). The
 * link already names the content and difficulty in each reader's language.
 */
export function finderAdvertChatLine(
  listingId: number,
  listing: FinderAdvertListing,
): string | null {
  if (!finderAdvertText(listing)) return null;
  const token = finderGroupLinkToken(listingId, listing.activityId);
  return token ? `${token} ${advertDetail(listing).join(' - ')}` : null;
}

// Bounded per-key cooldowns on any monotonic seconds clock. Expired entries are
// swept whenever the book grows past the soft cap, so it only ever holds keys
// that posted inside the longest cooldown window.
const SWEEP_AT = 256;

export class FinderAdvertCooldowns {
  private readonly until = new Map<string, number>();

  remaining(key: number, target: FinderAdvertTarget, now: number): number {
    return Math.max(0, Math.ceil((this.until.get(`${key}:${target}`) ?? 0) - now));
  }

  view(key: number, now: number, discordAvailable: boolean): FinderAdvertCooldownView {
    return {
      general: Math.ceil(this.remaining(key, 'general', now) / 60),
      discord: Math.ceil(this.remaining(key, 'discord', now) / 60),
      discordAvailable,
    };
  }

  /** Spend the cooldown; false (and nothing spent) while it is still running. */
  use(key: number, target: FinderAdvertTarget, now: number): boolean {
    if (this.remaining(key, target, now) > 0) return false;
    if (this.until.size >= SWEEP_AT) {
      for (const [entry, until] of this.until) if (until <= now) this.until.delete(entry);
    }
    this.until.set(`${key}:${target}`, now + FINDER_ADVERT_COOLDOWN_SECONDS[target]);
    return true;
  }
}
