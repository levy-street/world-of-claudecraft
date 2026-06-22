import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const privacyHtml = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const termsHtml = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dataDeletionHtml = readFileSync(new URL('../public/data-deletion.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const supportHtml = readFileSync(new URL('../public/support.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const serverMain = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mobileControlsTs = readFileSync(new URL('../src/game/mobile_controls.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const robotsTxt = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sitemapXml = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function splitGameUiTemplate(): { templateHtml: string; liveHtml: string } {
  const marker = '<template id="game-ui-template">';
  const start = html.indexOf(marker);
  const end = html.indexOf('</template>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const templateHtml = html.slice(start, end + '</template>'.length);
  return {
    templateHtml,
    liveHtml: html.slice(0, start) + html.slice(end + '</template>'.length),
  };
}

describe('client HTML shell', () => {
  it('keeps game HUD controls out of the live startup DOM', () => {
    const { liveHtml, templateHtml } = splitGameUiTemplate();

    expect(templateHtml).toContain('id="ui"');
    expect(templateHtml).toContain('Release Spirit');
    // chat tabs (Chat / Combat Log / channels) are rendered into #chatlog-tabs
    // by the HUD, so we assert on the container rather than a static label
    expect(templateHtml).toContain('id="chatlog-tabs"');
    expect(templateHtml).toContain('id="chat-input"');

    expect(liveHtml).not.toContain('id="ui"');
    expect(liveHtml).not.toContain('Release Spirit');
    expect(liveHtml).not.toContain('id="chatlog-tabs"');
    expect(liveHtml).not.toContain('id="chat-input"');
  });

  it('keeps the Account nav tab hidden unless a session is restored', () => {
    expect(html).toContain('<li class="nav-item" id="nav-item-account" hidden>');
    expect(html).toContain('<li class="nav-item" id="nav-item-logout" hidden>');
    expect(mainTs).toContain('if (api.restoreSession()) {');
    expect(mainTs).toContain('} else {\n    enterLoggedOutChrome();\n  }');
  });

  it('shows a logged-in Logout nav item next to Account', () => {
    expect(html).toContain('id="nav-btn-account"');
    expect(html).toContain('id="nav-btn-logout"');
    expect(html.indexOf('id="nav-btn-account"')).toBeLessThan(html.indexOf('id="nav-btn-logout"'));
    expect(html).toContain('data-i18n="nav.logout"');
    expect(mainTs).toContain("const loggedInNavItems = ['#nav-item-account', '#nav-item-logout'];");
    expect(mainTs).toContain('function logoutAccount(): void {');
    expect(mainTs).toContain('void api.logout().finally(finish);');
    expect(mainTs).toContain('api.clearSession();');
    expect(mainTs).toContain("setupNavBtn($('#nav-btn-logout'), '#hero-view', logoutAccount);");
  });

  it('requires users to confirm a new account password', () => {
    expect(html).toContain('id="account-confirm-pass"');
    expect(mainTs).toContain("const confirm = ($('#account-confirm-pass') as HTMLInputElement).value;");
    expect(mainTs).toContain('validatePasswordChange(current, next, confirm)');
  });

  it('routes logged-in play navigation to the realm and character flow', () => {
    expect(mainTs).toContain('const goToLoggedInPlay = () => {');
    expect(mainTs).toContain('void enterRealmFlow().catch((err) => {');
    expect(mainTs).toContain('api.clearSession();');
    expect(mainTs).toContain('const enterOnlinePlayFlow = () => {');
    expect(mainTs).toContain('if (api.token) {');
    expect(mainTs).toContain('goToLoggedInPlay();');
    expect(mainTs).toContain('setupNavBtn(navBtnPlay, \'#hero-view\', enterOnlinePlayFlow);');
    expect(mainTs).toContain('const handleOnlineSelect = () => {');
    expect(mainTs).toContain("show('#login-panel');");
  });

  it('ships crawlable SEO metadata and sitemap hints', () => {
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(html).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/" />');
    expect(html).toContain('<meta property="og:site_name" content="World of ClaudeCraft" />');
    expect(html).toContain('"alternateName": "World of Claudecraft"');
    expect(html).toContain('"https://github.com/levy-street/world-of-claudecraft"');
    expect(mainTs).toContain("alternateName: 'World of Claudecraft'");
    expect(mainTs).toContain("'https://github.com/levy-street/world-of-claudecraft'");
    expect(robotsTxt.trim()).toBe('User-agent: *\nAllow: /\n\nSitemap: https://worldofclaudecraft.com/sitemap.xml');
    expect(robotsTxt).toContain('Sitemap: https://worldofclaudecraft.com/sitemap.xml');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/links</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/play</loc>');
    expect(playHtml).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/play" />');
    expect(playHtml).toContain('<meta property="og:url" content="https://worldofclaudecraft.com/play" />');
    expect(playHtml).toContain('"url": "https://worldofclaudecraft.com/play"');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/privacy</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/terms</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/data-deletion</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/support</loc>');
    expect(privacyHtml).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/privacy" />');
    expect(privacyHtml).toContain('<h1>Privacy Policy</h1>');
    expect(privacyHtml).toContain('href="/support">Support</a>');
    expect(privacyHtml).toContain('href="/data-deletion">Data Deletion</a>');
    expect(termsHtml).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/terms" />');
    expect(termsHtml).toContain('<h1>Terms and Conditions</h1>');
    expect(termsHtml).toContain('href="/support">Support</a>');
    expect(termsHtml).toContain('href="/data-deletion">Data Deletion</a>');
    expect(dataDeletionHtml).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/data-deletion" />');
    expect(dataDeletionHtml).toContain('<h1>Data Deletion</h1>');
    expect(dataDeletionHtml).toContain('href="mailto:woc@levystreet.com"');
    expect(dataDeletionHtml).toContain('href="https://discord.gg/GjhnUsBtw"');
    expect(dataDeletionHtml).toContain('href="/support">Support</a>');
    expect(supportHtml).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/support" />');
    expect(supportHtml).toContain('<h1>Support</h1>');
    expect(supportHtml).toContain('href="mailto:woc@levystreet.com"');
    expect(supportHtml).toContain('href="https://discord.gg/GjhnUsBtw"');
    expect(supportHtml).toContain('href="/data-deletion">Data Deletion page</a>');
    expect(supportHtml).toContain('"@type": "ContactPage"');
    expect(html).toContain('href="/terms" class="footer-link" data-i18n="footer.terms"');
    expect(html).toContain('href="/privacy" class="footer-link" data-i18n="footer.privacy"');
    expect(viteConfig).toContain("['/privacy', '/privacy.html']");
    expect(viteConfig).toContain("['/terms', '/terms.html']");
    expect(viteConfig).toContain("['/data-deletion', '/data-deletion.html']");
    expect(viteConfig).toContain("['/support', '/support.html']");
    expect(serverMain).toContain("['/privacy', '/privacy.html']");
    expect(serverMain).toContain("['/terms', '/terms.html']");
    expect(serverMain).toContain("['/data-deletion', '/data-deletion.html']");
    expect(serverMain).toContain("['/support', '/support.html']");
  });

  it('loads Meta Pixel outside local development and tracks level 5', () => {
    expect(html).toContain('https://connect.facebook.net/en_US/fbevents.js');
    expect(html).toContain("fbq('init', '1692101265042180');");
    expect(html).toContain("fbq('track', 'PageView');");
    expect(html).toContain('https://www.facebook.com/tr?id=1692101265042180&ev=PageView&noscript=1');
    expect(html).toContain("if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {");
    expect(hudTs).toContain("fbq('trackCustom', eventName, data ?? {});");
    expect(hudTs).toContain("if (ev.level === 5) trackMetaPixel('ReachedLevel5', { level: ev.level });");
  });

  it('excludes wallet verification surfaces from native app builds', () => {
    expect(html).toContain('body.native-app #nav-btn-download,');
    expect(html).toContain('body.native-app .cs-wallet,\n  body.native-app .cs-wallet-hidden-note,\n  body.native-app .account-wallet-card');
    expect(html).toContain('<section class="account-card account-wallet-card">');
    expect(mainTs).toContain("const WALLET_ENABLED = !NATIVE_APP && String(import.meta.env.VITE_WALLET_DISABLED ?? '').trim() !== '1';");
    expect(mainTs).toContain("document.querySelector('.cs-wallet')?.remove();");
    expect(mainTs).toContain("document.querySelector('.account-wallet-card')?.remove();");
  });

  it('offers the quest log in the mobile controls drawer', () => {
    expect(html).toContain('id="mobile-extra-controls"');
    expect(html).toContain('id="mobile-quest"');
    expect(html).toContain('aria-label="Quest Log"');
  });

  it('keeps the game menu free of duplicate and dev-only entries', () => {
    const interfaceEntries = hudTs.match(/add\(t\('hud\.options\.interface'\), \(\) => goto\('interface'\)\);/g) ?? [];
    expect(interfaceEntries).toHaveLength(1);
    expect(hudTs).not.toContain('Skin Select (dev)');
  });

  it('wires player card pose clicks before loading card metadata', () => {
    const methodStart = hudTs.indexOf('private async openPlayerCard');
    const listener = hudTs.indexOf("poseButtons.forEach((b, i) => b.addEventListener('click'", methodStart);
    const metadataAwait = hudTs.indexOf('[referral, standing] = await Promise.all([fetchReferralInfo(), fetchStanding()]);', methodStart);
    const actionWiring = hudTs.indexOf('this.wireCardActions(back, state, setStatus);', methodStart);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(listener).toBeGreaterThan(methodStart);
    expect(metadataAwait).toBeGreaterThan(listener);
    expect(actionWiring).toBeGreaterThan(metadataAwait);

    const listenerBlock = hudTs.slice(listener, metadataAwait);
    expect(listenerBlock).toContain('if (!metadataReady) {');
    expect(listenerBlock).toContain('selectPose(i);');
    expect(listenerBlock).toContain('return;');
    expect(hudTs.slice(metadataAwait, actionWiring)).toContain('await compose(requestedPoseIndex);');
  });

  it('only displays mobile touch controls after the game is active', () => {
    expect(html).toContain('body.mobile-touch.game-active #mobile-controls');
    expect(html).not.toContain('body.mobile-touch #mobile-controls { position: absolute; inset: 0; display: block;');
  });

  it('does not expose inert scrollbars on fixed mobile game overlays', () => {
    expect(html).toContain('#ui { position: fixed; left: 0; top: 0; width: var(--app-vw); max-width: 100vw; height: var(--app-vh); overflow: hidden;');
    expect(html).toContain('body.mobile-touch.game-active #ui,\n  body.mobile-touch.game-active #nameplates,\n  body.mobile-touch.game-active #mobile-controls {\n    overflow: hidden;\n    scrollbar-width: none;');
    expect(html).toContain('body.mobile-touch.game-active #ui::-webkit-scrollbar,\n  body.mobile-touch.game-active #nameplates::-webkit-scrollbar,\n  body.mobile-touch.game-active #mobile-controls::-webkit-scrollbar');
    expect(html).toContain('height: 0;\n    display: none;');
    expect(html).toContain('body.mobile-touch.game-active::-webkit-scrollbar {\n    height: 0;');
    expect(html).toContain('body.mobile-touch.game-active *::-webkit-scrollbar {\n    height: 0;');
    expect(html).toContain('body.mobile-touch.game-active *::-webkit-scrollbar:horizontal {\n    height: 0;\n    display: none;');
  });

  it('suppresses mobile in-game text selection and touch callouts without blocking inputs', () => {
    expect(html).toContain('body.mobile-touch.game-active #mobile-controls *,\n  body.mobile-touch.game-active #bottom-bar,');
    expect(html).toContain('body.mobile-touch.game-active .mobile-btn {\n    user-select: none;\n    -webkit-user-select: none;\n    -webkit-touch-callout: none;');
    expect(html).toContain('body.mobile-touch.game-active input,\n  body.mobile-touch.game-active textarea,\n  body.mobile-touch.game-active select,');
    expect(html).toContain('-webkit-user-select: text;\n    -webkit-touch-callout: default;');
  });

  it('collapses in-game mobile community links behind one Community control', () => {
    expect(html).toContain('<a class="donate-cta"');
    expect(html).toContain('<details id="community-menu">');
    expect(html).toContain('<summary class="community-toggle"');
    expect(html).toContain('<div class="community-tray">');
    expect(html).toContain('<a class="community-link discord"');
    expect(html).toContain('<a class="community-link github"');
    expect(html).toContain('<a class="community-link donate"');
    expect(html).toContain('body.mobile-touch.game-active #ui { z-index: 80; }');
    expect(html).toContain('body.mobile-touch #community-hud {\n    right: max(8px, env(safe-area-inset-right));\n    top: calc(max(8px, env(safe-area-inset-top)) + 158px);');
    expect(html).toContain('body.mobile-touch .community-toggle {\n    width: 44px;\n    height: 44px;');
    expect(html).toContain('body.mobile-touch .community-toggle svg {\n    width: 20px;\n    height: 20px;');
    expect(html).toContain('body.mobile-touch #community-hud { top: calc(max(6px, env(safe-area-inset-top)) + 132px);');
    expect(html).toContain('body.mobile-touch .community-toggle { width: 40px; height: 40px; }');
    expect(html).toContain('body.mobile-touch .community-tray {\n    position: absolute;');
    expect(html).toContain('z-index: 90;');
    expect(html).toContain('body.mobile-touch #community-menu[open] .community-tray { display: flex; }');
    expect(html).toContain('body.mobile-touch .community-link.donate { display: inline-flex;');
    expect(html).not.toContain('body.mobile-touch .community-link.donate {\n    display: none;');
    expect(html).not.toContain('body.mobile-touch .donate-cta {\n    display: none;');
  });

  it('closes mobile community and More trays when tapping outside', () => {
    expect(hudTs).toContain("const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;");
    expect(hudTs).toContain("if (document.body.classList.contains('mobile-touch') && communityMenu?.open && !communityMenu.contains(target)) {\n        communityMenu.open = false;\n      }");
    expect(hudTs).not.toContain('if (communityMenu?.open && !communityMenu.contains(target)) {\n        communityMenu.open = false;\n      }');
    expect(hudTs).toContain("if (document.body.classList.contains('mobile-more-open')) {");
    expect(hudTs).toContain("document.body.classList.remove('mobile-more-open');");
    expect(hudTs).toContain("document.getElementById('mobile-controls')?.classList.remove('expanded');");
    expect(hudTs).toContain("more?.classList.remove('active');");
    expect(hudTs).toContain("document.getElementById('mobile-more-close')?.addEventListener('click', () => {");
  });

  it('keeps desktop community links open after HUD clicks', () => {
    expect(mainTs).toContain('communityMenu.open = !(NATIVE_APP || useTouchInterface());');
    expect(hudTs).toContain("document.body.classList.contains('mobile-touch') && communityMenu?.open");
  });

  it('renders the mobile XP bar as a ring around the top-left class circle', () => {
    expect(html).toContain('body.mobile-touch #xpbar {\n    display: none;\n  }');
    expect(html).toContain('body.mobile-touch #player-frame {\n    --xp-ring-start: 210deg;\n    --xp-ring-arc: 360deg;');
    expect(html).toContain('body.mobile-touch #player-frame::before {\n    content: "";');
    expect(html).toContain('width: 73px;\n    height: 73px;');
    expect(html).toContain('z-index: 2;');
    expect(html).toContain('conic-gradient(from var(--xp-ring-start),');
    expect(html).toContain('calc(var(--xp-fill, 0) * 360deg)');
    expect(html).toContain('transparent var(--xp-ring-arc) 360deg');
    expect(html).toContain('body.mobile-touch #player-frame {\n    position: fixed;\n    left: max(8px, env(safe-area-inset-left));\n    top: max(8px, env(safe-area-inset-top));\n    z-index: 21;');
    expect(html).toContain('body.mobile-touch #player-frame .portrait-wrap { z-index: 3; }');
    expect(html).toContain('body.mobile-touch #player-frame .uf-bars {\n    position: relative;\n    z-index: 1;');
    expect(html).toContain('-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));');
    expect(html).toContain('body.mobile-touch #xpbar .fill,\n  body.mobile-touch #xpbar .ticks { display: none; }');
    expect(html).toContain('body.mobile-touch #player-frame::before {\n      left: -5px;\n      top: -5px;\n      width: 73px;\n      height: 73px;');
    expect(html).toContain('body.mobile-touch #target-frame {\n    left: max(8px, env(safe-area-inset-left));\n    top: calc(max(8px, env(safe-area-inset-top)) + 72px);');
    expect(html).toContain('body.mobile-touch #party-frames {\n    position: fixed;\n    left: max(8px, env(safe-area-inset-left));\n    top: calc(max(8px, env(safe-area-inset-top)) + 74px);');
    expect(html).toContain('body.mobile-touch #party-frames.below-target {\n    top: calc(max(8px, env(safe-area-inset-top)) + 130px);');
    expect(html).toContain('body.mobile-touch #party-frames .party-frame {\n    width: 132px;\n    min-height: 30px;');
    expect(html).toContain('body.mobile-touch #party-frames .party-frame:not(:first-child) {\n    margin-top: -1px;');
    expect(html).toContain('body.mobile-touch #party-frames #party-leave {\n    width: 132px;\n    min-height: 32px;');
    expect(html).toContain('body.mobile-touch #party-frames .party-frame {\n      width: 118px;\n      min-height: 25px;');
    expect(html).toContain('body.mobile-touch #target-frame {\n      left: max(6px, env(safe-area-inset-left));\n      top: calc(max(6px, env(safe-area-inset-top)) + 56px);');
    expect(html).toContain('body.mobile-touch #party-frames.below-target {\n      top: calc(max(6px, env(safe-area-inset-top)) + 100px);');
    expect(html).not.toContain('body.mobile-touch.mobile-left-handed #xpbar,');
    expect(hudTs).toContain("$('#xpbar').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));");
    expect(hudTs).toContain("$('#player-frame').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));");
  });

  it('keeps the mobile homepage scrollable with a sticky header', () => {
    expect(html).toContain('touch-action: pan-y; overscroll-behavior-y: auto;');
    expect(html).toContain('body.game-active {\n    overflow: hidden;\n    touch-action: none;');
    expect(html).toContain('-webkit-overflow-scrolling: touch;');
    expect(html).toContain('body.mobile-touch .homepage-header {\n    display: flex;\n    position: sticky;\n    top: 0;\n    z-index: 120;');
    expect(html).toContain('padding-top: calc(var(--spacing-sm) + env(safe-area-inset-top));');
    expect(html).toContain('padding-right: max(var(--spacing-md), env(safe-area-inset-right));');
    expect(html).toContain('body.mobile-touch #homepage-views-container {\n    padding-top: var(--spacing-lg);\n    padding-right: max(var(--spacing-md), env(safe-area-inset-right));');
    expect(html).toContain('body.mobile-touch .header-actions {\n    width: 100%;\n    display: flex;\n    flex-direction: column;\n    align-items: center;');
    expect(html).toContain('body.mobile-touch .footer-lang-row {\n    width: 100%;\n    flex-direction: column;\n    align-items: center;');
    expect(html).toContain('body.native-app.mobile-touch .auth-panel-premium {\n    backdrop-filter: none;\n    -webkit-backdrop-filter: none;');
    expect(html).toContain('body.native-app.mobile-touch[data-start-panel="login-panel"] .portal-ring,');
    expect(html).toContain('touch-action: manipulation;\n    -webkit-tap-highlight-color: transparent;');
    expect(mainTs).toContain("target?.closest('button, a, input, textarea, select, [role=\"button\"], [role=\"option\"], [tabindex]')");
    expect(mainTs).toContain("document.addEventListener('pointerup', handleNativeMenuToggle, true);");
    expect(mainTs).toContain("document.addEventListener('touchend', handleNativeMenuToggle, { capture: true, passive: false });");
    expect(mainTs).toContain("if (headerMenu) headerMenu.style.display = open ? 'flex' : '';");
    expect(html).not.toContain('body.mobile-touch .homepage-header {\n    display: flex;\n    position: relative;');
    expect(mainTs).not.toContain("visualViewport?.addEventListener('scroll', syncAppViewport)");
  });

  it('lets HUD windows scroll by touch on iOS (Bag / Market)', () => {
    // The HUD overlay must permit one-finger panning so scroll containers
    // inside it can scroll on iOS — `touch-action: none` here would block them
    // (Safari intersects touch-action down the ancestor chain, so a child's
    // own pan-y cannot re-enable it). pan-x pan-y still blocks pinch-zoom.
    expect(html).toContain('body.mobile-touch #ui { touch-action: pan-x pan-y; }');
    expect(html).not.toContain('body.mobile-touch #ui { touch-action: none; }');
    // Scrollable lists get iOS momentum + scroll isolation.
    expect(html).toContain('#bags .bag-grid { flex: 1 1 auto; min-height: 0; overflow-y: auto;\n    touch-action: pan-y; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }');
    expect(html).toContain('#market-body { overflow-y: auto; flex: 1; min-height: 0; padding-right: 2px;\n    touch-action: pan-y; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }');
    // The world canvas still suppresses panning so camera drag is unaffected.
    expect(html).toContain('body.mobile-touch #game-canvas { touch-action: none; }');
  });

  it('places news release metadata below the heading on mobile', () => {
    expect(mainTs).toContain('<h3 class="news-item-title">${title}</h3><div class="news-item-meta">${tag}${badge}${when}</div></div>');
    expect(html).toContain('body.mobile-touch .news-item-head {\n    flex-direction: column;\n    align-items: flex-start;');
    expect(html).toContain('body.mobile-touch .news-item-meta {\n    width: 100%;\n    margin-left: 0;');
    expect(html).toContain('overflow-wrap: break-word;\n    word-break: normal;');
    expect(html).toContain('body.mobile-touch .news-body {\n    text-align: left;');
    expect(html).toContain('body.mobile-touch .news-body ul {\n    list-style: none;\n    padding-left: 0;');
  });

  it('renders the high scores leaderboard responsively on mobile', () => {
    expect(mainTs).toContain('<span class="hs-realm" data-label="${esc(realmLabel)}">${esc(r.realm ?? \'\')}</span>');
    expect(mainTs).toContain('<span class="hs-xp" data-label="${esc(lifetimeXpLabel)}">${formatXp(r.lifetimeXp)}</span>');
    expect(html).toContain('body.mobile-touch .hs-head {\n    display: none;');
    expect(html).toContain('body.mobile-touch .hs-row {\n    grid-template-columns: 38px minmax(0, 1fr);');
    expect(html).toContain('grid-template-areas:\n      "rank name"\n      "rank realm"\n      "rank lvl"\n      "rank vlvl"\n      "rank xp";');
    expect(html).toContain('body.mobile-touch .hs-realm::before,\n  body.mobile-touch .hs-lvl::before,\n  body.mobile-touch .hs-vlvl::before,\n  body.mobile-touch .hs-xp::before {\n    content: attr(data-label);');
  });

  it('stacks selected character details on mobile', () => {
    expect(html).toContain('id="charselect-class-details"');
    expect(html).toContain('body.mobile-touch #charselect-panel #charselect-class-details .class-details-grid,\n  body.mobile-touch #charselect-panel #online-class-details .class-details-grid {\n    display: flex;\n    flex-direction: column;');
  });

  it('lays out mobile More tray buttons horizontally', () => {
    expect(html).toContain('<div id="mobile-extra-controls" class="window panel" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">');
    expect(html).toContain('<div class="panel-title">');
    expect(html).toContain('id="mobile-more-close"');
    expect(html).toContain('<div id="mobile-extra-grid">');
    expect(html).toContain('body.mobile-touch.mobile-more-open #mobile-controls { z-index: 140; }');
    expect(html).toContain('body.mobile-touch #mobile-extra-controls {\n    position: fixed;\n    left: 50%;\n    top: max(14px, env(safe-area-inset-top));\n    bottom: auto;\n    transform: translateX(-50%);');
    expect(html).toContain('z-index: 100;');
    expect(html).toContain('border-radius: 10px;');
    expect(html).toContain('max-width: calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));');
    expect(html).toContain('max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));');
    expect(html).toContain('body.mobile-touch.mobile-more-open #mobile-extra-controls { display: flex; flex-direction: column; }');
    expect(html).toContain('body.mobile-touch #mobile-extra-controls .panel-title {\n    min-height: 32px;');
    expect(html).toContain('width: min(560px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)));');
    expect(html).toContain('body.mobile-touch #mobile-extra-grid {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(html).toContain('body.mobile-touch #mobile-extra-controls .mobile-btn');
    expect(html).toContain('body.mobile-touch #mobile-extra-controls .mobile-btn {\n    width: 100%;');
    expect(html).toContain('flex-direction: row;');
    expect(html).toContain('body.mobile-touch #mobile-extra-controls .mobile-btn .ui-icon');
    expect(mobileControlsTs).toContain("const open = !document.body.classList.contains('mobile-more-open');");
    expect(mobileControlsTs).toContain("this.root?.classList.toggle('expanded', open);");
    expect(mobileControlsTs).toContain("document.body.classList.toggle('mobile-more-open', open);");
    expect(mobileControlsTs).toContain("modal.style.left = '50%';");
    expect(mobileControlsTs).toContain("modal.style.top = 'max(14px, env(safe-area-inset-top))';");
    expect(mobileControlsTs).toContain("modal.style.transform = 'translateX(-50%)';");
    expect(mobileControlsTs).toContain('delete modal.dataset.windowMoved;');
    expect(mobileControlsTs).toContain('private closeMoreModal(): void {');
    expect(mobileControlsTs).toContain("document.getElementById('mobile-controls')?.classList.remove('expanded');");
    const bindButton = mobileControlsTs.slice(
      mobileControlsTs.indexOf('private bindButton'),
      mobileControlsTs.indexOf('private closeMoreModal'),
    );
    expect(bindButton.indexOf("button.closest('#mobile-extra-controls')")).toBeGreaterThan(-1);
    expect(bindButton.indexOf('this.closeMoreModal();')).toBeLessThan(bindButton.indexOf('cb();'));
    expect(hudTs).toContain(".filter((win) => win.id !== 'mobile-extra-controls')");
  });

  it('replaces the dual mode cards with one Play CTA and a realm selector', () => {
    expect(html).toContain('id="btn-play"');
    expect(html).toContain('id="server-select"');
    expect(html).toContain('id="server-select-menu"');
    expect(html).toContain('role="listbox"');
    // Legacy online/offline triggers persist as hidden automation hooks.
    expect(html).toContain('id="btn-online"');
    expect(html).toContain('id="btn-offline"');
    expect(html).not.toContain('class="mode-card');
    expect(html).not.toContain('.mode-row {');
    expect(html).toContain('body.mobile-touch #mode-select {\n    width: 100%;\n    max-width: min(440px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)));\n    margin-inline: auto;');
    // Landscape compacts the single play console instead of splitting two cards.
    expect(html).toContain('@media (orientation: landscape) {\n    body.mobile-touch .play-console {');
    expect(html).toContain('@media (orientation: landscape) {\n    body.mobile-touch .play-console {\n      width: 100%;\n      max-width: 460px;');
  });

  it('ships a looping cinematic backdrop with a poster fallback, lazy-loaded for perf', () => {
    expect(html).toContain('id="bg-home"');
    expect(html).toContain('poster="/home-bg.png"');
    // The 5.7MB mp4 is NOT eagerly fetched: no <source>/autoplay/preload in the
    // static markup. main.ts attaches data-trailer-src only on capable devices;
    // phones / Save-Data / reduced-motion / high-contrast keep the poster only.
    expect(html).toContain('data-trailer-src="/home-bg.mp4"');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('<source src="/home-bg.mp4"');
    expect(mainTs).toContain('applyLandingBackdrop');
    // View transitions still honour reduced-motion.
    expect(mainTs).toContain("prefers-reduced-motion: reduce");
  });

  it('omits Meters from the mobile More tray while keeping the desktop window', () => {
    expect(html).toContain('id="meters-window"');
    expect(html).not.toContain('id="mobile-meters"');
  });

  it('keeps the World Market to one scroll container with browse filters below the tabs', () => {
    expect(html).toContain('#market-window { width: 470px; height: min(640px, calc(85vh - 24px)); display: none; flex-direction: column; overflow: hidden;');
    expect(html).toContain('#market-body { overflow-y: auto; flex: 1; min-height: 0;');
    expect(html).toContain('.mkt-page { display: flex; align-items: center; justify-content: space-between;');
    expect(html).toContain('body.mobile-touch #market-window {\n    max-height: calc(58vh - 20px);\n    overflow: hidden;');
    expect(hudTs).toContain('MARKET_PAGE_SIZE');
    expect(hudTs).toContain('this.marketBrowsePage');
    expect(hudTs).toContain('data-market-page="prev"');
    expect(hudTs).toContain('data-market-page="next"');
    expect(hudTs).toContain('itemUi.market.pageRange');
    expect(hudTs).toContain('class="mkt-filters${hasSubtype ? \' has-subtype\' : \'\'}"');
    expect(hudTs).toContain('data-market-filter-menu="${menu}"');
    expect(hudTs).toContain("this.renderMarketFilterMenu('itemType'");
    expect(hudTs).toContain("this.renderMarketFilterMenu('subtype'");
    expect(hudTs).toContain("this.renderMarketFilterMenu('rarity'");
    expect(hudTs).not.toContain('<select data-market-filter=');
  });

  it('keeps the mobile More and Autorun buttons in the combat row', () => {
    const combatControls = html.slice(html.indexOf('<div id="mobile-combat-controls">'), html.indexOf('<div id="mobile-extra-controls"'));
    const primaryButtons = [...combatControls.matchAll(/<button class="mobile-btn"/g)];
    const attack = combatControls.indexOf('id="mobile-attack-nearest"');
    const autorun = combatControls.indexOf('id="mobile-autorun"');
    const jump = combatControls.indexOf('id="mobile-jump"');

    expect(primaryButtons).toHaveLength(7);
    expect(attack).toBeGreaterThanOrEqual(0);
    expect(autorun).toBeGreaterThan(attack);
    expect(jump).toBeGreaterThan(autorun);
    expect(html).toContain('grid-template-columns: 124px repeat(6, 58px);');
    expect(html).toContain('grid-template-columns: 115px repeat(6, 54px);');
    expect(html).toContain('grid-template-columns: 96px repeat(6, 42px);');
    expect(html).toContain('position: absolute; left: 50%; bottom: calc(3px + env(safe-area-inset-bottom));');
    expect(html).toContain('bottom: calc(2px + env(safe-area-inset-bottom)); grid-template-columns: 115px repeat(6, 54px);');
    expect(html).toContain('pointer-events: auto; align-items: end; z-index: 30;');
    expect(html).toContain('body.mobile-touch #mobile-more {\n    position: static;');
    expect(mainTs).toContain('onMenu: () => hud.toggleOptionsMenu(),');
  });

  it('keeps the mobile spell bar in a scrollable row between the joysticks', () => {
    expect(html).toContain('width: min(30vw, 132px);');
    expect(html).toContain('min-width: 112px;');
    expect(html).toContain('height: min(36vh, 172px);');
    expect(html).toContain('left: calc(max(18px, env(safe-area-inset-left)) + 154px);');
    expect(html).toContain('right: calc(max(18px, env(safe-area-inset-right)) + 154px);');
    expect(html).toContain('bottom: calc(64px + env(safe-area-inset-bottom));');
    expect(html).toContain('left: calc(max(20px, env(safe-area-inset-left)) + 136px);');
    expect(html).toContain('right: calc(max(20px, env(safe-area-inset-right)) + 136px);');
    expect(html).toContain('bottom: calc(57px + env(safe-area-inset-bottom));');
    expect(html).toContain('body.mobile-touch #actionbar {\n    display: flex;\n    flex-wrap: nowrap;');
    expect(html).toContain('overflow-x: auto;\n    overflow-y: hidden;');
    expect(html).toContain('touch-action: pan-x;');
    expect(html).toContain('min-height: 50px;');
    expect(html).toContain('body.mobile-touch .action-btn { width: 42px; height: 42px; flex: 0 0 42px;');
    expect(html).toContain('body.mobile-touch.mobile-hotbar-dragging #actionbar { touch-action: none; }');
    expect(html).toContain('body.mobile-touch .action-btn.mobile-drag-source');
  });

  it('seeds druid form bars with the form kit, and only clones normal for rogue stealth', () => {
    expect(hudTs).toContain('if (this.isFormKitBar()) {');
    expect(hudTs).toContain('if (this.seedFormBarIfNeeded(parsed)) return;');
    expect(hudTs).toContain('buildDefaultFormBar(this.formKitAbilityIds(this.activeHotbarForm), Hud.BAR_ABILITY_SLOTS)');
    expect(hudTs).toContain('const emptyFormMap = this.activeHotbarForm !== \'normal\' && parsed.every((action) => action === null);');
    expect(hudTs).toContain("localStorage.getItem(this.slotMapKey('normal'))");
    expect(hudTs).not.toContain('this.loadedSlotMapFromStorage = stored || this.activeHotbarForm !== \'normal\';');
  });

  it('migrates a pre-existing form bar at most once via a per-form seeded marker', () => {
    expect(hudTs).toContain('_seeded');
    expect(hudTs).toContain('shouldSeedFormBar(parsed, normalActions, false)');
  });

  it('only auto-places abilities that belong on the active form bar', () => {
    expect(hudTs).toContain('if (this.shouldAutoPlaceOnForm(id, this.activeHotbarForm)) autoPlaceAbilityIds.add(id);');
  });

  it('keeps the active druid form toggle on its form action bar', () => {
    expect(hudTs).toContain("new Set(['bear_form', 'cat_form', 'travel_form'])");
    expect(hudTs).toContain("if (this.activeHotbarForm === 'bear') return 'bear_form';");
    expect(hudTs).toContain("if (this.activeHotbarForm === 'cat') return 'cat_form';");
    expect(hudTs).toContain('if (formToggle && knownAbilityIds.includes(formToggle)) autoPlaceAbilityIds.add(formToggle);');
  });

  it('offers a reset-to-default action bar button in the spellbook, only for classes with form bars', () => {
    expect(hudTs).toContain('data-reset-bar');
    expect(hudTs).toContain('this.resetActiveFormBarToDefault()');
    expect(hudTs).toContain("t('abilityUi.spellbook.resetBar')");
    expect(html).toContain('.spellbook-reset {');
    expect(html).toContain('body.mobile-touch #spellbook .spellbook-reset {');
    expect(hudTs).toContain('const resetBtnHtml = this.classHasFormBars()');
    expect(hudTs).toContain('return classHasFormBars(this.sim.cfg.playerClass);');
  });

  it('shows mobile spellbook add and remove controls for the spell bar', () => {
    expect(html).toContain('.spell-hotbar-toggle { display: none; }');
    expect(html).toContain('body.mobile-touch #spellbook .spell-hotbar-toggle {\n    min-width: 40px;\n    min-height: 40px;');
    expect(html).toContain('body.mobile-touch #spellbook .spell-hotbar-toggle.remove');
    expect(hudTs).toContain("toggle.className = 'spell-hotbar-toggle' + (onBar ? ' remove' : '');");
    expect(hudTs).toContain('this.removeAbilityFromHotbar(known.def.id)');
    expect(hudTs).toContain('this.addAbilityToHotbar(known.def.id)');
  });

  it('sizes the mobile Bags window as a usable modal', () => {
    expect(html).toContain('body.mobile-touch #bags {\n    position: fixed;\n    left: max(10px, env(safe-area-inset-left));\n    right: max(10px, env(safe-area-inset-right));\n    top: max(10px, env(safe-area-inset-top));\n    bottom: calc(72px + env(safe-area-inset-bottom));\n    width: auto;\n    transform: none;');
    expect(html).toContain('body.mobile-touch #bags .bag-grid {\n    min-height: 150px;');
    expect(html).not.toContain('body.mobile-touch #bags {\n    position: fixed;\n    left: 10px;\n    right: 10px;\n    bottom: 10px;');
    expect(html).not.toContain('max-height: calc(38vh - 20px);');
  });

  it('combines Trader and Bags into a mobile split-pane modal', () => {
    expect(html).toContain('body.mobile-touch.vendor-open #vendor-window,\n  body.mobile-touch.vendor-open #bags {\n    position: fixed;\n    top: max(10px, env(safe-area-inset-top));\n    bottom: calc(72px + env(safe-area-inset-bottom));');
    expect(html).toContain('body.mobile-touch.vendor-open #vendor-window {\n    left: max(10px, env(safe-area-inset-left));\n    right: 50vw;');
    expect(html).toContain('body.mobile-touch.vendor-open #bags {\n    left: 50vw;\n    right: max(10px, env(safe-area-inset-right));');
    expect(html).toContain('body.mobile-touch.vendor-open #vendor-window .panel-title,\n  body.mobile-touch.vendor-open #bags .panel-title {\n    height: 47px;\n    min-height: 47px;');
    expect(html).toContain('body.mobile-touch.vendor-open #vendor-window .panel-title .x-btn {\n    display: none;');
    expect(hudTs).toContain("if (this.vendorOpen && document.body.classList.contains('mobile-touch')) this.closeVendor();");
    expect(hudTs).toContain("const closeMobileBags = document.body.classList.contains('mobile-touch') && $('#bags').style.display !== 'none';");
  });

  it('keeps the expanded mobile More tray inside the viewport', () => {
    expect(html).toContain('body.mobile-touch.mobile-left-handed #mobile-extra-controls {\n    left: 50%;\n    right: auto;');
    expect(html).toContain('max-height: calc(100dvh - 28px - env(safe-area-inset-top) - env(safe-area-inset-bottom));');
  });

  it('caps mobile quest and NPC panels instead of stretching them edge to edge', () => {
    expect(html).toContain('body.mobile-touch #quest-log-window,\n  body.mobile-touch #vendor-window,\n  body.mobile-touch #quest-dialog');
    expect(html).toContain('width: clamp(320px, 76vw, 680px);');
    expect(html).toContain('max-width: calc(100vw - 20px);');
    expect(html).toContain('transform: translateX(-50%);');
  });

  it('centers mobile Talents above touch controls', () => {
    expect(html).toContain('body.mobile-touch.mobile-window-open #ui {\n    z-index: 90;');
    expect(html).toContain('body.mobile-touch #talents-window {\n    position: fixed;');
    expect(html).toContain('top: 50%;');
    expect(html).toContain('transform: translate(-50%, -50%);');
    expect(html).toContain('z-index: 95 !important;');
  });
});
