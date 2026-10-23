// The SPA shell fallback's status (server/static_fallback.ts, wired in serveStatic).
//
// serveStatic used to answer EVERY unknown extensionless path with the homepage shell
// and HTTP 200, so /game, /cp or /MMORPGS/free looked like copies of the homepage
// ("soft 404s" to a search engine). Known client routes keep 200; any other path
// still gets the same shell body, but with 404.
//
// The wiring half drives the real routeHttpRequest. server/main.ts reads its shells
// from dist/, which a test checkout may not have built, so the mock below stands in
// for exactly the three shell files (existence + body) and passes every other fs
// call through, the same pass-through shape tests/server/static_fd_leak.test.ts uses.

import * as http from 'node:http';
import { Readable } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  STATIC_PAGE_ALIASES as ALIASES,
  SHELL_CLIENT_ROUTES,
  spaFallbackStatus,
} from '../../server/static_fallback';

const SHELL = /[\\/]dist[\\/](index|guide|admin)\.html$/;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
      SHELL.test(String(p)) || actual.existsSync(p),
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const match = String(args[0]).match(SHELL);
      if (match) return Readable.from([`SHELL:${match[1]}`]) as never;
      return actual.createReadStream(...args);
    },
  };
  return { ...wrapped, default: wrapped };
});

describe('spaFallbackStatus', () => {
  it('covers the pretty-URL aliases serveStatic rewrites', () => {
    expect(ALIASES.size).toBeGreaterThanOrEqual(20);
    expect(ALIASES.get('/play')).toBe('/play.html');
    expect(ALIASES.get('/wiki')).toBe('/guide.html');
  });

  it('keeps 200 for the game shell routes', () => {
    for (const p of [
      '/',
      '/admin',
      '/admin/',
      '/desktop-login',
      '/desktop-login/',
      '/error',
      '/leaderboard',
    ]) {
      expect(SHELL_CLIENT_ROUTES.has(p), p).toBe(true);
      expect(spaFallbackStatus(p, false, ALIASES), p).toBe(200);
    }
  });

  it('keeps 200 for every standalone page alias, even when its file is missing', () => {
    for (const p of ALIASES.keys()) expect(spaFallbackStatus(p, false, ALIASES), p).toBe(200);
  });

  it('leaves every /wiki path to the guide router', () => {
    for (const p of ['/wiki', '/wiki/', '/wiki/classes/warrior', '/wiki/no-such-page']) {
      expect(spaFallbackStatus(p, false, ALIASES), p).toBe(200);
    }
  });

  it('leaves the admin host exactly as it was', () => {
    for (const p of ['/', '/anything', '/players/42']) {
      expect(spaFallbackStatus(p, true, ALIASES), p).toBe(200);
    }
  });

  it('answers 404 for paths no route owns', () => {
    for (const p of [
      '/game',
      '/cp',
      '/gamefi/referral',
      '/MMORPGS/free',
      '/Play',
      '/wikipedia',
      '/desktop-login/extra',
      '/games-like',
      '//',
      '/nope.html',
    ]) {
      expect(spaFallbackStatus(p, false, ALIASES), p).toBe(404);
    }
  });

  it('decides on the pathname, so query strings keep their route', () => {
    const pathname = (u: string) => new URL(u, 'http://t').pathname;
    expect(spaFallbackStatus(pathname('/?lang=pt_BR'), false, ALIASES)).toBe(200);
    expect(spaFallbackStatus(pathname('/error?code=auth.expired'), false, ALIASES)).toBe(200);
    expect(spaFallbackStatus(pathname('/game?ref=x'), false, ALIASES)).toBe(404);
  });
});

describe('serveStatic SPA fallback (routeHttpRequest)', () => {
  let routeHttpRequest: typeof import('../../server/main').routeHttpRequest;
  let port = 0;

  beforeAll(async () => {
    ({ routeHttpRequest } = await import('../../server/main'));
    const server = http.createServer((req, res) => routeHttpRequest(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing test port');
    port = address.port;
    return () => new Promise<void>((resolve) => server.close(() => resolve()));
  }, 30000);

  function fetchPath(
    urlPath: string,
    opts: { method?: string; host?: string } = {},
  ): Promise<{ status: number; type: string; cache: string; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: urlPath,
          method: opts.method ?? 'GET',
          headers: { Host: opts.host ?? 'worldofclaudecraft.com', Connection: 'close' },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              type: String(res.headers['content-type'] ?? ''),
              cache: String(res.headers['cache-control'] ?? ''),
              body,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves the homepage shell with 404 for an unknown path', async () => {
    const res = await fetchPath('/game');
    expect(res.status).toBe(404);
    expect(res.type).toBe('text/html');
    expect(res.cache).toBe('no-cache');
    expect(res.body).toBe('SHELL:index');
  });

  it('answers HEAD with the same status as GET', async () => {
    expect((await fetchPath('/gamefi/referral', { method: 'HEAD' })).status).toBe(404);
    expect((await fetchPath('/desktop-login', { method: 'HEAD' })).status).toBe(200);
  });

  it('keeps 200 for client routes, aliases and the query-string homepage', async () => {
    const desktop = await fetchPath('/desktop-login');
    expect(desktop.status).toBe(200);
    expect(desktop.body).toBe('SHELL:index');
    expect((await fetchPath('/?lang=pt_BR')).status).toBe(200);
    expect((await fetchPath('/error?code=auth.expired')).status).toBe(200);
    // A standalone page alias stays 200 whether or not its file is in this checkout's dist/.
    expect((await fetchPath('/press')).status).toBe(200);
  });

  it('keeps every /wiki path on the guide shell with 200', async () => {
    const res = await fetchPath('/wiki/no-such-page');
    expect(res.status).toBe(200);
    expect(res.body).toBe('SHELL:guide');
  });

  it('leaves the admin host on the admin shell with 200', async () => {
    const res = await fetchPath('/anything', { host: 'admin.worldofclaudecraft.com' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('SHELL:admin');
  });

  it('still 404s a missing asset as plain text, never a shell', async () => {
    const res = await fetchPath('/models/definitely-missing.glb');
    expect(res.status).toBe(404);
    expect(res.type).toBe('text/plain');
    expect(res.body).toBe('not found');
  });
});
