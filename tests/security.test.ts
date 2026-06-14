import { EventEmitter } from 'node:events';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWebSocketAuthMessage, buildWebSocketUrl } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import { normalizeCharName, offensiveCharacterName, offensiveName, offensiveUsername, validCharName, validUsername } from '../server/auth';
import { rateLimited, requestIp } from '../server/ratelimit';

function fakeReq(headers: Record<string, string>, remoteAddress: string) {
  const req: any = new EventEmitter();
  req.headers = headers;
  req.socket = { remoteAddress };
  return req;
}

function withUsernameBanlist(env: { inline?: string; file?: string }, test: () => void): void {
  const prevInline = process.env.USERNAME_BANLIST;
  const prevFile = process.env.USERNAME_BANLIST_FILE;
  if (env.inline === undefined) delete process.env.USERNAME_BANLIST;
  else process.env.USERNAME_BANLIST = env.inline;
  if (env.file === undefined) delete process.env.USERNAME_BANLIST_FILE;
  else process.env.USERNAME_BANLIST_FILE = env.file;
  try {
    test();
  } finally {
    if (prevInline === undefined) delete process.env.USERNAME_BANLIST;
    else process.env.USERNAME_BANLIST = prevInline;
    if (prevFile === undefined) delete process.env.USERNAME_BANLIST_FILE;
    else process.env.USERNAME_BANLIST_FILE = prevFile;
  }
}

describe('websocket authentication', () => {
  it('keeps bearer tokens out of the websocket URL', () => {
    const url = buildWebSocketUrl('https:', 'worldofclaudecraft.com');

    expect(url).toBe('wss://worldofclaudecraft.com/ws');
    expect(url).not.toContain('token');
  });

  it('sends credentials as an auth message instead of query params', () => {
    expect(buildWebSocketAuthMessage('a'.repeat(64), 42)).toEqual({
      t: 'auth',
      token: 'a'.repeat(64),
      character: 42,
    });
  });
});

describe('rate-limit client IP selection', () => {
  it('ignores spoofed x-forwarded-for from untrusted direct clients', () => {
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.55' }, '198.51.100.10');

    expect(requestIp(req)).toBe('198.51.100.10');
  });

  it('uses x-forwarded-for from a trusted loopback reverse proxy', () => {
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.55, 127.0.0.1' }, '127.0.0.1');

    expect(requestIp(req)).toBe('203.0.113.55');
  });

  // Production regression: host nginx proxies into the game CONTAINER, so the
  // connection arrives from the docker bridge gateway. Players must NOT all
  // collapse into one rate-limit bucket keyed on that gateway address.
  it('trusts x-forwarded-for from the docker bridge gateway (host nginx -> container)', () => {
    const alice = fakeReq({ 'x-forwarded-for': '203.0.113.55' }, '172.18.0.1');
    const bob = fakeReq({ 'x-forwarded-for': '198.51.100.77' }, '172.18.0.1');

    expect(requestIp(alice)).toBe('203.0.113.55');
    expect(requestIp(bob)).toBe('198.51.100.77');
  });

  it('also handles the ipv6-mapped form of the bridge gateway', () => {
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.55' }, '::ffff:172.18.0.1');

    expect(requestIp(req)).toBe('203.0.113.55');
  });

  it('resolves the rightmost untrusted hop so clients cannot spoof extra entries', () => {
    // attacker sends their own X-Forwarded-For; nginx appends their real IP.
    // Counting the leftmost entry would let them rotate fake IPs at will.
    const req = fakeReq({ 'x-forwarded-for': '1.2.3.4, 203.0.113.55' }, '172.18.0.1');

    expect(requestIp(req)).toBe('203.0.113.55');
  });

  it('TRUSTED_PROXY_IPS pins the proxy list when set', () => {
    process.env.TRUSTED_PROXY_IPS = '10.9.9.9';
    try {
      // a private address NOT on the pinned list is no longer trusted
      const direct = fakeReq({ 'x-forwarded-for': '203.0.113.55' }, '172.18.0.1');
      expect(requestIp(direct)).toBe('172.18.0.1');
      const proxied = fakeReq({ 'x-forwarded-for': '203.0.113.55' }, '10.9.9.9');
      expect(requestIp(proxied)).toBe('203.0.113.55');
    } finally {
      delete process.env.TRUSTED_PROXY_IPS;
    }
  });

  it('rate-limits forwarded clients independently', () => {
    // 21 attempts from one forwarded client trip the limiter...
    let aliceLimited = false;
    for (let i = 0; i < 21; i++) {
      aliceLimited = rateLimited(fakeReq({ 'x-forwarded-for': '203.0.113.200' }, '172.18.0.1'));
    }
    expect(aliceLimited).toBe(true);
    // ...while another player behind the same proxy is unaffected
    expect(rateLimited(fakeReq({ 'x-forwarded-for': '198.51.100.201' }, '172.18.0.1'))).toBe(false);
  });
});

