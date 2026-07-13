import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { headerMarkup, mountSharedMarketingHeader } from '../src/ui/shared_marketing_header';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const publicNavIds = [
  'nav-btn-play',
  'nav-btn-highscores',
  'nav-btn-wiki',
  'nav-btn-patch-notes',
  'nav-btn-news',
  'nav-btn-community-built',
  'nav-btn-download',
  'nav-btn-login',
];

describe('shared marketing header', () => {
  it('renders the same public navigation from one source for home and Community', () => {
    const home = headerMarkup('play');
    const community = headerMarkup('community');

    for (const id of publicNavIds) {
      expect(home.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1);
      expect(community.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1);
    }

    const homeCurrent = home.match(/<a[^>]+id="nav-btn-play"[^>]*>/)?.[0] ?? '';
    const communityCurrent =
      community.match(/<a[^>]+id="nav-btn-community-built"[^>]*>/)?.[0] ?? '';
    expect(homeCurrent).toContain('aria-current="page"');
    expect(communityCurrent).toContain('aria-current="page"');
    expect(home).toContain('id="nav-item-account" hidden');
    expect(home).toContain('id="nav-item-logout" hidden');
    for (const header of [home, community]) {
      expect(header.match(/data-homepage-music-toggle/g)).toHaveLength(2);
      expect(header).toContain('id="homepage-music-toggle"');
      expect(header).toContain('id="homepage-music-toggle-mobile"');
    }
  });

  it('mounts the homepage through the same shared-header placeholder', () => {
    const placeholder = { outerHTML: '' };
    const querySelector = vi.fn((selector: string) => {
      if (selector === '[data-shared-marketing-header]') return placeholder;
      return null;
    });
    vi.stubGlobal('document', { querySelector });

    try {
      mountSharedMarketingHeader({ page: 'play' });
      expect(placeholder.outerHTML).toBe(headerMarkup('play'));
      expect(querySelector).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the shared-header placeholder in both page entries', () => {
    const indexHtml = read('index.html');
    const communityHtml = read('community.html');

    expect(indexHtml).toContain('<div data-shared-marketing-header></div>');
    expect(communityHtml).toContain('<div data-shared-marketing-header></div>');
    expect(indexHtml).not.toContain('<header class="homepage-header">');
    expect(communityHtml).not.toContain('<header class="homepage-header">');
  });

  it('keeps page styles out of the shared header cascade', () => {
    const communityCss = read('src/styles/community-page.css');

    expect(communityCss).not.toContain('.homepage-header');
    expect(communityCss).not.toContain('.header-logo-btn');
    expect(communityCss).not.toContain('.nav-link');
    expect(communityCss).not.toContain('.mobile-current-nav-label');
    expect(communityCss).not.toMatch(/^a\s*\{/m);
    expect(communityCss).toContain('main a,\n.community-footer a {');
  });
});
