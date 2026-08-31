import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasChromeIconArt } from '../src/ui/chrome_icon_art';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  isSteamDistribution,
  STEAM_APP_ID,
  STEAM_BUILD_BODY_CLASS,
  STEAM_WISHLIST_PENDING_BODY_CLASS,
  STEAM_WISHLIST_URL,
  steamWishlistSuppressed,
  syncSteamWishlistVisibility,
} from '../src/ui/steam_wishlist';
import { hasUiIcon, svgIcon } from '../src/ui/ui_icons';

// The always-visible "Wishlist on Steam" reminder. Four things are worth pinning,
// and they are the four ways this feature can rot:
//   1. the SUPPRESSION policy (who must never see it) stays a pure decision, and
//      the shell probe degrades toward showing rather than hiding;
//   2. the reminder is on every surface, in BOTH entry documents, with the same
//      URL as the module constant (the play.html shared-entry trap: markup that
//      drifts between entries fails silently at runtime);
//   3. the CSS keeps it QUIET: the sheen stays gated on the ambient-effects tier,
//      and the suppression rule reaches every surface at once;
//   4. the copy is localized, including the five non-Latin fills M16 requires.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ENTRIES = ['index.html', 'play.html'] as const;
const entry = (file: string): string => readFileSync(join(repoRoot, file), 'utf8');
const hudCss = (): string => readFileSync(join(repoRoot, 'src/styles/hud.css'), 'utf8');
const shellCss = (): string => readFileSync(join(repoRoot, 'src/styles/shell.css'), 'utf8');

/** The four wishlist surfaces, keyed by the class that identifies each one. */
const SURFACES = [
  { name: 'homepage header CTA', marker: 'class="steam-wishlist steam-wishlist-cta"' },
  {
    name: 'homepage footer link',
    marker: 'class="social-link steam-wishlist steam-wishlist-social"',
  },
  {
    name: 'in-game community rail',
    marker: 'class="community-link steam-wishlist steam-wishlist-chip"',
  },
  { name: 'mobile More tray', marker: 'id="mobile-steam-wishlist"' },
  // Every one of them is a plain link: nothing here needs client state, so the
  // reminder costs src/main.ts (a firewall at its monolith ceiling) nothing.
] as const;

/** Every wishlist element in an entry, as whole opening tags. */
function wishlistTags(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)[^>]*\bsteam-wishlist\b[^>]*>/g)].map((m) => m[0]);
}

