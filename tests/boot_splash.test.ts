// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOADING_CURTAIN_FADE_MS } from '../src/game/ui_effects_profile';
import { LANDING_BACKDROP_SELECTORS, liftBootSplashWhenReady } from '../src/ui/boot_splash';
import {
  BOOT_PENDING_CLASS,
  BOOT_SPLASH_COSMETIC_WAIT_MS,
  BOOT_SPLASH_ID,
  BOOT_SPLASH_LEAVING_CLASS,
  BOOT_SPLASH_OWNED_EVENT,
  bootSplashReady,
  firstBackgroundImageUrl,
} from '../src/ui/boot_splash_core';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ENTRIES = ['index.html', 'play.html'] as const;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const never = () => new Promise<void>(() => {});

function resetDom(): void {
  document.dispatchEvent(new Event(BOOT_SPLASH_OWNED_EVENT));
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'fonts');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '';
  document.body.className = '';
  document.body.innerHTML = '';
}

function mountSplash(): HTMLElement {
  document.body.className = `${BOOT_PENDING_CLASS} start-screen-open`;
  document.body.innerHTML = `<div id="${BOOT_SPLASH_ID}"><img class="boot-splash-logo" /></div><main id="start-screen"></main>`;
  return document.getElementById(BOOT_SPLASH_ID) as HTMLElement;
}

function addStylesheet(opts: { href?: string; sheet?: object | null; settled?: boolean }) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // A defined property, not the attribute: happy-dom would really fetch an href.
  Object.defineProperty(link, 'href', {
    value: new URL(opts.href ?? '/assets/main.css', location.href).href,
  });
  Object.defineProperty(link, 'sheet', { value: opts.sheet ?? null });
  if (opts.settled) link.dataset.bootSettled = '';
  document.head.append(link);
  return link;
}

function trackLift(promise: Promise<void>) {
  const state = { lifted: false };
  void promise.then(() => {
    state.lifted = true;
  });
  return state;
}

