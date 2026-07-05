import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWebSocketAuthMessage, buildWebSocketUrl } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import { normalizeCharName, offensiveName, offensiveUsername, validCharName, validUsername } from '../server/auth';
import {
  rateLimited,
  requestIp,
  authThrottled,
  recordAuthFailure,
  clearAuthFailures,
  authFailureCount,
  resetAuthFailures,
  trackedIpCount,
  resetRateLimits,
  cardUploadRateLimited,
  CARD_UPLOAD_MAX_PER_MINUTE,
  resetCardUploadRateLimits,
  walletLinkRateLimited,
  WALLET_LINK_MAX_PER_MINUTE,
  resetWalletLinkRateLimits,
  wocBalanceRateLimited,
  WOC_BALANCE_MAX_PER_MINUTE,
  resetWocBalanceRateLimits,
} from '../server/ratelimit';

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
      clientSeed: '',
    });
  });

  it('carries the client seed when one is supplied', () => {
    expect(buildWebSocketAuthMessage('a'.repeat(64), 42, 'seed-123')).toEqual({
      t: 'auth',
      token: 'a'.repeat(64),
      character: 42,
      clientSeed: 'seed-123',
    });
  });
});

describe('rate-limit client IP selection', () => {
  // The attempts map is module-level shared state; reset it so the flood tests
  // below (and any future ordering changes) can't leak entries between cases.
  beforeEach(() => {
    resetRateLimits();
    resetCardUploadRateLimits();
    resetWalletLinkRateLimits();
    resetWocBalanceRateLimits();
  });

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

  it('rate-limits card uploads by account across client IPs', () => {
    const accountId = 77;
    for (let i = 0; i < CARD_UPLOAD_MAX_PER_MINUTE; i++) {
      expect(cardUploadRateLimited(fakeReq({ 'x-forwarded-for': `203.0.113.${i + 1}` }, '172.18.0.1'), accountId)).toBe(false);
    }
    expect(cardUploadRateLimited(fakeReq({ 'x-forwarded-for': '203.0.113.250' }, '172.18.0.1'), accountId)).toBe(true);
  });

  it('rate-limits card uploads by client IP across accounts', () => {
    const ip = '203.0.113.220';
    for (let i = 0; i < CARD_UPLOAD_MAX_PER_MINUTE; i++) {
      expect(cardUploadRateLimited(fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1'), 1000 + i)).toBe(false);
    }
    expect(cardUploadRateLimited(fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1'), 2000)).toBe(true);
  });

  it('rate-limits wallet link/challenge attempts by account across client IPs', () => {
    const accountId = 77;
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(fakeReq({ 'x-forwarded-for': `203.0.114.${i + 1}` }, '172.18.0.1'), accountId)).toBe(false);
    }
    expect(walletLinkRateLimited(fakeReq({ 'x-forwarded-for': '203.0.114.250' }, '172.18.0.1'), accountId)).toBe(true);
  });

  it('rate-limits wallet link/challenge attempts by client IP across accounts', () => {
    const ip = '203.0.114.220';
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1'), 1000 + i)).toBe(false);
    }
    expect(walletLinkRateLimited(fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1'), 2000)).toBe(true);
  });

  it('rate-limits the $WOC balance proxy per IP on its OWN bucket (decoupled from login/register)', () => {
    const ip = '203.0.115.10';
    const req = () => fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1');
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      expect(wocBalanceRateLimited(req())).toBe(false);
    }
    expect(wocBalanceRateLimited(req())).toBe(true); // 21st balance read from this IP is limited
    // Crucially, exhausting the balance bucket must NOT spill into the shared
    // register/login limiter — the player can still log in from the same IP.
    expect(rateLimited(req())).toBe(false);
  });

  it('keeps the balance proxy unaffected by an exhausted login/register budget', () => {
    const ip = '203.0.115.20';
    const req = () => fakeReq({ 'x-forwarded-for': ip }, '172.18.0.1');
    for (let i = 0; i < 21; i++) rateLimited(req()); // burn the shared login/register bucket
    expect(rateLimited(req())).toBe(true);
    // The balance proxy has its own bucket, so a card/bag open still succeeds.
    expect(wocBalanceRateLimited(req())).toBe(false);
  });

  it('keeps limiting a persistent attacker after the memory backstop evicts', () => {
    // A persistent attacker keeps hammering one endpoint while the IP map is
    // pushed past its backstop threshold by churning many one-off IPs. The
    // backstop must evict expired one-off entries, NOT wipe the attacker's
    // live counter — otherwise flooding the map silently disables rate limiting.
    const attacker = '203.0.113.250';
    let limited = false;
    for (let i = 0; i < 25; i++) {
      limited = rateLimited(fakeReq({ 'x-forwarded-for': attacker }, '172.18.0.1'));
    }
    expect(limited).toBe(true);

    // Churn past MAX_TRACKED_IPS (10_000) distinct clients to trip the backstop.
    for (let i = 0; i < 10_050; i++) {
      const a = (i >> 8) & 0xff;
      const b = i & 0xff;
      rateLimited(fakeReq({ 'x-forwarded-for': `100.64.${a}.${b}` }, '172.18.0.1'));
    }

    // The attacker's counter must survive eviction and stay limited.
    expect(rateLimited(fakeReq({ 'x-forwarded-for': attacker }, '172.18.0.1'))).toBe(true);
  });

  it('keeps a burst-then-idle limited IP limited after a flood of newer IPs', () => {
    // An IP bursts past the limit (so it is rate-limited for the rest of the
    // 60s window), then goes idle. An attacker floods the map with >10k NEWER
    // distinct one-off IPs. A naive least-recently-active eviction would pick
    // the idle-but-still-in-window limited IP as "oldest" and evict it,
    // resetting its limit before the window expires — the eviction-path version
    // of the flood-reset bypass. The backstop must skip currently-limited IPs.
    const victim = '203.0.113.240';
    let limited = false;
    for (let i = 0; i < 21; i++) {
      limited = rateLimited(fakeReq({ 'x-forwarded-for': victim }, '172.18.0.1'));
    }
    expect(limited).toBe(true);

    // Flood past MAX_TRACKED_IPS (10_000) with NEWER one-off IPs; victim idle.
    for (let i = 0; i < 10_050; i++) {
      const a = (i >> 8) & 0xff;
      const b = i & 0xff;
      rateLimited(fakeReq({ 'x-forwarded-for': `100.64.${a}.${b}` }, '172.18.0.1'));
    }

    // The idle victim must stay limited — its counter must survive eviction.
    expect(rateLimited(fakeReq({ 'x-forwarded-for': victim }, '172.18.0.1'))).toBe(true);
  });

  it('does not let a lenient-route flood evict an IP limited by a stricter route', () => {
    // The attempts map is SHARED across routes with different limits: game
    // login/register use the default 20, admin login uses 10. An IP that has
    // tripped the stricter admin limit (11 attempts > 10) is currently limited,
    // but has only 11 entries. A flood of default-limit (20) requests from newer
    // IPs must NOT evict that bucket — eviction must judge "limited" by the
    // strictest policy sharing the map, not the flooding call's lenient limit.
    const adminLimit = 10;
    const victim = '203.0.113.230';
    let adminLimited = false;
    for (let i = 0; i < 11; i++) {
      adminLimited = rateLimited(fakeReq({ 'x-forwarded-for': victim }, '172.18.0.1'), adminLimit);
    }
    expect(adminLimited).toBe(true);

    // Flood the map via the LENIENT default-limit (20) route with newer IPs.
    for (let i = 0; i < 10_050; i++) {
      const a = (i >> 8) & 0xff;
      const b = i & 0xff;
      rateLimited(fakeReq({ 'x-forwarded-for': `100.66.${a}.${b}` }, '172.18.0.1'));
    }

    // The admin-limited victim must still be limited under the admin policy.
    expect(rateLimited(fakeReq({ 'x-forwarded-for': victim }, '172.18.0.1'), adminLimit)).toBe(true);
  });

  it('keeps the IP map bounded under a flood of distinct in-window clients', () => {
    // A pure flood is all in-window, so expired-only eviction would delete
    // nothing and the map would grow unbounded — and every subsequent call
    // would re-scan a growing map (O(n^2)). The backstop must fall back to
    // evicting the least-recently-active IPs so the map stays near the cap.
    for (let i = 0; i < 12_000; i++) {
      // Two octets give 256*256 = 65_536 distinct IPs, plenty for 12_000.
      const a = (i >> 8) & 0xff;
      const b = i & 0xff;
      rateLimited(fakeReq({ 'x-forwarded-for': `100.65.${a}.${b}` }, '172.18.0.1'));
    }

    // MAX_TRACKED_IPS is 10_000; allow a small margin for the just-recorded entry.
    expect(trackedIpCount()).toBeLessThanOrEqual(10_001);
  });
});

describe('per-account failed-login throttle (#93)', () => {
  // The failure map is module-level shared state; reset it so the flood tests
  // below (and any future ordering changes) can't leak entries between cases.
  beforeEach(() => resetAuthFailures());

  it('throttles an account after repeated failed logins, regardless of source IP', () => {
    const user = 'victim_account';
    expect(authThrottled(user)).toBe(false);
    // a credential-stuffing botnet hammers one account from many IPs
    for (let i = 0; i < 10; i++) {
      expect(authThrottled(user)).toBe(false); // still allowed to try
      recordAuthFailure(user);
    }
    expect(authThrottled(user)).toBe(true); // now locked out for the window
  });

  it('is case/whitespace-insensitive so the same account cannot be split into buckets', () => {
    for (let i = 0; i < 10; i++) recordAuthFailure('  CaseUser ');
    expect(authThrottled('caseuser')).toBe(true);
    expect(authThrottled('CASEUSER')).toBe(true);
  });

  it('clears failures after a successful login so honest typos are forgiven', () => {
    const user = 'butterfingers';
    for (let i = 0; i < 9; i++) recordAuthFailure(user);
    expect(authThrottled(user)).toBe(false); // one under the ceiling
    clearAuthFailures(user); // correct password on the next try
    for (let i = 0; i < 9; i++) recordAuthFailure(user);
    expect(authThrottled(user)).toBe(false); // counter started fresh
  });

  it('keeps separate accounts independent', () => {
    for (let i = 0; i < 10; i++) recordAuthFailure('account_a');
    expect(authThrottled('account_a')).toBe(true);
    expect(authThrottled('account_b')).toBe(false);
  });

  it('keeps an account locked out after the memory backstop evicts', () => {
    // A credential-stuffing flood spreads guesses across thousands of accounts,
    // pushing the failure map past its backstop threshold. The backstop must
    // evict expired one-off entries, NOT wipe the live lockout counter for an
    // account actively under attack — otherwise flooding silently disables the
    // per-account throttle exactly when it is needed most.
    const victim = 'lockme_account';
    for (let i = 0; i < 10; i++) recordAuthFailure(victim);
    expect(authThrottled(victim)).toBe(true);

    // Churn past MAX_TRACKED_IPS (10_000) distinct accounts to trip the backstop.
    for (let i = 0; i < 10_050; i++) recordAuthFailure(`throwaway_${i}`);

    // The victim's lockout must survive eviction.
    expect(authThrottled(victim)).toBe(true);
  });

  it('keeps a throttled-then-idle victim throttled after a flood of newer accounts', () => {
    // Models the REAL flow (#251): once an account is throttled, the login
    // handler rejects it BEFORE recordAuthFailure runs (server/main.ts), so the
    // victim's timestamps go stale and it is never re-touched. An attacker then
    // floods the map with >10k NEWER distinct one-off failures. A naive
    // least-recently-active eviction that ignored throttle state would pick the
    // idle victim as "oldest" and evict it — resetting its throttle, the exact
    // bypass the backstop must prevent. The eviction must skip throttled accounts.
    const victim = 'idle_victim';
    for (let i = 0; i < 10; i++) recordAuthFailure(victim);
    expect(authThrottled(victim)).toBe(true);

    // Flood past MAX_TRACKED_IPS (10_000) with newer accounts; victim untouched.
    for (let i = 0; i < 10_050; i++) recordAuthFailure(`floodacct_${i}`);

    // The idle victim must stay throttled — its counter must survive eviction.
    expect(authThrottled(victim)).toBe(true);
  });

  it('keeps the failure map bounded under a flood of distinct in-window accounts', () => {
    // A pure flood is all in-window (#251), so expired-only eviction would
    // delete nothing and the map would grow unbounded — and every subsequent
    // call would re-scan a growing map (O(n^2)). The backstop must fall back to
    // evicting the least-recently-active accounts so the map stays near the cap.
    for (let i = 0; i < 12_000; i++) recordAuthFailure(`floodbound_${i}`);

    // MAX_TRACKED_IPS is 10_000; allow a small margin for the just-recorded entry.
    expect(authFailureCount()).toBeLessThanOrEqual(10_001);
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

  it('caches file-backed banned terms until banlist env changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woc-banlist-'));
    const firstFile = join(dir, 'first.txt');
    const secondFile = join(dir, 'second.txt');
    writeFileSync(firstFile, 'fileterm\n');
    writeFileSync(secondFile, 'otherterm\n');

    try {
      withUsernameBanlist({ file: firstFile }, () => {
        expect(offensiveName('fileterm')).toBe(true);
        writeFileSync(firstFile, 'changedterm\n');
        expect(offensiveName('fileterm')).toBe(true);
        expect(offensiveName('changedterm')).toBe(false);

        process.env.USERNAME_BANLIST_FILE = secondFile;
        expect(offensiveName('fileterm')).toBe(false);
        expect(offensiveName('otherterm')).toBe(true);

        delete process.env.USERNAME_BANLIST_FILE;
        expect(offensiveName('otherterm')).toBe(false);
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('retries file-backed banned terms after a failed read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woc-banlist-missing-'));
    const missingFile = join(dir, 'missing.txt');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      withUsernameBanlist({ file: missingFile }, () => {
        expect(offensiveName('laterterm')).toBe(false);
        expect(warn).toHaveBeenCalledOnce();

        writeFileSync(missingFile, 'laterterm\n');
        expect(offensiveName('laterterm')).toBe(true);
      });
    } finally {
      warn.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('character name censorship', () => {
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
});
