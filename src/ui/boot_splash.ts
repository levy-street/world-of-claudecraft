import {
  BOOT_PENDING_CLASS,
  BOOT_SPLASH_COSMETIC_WAIT_MS,
  BOOT_SPLASH_ID,
  BOOT_SPLASH_LEAVING_CLASS,
  BOOT_SPLASH_OWNED_EVENT,
  BOOT_STYLESHEET_SETTLED_KEY,
  bootSplashReady,
  firstBackgroundImageUrl,
} from './boot_splash_core';

const LANDING_FONT_TOKENS = ['--font-display', '--font-ui'] as const;
export const LANDING_BACKDROP_SELECTORS = [
  '#start-screen-backdrop .website-cinematic-art',
  '#bg-home',
] as const;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function settled(link: HTMLLinkElement): Promise<void> {
  if (link.sheet || BOOT_STYLESHEET_SETTLED_KEY in link.dataset) return Promise.resolve();
  return new Promise<void>((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

/**
 * The game stylesheets load after the splash (see scripts/lib/boot_splash_stylesheets.mjs)
 * and not every engine holds module scripts until they arrive. The same-origin sheets
 * style the page and are required; a third-party one (the web font CSS) is cosmetic.
 */
function stylesheets(): { own: Promise<unknown>; thirdParty: Promise<unknown> } {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')];
  // Protocol and host, not URL.origin, which is "null" for a custom scheme such as
  // the iOS shell's capacitor://.
  const isOwn = (link: HTMLLinkElement) => {
    const url = new URL(link.href, location.href);
    return url.protocol === location.protocol && url.host === location.host;
  };
  return {
    own: Promise.all(links.filter(isOwn).map(settled)),
    thirdParty: Promise.all(links.filter((link) => !isOwn(link)).map(settled)),
  };
}

function landingFontsLoaded(): Promise<unknown> {
  const fonts = document.fonts;
  if (!fonts) return Promise.resolve();
  const rootStyle = getComputedStyle(document.documentElement);
  return Promise.all(
    LANDING_FONT_TOKENS.map((token) => rootStyle.getPropertyValue(token).trim())
      .filter(Boolean)
      .map((family) => fonts.load(`1em ${family}`)),
  );
}

function backdropUrl(): string | null {
  for (const selector of LANDING_BACKDROP_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || el.getClientRects().length === 0) continue;
    if (el instanceof HTMLVideoElement) return el.poster || null;
    return firstBackgroundImageUrl(getComputedStyle(el).backgroundImage);
  }
  return null;
}

function backdropDecoded(): Promise<unknown> {
  const url = backdropUrl();
  if (!url) return Promise.resolve();
  const img = new Image();
  img.src = url;
  return img.decode();
}

function lift(fadeMs: number): void {
  document.body.classList.remove(BOOT_PENDING_CLASS);
  const splash = document.getElementById(BOOT_SPLASH_ID);
  if (!splash) return;
  if (fadeMs <= 0) {
    splash.remove();
    return;
  }
  splash.classList.add(BOOT_SPLASH_LEAVING_CLASS);
  setTimeout(() => splash.remove(), fadeMs);
}

/**
 * Takes the boot splash over from the inline fail-safe and lifts it once the start
 * screen is presentable: its own stylesheets and `localized` (the boot locale applied)
 * settled, then its web fonts and backdrop image within the cosmetic bound. A boot that
 * skips the start screen passes `landing: false` and only waits for the stylesheets.
 */
export async function liftBootSplashWhenReady(opts: {
  landing: boolean;
  localized?: PromiseLike<unknown>;
  fadeMs: number;
}): Promise<void> {
  document.dispatchEvent(new Event(BOOT_SPLASH_OWNED_EVENT));
  const sheets = stylesheets();
  const required = opts.localized ? [sheets.own, opts.localized] : [sheets.own];
  const cosmetic = opts.landing
    ? [
        sheets.thirdParty,
        Promise.all([sheets.own, sheets.thirdParty]).then(landingFontsLoaded),
        sheets.own.then(backdropDecoded),
      ]
    : [];
  await bootSplashReady(required, cosmetic, BOOT_SPLASH_COSMETIC_WAIT_MS, delay);
  lift(opts.fadeMs);
}
