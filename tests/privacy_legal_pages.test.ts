import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const policyMarkdown = read('../PRIVACY_POLICY.md');
const privacyHtml = read('../public/privacy.html');
const cookiesHtml = read('../public/cookies.html');
const sitemapXml = read('../public/sitemap.xml');
const indexHtml = read('../index.html');
const playHtml = read('../play.html');
const termsHtml = read('../public/terms.html');
const supportHtml = read('../public/support.html');
const dataDeletionHtml = read('../public/data-deletion.html');
const returnToGameScript = read('../public/return-to-game.js');
const serverMain = read('../server/main.ts');
const viteConfig = read('../vite.config.ts');

describe('privacy and cookie legal pages', () => {
  it('publishes the updated privacy policy without browsewrap acceptance language', () => {
    expect(policyMarkdown).toContain('Last updated: 12 July 2026');
    expect(privacyHtml).toContain('Last updated: 12 July 2026');
    expect(privacyHtml).toContain('"dateModified": "2026-07-12"');
    expect(policyMarkdown).not.toContain('By using the Service you agree');
    expect(privacyHtml).not.toContain('By using the Service you agree');
    expect(policyMarkdown).not.toContain('continued use of the Service after an update');
    expect(privacyHtml).not.toContain('continued use of the Service after an update');
  });

  it('names every active measurement, marketing, embed, security, and telemetry surface', () => {
    for (const expected of [
      'Google Analytics',
      'Meta Pixel',
      'Meta Conversions API',
      'X timeline',
      'Twitch stream',
      'Cloudflare Turnstile',
      'First-party site presence',
      'First-party performance telemetry',
      'Google Fonts',
      'Global Privacy Control',
      'woc_privacy_consent',
      '180 days',
    ]) {
      expect(policyMarkdown).toContain(expected);
      expect(privacyHtml).toContain(expected);
    }
    expect(policyMarkdown).toContain('sale, sharing, or targeted advertising');
    expect(policyMarkdown).toContain('International transfers');
    expect(policyMarkdown).toContain('country or region code');
  });

  it('publishes a canonical cookie notice with controls and a storage register', () => {
    expect(cookiesHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/cookies" />',
    );
    expect(cookiesHtml).toContain('<h1>Cookie Notice</h1>');
    expect(cookiesHtml).toContain('Last updated: 12 July 2026');
    expect(cookiesHtml).toContain('data-privacy-choices');
    expect(cookiesHtml).toContain('href="/?privacy-settings=1"');
    expect(cookiesHtml).toContain('id="privacy-choice-summary"');
    expect(cookiesHtml).toContain('navigator.globalPrivacyControl === true');
    expect(cookiesHtml).toContain('<caption>Current technology register</caption>');

    for (const category of ['Necessary', 'Analytics', 'Marketing', 'X timeline', 'Twitch stream']) {
      expect(cookiesHtml).toContain(category);
    }
    for (const storageName of [
      'woc_privacy_consent',
      'woc_session',
      'woc_site_visitor_id',
      'woc_perf_session_id',
      '_ga',
      '_fbp',
      '_fbc',
    ]) {
      expect(cookiesHtml).toContain(storageName);
    }
  });

  it('routes and links the cookie notice and privacy choices from public surfaces', () => {
    expect(serverMain).toContain("['/cookies', '/cookies.html']");
    expect(serverMain).toContain("['/cookies/', '/cookies.html']");
    expect(viteConfig).toContain("['/cookies', '/cookies.html']");
    expect(viteConfig).toContain("['/cookies/', '/cookies.html']");
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/cookies</loc>');

    for (const html of [indexHtml, playHtml]) {
      expect(html).toContain('href="/cookies" class="footer-link"');
      expect(html).toContain('data-i18n="footer.cookies"');
      expect(html).not.toContain('data-i18n="footer.privacyChoices"');
    }
  });

  it('returns from legal and support pages to the page that opened them', () => {
    for (const html of [termsHtml, privacyHtml, cookiesHtml, supportHtml, dataDeletionHtml]) {
      expect(html).toContain('href="/" data-return-to-game>Return to Game</a>');
      expect(html).toContain('<script src="/return-to-game.js"></script>');
    }

    expect(returnToGameScript).toContain('referrer?.origin !== window.location.origin');
    expect(returnToGameScript).toContain('window.history.back()');
  });
});
