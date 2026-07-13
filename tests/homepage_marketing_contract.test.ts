import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headerMarkup } from '../src/ui/shared_marketing_header';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const sha256 = (path: string): string =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
const html = read('index.html');
const playHtml = read('play.html');
const mainTs = read('src/main.ts');
const landingTwitchTs = read('src/ui/landing_twitch.ts');
const homepageCss = read('src/styles/homepage.css');
const shellCss = read('src/styles/shell.css');
const siteNewsCss = read('src/styles/site-news.css');
const sharedMarketingHeaderTs = read('src/ui/shared_marketing_header.ts');
const sharedPlayHeader = headerMarkup('play');
const communityCss = read('src/styles/community-quest-cards.css');
const forgedCommunityCss = read('src/styles/community-forged-ui.css');
const realmDataCss = read('src/styles/realm-data-pages.css');

const APP_STORE = 'https://apps.apple.com/app/world-of-claudecraft/id6782569061';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=com.worldofclaudecraft';
const TWITCH_CHANNEL = 'https://www.twitch.tv/claudeplaysclaudecraft';
const TWITCH_CATEGORY = 'https://www.twitch.tv/directory/category/world-of-claudecraft';

describe('AAA homepage marketing contract', () => {
  it('preserves every launcher hook that the game flow depends on', () => {
    for (const id of [
      'hero-view',
      'mode-select',
      'server-select',
      'server-select-trigger',
      'server-select-menu',
      'btn-play',
      'btn-online',
      'btn-offline',
      'login-panel',
      'realm-panel',
      'charselect-panel',
      'offline-select',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('uses the canonical emblem for every compact brand placement', () => {
    const canonicalEmblem = '/woc-logo-square-320-v1.webp';
    const retiredEmblem = '/woc-logo-square-96-v1.webp';
    const brandedSources = [
      html,
      mainTs,
      homepageCss,
      siteNewsCss,
      sharedMarketingHeaderTs,
      ...[
        'public/data-deletion.html',
        'public/cookies.html',
        'public/terms.html',
        'public/support.html',
        'public/privacy.html',
      ].map(read),
    ];

    expect(html.match(/woc-logo-square-320-v1\.webp/g)).toHaveLength(1);
    expect(sharedPlayHeader).toContain(canonicalEmblem);
    expect(mainTs).toContain(canonicalEmblem);
    expect(homepageCss).toContain(canonicalEmblem);
    expect(siteNewsCss).toContain(canonicalEmblem);
    expect(sharedMarketingHeaderTs).toContain(canonicalEmblem);
    for (const source of brandedSources) {
      expect(source).not.toContain(retiredEmblem);
    }

    const assetPath = join(root, 'public', 'woc-logo-square-320-v1.webp');
    expect(existsSync(assetPath)).toBe(true);
    expect(statSync(assetPath).size).toBeLessThan(80_000);
    expect(sha256('public/icon-512.png')).toBe(
      'fb512dcd98f148017b50648448d8ac8ac5bd9f9628ee6c5fbbd129ae0a6377d5',
    );
    expect(sha256('public/woc-logo-square-320-v1.webp')).toBe(
      'a9fd624cbae7f8e48fa521e5c90eb6f53238262052dc717e05440bd69cfbf787',
    );
    expect(sha256('public/woc_logo_square.webp')).toBe(
      '19d536694d900b140f5af7e16fb0245b158814334bbdc0f4b83ec8dab5ce3ec8',
    );
  });

  it('keeps both launcher faces in one stable slot and uses explicit foreground grip layers', () => {
    expect(mainTs).toContain("launcherSlot.className = 'play-module-slot'");
    expect(mainTs).toContain("launcherCard.className = 'play-module-card'");
    expect(mainTs).toContain('launcherCard.append(homepageModePanel, homepageLoginPanel)');
    expect(mainTs).toContain('launcherSlot.append(launcherCard)');
    expect(mainTs).toContain("launcherSlot.dataset.peekFace = 'mode'");
    expect(mainTs).toContain("peek.classList.add('play-module-peek--launcher')");
    expect(mainTs).toContain('launcherSlot.append(...launcherPeeks)');
    expect(mainTs).toContain("'play-module-login-back',");
    expect(mainTs).toContain("loginContent.className = 'play-module-login-content'");
    expect(mainTs).toContain("loginFooter.className = 'play-module-login-footer'");
    expect(homepageCss).toContain('.site-hero-stage .play-module-slot');
    expect(homepageCss).toContain('.play-module-slot.is-flipping .play-module-card');
    expect(homepageCss).not.toContain('launcher-card-glint');
    expect(homepageCss).toContain('.play-module-slot[data-peek-face="login"]');
    expect(mainTs).toContain('setLauncherFaceActive(launcherLoginPanel, showLogin)');
    expect(mainTs).toContain('focusPanelTarget(el)');
    expect(mainTs).toContain('cancelLauncherFlip = () => finishLauncherFlip(false)');
    expect(mainTs).not.toContain('isFlatMobileLauncher');
    expect(mainTs).toContain("if (heroView?.hasAttribute('hidden')) {");
    expect(mainTs).toContain("startScreen.style.scrollBehavior = 'auto';");
    expect(mainTs).toContain('startScreen.scrollTop += delta;');
    expect(mainTs).toContain('startScreen.style.scrollBehavior = previousScrollBehavior;');
    expect(mainTs).not.toContain(
      'Math.max(launcherSlot.getBoundingClientRect().top, headerClearance)',
    );
    expect(homepageCss).toContain('stable launcher anchor');
    expect(homepageCss).toContain('[data-start-panel="login-panel"] .site-hero-stage {');
    expect(homepageCss).not.toContain(
      '[data-start-panel="mode-select"] .site-hero-stage .play-module-slot',
    );
    expect(html).toContain('play-module-peek--skeleton-grip');
    expect(html).not.toContain('play-module-peek--warrior-grip');
    expect(homepageCss).toContain('[data-start-panel="login-panel"] .site-hero-stage');
    expect(homepageCss).toContain('#login-panel.play-module-login-back');
    expect(homepageCss).toContain(
      ':not([data-start-panel="mode-select"]):not([data-start-panel="login-panel"]) .site-story,',
    );
    expect(homepageCss).not.toContain(
      'body[data-site-home="true"]:not([data-start-panel="mode-select"]) .site-story,',
    );
    const mobilePregameShell =
      shellCss
        .split('/* ---------- Mobile pre-game chrome compaction')[1]
        ?.split('/* ---------- Online character-select')[0] ?? '';
    expect(mobilePregameShell).not.toContain('[data-start-panel="login-panel"]');
    expect(mobilePregameShell).toContain('[data-start-panel="discord-choice-panel"]');
    expect(mobilePregameShell).toContain('[data-start-panel="charselect-panel"]');
    expect(homepageCss).toContain('.server-select-option[data-mode="online"]');
    expect(homepageCss).toContain('.server-select-option[data-mode="offline"]');
    const mobileLauncherCss =
      homepageCss.split('/* Mobile launcher quality pass: lightweight 3D compositing')[1] ?? '';
    expect(mobileLauncherCss).toContain('perspective: 1200px;');
    expect(mobileLauncherCss).toContain('transform-style: preserve-3d;');
    expect(mobileLauncherCss).toContain('backface-visibility: hidden;');
    expect(mobileLauncherCss).toContain(
      'transition: transform 540ms cubic-bezier(0.65, 0, 0.35, 1);',
    );
  });

  it('aligns the generated contract plaque artwork with the desktop hero copy', () => {
    expect(homepageCss).toContain('width: calc(100% + 28px);');
    expect(homepageCss).toContain('max-width: 548px;');
    expect(homepageCss).toContain('margin-left: -14px;');
  });

  it('uses a clean non-ghosted contract copy confirmation on mobile', () => {
    const copiedState =
      homepageCss.split('/* Mobile copy confirmation: swap the text cleanly')[1] ?? '';
    expect(copiedState).toContain('transition: none;');
    expect(copiedState).toContain('visibility: hidden;');
    expect(copiedState).toContain('opacity: 0;');
    expect(copiedState).toContain('visibility: visible;');
    expect(copiedState).toContain('transform: none;');
  });

  it('uses the mobile narrative order for the tablet hero without flattening the launcher', () => {
    const tabletFlow = (
      homepageCss.split('/* Tablet hero composition: preserve the full launcher interaction')[1] ??
      ''
    ).replace(/\r\n/g, '\n');
    expect(tabletFlow).toContain('@media (min-width: 621px) and (max-width: 1279px)');
    expect(tabletFlow).toContain('.site-hero-copy {\n    display: contents;');
    expect(tabletFlow).toContain('#title-logo {\n    grid-column: 1;\n    grid-row: 1;');
    expect(tabletFlow).toContain(
      '.site-hero-stage .play-module-slot {\n    grid-column: 1;\n    grid-row: 2;',
    );
    expect(tabletFlow).toContain('.site-hero-heading {\n    grid-column: 1;\n    grid-row: 3;');
    expect(tabletFlow).toContain(
      '#token-ca.site-hero-contract {\n    grid-column: 1;\n    grid-row: 5;',
    );
    expect(tabletFlow).toContain('.play-module-frame {\n    filter: none !important;');
    expect(tabletFlow).toContain('aspect-ratio: 1833 / 681;');
    expect(tabletFlow).toContain('aspect-ratio: 2027 / 255;');
    expect(tabletFlow).not.toContain('perspective: none;');
    expect(tabletFlow).not.toContain('transition: none;');
  });

  it('keeps the contract address in one horizontal asset-shaped rail at every width', () => {
    const sharedRail =
      homepageCss.split('/* Keep the contract address as one asset-shaped horizontal rail')[1] ??
      '';
    expect(sharedRail).toContain('grid-template-columns: 20px minmax(0, 1fr) 20px;');
    expect(sharedRail).toContain('grid-column: 2;');
    expect(sharedRail).toContain('text-align: center;');
    expect(sharedRail).toContain('aspect-ratio: 2027 / 255;');
  });

  it('uses the shared play-page styling for the homepage server selector', () => {
    const sharedSelectorCss =
      homepageCss
        .split(
          '/* Keep the homepage placement, but use the shared play-page control styling. */',
        )[1]
        ?.split('@layer index-extra')[0] ?? '';
    expect(sharedSelectorCss).toContain(
      'background: linear-gradient(180deg, rgba(24, 24, 34, 0.92)',
    );
    expect(sharedSelectorCss).toContain('border-radius: var(--radius-md)');
    expect(sharedSelectorCss).toContain('@media (max-width: 620px)');
    expect(sharedSelectorCss).toContain('height: 8.5%');
    expect(sharedSelectorCss).not.toContain('.server-stat-line.is-unavailable > span');
  });

  it('ships exact iOS and Android destinations as secure external links', () => {
    for (const href of [APP_STORE, GOOGLE_PLAY]) {
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const anchors = html.match(new RegExp(`<a[^>]+href="${escaped}"[^>]*>`, 'g')) ?? [];
      expect(anchors).toHaveLength(2);
      for (const anchor of anchors) {
        expect(anchor).toContain('target="_blank"');
        expect(anchor).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it('renders Steam as a noninteractive coming-soon surface', () => {
    const standardSteamCards = html.match(
      /<div class="site-platform-card[^"]*site-platform-card--disabled[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    );
    const launcherSteamCards = html.match(
      /<div class="play-module-platform play-module-platform--disabled"[^>]*>[\s\S]*?<\/div>/g,
    );
    expect(standardSteamCards).toHaveLength(1);
    expect(launcherSteamCards).toHaveLength(1);
    for (const card of [...(standardSteamCards ?? []), ...(launcherSteamCards ?? [])]) {
      expect(card).not.toContain('href=');
      expect(card).not.toContain('tabindex=');
      expect(card).toContain('landing.comingSoon');
    }
    expect(html).not.toMatch(/<a[^>]+steam\.webp/i);
  });

  it('places the redesigned broadcast directly after the hero and removes the requested blocks', () => {
    const storyStart = html.indexOf('id="world-story"');
    const streamStart = html.indexOf('id="yuumiii-stream"');
    const worldStart = html.indexOf('class="site-section site-world"');
    expect(storyStart).toBeGreaterThan(-1);
    expect(streamStart).toBeGreaterThan(storyStart);
    expect(streamStart).toBeLessThan(worldStart);
    expect(html).not.toContain('class="site-section site-intro"');
    expect(html).not.toContain('class="site-section site-classes"');
    expect(html.match(/id="yuumiii-stream"/g)).toHaveLength(1);
    expect(html).toContain('class="site-stream-console"');
    for (const asset of [
      '/site/yuumiii-cutout.webp',
      '/site/stream-button-live.webp',
      '/site/stream-button-dark.webp',
      '/site/stream-icon-clock.webp',
      '/site/stream-icon-crown.webp',
      '/site/stream-icon-swords.webp',
      '/site/stream-icon-shield.webp',
      '/site/stream-divider.webp',
    ]) {
      expect(`${html}\n${homepageCss}`).toContain(asset);
    }
    expect(html).not.toContain('site-stream-console__corner');
  });

  it('incorporates PR 1511 server availability and total-player semantics', () => {
    for (const entry of [html, playHtml]) {
      expect(entry).toContain('Select server mode: Server Online or Server Offline');
      expect(entry).toContain('aria-labelledby="server-select-value"');
      expect(entry).toContain('data-i18n="mode.serverOnline">Server Online</span>');
      expect(entry).toContain('data-i18n="mode.serverOffline">Server Offline</span>');
      expect(entry.match(/class="server-stat-line"/g)).toHaveLength(2);
      expect(entry).toContain('data-i18n="stats.accountsCreated">Total players</span>');
      expect(entry).not.toContain('data-i18n="stats.accountsCreated">Players</span>');
    }
    expect(mainTs).toContain('formatNumber(cached.accounts_created, { maximumFractionDigits: 0 })');
    expect(mainTs).toContain('formatNumber(data.accounts_created, { maximumFractionDigits: 0 })');
  });
  it('keeps Twitch lazy while providing direct and unavailable paths', () => {
    expect(html).toContain('id="yuumiii-player"');
    expect(html).toContain('<button type="button" class="site-stream-mobile-portal"');
    expect(html).not.toContain('<a class="site-stream-mobile-portal"');
    expect(html).toContain('aria-controls="yuumiii-player"');
    expect(html).toContain('src="/site/stream-play-inline.svg"');
    expect(html).toContain('class="site-stream-mobile-external"');
    expect(html).not.toContain('site-stream-action--explore');
    expect(html).toContain(`href="${TWITCH_CHANNEL}"`);
    expect(html).toContain(`href="${TWITCH_CATEGORY}"`);
    expect(html).toContain('data-stream-copy="offline"');
    expect(html).toContain('data-stream-copy="unavailable"');
    expect(html).not.toContain('player.twitch.tv/?');
    expect(html).not.toMatch(/<iframe/i);
    expect(mainTs).toContain('initLandingTwitch({');
    expect(mainTs).toContain(
      "privacyAllowed: DESKTOP_APP || NATIVE_APP || privacyConsent.allowed('twitch')",
    );
    expect(homepageCss).toContain('.site-stream-mobile-portal');
    expect(homepageCss).toMatch(
      /#yuumiii-stream \.site-stream-mobile-external \{[\s\S]*?box-sizing: border-box;/,
    );
    expect(homepageCss).toContain('width: calc(100% - 12px);');
    expect(homepageCss).toContain('margin: 12px 6px 6px;');
    expect(homepageCss).toContain(
      'linear-gradient(180deg, #f4d98d, #b57b26 58%, #6a3d0c) border-box;',
    );
    const mobileTwitchStart = homepageCss.indexOf('/* Definitive mobile Twitch flow');
    const mobileTwitchEnd = homepageCss.indexOf('/* Unified Twitch controls', mobileTwitchStart);
    const mobileTwitchCss = homepageCss.slice(mobileTwitchStart, mobileTwitchEnd);
    expect(mobileTwitchStart).toBeGreaterThan(-1);
    expect(mobileTwitchEnd).toBeGreaterThan(mobileTwitchStart);
    expect(mobileTwitchCss).not.toContain(
      '#yuumiii-stream .site-stream-mobile-portal {\n    display: none !important;',
    );
    expect(mobileTwitchCss).toContain('border-color: rgba(180, 112, 226, 0.82) !important;');
    expect(mobileTwitchCss).toContain('0 0 24px rgba(126, 61, 174, 0.34)');
    expect(homepageCss).toContain('#yuumiii-stream[data-stream-inline="true"]');
    expect(mobileTwitchCss).toContain('width: 100% !important;');
    expect(mobileTwitchCss).not.toMatch(/^\s*width: 400px !important;$/m);
    expect(mobileTwitchCss).not.toContain('--site-stream-mobile-scale');
    expect(mobileTwitchCss).not.toContain('zoom:');
    expect(mobileTwitchCss).toContain('#yuumiii-player iframe');
    expect(mobileTwitchCss).toContain('touch-action: auto;');
    expect(mobileTwitchCss).toContain('height: 300px !important;');
    expect(mobileTwitchCss).not.toContain('height: clamp(300px, 115vw, 460px) !important;');
    expect(mobileTwitchCss).toMatch(
      /#yuumiii-stream\[data-stream-playback="playing"\][\s\S]*?\.site-stream-viewport \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 0 !important;[\s\S]*?aspect-ratio: 16 \/ 9 !important;/,
    );
    expect(landingTwitchTs).toContain("mobilePortal?.addEventListener('click'");
    expect(mainTs).toContain('syncLandingPrivacyServices();');
    expect(landingTwitchTs).toContain('initialized.updatePrivacyAllowed(privacyAllowed)');
    expect(landingTwitchTs).toContain('landingTwitchMountMode(decision)');
    expect(landingTwitchTs).toContain("decision === 'mount' || decision === 'compact'");
    expect(landingTwitchTs).not.toContain('streamPrimed');
    expect(landingTwitchTs).not.toContain('requestPlayback');
    expect(landingTwitchTs).toContain('twitch.Player.PLAYING');
    expect(landingTwitchTs).toContain("root.dataset.streamPlayback = 'playing'");
    expect(landingTwitchTs).toContain('autoplay: false');
    expect(landingTwitchTs).not.toContain('playsinline');
    expect(landingTwitchTs).not.toContain('twitch-mobile-gate.html');
    expect(homepageCss).not.toContain('#yuumiii-stream[data-stream-primed="true"]');
    expect(homepageCss).not.toContain('--stream-prime-scale');
    expect(homepageCss).not.toContain('--stream-prime-x');
    expect(homepageCss).not.toContain('pointer-events: none !important;');
    expect(homepageCss).toContain('box-shadow: 0 0 11px rgba(47, 214, 90, 0.9);');
    expect(landingTwitchTs).toContain('requestPrivacyConsent?.() !== true');
    expect(landingTwitchTs).toContain("root.dataset.streamInline = 'true'");
  });
  it('ships a privacy-first News hub with an always-available X fallback in BOTH entries', () => {
    for (const [name, entry, renderedHeader] of [
      ['index.html', html, sharedPlayHeader],
      ['play.html', playHtml, sharedPlayHeader],
    ] as const) {
      expect(entry, name).toContain('href="/src/styles/site-news.css"');
      expect(entry, name).not.toContain('platform.x.com/widgets.js');
      const menuToggle =
        renderedHeader.match(/<button[^>]+id="mobile-menu-toggle"[^>]*>/)?.[0] ?? '';
      expect(menuToggle, name).toContain('aria-controls="header-menu-container"');

      const newsStart = entry.indexOf('id="news-view"');
      const newsEnd = entry.indexOf('id="download-view"', newsStart);
      const newsView = entry.slice(newsStart, newsEnd);
      expect(newsStart, name).toBeGreaterThan(-1);
      expect(newsEnd, name).toBeGreaterThan(newsStart);
      expect(newsView, name).toContain('class="site-news-grid"');
      expect(newsView, name).toContain('id="news-x-card"');
      expect(newsView, name).toContain('data-x-state="consent"');
      expect(newsView, name).toContain('class="site-news-card site-news-card--blog"');
      expect(newsView, name).toContain('class="site-blog-list"');
      expect(newsView, name).toContain('class="site-press-story"');
      expect(newsView, name).not.toContain('role="list"');
      expect(newsView, name).not.toContain('role="listitem"');
      expect(newsView.match(/<article\b/g) ?? [], name).toHaveLength(1);
      expect(newsView, name).toContain('rel="noopener noreferrer nofollow"');
      expect(newsView, name).toContain(
        'https://www.mmorpg.com/news/the-first-vibe-coded-mmorpg-is-free-open-source-and-surprisingly-complete-2000138347',
      );

      const timeline = newsView.match(/<a class="twitter-timeline"[\s\S]*?>/)?.[0] ?? '';
      expect(timeline, name).toContain('href="https://x.com/WoClaudecraft"');
      expect(timeline, name).toContain('data-theme="dark"');
      expect(timeline, name).toContain('data-dnt="true"');
      expect(timeline, name).toContain('data-height="640"');
      expect(timeline, name).toContain('target="_blank"');
      expect(timeline, name).toContain('rel="noopener noreferrer"');
      expect(timeline, name).toContain('data-i18n-aria="landing.newsXOpenAria"');

      const fallback = newsView.match(/<a id="news-x-permanent-fallback"[\s\S]*?>/)?.[0] ?? '';
      expect(fallback, name).toContain('href="https://x.com/WoClaudecraft"');
      expect(fallback, name).toContain('target="_blank"');
      expect(fallback, name).toContain('rel="noopener noreferrer"');
      expect(fallback, name).toContain('data-i18n-aria="landing.newsXOpenAria"');

      expect(newsView, name).toContain('data-i18n="landing.newsXConsentTitle"');
      expect(newsView, name).toContain('data-i18n="landing.newsXConsentBody"');
      expect(newsView, name).toContain('data-i18n="landing.newsXConsentNote"');
      expect(newsView, name).toContain('data-i18n="landing.newsXPrivacyChoices"');
      expect(newsView, name).toContain('id="news-x-privacy"');
      expect(newsView, name).not.toContain('id="news-x-load"');
      expect(newsView, name).toContain('data-i18n="landing.newsXLoading"');
      expect(newsView, name).toContain('data-i18n="landing.newsXUnavailableTitle"');
      expect(newsView, name).toContain('data-i18n="landing.newsXUnavailableBody"');
      expect(newsView, name).toContain('data-i18n="landing.newsXLoaded"');
      expect(newsView, name).toContain('data-i18n="landing.newsXHiddenTitle"');
      expect(newsView, name).toContain('data-i18n="landing.newsXHiddenBody"');
      expect(newsView, name).not.toContain('data-i18n="landing.newsXNewTab"');
    }

    expect(mainTs).toContain("import { initLandingXTimeline } from './ui/landing_x_timeline';");
    expect(mainTs).toContain('const landingXTimeline = initLandingXTimeline({');
    expect(mainTs).toContain("iframeTitle: () => t('landing.newsXIframeTitle')");
    expect(mainTs).toContain('openPrivacyPreferences: () => {');
    expect(mainTs).not.toContain(
      "requestPrivacyConsent: () => privacyConsent.requestCategory('x')",
    );
    expect(mainTs).toContain("if (privacyConsent.allowed('x')) {");
    expect(mainTs).toContain("if (targetId === '#news-view') {");
    expect(mainTs).toContain('requestAnimationFrame(() => landingXTimeline?.load());');
    expect(mainTs).toContain("document.getElementById('site-social-tray-root')");
    expect(mainTs).toContain(
      "if (socialTrayRoot) socialTrayRoot.hidden = targetId === '#account-view';",
    );
  });

  it('renders the realm journey as one responsive cinematic stage', () => {
    const worldStart = html.indexOf('class="site-section site-world"');
    const worldEnd = html.indexOf('</section>', worldStart);
    const worldSection = html.slice(worldStart, worldEnd);

    expect(worldStart).toBeGreaterThan(-1);
    expect(worldSection.match(/<figure class="site-journey-card/g)).toHaveLength(3);
    expect(worldSection).toContain('site-journey-card--primary');
    expect(worldSection).toContain(
      '<source media="(max-width: 620px)" srcset="/site/journey/realm-long-road-mobile-v2.webp',
    );

    const worldBackdrop = worldSection.match(
      /<picture class="site-world__backdrop"[\s\S]*?<\/picture>/,
    )?.[0];
    expect(worldBackdrop).toBeTruthy();
    expect(worldBackdrop).toContain('realm-dawn-cartoon-v2-mobile-v1.webp');
    expect(worldBackdrop).toContain('realm-dawn-cartoon-v2.webp');
    expect(worldBackdrop).toContain('media="(max-width: 1080px)"');
    expect(worldBackdrop).toContain('loading="lazy"');
    expect(worldBackdrop).toContain('decoding="async"');
    expect(worldBackdrop).toContain('fetchpriority="low"');
    expect(worldBackdrop).toContain('aria-hidden="true"');
    expect(worldBackdrop).toContain('alt=""');

    const journeyImages = worldSection.match(/<img[^>]*data-i18n-alt="[^"]+"[^>]*>/g) ?? [];
    expect(journeyImages).toHaveLength(3);
    for (const image of journeyImages) {
      expect(image).toContain('loading="lazy"');
      expect(image).toContain('decoding="async"');
      expect(image).toMatch(/width="\d+"/);
      expect(image).toMatch(/height="\d+"/);
      expect(image).toContain('data-i18n-alt=');
    }

    expect(homepageCss).toContain('grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)');
    expect(homepageCss).toContain('.site-world__backdrop');
    expect(homepageCss).toContain('@media (max-width: 1080px)');
    expect(homepageCss).toContain('@media (max-width: 760px)');
    expect(homepageCss).toContain('margin-top: clamp(96px, 32vw, 180px)');
    expect(homepageCss).toContain('@media (max-width: 620px)');
  });

  it('resets the app scroll container whenever primary views change', () => {
    expect(mainTs).toContain("document.getElementById('start-screen')");
    expect(mainTs).toContain('startScreen.scrollTop = 0');
    expect(mainTs.match(/resetStartScreenScroll()/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('keeps the redesign index-only and leaves the dedicated play entry isolated', () => {
    expect(html).toContain('href="/src/styles/homepage.css"');
    expect(playHtml).not.toContain('homepage.css');
    expect(playHtml).not.toContain('site-story');
  });

  it('renders responsive community quest cards with live copy and optimized art', () => {
    expect(html).toContain('href="/src/styles/community-quest-cards.css"');
    expect(html).toContain('href="/src/styles/community-forged-ui.css"');
    const pictures =
      html.match(/<picture class="site-project-panel__art"[\s\S]*?<\/picture>/g) ?? [];
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) {
      expect(picture).toContain('media="(max-width: 620px)"');
      expect(picture).toContain('loading="lazy"');
      expect(picture).toContain('decoding="async"');
      expect(picture).toContain('alt=""');
      expect(picture).toContain('aria-hidden="true"');
    }
    const backdrop = html.match(
      /<picture class="site-open-support__backdrop"[\s\S]*?<\/picture>/,
    )?.[0];
    expect(backdrop).toBeTruthy();
    expect(backdrop).toContain('media="(max-width: 620px)"');
    expect(backdrop).toContain('community-realm-backdrop-cartoon-v6-mobile.webp');
    expect(backdrop).toContain('community-realm-backdrop-cartoon-v6.webp');
    expect(backdrop).toContain('loading="lazy"');
    expect(backdrop).toContain('fetchpriority="low"');
    expect(backdrop).toContain('aria-hidden="true"');
    expect(html).toContain('aria-labelledby="site-community-title"');
    expect(html).toContain(
      'class="site-section-heading site-section-heading--wide site-open-support__intro"',
    );
    expect(html).toContain('data-i18n="landing.communityEyebrow"');
    expect(html).toContain('data-i18n="landing.communityHeading"');
    expect(html).toContain('data-i18n="landing.communityBody"');
    expect(html).toContain('Host your own world. Bring your friends.');
    expect(html).toContain(
      'host your own private world, and invite your friends to adventure together on a server you control.',
    );
    expect(html).not.toContain('Gymnasium-compatible');
    expect(html).not.toContain('Train an adventurer');
    expect(communityCss).toContain('.site-open-support__intro');
    expect(html).toContain('aria-labelledby="site-open-source-title"');
    expect(html).toContain('aria-labelledby="site-support-title"');
    expect(html).toContain('class="site-community-link--primary"');
    expect(html).toContain('https://discord.com/invite/worldofclaudecraft');
    for (const asset of [
      '/site/community/community-world-forge.webp',
      '/site/community/community-world-forge-mobile.webp',
      '/site/community/community-guild-hall.webp',
      '/site/community/community-guild-hall-mobile.webp',
      '/site/community/community-realm-backdrop-cartoon-v6.webp',
      '/site/community/community-realm-backdrop-cartoon-v6-mobile.webp',
    ]) {
      expect(`${html}\n${communityCss}\n${forgedCommunityCss}`).toContain(asset);
    }
    expect(html).not.toContain('site-project-panel__sigil');
    expect(communityCss).not.toContain('community-sigil-glint');
    expect(communityCss).toContain('--quest-corner-size');
    expect(forgedCommunityCss).toContain('.site-project-link__cue::after');
    expect(communityCss).toContain('@media (max-width: 1180px)');
    expect(communityCss).toContain('@media (max-width: 620px)');
    expect(communityCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(communityCss).toContain('@media (forced-colors: active)');
  });

  it('carries the illustrated journey through a responsive final gate', () => {
    const finalStart = html.indexOf('class="site-section site-final-gate"');
    const finalEnd = html.indexOf('</section>', finalStart);
    const finalSection = html.slice(finalStart, finalEnd);
    const finalBackdrop = finalSection.match(
      /<picture class="site-final-gate__backdrop"[\s\S]*?<\/picture>/,
    )?.[0];

    expect(finalStart).toBeGreaterThan(-1);
    expect(finalBackdrop).toBeTruthy();
    expect(finalBackdrop).toContain('final-moongate-cartoon-v1-mobile.webp');
    expect(finalBackdrop).toContain('final-moongate-cartoon-v1.webp');
    expect(finalBackdrop).toContain('media="(max-width: 760px)"');
    expect(finalBackdrop).toContain('loading="lazy"');
    expect(finalBackdrop).toContain('decoding="async"');
    expect(finalBackdrop).toContain('fetchpriority="low"');
    expect(finalBackdrop).toContain('aria-hidden="true"');
    expect(finalBackdrop).toContain('alt=""');
    expect(homepageCss).toContain('.site-final-gate__backdrop');
    expect(homepageCss).toContain('border-bottom: 1px solid rgba(214, 177, 92, 0.27)');
    expect(communityCss).toContain('border-bottom: 1px solid rgba(214, 177, 92, 0.27)');
  });
  it('has one page heading and complete community destinations', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="site-hero-heading"');
    expect(html).not.toContain('class="site-hero-heading" aria-hidden="true"');
    expect(html).toContain('https://x.com/WoClaudecraft');
    expect(html).toContain('https://github.com/levy-street/world-of-claudecraft');
    expect(html).toContain('https://github.com/sponsors/levy-street');
    expect(html).toContain('https://discord.com/invite/worldofclaudecraft');
    expect(html).toContain('data-trailer-src="/home-bg.mp4"');
  });

  it('publishes mobile availability and Twitch identities in structured data', () => {
    const raw = html.match(
      /<script id="structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(raw).toBeTruthy();
    const graph = JSON.parse(raw ?? '{}')['@graph'] as Array<Record<string, unknown>>;
    const game = graph.find((node) => node['@type'] === 'VideoGame');
    const organization = graph.find((node) => node['@type'] === 'Organization');
    expect(game?.gamePlatform).toEqual(['Web Browser', 'iOS', 'Android']);
    expect(game?.installUrl).toEqual([APP_STORE, GOOGLE_PLAY]);
    expect(game?.sameAs).toContain(TWITCH_CHANNEL);
    expect(organization?.sameAs).toContain(TWITCH_CATEGORY);
    expect(mainTs).toContain("gamePlatform: [t('seo.operatingSystem'), 'iOS', 'Android']");
  });

  it('ships responsive High Scores artwork without shrinking mobile leaderboard rows', () => {
    expect(realmDataCss).toContain('/site/highscores-boar-battle-paladin-v3.webp');
    expect(realmDataCss).toContain('@media (max-width: 900px) and (orientation: portrait)');
    expect(realmDataCss).toContain('/site/highscores-boar-battle-paladin-mobile-v3.webp');
    expect(realmDataCss).toContain('/site/highscores-frame-desktop-v5.webp');
    expect(realmDataCss).toContain('width: min(100%, 830px);');
    expect(realmDataCss).toContain('padding: 8px 6px 8px 8px;');
    expect(realmDataCss).toContain('width: calc(100% - 56px);');
    expect(realmDataCss).toContain('padding: 6px;');
    expect(realmDataCss).toContain('width: calc(100% - 48px);');
    expect(realmDataCss).toContain('/site/highscores-frame-mobile-v5.webp');
    expect(realmDataCss).toContain('flex: 0 0 auto;');
    expect(realmDataCss).toContain('max-height: min(64svh, 760px);');
    expect(realmDataCss).toContain('max-height: 66svh;');
    expect(realmDataCss).toContain('margin-bottom: clamp(72px, 10svh, 108px);');
    expect(realmDataCss).toContain('filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.58));');
    expect(realmDataCss).toContain('.realm-data-frame__ornaments {\n    display: none;');
    expect(realmDataCss).toContain('.social-tray__launcher');
  });

  it('extends the desktop patch-note backing plate beneath the ornate frame rails', () => {
    expect(realmDataCss).toContain('@media (min-width: 901px)');
    expect(realmDataCss).toContain('inset: 42px 46px 44px;');
  });
  it('gives patch notes a readable phone layout without changing desktop cards', () => {
    const phoneStart = realmDataCss.indexOf('/* Phone reading mode:');
    const phoneEnd = realmDataCss.indexOf('@media (prefers-reduced-motion: reduce)', phoneStart);
    const phoneCss = realmDataCss.slice(phoneStart, phoneEnd);

    expect(phoneStart).toBeGreaterThan(-1);
    expect(phoneCss).toContain('@media (max-width: 600px)');
    expect(phoneCss).toContain('height: auto;');
    expect(phoneCss).toContain('padding: 56px clamp(40px, 12vw, 47px) 50px;');
    expect(phoneCss).toContain('url("/site/patch-note-frame-mobile-v1.webp")');
    expect(phoneCss).toContain('background: url(');
    expect(phoneCss).not.toContain('border-image-width: 48px 30px;');
    expect(phoneCss).toContain('max-height: min(58svh, 480px);');
    expect(phoneCss).toContain('scrollbar-gutter: auto;');
    expect(phoneCss).toContain('-webkit-overflow-scrolling: touch;');
    expect(phoneCss).toContain('width: 100%;');
    expect(phoneCss).toContain('justify-content: center;');
  });
  it('serves optimized local artwork within the homepage image budget', () => {
    for (const name of [
      'app-store.webp',
      'google-play.webp',
      'steam.webp',
      'worldofclaudecraft-logo.webp',
      'journey/realm-long-road.webp',
      'journey/realm-long-road-mobile.webp',
      'journey/realm-crypt-night.webp',
      'journey/realm-thornpeak.webp',
      'journey/realm-dawn-cartoon-v2.webp',
      'journey/realm-dawn-cartoon-v2-portrait.webp',
      'final-moongate-cartoon-v1.webp',
      'final-moongate-cartoon-v1-mobile.webp',
      'eastbrook-dusk.webp',
      'hollow-crypt.webp',
      'drowned-temple.webp',
      'thornpeak-snow.webp',
      'yuumiii-cutout.webp',
      'yuumiii-village.webp',
      'yuumiii-crypt.webp',
      'yuumiii-battlefield.webp',
      'yuumiii-sunset.webp',
      'stream-button-live.webp',
      'stream-button-dark.webp',
      'stream-icon-clock.webp',
      'stream-icon-crown.webp',
      'stream-icon-swords.webp',
      'stream-icon-shield.webp',
      'twitch-mark.svg',
      'yuumiii-broadcast-backdrop-v2.webp',
      'stream-button-live-v2.webp',
      'stream-button-dark-v2.webp',
      'stream-divider.webp',
      'stream-crest.webp',
      'play-console-frame.webp',
      'play-button-gold.webp',
      'play-button-back.webp',
      'play-skeleton-peek.webp',
      'play-warrior-peek.webp',
      'platform-google-play.webp',
      'platform-app-store.webp',
      'platform-steam.webp',
      'play-platform-card-frame.webp',
      'launcher-shell-v3.webp',
      'launcher-or-v3.webp',
      'launcher-server-panel-v4.webp',
      'community/community-world-forge.webp',
      'community/community-world-forge-mobile.webp',
      'community/community-guild-hall.webp',
      'community/community-guild-hall-mobile.webp',
      'community/community-realm-backdrop-cartoon-v6.webp',
      'community/community-realm-backdrop-cartoon-v6-mobile.webp',
      'launcher-card-rule-v4.webp',
      'highscores-scenic-paladin-mage-v2.webp',
      'highscores-scenic-paladin-mage-mobile-v2.webp',
      'highscores-boar-battle-paladin-v3.webp',
      'highscores-boar-battle-paladin-mobile-v3.webp',
      'highscores-frame-desktop-v5.webp',
      'highscores-frame-mobile-v5.webp',
      'patch-note-frame-mobile-v1.webp',
    ]) {
      const path = join(root, 'public', 'site', name);
      expect(existsSync(path), `${name} must exist`).toBe(true);
      expect(statSync(path).size, `${name} should stay under 300 KB`).toBeLessThan(300_000);
    }

    const communityArtBytes = [
      'community/community-world-forge.webp',
      'community/community-world-forge-mobile.webp',
      'community/community-guild-hall.webp',
      'community/community-guild-hall-mobile.webp',
      'community/community-realm-backdrop-cartoon-v6.webp',
      'community/community-realm-backdrop-cartoon-v6-mobile.webp',
    ].reduce((total, name) => total + statSync(join(root, 'public', 'site', name)).size, 0);
    expect(communityArtBytes).toBeLessThan(525_000);
  });
});
