import { describe, expect, it } from 'vitest';
import {
  type AccountFlair,
  EMPTY_ACCOUNT_FLAIR,
  hasStreamerLink,
  normalizeAccountFlair,
  normalizeStreamerLink,
  normalizeStreamerLinks,
  STREAMER_HOSTS,
  STREAMER_LINK_MAX,
  STREAMER_PLATFORMS,
  streamerLinkList,
  wireStreamerLinks,
} from '../src/sim/account_flair';

// The links an operator types end up in a window.open on every player's client,
// so normalizeStreamerLink is a security boundary, not a formatting nicety. Each
// rejection case below is a real attack, and each is asserted per platform.

describe('normalizeStreamerLink: accepts', () => {
  it('takes each platform on each of its own hostnames', () => {
    for (const platform of STREAMER_PLATFORMS) {
      for (const host of STREAMER_HOSTS[platform]) {
        const url = `https://${host}/somechannel`;
        expect(normalizeStreamerLink(platform, url), `${platform} @ ${host}`).toBe(url);
      }
    }
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeStreamerLink('twitch', '  https://twitch.tv/foo  ')).toBe(
      'https://twitch.tv/foo',
    );
  });

  it('normalizes host case', () => {
    expect(normalizeStreamerLink('kick', 'https://KICK.COM/foo')).toBe('https://kick.com/foo');
  });
});

describe('normalizeStreamerLink: rejects', () => {
  // Every one of these must be null for EVERY platform: a single arm that lets
  // one through is the whole hole.
  const hostile: [label: string, value: unknown][] = [
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['plain http', 'http://twitch.tv/foo'],
    ['a file: URL', 'file:///etc/passwd'],
    ['embedded credentials', 'https://user:pass@twitch.tv/foo'],
    ['a lookalike subdomain', 'https://twitch.tv.evil.com/foo'],
    ['an allowed host in the PATH only', 'https://evil.com/twitch.tv/foo'],
    ['an allowed host in the QUERY only', 'https://evil.com/?x=https://twitch.tv/foo'],
    ['a bare hostname with no scheme', 'twitch.tv/foo'],
    ['the empty string', ''],
    ['whitespace only', '   '],
    ['a non-string', 12345],
    ['null', null],
    ['undefined', undefined],
  ];

  for (const [label, value] of hostile) {
    it(`rejects ${label} on every platform`, () => {
      for (const platform of STREAMER_PLATFORMS) {
        expect(normalizeStreamerLink(platform, value), `${platform}: ${label}`).toBeNull();
      }
    });
  }

  it('rejects a URL longer than the cap', () => {
    const tooLong = `https://twitch.tv/${'a'.repeat(STREAMER_LINK_MAX)}`;
    expect(tooLong.length).toBeGreaterThan(STREAMER_LINK_MAX);
    expect(normalizeStreamerLink('twitch', tooLong)).toBeNull();
  });

  it("rejects another platform's host (the allowlist is per platform)", () => {
    expect(normalizeStreamerLink('twitch', 'https://kick.com/foo')).toBeNull();
    expect(normalizeStreamerLink('kick', 'https://twitch.tv/foo')).toBeNull();
    expect(normalizeStreamerLink('youtube', 'https://x.com/foo')).toBeNull();
    expect(normalizeStreamerLink('x', 'https://youtube.com/foo')).toBeNull();
  });
});

describe('normalizeStreamerLinks', () => {
  it('keeps the valid entries and drops the invalid ones', () => {
    expect(
      normalizeStreamerLinks({
        twitch: 'https://twitch.tv/good',
        x: 'javascript:alert(1)',
        kick: 'https://kick.com/good',
        youtube: 'http://youtube.com/insecure',
      }),
    ).toEqual({ twitch: 'https://twitch.tv/good', kick: 'https://kick.com/good' });
  });

  it('ignores unknown platform keys', () => {
    expect(normalizeStreamerLinks({ myspace: 'https://twitch.tv/foo' })).toEqual({});
  });

  it('survives junk input', () => {
    expect(normalizeStreamerLinks(null)).toEqual({});
    expect(normalizeStreamerLinks('nope')).toEqual({});
    expect(normalizeStreamerLinks(42)).toEqual({});
  });
});

describe('normalizeAccountFlair', () => {
  it('reads a well-formed record', () => {
    expect(
      normalizeAccountFlair({
        ai: true,
        streamer: true,
        links: { twitch: 'https://twitch.tv/foo' },
      }),
    ).toEqual({ ai: true, streamer: true, links: { twitch: 'https://twitch.tv/foo' } });
  });

  it('coerces missing and non-boolean flags to false rather than truthy', () => {
    expect(normalizeAccountFlair({ ai: 'yes', streamer: 1 })).toEqual(EMPTY_ACCOUNT_FLAIR);
    expect(normalizeAccountFlair({})).toEqual(EMPTY_ACCOUNT_FLAIR);
    expect(normalizeAccountFlair(null)).toEqual(EMPTY_ACCOUNT_FLAIR);
  });
});

describe('wireStreamerLinks: the server-side gate', () => {
  const links = { twitch: 'https://twitch.tv/foo' };

  it('ships nothing when the streamer flag is off, even with links stored', () => {
    const flair: AccountFlair = { ai: false, streamer: false, links };
    expect(wireStreamerLinks(flair)).toBeUndefined();
  });

  it('ships nothing when the flag is on but no link survives validation', () => {
    const flair: AccountFlair = { ai: false, streamer: true, links: { twitch: 'http://evil.com' } };
    expect(wireStreamerLinks(flair)).toBeUndefined();
  });

  it('ships the links when the flag is on and a link is valid', () => {
    const flair: AccountFlair = { ai: false, streamer: true, links };
    expect(wireStreamerLinks(flair)).toEqual(links);
  });
});

describe('streamerLinkList: the render-side gate', () => {
  it('returns present links in platform order, not insertion order', () => {
    const list = streamerLinkList({
      youtube: 'https://youtube.com/@d',
      twitch: 'https://twitch.tv/a',
      kick: 'https://kick.com/c',
      x: 'https://x.com/b',
    });
    expect(list.map((l) => l.platform)).toEqual(['twitch', 'x', 'kick', 'youtube']);
  });

  it('returns only the platforms that have a link', () => {
    const list = streamerLinkList({ twitch: 'https://twitch.tv/a', kick: 'https://kick.com/c' });
    expect(list).toEqual([
      { platform: 'twitch', url: 'https://twitch.tv/a' },
      { platform: 'kick', url: 'https://kick.com/c' },
    ]);
  });

  it('drops a hostile URL that somehow reached the wire (defense in depth)', () => {
    // The admin write already rejects this. This asserts the SECOND gate: even a
    // compromised or buggy server cannot get a javascript: URL into window.open.
    const list = streamerLinkList({
      twitch: 'javascript:alert(1)' as string,
      kick: 'https://kick.com/ok',
    });
    expect(list).toEqual([{ platform: 'kick', url: 'https://kick.com/ok' }]);
  });

  it('is empty for undefined and for an empty bag', () => {
    expect(streamerLinkList(undefined)).toEqual([]);
    expect(streamerLinkList({})).toEqual([]);
  });
});

describe('hasStreamerLink', () => {
  it('is false for an empty bag and true once any platform is set', () => {
    expect(hasStreamerLink({})).toBe(false);
    expect(hasStreamerLink({ x: 'https://x.com/foo' })).toBe(true);
  });
});