describe('steam wishlist suppression policy', () => {
  it('shows the reminder to an ordinary web or desktop player', () => {
    expect(steamWishlistSuppressed({ nativeApp: false, steamBuild: false })).toBe(false);
  });

  it('hides it from the Steam build and from the native store shells', () => {
    expect(steamWishlistSuppressed({ nativeApp: false, steamBuild: true })).toBe(true);
    expect(steamWishlistSuppressed({ nativeApp: true, steamBuild: false })).toBe(true);
    expect(steamWishlistSuppressed({ nativeApp: true, steamBuild: true })).toBe(true);
  });

  it('reads the desktop shell answer, and degrades to showing when it cannot', async () => {
    expect(await isSteamDistribution({ steamLinkSupported: async () => true })).toBe(true);
    expect(await isSteamDistribution({ steamLinkSupported: async () => false })).toBe(false);
    // No bridge (web / native), no probe (an older shell), and a throwing probe
    // all mean "not known to be Steam", which must never hide the reminder from
    // every website desktop build.
    expect(await isSteamDistribution(null)).toBe(false);
    expect(await isSteamDistribution({})).toBe(false);
    expect(
      await isSteamDistribution({
        steamLinkSupported: async () => {
          throw new Error('shell is gone');
        },
      }),
    ).toBe(false);
  });

  it('stamps the body class from the shell answer, in both directions', async () => {
    const toggled: { token: string; force: boolean }[] = [];
    const body = {
      classList: { toggle: (token: string, force: boolean) => toggled.push({ token, force }) },
    };

    await syncSteamWishlistVisibility(true, { steamLinkSupported: async () => true }, body);
    await syncSteamWishlistVisibility(false, null, body);

    expect(toggled).toEqual([
      { token: STEAM_BUILD_BODY_CLASS, force: true },
      { token: STEAM_WISHLIST_PENDING_BODY_CLASS, force: false },
      { token: STEAM_BUILD_BODY_CLASS, force: false },
      { token: STEAM_WISHLIST_PENDING_BODY_CLASS, force: false },
    ]);
  });

  it('keeps the fail-closed boot class until the desktop probe settles', async () => {
    let resolveProbe: ((value: boolean) => void) | undefined;
    const probe = new Promise<boolean>((resolve) => {
      resolveProbe = resolve;
    });
    const classes = new Set([STEAM_WISHLIST_PENDING_BODY_CLASS]);
    const body = {
      classList: {
        toggle: (token: string, force: boolean) =>
          force ? classes.add(token) : classes.delete(token),
      },
    };

    const syncing = syncSteamWishlistVisibility(true, { steamLinkSupported: () => probe }, body);
    await Promise.resolve();
    expect(classes.has(STEAM_WISHLIST_PENDING_BODY_CLASS)).toBe(true);

    resolveProbe?.(true);
    await syncing;
    expect(classes.has(STEAM_WISHLIST_PENDING_BODY_CLASS)).toBe(false);
    expect(classes.has(STEAM_BUILD_BODY_CLASS)).toBe(true);
  });

  it('is wired once at shell boot, beside the other Steam surface', () => {
    // The probe rides wireSteamLink because src/main.ts is a firewall pinned at
    // its monolith ceiling; if that call is ever moved, move this pin with it,
    // because nothing else stamps the class and the reminder would then show
    // inside the Steam build with no test failing.
    const steamLink = readFileSync(join(repoRoot, 'src/ui/steam_link.ts'), 'utf8');
    expect(steamLink).toContain("import { syncSteamWishlistVisibility } from './steam_wishlist';");
    expect(steamLink).toMatch(
      /export function wireSteamLink\(api: Api\): void \{[\s\S]*?void syncSteamWishlistVisibility\(DESKTOP_APP\);/,
    );
  });

  it('points at the real store listing', () => {
    expect(STEAM_APP_ID).toBe(4897790);
    expect(STEAM_WISHLIST_URL).toBe(
      'https://store.steampowered.com/app/4897790/World_of_ClaudeCraft/',
    );
  });
});

describe('steam wishlist markup', () => {
  it('renders every surface in both entry documents', () => {
    for (const file of ENTRIES) {
      const html = entry(file);
      for (const surface of SURFACES) {
        expect(html, `${file} is missing the ${surface.name}`).toContain(surface.marker);
      }
      expect(wishlistTags(html), `${file} surface count`).toHaveLength(SURFACES.length);
    }
  });

  it('starts both entries fail-closed until the Steam-distribution probe settles', () => {
    for (const file of ENTRIES) {
      expect(entry(file), `${file} boot body class`).toContain(
        `<body class="${STEAM_WISHLIST_PENDING_BODY_CLASS}"`,
      );
    }
  });

  it('keeps the two entries byte-identical, tag for tag', () => {
    expect(wishlistTags(entry('play.html'))).toEqual(wishlistTags(entry('index.html')));
  });

  it('links every outbound surface at the module URL, in a safe new tab', () => {
    for (const file of ENTRIES) {
      for (const tag of wishlistTags(entry(file))) {
        expect(tag, file).toContain(`href="${STEAM_WISHLIST_URL}"`);
        expect(tag, file).toContain('target="_blank"');
        expect(tag, file).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it('names itself through the catalog on every surface, never as literal-only copy', () => {
    for (const file of ENTRIES) {
      const html = entry(file);
      for (const tag of wishlistTags(html)) {
        expect(tag, file).toContain('data-i18n-aria="hudChrome.steam.wishlistAria"');
        expect(tag, file).toContain('data-i18n-title="hudChrome.steam.wishlistAria"');
      }
      // Three surfaces carry the full label; the More-tray pill is too narrow
      // for it and carries the short caption with the full one as its name.
      expect(
        html.match(/data-i18n="hudChrome\.steam\.wishlist"/g)?.length,
        `${file} full label keys`,
      ).toBe(SURFACES.length - 1);
      expect(html, `${file} tray caption`).toMatch(
        /id="mobile-steam-wishlist"[\s\S]*?data-i18n="hudChrome\.steam\.wishlistShort"/,
      );
    }
  });

  it('keeps the accessible name containing the visible label (WCAG 2.5.3)', () => {
    setLanguage('en');
    const name = t('hudChrome.steam.wishlistAria');
    // Speech-input users say what they see, so an accessible name that drops the
    // visible words makes the control unspeakable. Both captions must be inside it.
    expect(name).toContain(t('hudChrome.steam.wishlist'));
    expect(name).toContain(t('hudChrome.steam.wishlistShort'));
  });

  it('draws the Steam mark from the one icon registry entry, never a second copy of the path', () => {
    expect(hasUiIcon('steam')).toBe(true);
    // A brand mark is identification only, so it never gains painted chrome art
    // (the role split guarded whole-set by tests/chrome_icons.test.ts).
    expect(hasChromeIconArt('steam')).toBe(false);
    expect(svgIcon('steam')).toContain('viewBox="0 0 512 512"');
    // The positive half first: the registry's Steam mark really does start
    // with this path prefix, so the not-inlined guard below is checking for
    // the actual path and not a vacuous never-present string.
    expect(svgIcon('steam')).toContain('<path d="M11.979 0C5.678');
    for (const file of ENTRIES) {
      for (const tag of wishlistTags(entry(file))) {
        expect(tag, file).toContain('data-icon="steam"');
      }
      // The registry path itself must not be inlined into the shell markup.
      expect(entry(file)).not.toContain('M11.979 0C5.678');
    }
  });
});

describe('steam wishlist styling stays quiet', () => {
  it('suppresses every surface at once, for the Steam build and the native shells', () => {
    const css = hudCss();
    expect(css).toContain(
      'body.steam-wishlist-pending .steam-wishlist,\n  body.native-app .steam-wishlist,\n  body.steam-build .steam-wishlist {\n    display: none !important;\n  }',
    );
    expect(css).toContain(`body.${STEAM_WISHLIST_PENDING_BODY_CLASS} .steam-wishlist`);
    // The class the module stamps and the class the sheet hides must agree.
    expect(css).toContain(`body.${STEAM_BUILD_BODY_CLASS} .steam-wishlist`);
  });

  it('gates the in-game sheen on the ambient effects tier, so low and reduced-motion stop it', () => {
    const css = hudCss();
    const sheen = css.slice(
      css.indexOf('.community-link.steam-wishlist-chip::after'),
      css.indexOf('@keyframes steam-wishlist-sheen'),
    );
    expect(sheen).toContain('animation-play-state: var(--fx-ambient-anim, running);');
    expect(sheen).toContain('animation-duration: calc(14s * var(--motion-scale, 1));');
    // The visible pass is a small slice of the cycle; the rest parks off-screen.
    expect(css).toContain('@keyframes steam-wishlist-sheen');
    expect(css).toMatch(/0%,\n\s*88% \{\n\s*transform: translateX\(-140%\);/);
  });

  it('never fills with Steam blue or the reserved gold, only edges with it on hover and focus', () => {
    const hud = hudCss();
    const shell = shellCss();
    for (const [name, raw] of [
      ['hud.css', hud],
      ['shell.css', shell],
    ] as const) {
      // Comments name the colour too; only declarations are being audited here.
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
      const uses = [...css.matchAll(/#66c0f4/g)];
      expect(uses.length, `${name} uses the Steam accent`).toBeGreaterThan(0);
      for (const use of uses) {
        const line = css.slice(css.lastIndexOf('\n', use.index) + 1, use.index);
        expect(line.trim(), `${name} paints Steam blue on an edge only`).toMatch(
          /^border-color:$|^border-color: $/,
        );
      }
    }
    // The gold call-to-action fill stays with Donate (DESIGN.md 10.1: at most
    // one primary action per surface).
    const cta = shell.slice(
      shell.indexOf('.steam-wishlist-cta {'),
      shell.indexOf('.steam-wishlist-cta:hover'),
    );
    expect(cta).toContain('background: linear-gradient(180deg, #1b1b26 0%, #0d0d14 100%);');
  });

  it('keeps the focus-visible treatment steady (no transition, animation, or filter)', () => {
    let focusRuleCount = 0;
    for (const css of [hudCss(), shellCss()]) {
      for (const match of css.matchAll(/\.steam-wishlist[^{}]*:focus-visible[^{]*\{([^}]*)\}/g)) {
        focusRuleCount += 1;
        expect(match[1]).not.toMatch(/transition|animation|filter/);
      }
    }
    expect(focusRuleCount).toBeGreaterThanOrEqual(2);
  });
});

describe('steam wishlist copy', () => {
  it('resolves the label, the short caption and the accessible name in English', () => {
    setLanguage('en');
    expect(t('hudChrome.steam.wishlist')).toBe('Wishlist on Steam');
    expect(t('hudChrome.steam.wishlistShort')).toBe('Wishlist');
    expect(t('hudChrome.steam.wishlistAria')).toBe(
      'Wishlist on Steam: open the World of ClaudeCraft store page',
    );
  });

  // M16: a new wordy English value ships its five non-Latin fills in the same change.
  it('ships the five non-Latin fills', async () => {
    for (const lang of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(t('hudChrome.steam.wishlist'), lang).not.toBe('Wishlist on Steam');
      expect(t('hudChrome.steam.wishlistShort'), lang).not.toBe('Wishlist');
      expect(t('hudChrome.steam.wishlistAria'), lang).not.toBe(
        'Wishlist on Steam: open the World of ClaudeCraft store page',
      );
      // The brand itself is never transliterated away.
      expect(t('hudChrome.steam.wishlist'), lang).toContain('Steam');
    }
    setLanguage('en');
  });
});
