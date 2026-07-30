import { t } from './i18n';
import type { Built } from './moderation_actions';

// Account flair: the operator-set "AI-operated account" mark and an official
// streamer's platform links. Kept OUT of moderation_actions.ts because flair is
// cosmetic, not punitive (no reason is required, and a staff account may
// legitimately be a streamer), but it reuses that module's Built/PendingAction
// shape so the existing confirm + submit plumbing carries it unchanged.
//
// The URL rules below MIRROR the canonical validator in src/sim/account_flair.ts.
// The admin bundle may not import from src/sim (src/admin/CLAUDE.md), exactly as
// permissions.ts mirrors the server permission vocabulary; tests/admin/account_flair.test.ts
// pins the two lists against each other so they cannot drift. This is UX validation
// only: the server re-validates every link and is the authority.

/** The four supported platforms, in render order. */
export const STREAMER_PLATFORMS = ['twitch', 'x', 'kick', 'youtube'] as const;

export type StreamerPlatform = (typeof STREAMER_PLATFORMS)[number];

/** Sparse: a platform the operator left blank has no entry. */
export type StreamerLinks = Partial<Record<StreamerPlatform, string>>;

/**
 * Exact hostnames accepted per platform. An exact match, never a suffix match, so
 * `twitch.tv.evil.com` and `evil.com/twitch.tv` both fail.
 */
export const STREAMER_HOSTS: Record<StreamerPlatform, readonly string[]> = {
  twitch: ['twitch.tv', 'www.twitch.tv'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  kick: ['kick.com', 'www.kick.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
};

/** Longest link an operator may store, matching the form's maxlength. */
export const STREAMER_LINK_MAX = 200;

const HOST_SETS: Record<StreamerPlatform, ReadonlySet<string>> = {
  twitch: new Set(STREAMER_HOSTS.twitch),
  x: new Set(STREAMER_HOSTS.x),
  kick: new Set(STREAMER_HOSTS.kick),
  youtube: new Set(STREAMER_HOSTS.youtube),
};

/**
 * Returns the normalized href, or null when the value is not a plain https URL on
 * one of that platform's own hostnames. Rejects other schemes (javascript:, data:,
 * http:), embedded credentials, and over-long input.
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
  if (url.username || url.password) return null;
  if (!HOST_SETS[platform].has(url.hostname.toLowerCase())) return null;
  const href = url.href;
  return href.length > STREAMER_LINK_MAX ? null : href;
}

/**
 * Normalize the four form fields. A blank field is simply absent from the result;
 * a non-blank field that fails validation is reported so the operator can fix it
 * instead of silently losing the link.
 */
export function normalizeStreamerForm(
  raw: Record<string, string | undefined>,
): { links: StreamerLinks } | { invalid: StreamerPlatform } {
  const links: StreamerLinks = {};
  for (const platform of STREAMER_PLATFORMS) {
    const value = (raw[platform] ?? '').trim();
    if (!value) continue;
    const url = normalizeStreamerLink(platform, value);
    if (!url) return { invalid: platform };
    links[platform] = url;
  }
  return { links };
}

const accountRow = (accountId: number) => ({ label: t('dialog.account'), value: `#${accountId}` });

// A reason is optional here (flair is not a punishment), so an empty note is
// simply omitted from the body rather than rejected.
const reasonBody = (reason: string): { reason?: string } => (reason ? { reason } : {});

function linksSummary(links: StreamerLinks): string {
  const parts = STREAMER_PLATFORMS.filter((p) => links[p]).map((p) => `${p}: ${links[p]}`);
  return parts.length ? parts.join(', ') : t('common.emptyValue');
}

/** Flag (or unflag) the account as AI-operated. */
export function setAiFlag(accountId: number, ai: boolean, reason = ''): Built {
  return {
    pending: {
      title: ai ? t('dialog.confirmMarkAi') : t('dialog.confirmUnmarkAi'),
      rows: [
        accountRow(accountId),
        {
          label: t('dialog.action'),
          value: ai ? t('dialog.actionMarkAi') : t('dialog.actionUnmarkAi'),
        },
      ],
      endpoint: `/admin/api/accounts/${accountId}/ai`,
      body: { ai, ...reasonBody(reason) },
    },
  };
}

/**
 * Set the streamer flag and the account's platform links in one write. The flag and
 * the links always travel together so the server never has to reconcile a partial
 * update; an invalid link fails the whole action.
 */
export function setStreamerFlair(
  accountId: number,
  streamer: boolean,
  links: Record<string, string | undefined>,
  reason = '',
): Built {
  const normalized = normalizeStreamerForm(links);
  if ('invalid' in normalized) return { errorKey: 'alert.invalidStreamerUrl' };
  return {
    pending: {
      title: streamer ? t('dialog.confirmMarkStreamer') : t('dialog.confirmUnmarkStreamer'),
      rows: [
        accountRow(accountId),
        {
          label: t('dialog.action'),
          value: streamer ? t('dialog.actionMarkStreamer') : t('dialog.actionUnmarkStreamer'),
        },
        { label: t('detail.streamerLinks'), value: linksSummary(normalized.links) },
      ],
      endpoint: `/admin/api/accounts/${accountId}/streamer`,
      body: { streamer, links: normalized.links, ...reasonBody(reason) },
    },
  };
}
