// Shared, host-agnostic account flair: the operator-set "AI-operated account"
// mark and an official streamer's platform links. Pure so the server, the
// renderer, and the HUD agree on the shape and on what counts as a legal link
// without crossing host boundaries (the sibling of discord_roles.ts / dev_tier.ts).
//
// The sim NEVER reads any of this: it is cosmetic, server-set, and confers no
// gameplay effect. It rides the entity identity fields and, sparsely, the chat
// event (chat reaches you from players far outside your interest scope, where no
// entity record exists).
//
// SECURITY: a streamer link is operator-entered text that ends up in a
// `window.open` on every player's client. `normalizeStreamerLink` is the one
// gate, and it is deliberately run TWICE: once when an admin writes the value,
// and again at render time, so a bad URL cannot reach the browser even if it
// somehow got onto the wire.

/** The four supported platforms. This order is also the render order. */
export const STREAMER_PLATFORMS = ['twitch', 'x', 'kick', 'youtube'] as const;

export type StreamerPlatform = (typeof STREAMER_PLATFORMS)[number];

/** Sparse: a platform the operator left blank has no entry. */
export type StreamerLinks = Partial<Record<StreamerPlatform, string>>;

/** The stored shape: what an operator sets and what the admin API reads back. */
export interface AccountFlair {
  ai: boolean;
  streamer: boolean;
  links: StreamerLinks;
}

/**
 * What a game client is allowed to see. There is no `streamer` boolean here by
 * design: the server ships links ONLY for an account whose streamer flag is on
 * (see `wireStreamerLinks`), so on the client "has links" IS "is a streamer".
 */
export interface PlayerFlair {
  ai: boolean;
  links: StreamerLinks;
}

/** Flair of a chat sender, attached by the server at fan-out. Sparse: a normal player has none. */
export interface ChatSenderFlair {
  ai?: true;
  links?: StreamerLinks;
}

// Frozen: this is aliased onto every session as the "no flair" default rather
// than copied, so a stray in-place mutation would silently flair every account
// on the realm at once. Flair is always replaced wholesale, never edited in
// place, so freezing costs nothing and closes the aliasing hazard for good.
export const EMPTY_ACCOUNT_FLAIR: AccountFlair = Object.freeze({
  ai: false,
  streamer: false,
  links: Object.freeze({}),
}) as AccountFlair;

/**
 * Exact hostnames accepted per platform. An exact match (never a suffix match),
 * so `twitch.tv.evil.com` and `evil.com/twitch.tv` both fail.
 */
export const STREAMER_HOSTS: Record<StreamerPlatform, readonly string[]> = {
  twitch: ['twitch.tv', 'www.twitch.tv'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  kick: ['kick.com', 'www.kick.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
};

/** Longest link an operator may store, matching the admin form's maxlength. */
export const STREAMER_LINK_MAX = 200;

const HOST_SETS: Record<StreamerPlatform, ReadonlySet<string>> = {
  twitch: new Set(STREAMER_HOSTS.twitch),
  x: new Set(STREAMER_HOSTS.x),
  kick: new Set(STREAMER_HOSTS.kick),
  youtube: new Set(STREAMER_HOSTS.youtube),
};

export function isStreamerPlatform(value: unknown): value is StreamerPlatform {
  return typeof value === 'string' && (STREAMER_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The security boundary. Returns the normalized href, or null when the value is
 * not a plain https URL on one of that platform's own hostnames. Rejects other
 * schemes (javascript:, data:, http:), embedded credentials, and over-long input.
 */
export function normalizeStreamerLink(platform: StreamerPlatform, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > STREAMER_LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // Credentials in a link the client opens are never legitimate here, and they
  // are the classic way to make a hostile host look like an allowed one.
  if (url.username || url.password) return null;
  if (!HOST_SETS[platform].has(url.hostname.toLowerCase())) return null;
  const href = url.href;
  return href.length > STREAMER_LINK_MAX ? null : href;
}

/** Sanitize an untrusted links bag (a DB row, a wire field, an admin request body). */
export function normalizeStreamerLinks(raw: unknown): StreamerLinks {
  const links: StreamerLinks = {};
  if (!raw || typeof raw !== 'object') return links;
  const source = raw as Record<string, unknown>;
  for (const platform of STREAMER_PLATFORMS) {
    const url = normalizeStreamerLink(platform, source[platform]);
    if (url) links[platform] = url;
  }
  return links;
}

/** Sanitize a whole stored flair record (mirrors normalizeAccountCosmetics). */
export function normalizeAccountFlair(raw: unknown): AccountFlair {
  if (!raw || typeof raw !== 'object') return { ai: false, streamer: false, links: {} };
  const source = raw as Record<string, unknown>;
  return {
    ai: source.ai === true,
    streamer: source.streamer === true,
    links: normalizeStreamerLinks(source.links),
  };
}

export function hasStreamerLink(links: StreamerLinks): boolean {
  return STREAMER_PLATFORMS.some((platform) => !!links[platform]);
}

/**
 * SERVER-SIDE gate: the links a client is allowed to receive. Undefined unless
 * the account is actually flagged as a streamer AND has at least one valid link,
 * so an account with links stored but the flag off ships nothing.
 */
export function wireStreamerLinks(flair: AccountFlair): StreamerLinks | undefined {
  if (!flair.streamer) return undefined;
  const links = normalizeStreamerLinks(flair.links);
  return hasStreamerLink(links) ? links : undefined;
}

/**
 * RENDER-SIDE gate: the ordered, present-only links to draw, each re-validated.
 * Anything that does not survive `normalizeStreamerLink` is dropped rather than
 * rendered, so a hostile URL can never reach `window.open`.
 */
export function streamerLinkList(
  links: StreamerLinks | undefined,
): { platform: StreamerPlatform; url: string }[] {
  if (!links) return [];
  const out: { platform: StreamerPlatform; url: string }[] = [];
  for (const platform of STREAMER_PLATFORMS) {
    const url = normalizeStreamerLink(platform, links[platform]);
    if (url) out.push({ platform, url });
  }
  return out;
}
