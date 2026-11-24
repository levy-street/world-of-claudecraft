// Serving the static encyclopedia (server/wiki_site.ts, wired into serveStatic in
// server/main.ts) plus its Vite dev/preview path mapping (scripts/lib/wiki_site_dev.mjs).
//
// The wiring half drives the real routeHttpRequest. server/main.ts reads from dist/,
// which a test checkout may not have built, so the fs mock below stands in for a few
// dist files (an article page, the redirect table, the wiki sitemap, the guide shell)
// and passes every other fs call through, as tests/server/static_fallback.test.ts does.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wikiSiteFile } from '../../scripts/lib/wiki_site_dev.mjs';
import { resetWikiRedirectCache, resolveWikiRequest } from '../../server/wiki_site';

const FAKE: Record<string, string> = {
  'wiki/item/test-sword/index.html': '<!doctype html><title>Test Sword</title>',
  'encyclopedia-data/redirects.json': JSON.stringify({
    '/wiki/item/old-sword': '/wiki/item/test-sword',
    '/wiki/item/retired-sword': null,
  }),
  'sitemap-wiki.xml': '<?xml version="1.0"?><urlset/>',
  'guide.html': 'SHELL:guide',
};
const DIST = /[\\/]dist[\\/](.+)$/;
const fakeFor = (p: unknown): string | undefined => {
  const match = String(p).match(DIST);
  return match ? FAKE[match[1].split('\\').join('/')] : undefined;
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
      fakeFor(p) !== undefined || actual.existsSync(p),
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      const fake = fakeFor(args[0]);
      if (fake !== undefined) {
        return Object.assign(actual.statSync(new URL(import.meta.url)), {
          size: Buffer.byteLength(fake),
        });
      }
      return actual.statSync(...args);
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const fake = fakeFor(args[0]);
      if (fake !== undefined) return (args[1] ? fake : Buffer.from(fake)) as never;
      return actual.readFileSync(...args);
    },
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const fake = fakeFor(args[0]);
      if (fake !== undefined) return Readable.from([fake]) as never;
      return actual.createReadStream(...args);
    },
  };
  return { ...wrapped, default: wrapped };
});

describe('resolveWikiRequest', () => {
  let dir = '';
  beforeEach(() => {
    resetWikiRedirectCache();
    dir = mkdtempSync(join(tmpdir(), 'woc-wiki-site-'));
    mkdirSync(join(dir, 'wiki/item/sword'), { recursive: true });
    writeFileSync(join(dir, 'wiki/item/sword/index.html'), 'page');
    mkdirSync(join(dir, 'encyclopedia-data'));
    writeFileSync(
      join(dir, 'encyclopedia-data/redirects.json'),
      JSON.stringify({ '/wiki/item/blade': '/wiki/item/sword', '/wiki/item/gone': null }),
    );
  });

  it('serves an article page from its index.html', () => {
    const hit = resolveWikiRequest(dir, '/wiki/item/sword');
    expect(hit?.kind).toBe('file');
    if (hit?.kind === 'file') expect(hit.file).toBe(join(dir, 'wiki/item/sword/index.html'));
  });

  it('301s a trailing slash to the slashless canonical path, keeping the query', () => {
    expect(resolveWikiRequest(dir, '/wiki/item/sword/', '?q=x')).toEqual({
      kind: 'redirect',
      location: '/wiki/item/sword?q=x',
    });
  });

  it('301s a retired address to its new page and 410s a gone one', () => {
    expect(resolveWikiRequest(dir, '/wiki/item/blade')).toEqual({
      kind: 'redirect',
      location: '/wiki/item/sword',
    });
    expect(resolveWikiRequest(dir, '/wiki/item/gone')).toEqual({ kind: 'gone' });
  });

  it('returns null for unknown pages, assets and non-wiki paths', () => {
    expect(resolveWikiRequest(dir, '/wiki/item/x')).toBeNull();
    expect(resolveWikiRequest(dir, '/wiki/item/sword.png')).toBeNull();
    expect(resolveWikiRequest(dir, '/wiki')).toBeNull();
    expect(resolveWikiRequest(dir, '/items/sword')).toBeNull();
  });

  it('rejects traversal out of the static dir', () => {
    for (const p of [
      '/wiki/../etc',
      '/wiki/item/../../secret',
      '/wiki/%2e%2e/%2e%2e/secret',
      '/wiki/item/%5c..%5csecret',
      '/wiki//item/sword',
    ])
      expect(resolveWikiRequest(dir, p), p).toBeNull();
  });

  it('tolerates a missing redirect table', () => {
    const bare = mkdtempSync(join(tmpdir(), 'woc-wiki-bare-'));
    expect(resolveWikiRequest(bare, '/wiki/item/blade')).toBeNull();
  });

  it('ignores a redirect target that is not a site path', () => {
    writeFileSync(
      join(dir, 'encyclopedia-data/redirects.json'),
      JSON.stringify({ '/wiki/item/evil': '//evil.example/x' }),
    );
    expect(resolveWikiRequest(dir, '/wiki/item/evil')).toEqual({ kind: 'gone' });
  });
});

