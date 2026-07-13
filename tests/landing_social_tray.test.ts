import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- jsdom does not bundle declarations and this test only uses its runtime DOM.
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  LANDING_SOCIALS,
  mountLandingSocialTray,
  SOCIAL_SPEECH_REVEAL_DELAY_MS,
} from '../src/ui/landing_social_tray';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const html = read('index.html');
const css = read('src/styles/social-tray.css');
const homepageCss = read('src/styles/homepage.css');
const trayTs = read('src/ui/landing_social_tray.ts');
const shellCatalog = read('src/ui/i18n.catalog/shell.ts');

const EXPECTED_SOCIALS = [
  ['x', 'https://x.com/WoClaudecraft'],
  ['discord', 'https://discord.com/invite/worldofclaudecraft'],
  ['twitch', 'https://www.twitch.tv/directory/category/world-of-claudecraft'],
  ['instagram', 'https://www.instagram.com/woclaudecraft/'],
  ['tiktok', 'https://www.tiktok.com/@worldofclaudecraft'],
  ['youtube', 'https://www.youtube.com/@WoClaudeCraft'],
  ['reddit', 'https://www.reddit.com/r/WorldofClaudecraft'],
  ['github', 'https://github.com/levy-street/world-of-claudecraft'],
] as const;

describe('landing social tray', () => {
  it('keeps the requested destinations in exact display order', () => {
    expect(LANDING_SOCIALS.map(({ id, url }) => [id, url])).toEqual(EXPECTED_SOCIALS);
  });

  it('uses unique ids and URLs with complete data-driven fields', () => {
    expect(new Set(LANDING_SOCIALS.map(({ id }) => id)).size).toBe(LANDING_SOCIALS.length);
    expect(new Set(LANDING_SOCIALS.map(({ url }) => url)).size).toBe(LANDING_SOCIALS.length);
    expect(Object.isFrozen(LANDING_SOCIALS)).toBe(true);

    for (const social of LANDING_SOCIALS) {
      expect(Object.isFrozen(social)).toBe(true);
      expect(social).toEqual(
        expect.objectContaining({
          accent: expect.stringMatching(/^#[0-9a-f]{6}$/i),
          accessibleLabelKey: expect.any(String),
          iconPath: expect.any(String),
          id: expect.any(String),
          nameKey: expect.any(String),
          url: expect.stringMatching(/^https:\/\//),
        }),
      );
      expect(social.iconPath.length).toBeGreaterThan(20);
    }
    expect(LANDING_SOCIALS.at(-1)?.badgeKey).toBe('landing.statSource');
    expect(LANDING_SOCIALS.find(({ id }) => id === 'instagram')).toEqual(
      expect.objectContaining({
        iconPath: expect.stringContaining('M7.75 2.75h8.5'),
        iconVariant: 'stroke',
      }),
    );
  });

  it('wires one index-only mount root, stylesheet, and module before the main entry', () => {
    expect(html.match(/id="site-social-tray-root"/g)).toHaveLength(1);
    expect(html).toContain('<div id="site-social-tray-root" class="site-marketing-only"></div>');
    expect(html).not.toContain('class="site-social-rail');
    const homepageStyle = html.indexOf('href="/src/styles/homepage.css"');
    const questCardStyle = html.indexOf('href="/src/styles/community-quest-cards.css"');
    const forgedUiStyle = html.indexOf('href="/src/styles/community-forged-ui.css"');
    const trayStyle = html.indexOf('href="/src/styles/social-tray.css"');
    expect(homepageStyle).toBeGreaterThan(-1);
    expect(questCardStyle).toBeGreaterThan(homepageStyle);
    expect(forgedUiStyle).toBeGreaterThan(questCardStyle);
    expect(trayStyle).toBeGreaterThan(forgedUiStyle);

    const trayEntry = html.indexOf('src="/src/ui/landing_social_tray.ts"');
    const mainEntry = html.indexOf('src="/src/main.ts"');
    expect(trayEntry).toBeGreaterThan(-1);
    expect(mainEntry).toBeGreaterThan(trayEntry);
    expect(trayTs).toContain("document.getElementById('site-social-tray-root')");
  });

  it('ships a viewport-fixed desktop rail and a compact dialog path', () => {
    expect(css).toContain('[data-start-panel="login-panel"]');
    expect(css).toContain(':not([data-start-panel="mode-select"]):not(');
    expect(css).toMatch(/\.social-tray--desktop\s*\{[\s\S]*?position: fixed;/);
    expect(css).toContain('top: 50%;');
    expect(css).toContain('right: calc(14px + env(safe-area-inset-right));');
    expect(css).toContain(
      '@media (min-width: 1181px) and (min-height: 820px) and (hover: hover) and (pointer: fine)',
    );
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-height: 620px) and (min-width: 641px)');
    expect(css).toContain('width: min(28rem, calc(100vw - 1rem));');
    expect(trayTs).toContain("document.createElement('dialog')");
    expect(trayTs).toContain('dialog.showModal()');
    expect(trayTs).toContain("launcher.setAttribute('aria-haspopup', 'dialog')");
    expect(trayTs).toContain("link.rel = 'noopener noreferrer'");
    expect(trayTs).toContain("localizeText(title, 'landing.followSocials')");
    expect(trayTs).toContain("localizeText(copy, 'landing.followSocials')");
    expect(trayTs).toContain("event.key !== 'Escape'");
    expect(shellCatalog).toContain("followSocials: 'Follow us on our socials'");
    expect(css).not.toContain('.social-tray__shell::after {');
    expect(css).not.toContain('.social-tray__launcher::after {');
    expect(trayTs).toContain("plaque.className = 'social-tray__launcher-plaque'");
    expect(trayTs).toContain("cue.className = 'social-tray__launcher-cue'");
    expect(trayTs).not.toContain("seal.className = 'social-tray__launcher-seal'");
    expect(css).toMatch(/\.social-tray__launcher\s*\{[\s\S]*?width: 244px;[\s\S]*?height: 112px;/);
    expect(css).toMatch(/\.social-tray__launcher-plaque\s*\{[\s\S]*?height: 62px;/);
    expect(css).not.toContain('.social-tray__launcher-copy::after');
    expect(css).not.toContain('.social-tray__launcher-seal');
    expect(homepageCss).not.toMatch(
      /@media \(max-width: 620px\)[\s\S]*?#site-social-tray-root\s*\{\s*display:\s*none\s*!important;/,
    );
  });

  it('reveals the desktop speech bubble after ten seconds and keeps it open until dismissed', () => {
    expect(SOCIAL_SPEECH_REVEAL_DELAY_MS).toBe(10_000);
    expect(trayTs).toContain("const SPEECH_VISIBLE_CLASS = 'social-tray__speech--visible'");
    expect(trayTs).toContain('window.clearTimeout(speechRevealTimer)');
    expect(trayTs).not.toContain('speechHideTimer');
    expect(trayTs).not.toContain('SOCIAL_SPEECH_VISIBLE_DURATION_MS');
    expect(trayTs).toContain("speechCloseButton.className = 'social-tray__speech-close'");
    expect(trayTs).toContain('speechCloseButton.hidden = true');
    expect(trayTs).toContain("speechCloseButton.setAttribute('aria-describedby', title.id)");
    expect(trayTs).toContain("localizeAria(speechCloseButton, 'skinEvent.close')");
    expect(trayTs).toContain("closeGlyph.textContent = '×'");
    expect(trayTs).toContain("nav.setAttribute('aria-labelledby', title.id)");
    expect(trayTs).toContain('speechDismissed = true');
    expect(trayTs).toContain("window.sessionStorage.setItem(SPEECH_DISMISSED_SESSION_KEY, 'true')");
    expect(trayTs).toContain('let speechDismissed = hasSessionSpeechDismissal()');
    expect(trayTs).toContain("window.addEventListener('pagehide', clearSpeechTimer");
    expect(css).toMatch(
      /\.social-tray__speech\s*\{[\s\S]*?opacity: 0;[\s\S]*?transform: translate\(22px, 6px\) scale\(0\.94\);/,
    );
    expect(css).toMatch(
      /\.social-tray--desktop\.social-tray__speech--visible\s+\.social-tray__speech\s*\{[\s\S]*?opacity: 1;[\s\S]*?transform: translate\(0, 0\) scale\(1\);/,
    );
    expect(css).toMatch(
      /\.social-tray__speech-close\s*\{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 50%;/,
    );
    expect(css).toContain('.social-tray__speech-close:focus-visible');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.social-tray__speech,[\s\S]*?\.social-tray__speech-close\s*\{[\s\S]*?transition: none;/,
    );
  });

  it('keeps a manual dismissal closed across a same-session remount', async () => {
    const dom = new JSDOM('<div id="first"></div><div id="second"></div>', {
      url: 'https://worldofclaudecraft.test/',
    });
    let pendingTimer: TimerHandler | undefined;

    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        media: '',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
    Object.defineProperty(dom.window, 'setTimeout', {
      configurable: true,
      value: (handler: TimerHandler) => {
        pendingTimer = handler;
        return 1;
      },
    });
    Object.defineProperty(dom.window, 'clearTimeout', {
      configurable: true,
      value: () => {
        pendingTimer = undefined;
      },
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('MutationObserver', dom.window.MutationObserver);

    try {
      const firstRoot = dom.window.document.getElementById('first');
      const secondRoot = dom.window.document.getElementById('second');
      expect(firstRoot).not.toBeNull();
      expect(secondRoot).not.toBeNull();

      mountLandingSocialTray(firstRoot as HTMLElement);
      const reveal = pendingTimer;
      pendingTimer = undefined;
      expect(typeof reveal).toBe('function');
      if (typeof reveal === 'function') reveal();

      const firstRail = firstRoot?.querySelector('.social-tray--desktop');
      const closeButton = firstRoot?.querySelector<HTMLButtonElement>('.social-tray__speech-close');
      expect(firstRail?.classList.contains('social-tray__speech--visible')).toBe(true);
      expect(closeButton?.hidden).toBe(false);

      closeButton?.focus();
      closeButton?.click();
      await Promise.resolve();

      expect(dom.window.sessionStorage.getItem('woc:social-speech-dismissed:v1')).toBe('true');
      expect(firstRail?.classList.contains('social-tray__speech--visible')).toBe(false);
      expect(closeButton?.hidden).toBe(true);
      expect(dom.window.document.activeElement?.getAttribute('data-social-id')).toBe('x');

      mountLandingSocialTray(secondRoot as HTMLElement);
      expect(pendingTimer).toBeUndefined();
      expect(
        secondRoot
          ?.querySelector('.social-tray--desktop')
          ?.classList.contains('social-tray__speech--visible'),
      ).toBe(false);
      expect(
        secondRoot?.querySelector<HTMLButtonElement>('.social-tray__speech-close')?.hidden,
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });
  it('keeps hover and keyboard labels outside an unclipped shell', () => {
    const shellRule = css.match(/\.social-tray__shell\s*\{([^}]*)\}/)?.[1];
    expect(shellRule).toBeDefined();
    expect(shellRule).not.toContain('clip-path');
    expect(css).toMatch(/\.social-tray__shell::before\s*\{[\s\S]*?clip-path: polygon/);
    expect(css).toContain('width: 66px;');
    expect(css).toContain('.social-tray__list::after');
    expect(css).toContain('.social-tray__finial::before');
    expect(css).toMatch(
      /\.social-tray__link:focus-visible \.social-tray__label\s*\{[\s\S]*?opacity: 1/,
    );
  });

  it('honors reduced motion and forced-color accessibility modes', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('outline-color: Highlight;');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.social-tray__drawer[\s\S]*?animation: none;/,
    );
    expect(trayTs).not.toContain("closeButton.textContent = 'x'");
  });

  it('serves final WebP character artwork below 100 KB per asset', () => {
    for (const asset of [
      'public/site/social-tray/character.webp',
      'public/site/social-tray/ivory-crown.webp',
    ]) {
      const absolute = join(root, asset);
      expect(existsSync(absolute), asset).toBe(true);
      expect(statSync(absolute).size, asset).toBeLessThan(100 * 1024);
      expect(`${trayTs}\n${css}`).toContain(`/${asset.replace(/^public\//, '')}`);
    }
  });

  it('keeps the original mobile mascot separate from transparent carved bench artwork', async () => {
    const asset = 'public/site/social-tray/mobile-social-bench-v2.webp';
    const absolute = join(root, asset);
    expect(existsSync(absolute), asset).toBe(true);
    expect(statSync(absolute).size, asset).toBeLessThan(100 * 1024);
    await expect(sharp(absolute).metadata()).resolves.toEqual(
      expect.objectContaining({
        channels: 4,
        hasAlpha: true,
        height: 175,
        width: 720,
      }),
    );
    expect(trayTs).toContain(asset.replace(/^public/, ''));
    expect(trayTs).toContain("bench.className = 'social-tray__launcher-bench'");
    expect(trayTs).toContain("character.className = 'social-tray__mobile-character'");
    expect(trayTs).toContain("character.src = '/site/social-tray/character.webp'");
    expect(css).not.toContain('social-tray__launcher-deprecated');
    expect(css).toMatch(
      /\.social-tray__launcher-bench\s*\{[\s\S]*?width:\s*330px;[\s\S]*?max-width:\s*none;/,
    );
    expect(css).toMatch(
      /\.social-tray__character-stage--compact\s*\{[\s\S]*?left:\s*-74px;[\s\S]*?width:\s*96px;/,
    );
    expect(css).toMatch(/\.social-tray__mobile-character\s*\{[\s\S]*?width:\s*96px;/);
  });
});
