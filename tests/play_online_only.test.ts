// The /play entry (play.html) goes straight to the ONLINE realm: it ships no
// Online/Offline realm dropdown and no offline single-player panel (both stay on
// the landing page, index.html), carries the Continue with Discord login and the
// Terms of Service footer link, and uses the same lazily-attached hero backdrop
// as the landing page. main.ts is shared by both entries, so every hook the
// online-only entry omits must be resolved defensively there; these tests pin
// both sides of that contract so one entry cannot silently break the other.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) =>
  readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const playHtml = read('play.html');
const indexHtml = read('index.html');
const mainTs = read('src/main.ts');
const playExtraCss = read('src/styles/play.extra.css');

describe('/play is online-only', () => {
  it('play.html has no realm dropdown and no offline flow', () => {
    for (const id of [
      'server-select',
      'server-select-menu',
      'server-opt-offline',
      'offline-select',
      'btn-offline',
      'btn-start-offline',
      'btn-offline-back',
    ]) {
      expect(playHtml).not.toContain(`id="${id}"`);
    }
    // The online compat trigger stays: E2E tours drive the online flow through it.
    expect(playHtml).toContain('id="btn-online"');
    // The solo console keeps the single Play CTA plus the live players line.
    expect(playHtml).toContain('class="play-console play-console-solo"');
    expect(playHtml).toContain('id="btn-play"');
    expect(playHtml).toContain('js-stat-accounts');
  });

  it('index.html (the landing page) keeps the realm dropdown and offline flow', () => {
    for (const id of ['server-select', 'server-opt-offline', 'offline-select', 'btn-offline']) {
      expect(indexHtml).toContain(`id="${id}"`);
    }
  });

  it('main.ts wires the Play button straight to online when the dropdown is absent', () => {
    // The dropdown block is conditional; without it the Play button must still be
    // wired (to the online flow), or /play renders a dead Play button.
    expect(mainTs).toContain("btnPlay.addEventListener('click', handleOnlineSelect);");
  });

  it('main.ts resolves every /play-absent hook defensively', () => {
    // Each of these throws at boot on /play if resolved without a guard.
    expect(mainTs).toContain('if (offlineBtn) {');
    expect(mainTs).toContain('if (btnStartOffline) {');
    expect(mainTs).toContain("if (offlineBackBtn) offlineBackBtn.addEventListener('click'");
    expect(mainTs).toContain("serverTrigger?.querySelector('.server-dot')");
    // The character-preview boot probe must skip a missing #offline-select, not
    // dereference it (and a missing panel must not be treated as the active one).
    expect(mainTs).toContain('return panel !== null && !panel.hasAttribute(');
  });
});

describe('/play login panel carries Continue with Discord', () => {
  it('play.html ships the Discord login button and the or-email divider', () => {
    expect(playHtml).toContain('id="btn-login-discord"');
    expect(playHtml).toContain('data-i18n="hudChrome.discord.loginCta"');
    expect(playHtml).toContain('id="auth-or-divider"');
  });

  it('main.ts reveals the button only when present and Discord is enabled', () => {
    expect(mainTs).toContain('if (discordLoginBtn && DISCORD_BUILD_ENABLED)');
  });
});

describe('/play footer carries the legal links', () => {
  it('play.html links the Terms of Service and Privacy Policy', () => {
    expect(playHtml).toContain('href="/terms"');
    expect(playHtml).toContain('data-i18n="footer.terms"');
    expect(playHtml).toContain('href="/privacy"');
    expect(playHtml).toContain('data-i18n="footer.privacy"');
  });
});

describe('/play uses the landing hero backdrop', () => {
  it('play.html defers the trailer exactly like index.html (poster paints first)', () => {
    // Same lazily-attached pattern as the landing hero: data-trailer-src, no
    // eager <source>, no autoplay, preload="none" (applyLandingBackdrop attaches
    // and plays the trailer only on capable devices).
    expect(playHtml).toContain('data-trailer-src="/home-bg.mp4"');
    expect(playHtml).toContain('poster="/home-bg.png"');
    expect(playHtml).not.toContain('<source src="/home-bg.mp4"');
    const playVideoTag = /<video id="bg-home"[^>]*>/.exec(playHtml)?.[0] ?? '';
    const indexVideoTag = /<video id="bg-home"[^>]*>/.exec(indexHtml)?.[0] ?? '';
    expect(playVideoTag).not.toContain('autoplay');
    expect(playVideoTag).toContain('preload="none"');
    expect(playVideoTag).toBe(indexVideoTag);
  });
});

describe('/play keeps its tracking and SEO head', () => {
  it('play.html keeps the Google tag with the localhost guard', () => {
    expect(playHtml).toContain('googletagmanager.com/gtag/js?id=G-BR5Z7GT7C2');
    expect(playHtml).toContain("gtag('config', 'G-BR5Z7GT7C2')");
    expect(playHtml).toContain("['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)");
  });

  it('play.html keeps its canonical /play SEO surface', () => {
    expect(playHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/play" />',
    );
    expect(playHtml).toContain('property="og:url" content="https://worldofclaudecraft.com/play"');
  });
});

describe('/play solo console styling stays per-entry', () => {
  it('play.extra.css styles the solo console (and only play.html loads it)', () => {
    expect(playExtraCss).toContain('.play-console-solo');
    expect(playExtraCss).toContain('.play-online-status');
    expect(indexHtml).not.toContain('play.extra.css');
  });
});