describe('bootSplashReady', () => {
  it('waits for every required probe, and a rejected one still releases', async () => {
    const a = deferred();
    const b = deferred();
    let done = false;
    void bootSplashReady([a.promise, b.promise], [], 0, () => Promise.resolve()).then(() => {
      done = true;
    });
    a.reject(new Error('locale fetch failed'));
    await flush();
    expect(done).toBe(false);
    b.resolve();
    await flush();
    expect(done).toBe(true);
  });

  it('waits for every cosmetic probe until the bound elapses', async () => {
    const font = deferred();
    const bound = deferred();
    const delay = vi.fn(() => bound.promise);
    let done = false;
    void bootSplashReady([], [Promise.resolve(), font.promise], 3000, delay).then(() => {
      done = true;
    });
    await flush();
    expect(delay).toHaveBeenCalledWith(3000);
    expect(done).toBe(false);
    bound.resolve();
    await flush();
    expect(done).toBe(true);
  });

  it('does not wait for the bound when the cosmetic probes settle first', async () => {
    let done = false;
    void bootSplashReady([], [Promise.reject(new Error('decode'))], 3000, never).then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(true);
  });

  it('starts the cosmetic bound only after the required probes settled', async () => {
    const required = deferred();
    const delay = vi.fn(() => Promise.resolve());
    void bootSplashReady([required.promise], [never()], 3000, delay);
    await flush();
    expect(delay).not.toHaveBeenCalled();
    required.resolve();
    await flush();
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('bounds the cosmetic wait at three seconds', () => {
    expect(BOOT_SPLASH_COSMETIC_WAIT_MS).toBe(3000);
  });
});

describe('firstBackgroundImageUrl', () => {
  it('reads the first url of a layered background', () => {
    expect(
      firstBackgroundImageUrl('url("/website-hero-eastbrook-v1.webp"), url("/fallback.webp")'),
    ).toBe('/website-hero-eastbrook-v1.webp');
    expect(firstBackgroundImageUrl("url('/a.webp')")).toBe('/a.webp');
    expect(firstBackgroundImageUrl('url(/b.webp)')).toBe('/b.webp');
  });

  it('returns null when there is no image', () => {
    expect(firstBackgroundImageUrl('none')).toBeNull();
    expect(firstBackgroundImageUrl('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('liftBootSplashWhenReady', () => {
  afterEach(resetDom);

  it('holds the splash until the boot locale is applied, then fades it out and removes it', async () => {
    const splash = mountSplash();
    const localized = deferred();
    vi.useFakeTimers();
    const state = trackLift(
      liftBootSplashWhenReady({ landing: false, localized: localized.promise, fadeMs: 350 }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.lifted).toBe(false);
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(true);
    expect(splash.isConnected).toBe(true);

    localized.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.lifted).toBe(true);
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(false);
    expect(document.body.classList.contains('start-screen-open')).toBe(true);
    expect(splash.classList.contains(BOOT_SPLASH_LEAVING_CLASS)).toBe(true);
    expect(splash.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(349);
    expect(splash.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(splash.isConnected).toBe(false);
  });

  it('holds a landing lift for a same-origin stylesheet even once the locale is applied', async () => {
    mountSplash();
    const link = addStylesheet({ href: '/assets/main.css' });
    vi.useFakeTimers();
    const state = trackLift(
      liftBootSplashWhenReady({ landing: true, localized: Promise.resolve(), fadeMs: 0 }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.lifted).toBe(false);
    link.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.lifted).toBe(true);
    expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
  });

  it('releases on the load event of a stylesheet still loading', async () => {
    mountSplash();
    const link = addStylesheet({ href: '/assets/main.css' });
    const state = trackLift(liftBootSplashWhenReady({ landing: false, fadeMs: 0 }));
    await flush();
    expect(state.lifted).toBe(false);
    link.dispatchEvent(new Event('load'));
    await flush();
    expect(state.lifted).toBe(true);
  });

  it('does not wait on a stylesheet already loaded or already marked settled', async () => {
    mountSplash();
    addStylesheet({ href: '/assets/main.css', sheet: {} });
    addStylesheet({ href: '/assets/extra.css', settled: true });
    const state = trackLift(liftBootSplashWhenReady({ landing: false, fadeMs: 0 }));
    await flush();
    expect(state.lifted).toBe(true);
  });

  it('treats a third-party stylesheet as cosmetic: never required, bounded on the landing', async () => {
    mountSplash();
    addStylesheet({ href: 'https://fonts.googleapis.com/css2?family=Cinzel' });
    const offLanding = trackLift(liftBootSplashWhenReady({ landing: false, fadeMs: 0 }));
    await flush();
    expect(offLanding.lifted).toBe(true);

    mountSplash();
    vi.useFakeTimers();
    const onLanding = trackLift(
      liftBootSplashWhenReady({ landing: true, localized: Promise.resolve(), fadeMs: 0 }),
    );
    await vi.advanceTimersByTimeAsync(BOOT_SPLASH_COSMETIC_WAIT_MS - 1);
    expect(onLanding.lifted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(onLanding.lifted).toBe(true);
  });

  it('lifts the landing splash within the cosmetic bound even if fonts never load', async () => {
    mountSplash();
    document.documentElement.style.setProperty('--font-display', '"Cinzel", serif');
    const load = vi.fn(never);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    vi.useFakeTimers();
    const state = trackLift(
      liftBootSplashWhenReady({ landing: true, localized: Promise.resolve(), fadeMs: 0 }),
    );
    await vi.advanceTimersByTimeAsync(BOOT_SPLASH_COSMETIC_WAIT_MS - 1);
    expect(load).toHaveBeenCalledWith('1em "Cinzel", serif');
    expect(state.lifted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.lifted).toBe(true);
    expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
  });

  it('removes the splash at once when motion is reduced (fade 0)', async () => {
    mountSplash();
    await liftBootSplashWhenReady({ landing: false, fadeMs: 0 });
    expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(false);
  });

  it('only clears the body class when the fail-safe already removed the splash', async () => {
    document.body.className = BOOT_PENDING_CLASS;
    await liftBootSplashWhenReady({ landing: false, fadeMs: 350 });
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(false);
  });

  it('announces that it owns the splash before waiting', () => {
    mountSplash();
    const owned = vi.fn();
    document.addEventListener(BOOT_SPLASH_OWNED_EVENT, owned);
    addStylesheet({ href: '/assets/main.css' });
    void liftBootSplashWhenReady({ landing: false, fadeMs: 0 });
    expect(owned).toHaveBeenCalledTimes(1);
    document.removeEventListener(BOOT_SPLASH_OWNED_EVENT, owned);
  });
});

function inlineFailSafe(html: string): string {
  const start = html.indexOf('<div id="boot-splash"');
  const open = html.indexOf('<script>', start);
  return html.slice(open + '<script>'.length, html.indexOf('</script>', open));
}

describe('inline fail-safe', () => {
  afterEach(resetDom);

  function boot(): HTMLElement {
    const splash = mountSplash();
    vi.useFakeTimers();
    new Function(inlineFailSafe(read('../index.html')))();
    return splash;
  }

  const released = (splash: HTMLElement) =>
    !splash.isConnected && !document.body.classList.contains(BOOT_PENDING_CLASS);

  it('releases when a game module fails to load', () => {
    const splash = boot();
    const script = document.createElement('script');
    script.type = 'module';
    document.head.append(script);
    script.dispatchEvent(new Event('error'));
    expect(released(splash)).toBe(true);
  });

  it('releases when the boot throws from a same-origin script', () => {
    const splash = boot();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', filename: `${location.origin}/src/main.ts` }),
    );
    expect(released(splash)).toBe(true);
  });

  it('ignores third-party script errors and failed images', () => {
    const splash = boot();
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'blocked',
        filename: 'https://connect.facebook.net/x.js',
      }),
    );
    const blocked = document.createElement('script');
    document.head.append(blocked);
    blocked.dispatchEvent(new Event('error'));
    const img = document.createElement('img');
    document.body.append(img);
    img.dispatchEvent(new Event('error'));
    expect(splash.isConnected).toBe(true);
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(true);
  });

  it('releases after sixty seconds', () => {
    const splash = boot();
    vi.advanceTimersByTime(59_999);
    expect(splash.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(released(splash)).toBe(true);
  });

  it('holds the capped release until its own stylesheets settled, never a third-party one', () => {
    const splash = boot();
    const own = addStylesheet({ href: '/assets/main.css' });
    addStylesheet({ href: 'https://fonts.googleapis.com/css2?family=Cinzel' });
    vi.advanceTimersByTime(90_000);
    expect(splash.isConnected).toBe(true);
    own.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1000);
    expect(released(splash)).toBe(true);
  });

  it('hands the error arm to the boot module but keeps the cap', () => {
    const splash = boot();
    document.dispatchEvent(new Event(BOOT_SPLASH_OWNED_EVENT));
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'late', filename: `${location.origin}/src/main.ts` }),
    );
    expect(splash.isConnected).toBe(true);
    expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(released(splash)).toBe(true);
  });

  it('stills the splash for the in-game reduce motion setting', () => {
    localStorage.setItem('woc_settings', JSON.stringify({ reduceMotion: true }));
    const still = boot();
    expect(still.classList.contains('boot-splash-still')).toBe(true);
    resetDom();
    localStorage.setItem('woc_settings', JSON.stringify({ reduceMotion: false }));
    expect(boot().classList.contains('boot-splash-still')).toBe(false);
    localStorage.removeItem('woc_settings');
  });

  it('marks a stylesheet link that loaded or failed', () => {
    boot();
    const loaded = document.createElement('link');
    const failed = document.createElement('link');
    document.head.append(loaded, failed);
    loaded.dispatchEvent(new Event('load'));
    failed.dispatchEvent(new Event('error'));
    expect('bootSettled' in loaded.dataset).toBe(true);
    expect('bootSettled' in failed.dataset).toBe(true);
  });

  it('shows the logo once it has loaded', () => {
    const splash = boot();
    const logo = splash.querySelector('.boot-splash-logo') as HTMLImageElement;
    expect(logo.classList.contains('is-loaded')).toBe(false);
    logo.dispatchEvent(new Event('load'));
    expect(logo.classList.contains('is-loaded')).toBe(true);
  });
});

describe('entry markup', () => {
  for (const entry of ENTRIES) {
    describe(entry, () => {
      const html = read(`../${entry}`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const splash = doc.getElementById(BOOT_SPLASH_ID);

      it('starts with the boot-pending body class and the splash as the first body element', () => {
        expect(doc.body.classList.contains(BOOT_PENDING_CLASS)).toBe(true);
        expect(doc.body.firstElementChild).toBe(splash);
        expect(splash?.getAttribute('aria-hidden')).toBe('true');
      });

      it('shows the same logo the start screen uses, preloaded from the head', () => {
        const logo = splash?.querySelector<HTMLImageElement>('img.boot-splash-logo');
        const introLogo = doc.getElementById('intro-logo') as HTMLImageElement | null;
        expect(logo?.getAttribute('src')).toBe(introLogo?.getAttribute('src'));
        expect(logo?.getAttribute('alt')).toBe('');
        const preload = doc.head.querySelector(
          `link[rel="preload"][as="image"][href="${logo?.getAttribute('src')}"]`,
        );
        expect(preload?.getAttribute('fetchpriority')).toBe('high');
        expect(splash?.querySelector('.boot-splash-bar')).not.toBeNull();
      });

      it('carries the inline fail-safe right after the splash', () => {
        expect(splash?.nextElementSibling?.tagName).toBe('SCRIPT');
        expect(inlineFailSafe(html)).toContain(BOOT_SPLASH_OWNED_EVENT);
      });

      it('fades the splash over the same duration the lift waits', () => {
        expect(html).toMatch(
          new RegExp(`#boot-splash \\{[^}]*transition: opacity ${LOADING_CURTAIN_FADE_MS}ms`),
        );
        expect(html).toContain(`#boot-splash.${BOOT_SPLASH_LEAVING_CLASS} {`);
      });

      it('reserves the logo box before the image arrives, at its real size', () => {
        const logo = splash?.querySelector<HTMLImageElement>('img.boot-splash-logo');
        const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
        const png = readFileSync(join(repoRoot, 'public', logo?.getAttribute('src') ?? ''));
        expect(logo?.getAttribute('width')).toBe(String(png.readUInt32BE(16)));
        expect(logo?.getAttribute('height')).toBe(String(png.readUInt32BE(20)));
      });

      it('paints with the landing palette tokens', () => {
        const tokens = read('../src/styles/tokens.css');
        const token = (name: string) =>
          new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)?.[1]?.toLowerCase();
        const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).toLowerCase();
        expect(css).toContain(`background: ${token('--website-ink-deep')};`);
        expect(css).toContain(`${token('--website-gold-bright')}, transparent`);
        const gold = token('--website-gold') ?? '';
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(gold.slice(i, i + 2), 16));
        expect(css).toContain(`rgb(${r} ${g} ${b} / 0.22)`);
      });

      it('has every landing backdrop the cosmetic probe looks for', () => {
        for (const selector of LANDING_BACKDROP_SELECTORS) {
          expect(doc.querySelector(selector), selector).not.toBeNull();
        }
      });
    });
  }

  it('keeps the splash markup and fail-safe byte-identical across both entries', () => {
    const block = (html: string) => {
      const start = html.indexOf('<div id="boot-splash"');
      return html.slice(start, html.indexOf('</script>', start));
    };
    const index = block(read('../index.html'));
    expect(index).toContain('id="boot-splash"');
    expect(block(read('../play.html'))).toBe(index);
  });
});

describe('main.ts wiring', () => {
  const main = read('../src/main.ts').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

  it('lifts the landing splash with the boot locale promise of the start screens', () => {
    expect(main).toMatch(/const localized = wireStartScreens\(\);/);
    expect(main).toMatch(
      /liftBootSplashWhenReady\(\{\s*landing: true,\s*localized,\s*fadeMs: loadingCurtainFadeDelayMs\(\)/,
    );
    expect(main).toMatch(/const localized = ensureLocaleLoaded\(bootLang\)\.then\(/);
    expect(main).toMatch(/return localized;\s*\}/);
  });

  it('lifts the splash without the landing probes when the boot skips the start screen', () => {
    const lift = String.raw`void liftBootSplashWhenReady\(\{ landing: false, fadeMs: loadingCurtainFadeDelayMs\(\) \}\);\s*void startOffline\(`;
    expect(main).toMatch(
      new RegExp(String.raw`if \(editorPlaytest\) \{\s*startSitePresence\('home'\);\s*${lift}`),
    );
    expect(main).toMatch(
      new RegExp(
        String.raw`else if \(diagnosticsAutoOffline\) \{\s*startSitePresence\('home'\);\s*${lift}`,
      ),
    );
  });
});