describe('malformed websocket frames cannot crash the server', () => {
  // Mirrors the guard in GameServer.dispatchMessage. Regression for the outage
  // where a WS frame containing the literal `null` reached `msg.t`: JSON.parse
  // returns null for valid-but-non-object JSON (also numbers/strings/arrays),
  // and `null.t` threw an uncaught TypeError that killed the whole process,
  // disconnecting every player.
  function parseFrame(raw: string): Record<string, unknown> | null {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
    return msg;
  }

  it('rejects null / primitives / arrays / unparseable frames', () => {
    for (const raw of ['null', 'false', '0', '"hello"', '[1,2,3]', '{bad', '']) {
      expect(parseFrame(raw)).toBeNull();
    }
  });

  it('reading .t on every rejected frame never throws', () => {
    for (const raw of ['null', 'false', '0', '"hello"', '[1,2,3]', '{bad', '']) {
      expect(() => parseFrame(raw)?.t).not.toThrow();
    }
  });

  it('still accepts a well-formed object frame', () => {
    expect(parseFrame(JSON.stringify({ t: 'input', mi: { f: 1 } }))).toEqual({ t: 'input', mi: { f: 1 } });
  });
});

describe('character name normalization', () => {
  // The server is the authority: it must not trust the browser to strip
  // whitespace. A direct API client could otherwise store padded names that
  // then become un-befriendable (findCharacterByName won't match the typed,
  // unpadded form).
  it('trims surrounding whitespace and collapses interior runs', () => {
    expect(normalizeCharName('  Bob  Smith ')).toBe('Bob Smith');
    expect(normalizeCharName('Thrall')).toBe('Thrall');
    expect(normalizeCharName('Bob \t Smith')).toBe('Bob Smith');
  });

  it('returns null for names that are invalid even after normalizing', () => {
    expect(normalizeCharName('  ')).toBeNull();
    expect(normalizeCharName('A')).toBeNull(); // too short
    expect(normalizeCharName('123Adventurer')).toBeNull();
    expect(normalizeCharName(42)).toBeNull();
  });

  it('preserves valid punctuation while normalizing whitespace', () => {
    expect(normalizeCharName("  Kael'thas ")).toBe("Kael'thas");
    expect(normalizeCharName('Rexxar-Misha')).toBe('Rexxar-Misha');
  });

  it('a normalized name always passes validCharName', () => {
    const n = normalizeCharName('  Bob  Smith ');
    expect(n).not.toBeNull();
    expect(validCharName(n)).toBe(true);
  });
});

describe('gm privilege boundaries', () => {
  it('normal character names cannot create reserved GM-style names', () => {
    expect(validCharName('GM01')).toBe(false);
    expect(validCharName('GM99')).toBe(false);
  });

  it('does not restore gm privilege from client-controlled saved character state', () => {
    const source = new Sim({ seed: 42, playerClass: 'warrior' });
    const state = source.serializeCharacter(source.playerId) as any;
    state.gm = true;
    state.is_gm = true;

    const target = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = target.addPlayer('warrior', 'Tester', { state });

    expect(target.entities.get(pid)?.gm).not.toBe(true);
  });
});