describe('wikiSiteFile (vite dev and preview)', () => {
  const files = new Set([
    'wiki/item/sword/index.html',
    'encyclopedia-data/search.0123456789.json',
    'sitemap-wiki.xml',
  ]);
  const exists = (rel: string) => files.has(rel);

  it('maps article paths, data files and the sitemap', () => {
    expect(wikiSiteFile('/wiki/item/sword', exists)).toBe('wiki/item/sword/index.html');
    expect(wikiSiteFile('/wiki/item/sword/', exists)).toBe('wiki/item/sword/index.html');
    expect(wikiSiteFile('/encyclopedia-data/search.0123456789.json', exists)).toBe(
      'encyclopedia-data/search.0123456789.json',
    );
    expect(wikiSiteFile('/sitemap-wiki.xml', exists)).toBe('sitemap-wiki.xml');
  });

  it('leaves Guide routes, missing pages and traversal alone', () => {
    expect(wikiSiteFile('/wiki/classes/warrior', exists)).toBeNull();
    expect(wikiSiteFile('/wiki/item/x', exists)).toBeNull();
    expect(wikiSiteFile('/wiki/../package.json', exists)).toBeNull();
    expect(wikiSiteFile('/encyclopedia-data/../x', exists)).toBeNull();
    expect(wikiSiteFile('/wiki', exists)).toBeNull();
  });
});

describe('serveStatic encyclopedia pages (routeHttpRequest)', () => {
  let routeHttpRequest: typeof import('../../server/main').routeHttpRequest;
  let port = 0;

  beforeAll(async () => {
    resetWikiRedirectCache();
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
  ): Promise<{ status: number; type: string; location: string; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: urlPath,
          method: 'GET',
          headers: { Host: 'worldofclaudecraft.com', Connection: 'close' },
        },
        (res) => {
          res.on('error', reject);
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              type: String(res.headers['content-type'] ?? ''),
              location: String(res.headers.location ?? ''),
              body,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves an article page as HTML with 200', async () => {
    const res = await fetchPath('/wiki/item/test-sword');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.body).toContain('Test Sword');
  });

  it('301s the trailing-slash variant to the canonical path', async () => {
    const res = await fetchPath('/wiki/item/test-sword/');
    expect(res.status).toBe(301);
    expect(res.location).toBe('/wiki/item/test-sword');
  });

  it('301s a redirected address and 410s a gone one', async () => {
    const moved = await fetchPath('/wiki/item/old-sword');
    expect(moved.status).toBe(301);
    expect(moved.location).toBe('/wiki/item/test-sword');
    expect((await fetchPath('/wiki/item/retired-sword')).status).toBe(410);
  });

  it('404s an unknown article address on the guide shell', async () => {
    const res = await fetchPath('/wiki/item/x');
    expect(res.status).toBe(404);
    expect(res.body).toBe('SHELL:guide');
    expect((await fetchPath('/wiki/bogus')).status).toBe(404);
  });

  it('keeps a Guide route on its shell with 200', async () => {
    const res = await fetchPath('/wiki/classes/warrior');
    expect(res.status).toBe(200);
    expect(res.body).toBe('SHELL:guide');
  });

  it('serves the wiki sitemap as XML', async () => {
    const res = await fetchPath('/sitemap-wiki.xml');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/xml; charset=utf-8');
  });
});
