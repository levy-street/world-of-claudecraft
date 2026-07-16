import { describe, expect, it } from 'vitest';
import {
  normalizeStreamerLink,
  STREAMER_HOSTS,
  STREAMER_LINK_MAX,
  STREAMER_PLATFORMS,
  type StreamerPlatform,
  setAiFlag,
  setStreamerFlair,
} from '../../src/admin/account_flair';
import {
  STREAMER_HOSTS as SIM_STREAMER_HOSTS,
  STREAMER_LINK_MAX as SIM_STREAMER_LINK_MAX,
  STREAMER_PLATFORMS as SIM_STREAMER_PLATFORMS,
  normalizeStreamerLink as simNormalizeStreamerLink,
} from '../../src/sim/account_flair';

// Pure request shaping + the client-side URL mirror for the account flair controls.
// Runs in the default Node env (no DOM). The admin BUNDLE may not import src/sim
// (src/admin/CLAUDE.md), so account_flair.ts carries its own copy of the platform list
// and host allowlist; the parity block below pins that copy against the canonical
// validator, exactly as tests/admin_permissions.test.ts pins the permission vocabulary.
// The server re-validates every link and remains the authority.

// One hostile corpus, applied to EVERY platform (the host is substituted per platform).
const hostileFor = (platform: StreamerPlatform): { why: string; url: string }[] => {
  const host = STREAMER_HOSTS[platform][0];
  return [
    { why: 'javascript: scheme', url: `javascript:alert(1)//${host}` },
    { why: 'data: scheme', url: `data:text/html,<script>alert(1)</script>` },
    { why: 'file: scheme', url: `file:///etc/passwd` },
    { why: 'plain http', url: `http://${host}/streamer` },
    { why: 'protocol-relative', url: `//${host}/streamer` },
    { why: 'embedded credentials', url: `https://user:pass@${host}/streamer` },
    { why: 'embedded username only', url: `https://evil.com@${host}` },
    { why: 'lookalike suffix host', url: `https://${host}.evil.com/streamer` },
    { why: 'allowed host in the path only', url: `https://evil.com/${host}` },
    { why: 'allowed host in a query param', url: `https://evil.com/?to=${host}` },
    { why: 'allowed host as a subdomain label', url: `https://${host}-evil.com/streamer` },
    { why: 'not a url at all', url: 'twitch.tv/streamer' },
    { why: 'over the length cap', url: `https://${host}/${'a'.repeat(STREAMER_LINK_MAX)}` },
  ];
};

describe('normalizeStreamerLink', () => {
  it('accepts every allowlisted host of every platform over https', () => {
    for (const platform of STREAMER_PLATFORMS) {
      for (const host of STREAMER_HOSTS[platform]) {
        expect(normalizeStreamerLink(platform, `https://${host}/streamer`)).toBe(
          `https://${host}/streamer`,
        );
      }
    }
  });

  it('trims surrounding whitespace and keeps the normalized href', () => {
    expect(normalizeStreamerLink('twitch', '  https://twitch.tv/streamer  ')).toBe(
      'https://twitch.tv/streamer',
    );
    // A bare origin normalizes to a trailing slash (URL.href), which is what we store.
    expect(normalizeStreamerLink('kick', 'https://kick.com')).toBe('https://kick.com/');
  });

  it('rejects every hostile form on every platform', () => {
    for (const platform of STREAMER_PLATFORMS) {
      for (const { why, url } of hostileFor(platform)) {
        expect(normalizeStreamerLink(platform, url), `${platform}: ${why} (${url})`).toBeNull();
      }
    }
  });

  it('rejects empty, blank, and non-string values on every platform', () => {
    for (const platform of STREAMER_PLATFORMS) {
      expect(normalizeStreamerLink(platform, '')).toBeNull();
      expect(normalizeStreamerLink(platform, '   ')).toBeNull();
      expect(normalizeStreamerLink(platform, undefined)).toBeNull();
      expect(normalizeStreamerLink(platform, 42)).toBeNull();
    }
  });

  it('never accepts another platform host (the allowlist is per platform)', () => {
    for (const platform of STREAMER_PLATFORMS) {
      for (const other of STREAMER_PLATFORMS) {
        if (other === platform) continue;
        for (const host of STREAMER_HOSTS[other]) {
          expect(
            normalizeStreamerLink(platform, `https://${host}/streamer`),
            `${platform} must reject ${host}`,
          ).toBeNull();
        }
      }
    }
  });

  it('accepts a link exactly at the length cap and rejects one over it', () => {
    const prefix = 'https://twitch.tv/';
    const atCap = prefix + 'a'.repeat(STREAMER_LINK_MAX - prefix.length);
    expect(atCap.length).toBe(STREAMER_LINK_MAX);
    expect(normalizeStreamerLink('twitch', atCap)).toBe(atCap);
    expect(normalizeStreamerLink('twitch', `${atCap}a`)).toBeNull();
  });
});

