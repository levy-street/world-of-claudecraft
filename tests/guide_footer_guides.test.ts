// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildChrome } from '../src/guide/chrome';
import { GUIDE_BASE } from '../src/guide/routes';
import { setLanguage } from '../src/ui/i18n';

// The player-guide pages (/mmorpgs/..., /games-like/...) are static pages served
// beside the game, not by it. The wiki footer and the
// homepage footer link the same six, in the same order, so crawlers reach them from the
// game's own pages and players can find them.
const GUIDES = [
  '/mmorpgs/free',
  '/games-like/world-of-warcraft',
  '/mmorpgs/best',
  '/mmorpgs/new',
  '/mmorpgs/browser',
  '/games-like/diablo',
];

describe('player-guide footer links', () => {
  let footer: HTMLElement;

  beforeAll(() => {
    setLanguage('en');
    const mount = document.createElement('div');
    buildChrome(mount, { onLanguageChange: () => {} }, new AbortController().signal);
    footer = mount.querySelector('.guide-footer') as HTMLElement;
  });

  it('renders the six guides in the wiki footer, labelled, in order', () => {
    const nav = footer.querySelector('nav.guide-footer-guides') as HTMLElement;
    expect(nav).not.toBeNull();
    expect(nav.getAttribute('aria-label')).toBe('Player guides');
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(GUIDES);
    expect(links.map((a) => a.textContent)).toEqual([
      'Free MMORPGs',
      'Games like WoW',
      'Best MMORPGs',
      'New MMORPGs',
      'Browser MMORPGs',
      'Games like Diablo',
    ]);
  });

  it('opens the guides in the same tab, outside the wiki router', () => {
    for (const a of footer.querySelectorAll('nav.guide-footer-guides a')) {
      const href = a.getAttribute('href') ?? '';
      expect(a.hasAttribute('target'), href).toBe(false);
      // The guide router only intercepts paths under GUIDE_BASE, so these navigate normally.
      expect(href === GUIDE_BASE || href.startsWith(`${GUIDE_BASE}/`), href).toBe(false);
    }
  });

  it('keeps the existing play and community links untouched', () => {
    const play = footer.querySelector('nav.guide-footer-links:not(.guide-footer-guides)');
    expect(play?.querySelector('a.guide-cta')?.getAttribute('href')).toBe('/play');
  });

  // index.html (/) and play.html (/play) carry the same homepage footer, and both are indexed.
  it.each(['index.html', 'play.html'])(
    'ships the same six links in the %s footer HTML, not injected by script',
    (shell) => {
      const html = readFileSync(path.resolve(process.cwd(), shell), 'utf8');
      const row = html.match(/<nav class="footer-guides-row"[\s\S]*?<\/nav>/)?.[0] ?? '';
      expect(row).toContain('aria-label="Player guides"');
      expect(row).toContain('data-i18n-aria="footer.guidesLabel"');
      expect([...row.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(GUIDES);
    },
  );
});