describe('username censorship', () => {
  it('allows normal account usernames that meet the shape rules', () => {
    withUsernameBanlist({ inline: 'blockedterm' }, () => {
      expect(validUsername('Eastbrook_123')).toBe(true);
    });
  });

  it('rejects configured banned terms in new account usernames', () => {
    withUsernameBanlist({ inline: 'blockedterm' }, () => {
      expect(validUsername('blockedterm')).toBe(false);
      expect(validUsername('xBLOCKEDTERMx')).toBe(false);
    });
  });

  it('normalizes obvious separators and leetspeak before checking usernames', () => {
    withUsernameBanlist({ inline: 'biga' }, () => {
      expect(offensiveUsername('b_1_g_4')).toBe(true);
      expect(validUsername('b_1_g_4')).toBe(false);
    });
  });

  it('rejects profanity detected by the built-in username filter', () => {
    withUsernameBanlist({}, () => {
      expect(offensiveName('fuuuck')).toBe(true);
      expect(validUsername('fuuuck')).toBe(false);
    });
  });

  it('rejects built-in policy-banned name terms and obvious variants', () => {
    withUsernameBanlist({}, () => {
      expect(validUsername('Hitler')).toBe(false);
      expect(validUsername('H1tler')).toBe(false);
      expect(validCharName('H i t l e r')).toBe(false);
      expect(validCharName('Adolf')).toBe(true);
    });
  });

  it('can load banned username terms from a configured file', () => {
    const file = join(tmpdir(), `woc-banlist-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    writeFileSync(file, 'forbidden\n');
    try {
      withUsernameBanlist({ file }, () => {
        expect(validUsername('forbidden')).toBe(false);
      });
    } finally {
      rmSync(file, { force: true });
    }
  });
});

describe('character name moderation', () => {
  it('allows normal character names that meet the shape rules', () => {
    withUsernameBanlist({ inline: 'blockedterm' }, () => {
      expect(validCharName('Jaina Proudmoore')).toBe(true);
      expect(validCharName("Kael'thas")).toBe(true);
      expect(validCharName('Rexxar-Misha')).toBe(true);
    });
  });

  it('rejects profanity in character names', () => {
    withUsernameBanlist({}, () => {
      expect(validCharName('Fuuuck')).toBe(false);
    });
  });

  it('normalizes separators before checking character names', () => {
    withUsernameBanlist({ inline: 'biga' }, () => {
      expect(validCharName('B I G A')).toBe(false);
    });
  });

  it('applies configured banned username terms to character names too', () => {
    withUsernameBanlist({ inline: 'gravecaller' }, () => {
      expect(validCharName('Grave Caller')).toBe(false);
    });
  });

  it('rejects configured banned terms in new character names', () => {
    withUsernameBanlist({ inline: 'blockedterm' }, () => {
      expect(validCharName('Blockedterm')).toBe(false);
      expect(validCharName('Ablockedterm')).toBe(false);
    });
  });

  it('normalizes spaces, hyphens, and apostrophes before checking character names', () => {
    withUsernameBanlist({ inline: 'blockedterm' }, () => {
      expect(offensiveCharacterName("B'locked-Term")).toBe(true);
      expect(validCharName("B'locked-Term")).toBe(false);
    });
  });

  it('preserves space-containing banned character name terms', () => {
    withUsernameBanlist({ inline: 'blocked term' }, () => {
      expect(offensiveCharacterName('Blocked')).toBe(false);
      expect(validCharName('Blocked')).toBe(true);
      expect(offensiveCharacterName('Blocked Term')).toBe(true);
      expect(validCharName('Blocked Term')).toBe(false);
    });
  });
});