describe('setAiFlag', () => {
  it('posts the ai flag to the account ai endpoint', () => {
    const built = setAiFlag(42, true);
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/accounts/42/ai');
    expect(built.pending.body).toEqual({ ai: true });
    expect(built.pending.danger).toBeUndefined();
  });

  it('posts ai: false to unmark, and carries an optional reason when given', () => {
    const built = setAiFlag(7, false, 'no longer a bot');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/accounts/7/ai');
    expect(built.pending.body).toEqual({ ai: false, reason: 'no longer a bot' });
  });
});

describe('setStreamerFlair', () => {
  it('posts the flag plus the normalized links, omitting blank fields', () => {
    const built = setStreamerFlair(42, true, {
      twitch: ' https://twitch.tv/streamer ',
      x: '',
      kick: undefined,
      youtube: 'https://youtu.be/abc',
    });
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/accounts/42/streamer');
    expect(built.pending.body).toEqual({
      streamer: true,
      links: { twitch: 'https://twitch.tv/streamer', youtube: 'https://youtu.be/abc' },
    });
  });

  it('carries an optional reason and supports unmarking', () => {
    const built = setStreamerFlair(9, false, {}, 'partnership ended');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.body).toEqual({ streamer: false, links: {}, reason: 'partnership ended' });
  });

  it('refuses the whole action when any supplied link is invalid', () => {
    for (const platform of STREAMER_PLATFORMS) {
      for (const { why, url } of hostileFor(platform)) {
        expect(setStreamerFlair(42, true, { [platform]: url }), `${platform}: ${why}`).toEqual({
          errorKey: 'alert.invalidStreamerUrl',
        });
      }
    }
    // A bad link fails even alongside a good one, so nothing is silently dropped.
    expect(
      setStreamerFlair(42, true, {
        twitch: 'https://twitch.tv/streamer',
        kick: 'javascript:alert(1)',
      }),
    ).toEqual({ errorKey: 'alert.invalidStreamerUrl' });
  });
});

// --- Parity with the canonical validator ----------------------------------------
// The admin bundle cannot import src/sim, so this test (which may) is the only guard
// that stops the two copies drifting.
describe('admin mirror matches src/sim/account_flair', () => {
  it('pins the platform list, in order', () => {
    expect([...STREAMER_PLATFORMS]).toEqual([...SIM_STREAMER_PLATFORMS]);
    expect([...STREAMER_PLATFORMS]).toEqual(['twitch', 'x', 'kick', 'youtube']);
  });

  it('pins the host allowlist of every platform', () => {
    for (const platform of SIM_STREAMER_PLATFORMS) {
      expect([...STREAMER_HOSTS[platform]], platform).toEqual([...SIM_STREAMER_HOSTS[platform]]);
    }
    expect([...STREAMER_HOSTS.twitch]).toEqual(['twitch.tv', 'www.twitch.tv']);
    expect([...STREAMER_HOSTS.x]).toEqual(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
    expect([...STREAMER_HOSTS.kick]).toEqual(['kick.com', 'www.kick.com']);
    expect([...STREAMER_HOSTS.youtube]).toEqual([
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
    ]);
  });

  it('pins the length cap', () => {
    expect(STREAMER_LINK_MAX).toBe(SIM_STREAMER_LINK_MAX);
    expect(STREAMER_LINK_MAX).toBe(200);
  });

  it('reaches the same verdict as the canonical validator on every case', () => {
    for (const platform of STREAMER_PLATFORMS) {
      const cases = [
        ...STREAMER_HOSTS[platform].map((host) => `https://${host}/streamer`),
        ...hostileFor(platform).map((c) => c.url),
        '',
        '   ',
        `https://${STREAMER_HOSTS[platform][0]}`,
      ];
      for (const value of cases) {
        expect(normalizeStreamerLink(platform, value), `${platform}: ${value}`).toBe(
          simNormalizeStreamerLink(platform, value),
        );
      }
    }
  });
});
