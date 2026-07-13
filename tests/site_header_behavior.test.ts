import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headerMarkup } from '../src/ui/shared_marketing_header';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = read('index.html');
const playHtml = read('play.html');
const mainTs = read('src/main.ts');
const marketingMusicTs = read('src/ui/marketing_music.ts');
const sharedHeader = read('src/ui/shared_marketing_header.ts');
const headerCss = read('src/styles/site-header.css');
const communityHtml = read('community.html');
const communityPageTs = read('src/ui/community_page.ts');
const communityCss = read('src/styles/community-page.css');
const renderedPlayHeader = headerMarkup('play');

const entries = [['index.html', indexHtml, renderedPlayHeader]] as const;

describe('shared AAA site header behavior', () => {
  it('loads the final shared header sheet and exposes matching compact and drawer controls', () => {
    expect(playHtml).toContain('<div data-shared-marketing-header></div>');
    expect(indexHtml).toContain('<div data-shared-marketing-header></div>');
    expect(mainTs).toContain("mountSharedMarketingHeader({ page: 'play' });");
    expect(sharedHeader).toContain("type SharedHeaderPage = 'play' | 'community';");
    expect(sharedHeader).toContain('<header class="homepage-header">');
    expect(sharedHeader).toContain('<div class="header-menu-scrim" aria-hidden="true"></div>');
    expect(sharedHeader).toContain("${navLink('nav-btn-community-built'");
    expect(sharedHeader).toContain("${menuButton('nav-btn-wiki'");
    for (const [name, entry, renderedHeader] of entries) {
      const headerSheet = entry.indexOf('href="/src/styles/site-header.css"');
      expect(headerSheet, name).toBeGreaterThan(entry.indexOf('href="/src/styles/site-news.css"'));
      if (name === 'index.html') {
        expect(headerSheet, name).toBeGreaterThan(
          entry.indexOf('href="/src/styles/social-tray.css"'),
        );
      }
      expect(entry.match(/href="\/src\/styles\/site-header\.css"/g), name).toHaveLength(1);

      const headerStart = renderedHeader.indexOf('<header class="homepage-header">');
      const headerEnd = renderedHeader.indexOf('</header>', headerStart);
      const header = renderedHeader.slice(headerStart, headerEnd);
      expect(headerStart, name).toBeGreaterThan(-1);
      expect(headerEnd, name).toBeGreaterThan(headerStart);
      expect(renderedHeader.slice(headerEnd), name).toContain(
        '<div class="header-menu-scrim" aria-hidden="true"></div>',
      );
      expect(header, name).toContain(
        '<span class="mobile-current-nav-label" id="mobile-current-nav-label" aria-hidden="true" data-i18n="nav.play">Play</span>',
      );

      const compact = header.match(
        /<button[^>]+class="homepage-music-btn homepage-music-btn--compact"[^>]+>[\s\S]*?<\/button>/,
      )?.[0];
      expect(compact, name).toContain('id="homepage-music-toggle-mobile"');
      expect(compact, name).toContain('data-homepage-music-toggle');
      expect(compact, name).toContain('data-i18n-title="hud.options.music"');
      expect(compact, name).toContain('data-i18n-aria="hud.options.music"');
      expect(compact, name).toContain('header-control-icon--music-on');
      expect(compact, name).toContain('header-control-icon--music-muted');
      expect(compact, name).not.toContain('data-icon=');

      const drawer = header.match(
        /<button[^>]+class="homepage-music-btn homepage-music-btn--drawer"[^>]+>[\s\S]*?<\/button>/,
      )?.[0];
      expect(drawer, name).toContain('id="homepage-music-toggle"');
      expect(drawer, name).toContain('data-homepage-music-toggle');
      expect(drawer, name).toContain('header-control-icon--music-on');
      expect(drawer, name).toContain('header-control-icon--music-muted');
      expect(drawer, name).not.toContain('data-icon=');

      const menuToggle = header.match(
        /<button[^>]+class="mobile-menu-toggle"[^>]+>[\s\S]*?<\/button>/,
      )?.[0];
      expect(menuToggle, name).toContain('aria-controls="header-menu-container"');
      expect(menuToggle, name).toContain('header-control-icon--menu');
      expect(menuToggle, name).toContain('header-control-icon--close');
      expect(menuToggle, name).not.toContain('hamburger-bar');
      expect(header.match(/data-homepage-music-toggle/g), name).toHaveLength(2);
      expect(header, name).toMatch(
        /<a class="nav-link" id="nav-btn-community-built" href="\/community">[\s\S]*?data-i18n="nav.communityBuilt">Community Built<\/span>/,
      );
      expect(header, name).toMatch(
        /<li class="nav-item nav-item-login">\s*<button[^>]+id="nav-btn-login"/,
      );
    }
  });

  it('removes marketing navigation from every character-selection panel', () => {
    for (const panel of ['charselect-panel', 'charcreate-panel', 'offline-select']) {
      expect(headerCss).toContain(`body[data-start-panel="${panel}"] .homepage-header`);
      expect(headerCss).toContain(`body[data-start-panel="${panel}"] .header-menu-scrim`);
    }
    expect(mainTs).toContain('if (isCharacterPanel) setHomepageMenuOpen(false);');
  });
  it('keeps the compact current-page label synchronized with the active localized nav item', () => {
    const currentStart = mainTs.indexOf('function setHeaderNavCurrent(');
    const currentEnd = mainTs.indexOf('function setHomepageMenuOpen', currentStart);
    const currentSync = mainTs.slice(currentStart, currentEnd);

    expect(currentSync).toContain("currentKind: 'page' | 'location' = 'page'");
    expect(currentSync).toContain("link.setAttribute('aria-current', currentKind)");
    expect(currentSync).toContain("document.getElementById('mobile-current-nav-label')");
    expect(currentSync).toContain("activeLink.querySelector<HTMLElement>('.nav-link-label')");
    expect(currentSync).toContain(
      "mobileCurrentNavLabel.textContent = activeLabel?.textContent?.trim() ?? '';",
    );
    expect(currentSync).toContain('const i18nKey = activeLabel?.dataset.i18n;');
    expect(currentSync).toContain('mobileCurrentNavLabel.dataset.i18n = i18nKey;');
    expect(currentSync).toContain('delete mobileCurrentNavLabel.dataset.i18n;');
  });

  it('uses one synchronized music state for both rendered controls', () => {
    const musicStart = marketingMusicTs.indexOf('function syncMarketingMusicToggle(): void');
    const musicEnd = marketingMusicTs.indexOf('export function fadeOutMarketingMusic', musicStart);
    const musicWiring = marketingMusicTs.slice(musicStart, musicEnd);

    expect(
      musicWiring.match(/querySelectorAll<HTMLButtonElement>\('\[data-homepage-music-toggle\]'\)/g),
    ).toHaveLength(2);
    expect(musicWiring).toContain("btn.classList.toggle('is-muted', marketingMusicMuted);");
    expect(musicWiring).toContain(
      "btn.setAttribute('aria-pressed', String(!marketingMusicMuted));",
    );
    expect(marketingMusicTs).toContain(
      "document.querySelectorAll<HTMLButtonElement>('[data-homepage-music-toggle]')",
    );
    expect(musicWiring).toContain('buttons.forEach((btn) => {');
    expect(musicWiring).toContain('setMarketingMusicMuted(!marketingMusicMuted);');
    expect(mainTs).toContain('initMarketingMusic();');
    expect(mainTs).toContain('fadeOutMarketingMusic();');
    expect(communityPageTs).toContain('initMarketingMusic();');
  });

  it('measures translated disclosure labels and restores focus when outside press closes it', () => {
    expect(mainTs).toContain("'(max-width: 1151px)'");

    const headerSetupStart = mainTs.indexOf('// Mobile menu toggle setup');
    const headerSetupEnd = mainTs.indexOf(
      '// Dynamically initialize background embers',
      headerSetupStart,
    );
    const headerSetup = mainTs.slice(headerSetupStart, headerSetupEnd);

    const resetIndex = headerSetup.indexOf("headerMenu.classList.remove('is-single-column');");
    const measureIndex = headerSetup.indexOf(
      'visibleNavLinks.some((link) => link.scrollWidth > link.clientWidth)',
    );
    expect(resetIndex).toBeGreaterThan(-1);
    expect(measureIndex).toBeGreaterThan(resetIndex);
    expect(headerSetup).toContain('syncHomepageDrawerViewportTop(homepageHeader);');
    expect(headerSetup).not.toContain('if (window.innerWidth <= 340) {');
    expect(headerSetup).toContain("homepageHeader.classList.remove('is-nav-condensed');");
    expect(headerSetup).toContain(
      "homepageHeader.classList.toggle('is-nav-condensed', needsCondensed);",
    );
    expect(headerSetup).toContain('navList.scrollWidth > homepageNav.clientWidth');
    expect(headerSetup).toContain('headerMenu.classList.toggle(');
    expect(headerSetup).toContain("window.getComputedStyle(link).display !== 'none'");
    expect(headerSetup).toContain(
      'setHomepageMenuOpen(false, headerMenu.contains(document.activeElement));',
    );
    expect(headerSetup).toContain("mobileMenuToggle.matches(':focus-visible')");
    expect(headerSetup).toContain(".nav-link[aria-current]')?.focus()");
    expect(mainTs).toContain("document.body.classList.toggle('site-header-menu-open', open)");
    expect(mainTs).toContain('setHomepageMenuOpen(false, false);');
    expect(mainTs).toContain('heading.focus({ preventScroll: true })');
    expect(mainTs).toContain("destination?.querySelector<HTMLElement>('h1, h2')");
    expect(headerSetup).toContain(
      "window.addEventListener('resize', scheduleHomepageMenuMeasurement, { passive: true });",
    );
    expect(headerSetup).toContain(
      "document.addEventListener('woc:languagechange', scheduleHomepageMenuMeasurement);",
    );
    expect(headerSetup).toContain("homepageMenuMedia.addEventListener('change', () => {");
    expect(headerSetup).toContain('new MutationObserver(scheduleHomepageMenuMeasurement)');
    expect(headerSetup).toContain('document.fonts.ready.then(scheduleHomepageMenuMeasurement)');
    expect(headerSetup).toContain("attributeFilter: ['hidden']");
    expect(headerSetup).toContain('characterData: true');
    expect(headerSetup).toContain('childList: true');
    expect(headerSetup).toContain('subtree: true');
    expect(mainTs).toMatch(
      /header\.style\.setProperty\('--site-header-drawer-viewport-top', `\$\{headerBottom\}px`\);/,
    );
  });

  it('routes Community Built to its authored recruitment page', () => {
    expect(renderedPlayHeader).toContain('id="nav-btn-community-built" href="/community"');
    expect(mainTs).toContain("window.location.href = '/community';");
    expect(mainTs).not.toContain("window.location.href = '/#community-built';");
    expect(communityHtml).toContain(
      '<h1 id="recruit-title"><span>ClaudeCraft</span> Wants You</h1>',
    );
    expect(communityHtml).toContain('/site/community-wants-you-poster-v1.webp');
    expect(communityHtml).toContain('https://github.com/levy-street/world-of-claudecraft');
    expect(communityHtml).toContain('https://discord.com/invite/worldofclaudecraft');
    expect(communityHtml).toContain('Help us build the biggest community MMO in the world');
    expect(communityCss).toContain('container-type: inline-size;');
    expect(communityCss).toContain('font-size: clamp(24px, 9.5cqi, 36px);');
    expect(communityCss).toContain('white-space: nowrap;');
    expect(communityCss).toContain('--poster-caption-clearance: clamp(88px, 25cqi, 96px);');
    expect(communityCss).toContain('bottom: var(--poster-caption-clearance);');
    expect(communityCss).not.toContain('.recruit-poster::before');
  });
});
