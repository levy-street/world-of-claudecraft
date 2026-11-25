// Builds the whole static encyclopedia from the committed seed and audits every page the
// way Lighthouse's SEO category does (title, description, canonical, crawlable links with
// descriptive text, image alt text, no noindex, valid structured data), plus the two
// promises a static wiki makes: every in-wiki link resolves, and every published address
// is pinned in mediawiki/site_paths.json so a page never moves.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite, readRegistry } from '../scripts/wiki_site/build.mjs';
import { HOME_PATH, registryDrift } from '../scripts/wiki_site/paths.mjs';
import { cacheControlFor } from '../server/static_cache';
import { matchRoute } from '../src/guide/routes';

// Lighthouse's link-text audit rejects these as non-descriptive (English list).
const GENERIC_LINK_TEXT = new Set([
  'click here',
  'click this',
  'go',
  'here',
  'information',
  'learn more',
  'more',
  'more info',
  'more information',
  'right here',
  'read more',
  'see more',
  'start',
  'this',
]);

type Built = Awaited<ReturnType<typeof buildSite>>;
let outDir = '';
let built: Built;
const pages = new Map<string, string>();

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'woc-wiki-audit-'));
  built = await buildSite({
    seedFile: 'mediawiki/seed/pages.xml',
    outDir,
    log: () => {},
  });
  for (const file of walk(join(outDir, 'wiki'))) {
    const path =
      '/' +
      relative(outDir, file)
        .split(sep)
        .join('/')
        .replace(/\/index\.html$/, '');
    pages.set(path, readFileSync(file, 'utf8'));
  }
}, 300_000);

// Removing about 5,500 page folders is slow on a busy Windows machine.
afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
}, 300_000);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('static encyclopedia', () => {
  it('writes one page per article, the home page included', () => {
    expect(pages.size).toBe(built.written);
    expect(pages.has(HOME_PATH)).toBe(true);
    expect(built.broken.size).toBe(0);
  });

  it('pins every published address (run npm run wiki:paths after content changes)', () => {
    const drift = registryDrift(built.paths, readRegistry());
    expect(drift.added, 'pages without a pinned address').toEqual([]);
    expect(drift.missing, 'pinned pages that are gone and have no redirect').toEqual([]);
  });

  it('gives every page a unique title, a description and its own canonical address', () => {
    const titles = new Map<string, string>();
    for (const [path, html] of pages) {
      expect(html.startsWith('<!doctype html>\n<html lang="en">'), path).toBe(true);
      expect(html, path).toContain('<meta name="viewport" content="width=device-width');
      expect(html.match(/<title>/g), path).toHaveLength(1);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
      expect(titles.get(title), `${path} repeats the title of ${titles.get(title)}`).toBe(
        undefined,
      );
      titles.set(title, path);
      const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? '';
      expect(description.length, path).toBeGreaterThanOrEqual(50);
      expect(description.length, path).toBeLessThanOrEqual(170);
      expect(html, path).toContain(
        `<link rel="canonical" href="https://worldofclaudecraft.com${path}">`,
      );
      expect(html, path).not.toMatch(/noindex/);
    }
  });

  it('carries valid structured data with a breadcrumb trail', () => {
    for (const [path, html] of pages) {
      const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
      expect(json, path).toBeTruthy();
      const graph = JSON.parse(json as string)['@graph'];
      expect(graph[0].url, path).toBe('https://worldofclaudecraft.com' + path);
      const trail = graph[1].itemListElement;
      expect(trail.at(-1).item, path).toBe('https://worldofclaudecraft.com' + path);
    }
  });

  it('only links to pages that exist, with descriptive text', () => {
    const problems: string[] = [];
    for (const [path, html] of pages) {
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        const href = m[1].match(/\shref="([^"]*)"/)?.[1];
        if (href === undefined || href === '' || href.startsWith('javascript:')) {
          problems.push(`${path}: anchor without a crawlable href`);
          continue;
        }
        const label = text(m[2]) || m[1].match(/aria-label="([^"]*)"/)?.[1] || '';
        if (!label || GENERIC_LINK_TEXT.has(label.toLowerCase()))
          problems.push(`${path}: link text "${label}" for ${href}`);
        if (href.startsWith('#')) {
          if (!ids.has(decodeURIComponent(href.slice(1))))
            problems.push(`${path}: in-page link ${href} has no target`);
          continue;
        }
        const url = new URL(href, 'https://worldofclaudecraft.com' + path);
        if (url.origin !== 'https://worldofclaudecraft.com') continue;
        if (!url.pathname.startsWith('/wiki')) continue;
        if (!pages.has(url.pathname) && !matchRoute(url.pathname))
          problems.push(`${path}: link to ${url.pathname} resolves to nothing`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('gives every picture alt text and the page picture a description', () => {
    const problems: string[] = [];
    for (const [path, html] of pages) {
      for (const m of html.matchAll(/<img\b[^>]*>/g)) {
        if (!/\salt="/.test(m[0])) problems.push(`${path}: ${m[0].slice(0, 80)}`);
        if (/data-game-art=/.test(m[0])) problems.push(`${path}: unresolved picture`);
      }
      const art = html.match(/<img class="article-art[^>]*>/)?.[0];
      if (art && /\salt=""/.test(art)) problems.push(`${path}: page picture without alt`);
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('writes the data files the server caches and the redirect table it reads', () => {
    // The server caches only names that match its hashed pattern (server/static_cache.ts).
    for (const url of [built.searchUrl, built.cardsUrl]) {
      expect(url).toMatch(/^\/encyclopedia-data\/(search|cards)\.[a-f0-9]{10}\.json$/);
      expect(cacheControlFor(url)).toContain('immutable');
      expect(JSON.parse(readFileSync(join(outDir, url), 'utf8'))).toBeTruthy();
    }
    const search = JSON.parse(readFileSync(join(outDir, built.searchUrl), 'utf8'));
    expect(search.length).toBe(pages.size - 1);
    for (const [, path] of search) expect(pages.has(path), path).toBe(true);
    const redirects = JSON.parse(
      readFileSync(join(outDir, 'encyclopedia-data/redirects.json'), 'utf8'),
    );
    const registry = readRegistry();
    expect(Object.keys(redirects).sort()).toEqual(Object.keys(registry.redirects).sort());
    for (const target of Object.values(redirects))
      if (target !== null) expect(pages.has(target as string), String(target)).toBe(true);
  });

  it('lists exactly the built pages in sitemap-wiki.xml', () => {
    const xml = readFileSync(join(outDir, 'sitemap-wiki.xml'), 'utf8');
    const listed = [...xml.matchAll(/<loc>https:\/\/worldofclaudecraft\.com([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    expect(new Set(listed)).toEqual(new Set(pages.keys()));
  });

  it('keeps no reader hash links and does not ship the 30 MB seed to readers', () => {
    for (const [path, html] of pages) {
      const stray = html.match(/href="#(?!part-|section-|view")[^"]*"/);
      expect(stray?.[0], path).toBeUndefined();
      expect(html, path).not.toContain('pages.xml');
    }
  });
});
