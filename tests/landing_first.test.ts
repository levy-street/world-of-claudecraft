// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_MODULES_ELEMENT_ID as BUILD_ELEMENT_ID } from '../scripts/lib/landing_game_modules.mjs';
import { syncAppViewport } from '../src/game/app_viewport';
import { Settings } from '../src/game/settings';
import { BOOT_PENDING_CLASS, BOOT_SPLASH_OWNED_EVENT } from '../src/ui/boot_splash_core';
import {
  ART_DEFERRED_CLASS,
  createGameDownload,
  GAME_MODULES_ELEMENT_ID,
  gameModules,
  LANDING_ART_URLS,
  LANDING_BOOTING_ATTR,
  LANDING_BOOTING_CLASS,
  LANDING_PAINT_FALLBACK_MS,
  LANDING_PHASE_ATTR,
  LANDING_TURNSTILE_SCRIPT_URL,
  revealLandingArt,
  runLandingFirst,
  shouldReloadAfterFailure,
  stampLandingBody,
  syncLandingViewport,
} from '../src/ui/landing_first';

const source = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function mountLanding(): void {
  document.body.className = `${BOOT_PENDING_CLASS} steam-wishlist-pending start-screen-open`;
  document.body.innerHTML = `
    <div id="boot-splash"><img class="boot-splash-logo" alt=""></div>
    <main id="start-screen">
      <div id="start-screen-backdrop"></div>
      <details id="community-menu"></details>
      <span class="js-stat-characters">…</span>
      <a id="wiki-link" href="#wiki">Wiki</a>
      <a id="discord-link" href="https://discord.com/invite/worldofclaudecraft">Discord</a>
      <button type="button" id="btn-play"><span class="btn-play-label">Play</span><span class="btn-play-status btn-play-status-loading">Loading</span><span class="btn-play-status btn-play-status-starting">Starting</span></button>
      <span id="play-status" role="status" aria-live="polite"></span>
      <button type="button" id="nav-btn-login">Log in</button>
      <select id="lang-select"><option value="en">English</option><option value="fr_FR">Francais</option></select>
    </main>
    <script type="application/json" id="${GAME_MODULES_ELEMENT_ID}">[{"url":"/assets/main-a.js","bytes":300},{"url":"/assets/renderer-b.js","bytes":100}]</script>`;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** What main.ts does once its start screens are wired. */
function clientReady(): void {
  document.dispatchEvent(new Event(BOOT_SPLASH_OWNED_EVENT));
}

const never = () => new Promise<unknown>(() => undefined);
let fetchMock: ReturnType<typeof vi.fn>;
const disposers: (() => void)[] = [];

/** runLandingFirst, torn down after the test so no listener or timer leaks into the next. */
function run(startGame: () => Promise<unknown>): void {
  disposers.push(runLandingFirst(startGame));
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn(async (url: unknown) =>
    String(url).includes('/api/project-stats')
      ? new Response(JSON.stringify({ characters_created: 91190 }), { status: 200 })
      : new Response('', { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('landing-first boot', () => {
  it('lifts the splash and fills the counter without starting the client', async () => {
    mountLanding();
    const startGame = vi.fn(never);
    run(startGame);
    await vi.waitFor(() =>
      expect(document.body.classList.contains(BOOT_PENDING_CLASS)).toBe(false),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('.js-stat-characters')?.textContent).toBe('91190'),
    );
    expect(startGame).not.toHaveBeenCalled();
    // The presence heartbeat starts once per page (src/site_presence.ts), so it is
    // checked here, in the file's first landing run.
    expect(fetchedUrls().some((url) => url.includes('/api/site-presence'))).toBe(true);
  });

  it('does the page-view bookkeeping the client used to do at load', async () => {
    mountLanding();
    run(vi.fn(never));
    // The Steam wishlist links show (the website has no Steam bridge to wait on).
    await vi.waitFor(() =>
      expect(document.body.classList.contains('steam-wishlist-pending')).toBe(false),
    );
    // The community links report clicks.
    expect(document.getElementById('discord-link')?.hasAttribute('data-woc-click-tracked')).toBe(
      true,
    );
  });

  it('fetches the listed client modules once the landing has painted, without running them', async () => {
    mountLanding();
    const startGame = vi.fn(never);
    const prefetched = () => fetchedUrls().filter((url) => url.startsWith('/assets/'));
    run(startGame);
    // Not before the landing's own paint (happy-dom reports no largest-contentful-paint
    // entries, so the fallback timer stands in for it).
    await new Promise((resolve) => setTimeout(resolve, LANDING_PAINT_FALLBACK_MS / 2));
    expect(prefetched()).toEqual([]);
    await vi.waitFor(
      () => expect(prefetched()).toEqual(['/assets/main-a.js', '/assets/renderer-b.js']),
      { timeout: LANDING_PAINT_FALLBACK_MS + 3000 },
    );
    // A fetch, not a <link>: a link with the module's URL stops Vite's own preload.
    expect(document.head.querySelector('link[rel="prefetch"], link[rel="modulepreload"]')).toBe(
      null,
    );
    expect(startGame).not.toHaveBeenCalled();
  });

  it('downloads each module once when the visitor starts the client before the prefetch', async () => {
    mountLanding();
    run(vi.fn(never));
    document.dispatchEvent(new Event('pointerdown'));
    // Past the point where the idle prefetch would have begun: it must join, not repeat.
    await new Promise((resolve) => setTimeout(resolve, LANDING_PAINT_FALLBACK_MS + 500));
    expect(fetchedUrls().filter((url) => url.startsWith('/assets/'))).toEqual([
      '/assets/main-a.js',
      '/assets/renderer-b.js',
    ]);
  });

  it('starts the client once on the first interaction', async () => {
    mountLanding();
    const startGame = vi.fn(never);
    run(startGame);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    document.dispatchEvent(new Event('touchstart'));
    await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
  });

  it('holds a button clicked before the client is ready, then replays it once', () => {
    mountLanding();
    const startGame = vi.fn(never);
    run(startGame);
    const play = document.getElementById('btn-play') as HTMLButtonElement;
    const handler = vi.fn();
    play.addEventListener('click', handler);

    play.click();
    expect(handler).not.toHaveBeenCalled();
    expect(play.hasAttribute(LANDING_BOOTING_ATTR)).toBe(true);
    expect(play.getAttribute('aria-busy')).toBe('true');
    expect(document.body.classList.contains(LANDING_BOOTING_CLASS)).toBe(true);

    clientReady();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(play.hasAttribute(LANDING_BOOTING_ATTR)).toBe(false);
    expect(play.hasAttribute('aria-busy')).toBe(false);
    expect(document.body.classList.contains(LANDING_BOOTING_CLASS)).toBe(false);

    // After the hand-off every click is the client's own.
    play.click();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('shows Play loading with the download, then starting, and imports only after the download', async () => {
    mountLanding();
    const startGame = vi.fn(never);
    // Hold the module responses so the loading phase can be watched.
    const gate = deferred<void>();
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).startsWith('/assets/')) {
        await gate.promise;
        return new Response('x'.repeat(String(url).includes('main') ? 300 : 100));
      }
      return new Response(JSON.stringify({ characters_created: 1 }), { status: 200 });
    });
    run(startGame);
    const play = document.getElementById('btn-play') as HTMLButtonElement;
    play.click();
    expect(play.getAttribute(LANDING_PHASE_ATTR)).toBe('loading');
    expect(play.style.getPropertyValue('--landing-progress')).toBe('0');
    expect(document.getElementById('play-status')?.textContent).toBe('Loading');
    expect(startGame).not.toHaveBeenCalled();

    gate.resolve();
    await vi.waitFor(() => expect(play.getAttribute(LANDING_PHASE_ATTR)).toBe('starting'));
    expect(play.style.getPropertyValue('--landing-progress')).toBe('1');
    expect(document.getElementById('play-status')?.textContent).toBe('Starting');
    expect(startGame).toHaveBeenCalledTimes(1);

    clientReady();
    expect(play.hasAttribute(LANDING_PHASE_ATTR)).toBe(false);
    expect(play.style.getPropertyValue('--landing-progress')).toBe('');
    expect(document.getElementById('play-status')?.textContent).toBe('');
  });

  it('replays only the last of several held actions', () => {
    mountLanding();
    run(vi.fn(never));
    const play = document.getElementById('btn-play') as HTMLButtonElement;
    const login = document.getElementById('nav-btn-login') as HTMLButtonElement;
    const onPlay = vi.fn();
    const onLogin = vi.fn();
    play.addEventListener('click', onPlay);
    login.addEventListener('click', onLogin);
    play.click();
    login.click();
    expect(play.hasAttribute(LANDING_BOOTING_ATTR)).toBe(false);
    expect(login.hasAttribute(LANDING_BOOTING_ATTR)).toBe(true);
    clientReady();
    expect(onPlay).not.toHaveBeenCalled();
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('re-applies a picker change made before the client is ready', async () => {
    mountLanding();
    const startGame = vi.fn(never);
    run(startGame);
    const select = document.getElementById('lang-select') as HTMLSelectElement;
    select.value = 'fr_FR';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.getAttribute('aria-busy')).toBe('true');
    await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    // main.ts resets the picker to the stored language as it wires it, then signals.
    select.value = 'en';
    const onChange = vi.fn(() => select.value);
    select.addEventListener('change', onChange);
    clientReady();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]?.value).toBe('fr_FR');
    expect(select.hasAttribute('aria-busy')).toBe(false);
  });

  it('starts loading the captcha script on the first interaction', () => {
    vi.stubEnv('VITE_TURNSTILE_SITEKEY', 'site-key-under-test');
    mountLanding();
    run(vi.fn(never));
    const tags = () =>
      document.head.querySelectorAll(`script[src="${LANDING_TURNSTILE_SCRIPT_URL}"]`);
    expect(tags()).toHaveLength(0);
    document.dispatchEvent(new Event('pointerdown'));
    expect(tags()).toHaveLength(1);
    for (const tag of tags()) tag.remove();
    vi.unstubAllEnvs();
  });

  it('leaves links to their native behaviour', () => {
    mountLanding();
    run(vi.fn(never));
    const link = document.getElementById('wiki-link') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(link.hasAttribute(LANDING_BOOTING_ATTR)).toBe(false);
  });

  it('stops holding clicks when the client fails to load', async () => {
    mountLanding();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A reload already happened this minute, so this failure must not reload again.
    sessionStorage.setItem('woc_landing_reload', String(Date.now()));
    // The import fails when it runs (after the download), as a missing chunk would.
    run(vi.fn(() => Promise.reject(new Error('chunk 404'))));
    const play = document.getElementById('btn-play') as HTMLButtonElement;
    play.click();
    expect(play.hasAttribute(LANDING_BOOTING_ATTR)).toBe(true);
    await vi.waitFor(() => expect(play.hasAttribute(LANDING_BOOTING_ATTR)).toBe(false));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    play.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('shouldReloadAfterFailure', () => {
  it('reloads once a minute at most, so a client that keeps failing cannot loop', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(shouldReloadAfterFailure(1_000_000, storage)).toBe(true);
    expect(shouldReloadAfterFailure(1_030_000, storage)).toBe(false);
    expect(shouldReloadAfterFailure(1_061_000, storage)).toBe(true);
  });
});

describe('captcha script', () => {
  it('uses the URL the login form loads', () => {
    // Read from source: importing src/game/turnstile_gate.ts pulls the online client in.
    const gate = source('../src/game/turnstile_gate.ts');
    expect(gate).toContain(
      `export const TURNSTILE_SCRIPT_URL = '${LANDING_TURNSTILE_SCRIPT_URL}';`,
    );
  });
});

describe('stampLandingBody', () => {
  function stubPhone(phone: boolean, reducedMotion = false) {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion') ? reducedMotion : phone,
          media: query,
        }) as MediaQueryList,
    );
  }

  it('stamps the touch interface, the engine/effects classes and the static backdrop on a phone', () => {
    mountLanding();
    stubPhone(true);
    stampLandingBody(new Settings());
    const body = document.body.classList;
    expect(body.contains('mobile-touch')).toBe(true);
    expect([...body].some((c) => c.startsWith('engine-'))).toBe(true);
    expect([...body].some((c) => c.startsWith('fx-'))).toBe(true);
    expect(body.contains('is-mobile') || body.contains('is-desktop')).toBe(true);
    expect(document.getElementById('start-screen-backdrop')?.classList).toContain(
      'backdrop-static',
    );
    expect((document.getElementById('community-menu') as HTMLDetailsElement).open).toBe(false);
  });

  it('honours a stored Desktop interface mode and keeps the animated backdrop on a desktop', () => {
    mountLanding();
    localStorage.setItem('woc_settings', JSON.stringify({ interfaceMode: 1 }));
    stubPhone(true);
    stampLandingBody(new Settings());
    expect(document.body.classList.contains('mobile-touch')).toBe(false);

    mountLanding();
    localStorage.clear();
    stubPhone(false);
    stampLandingBody(new Settings());
    expect(document.body.classList.contains('mobile-touch')).toBe(false);
    expect(document.getElementById('start-screen-backdrop')?.classList).not.toContain(
      'backdrop-static',
    );
    expect((document.getElementById('community-menu') as HTMLDetailsElement).open).toBe(true);
  });
});

describe('syncLandingViewport', () => {
  it('writes the same --app-vw/--app-vh as syncAppViewport off the game screen', () => {
    document.body.className = '';
    const style = document.documentElement.style;
    syncAppViewport(window);
    const expected = [style.getPropertyValue('--app-vw'), style.getPropertyValue('--app-vh')];
    style.removeProperty('--app-vw');
    style.removeProperty('--app-vh');
    syncLandingViewport(window);
    expect([style.getPropertyValue('--app-vw'), style.getPropertyValue('--app-vh')]).toEqual(
      expected,
    );
    expect(expected[0]).toMatch(/^\d+px$/);
  });
});

describe('game module list', () => {
  it('reads the build list and tolerates its absence', () => {
    mountLanding();
    expect(gameModules()).toEqual([
      { url: '/assets/main-a.js', bytes: 300 },
      { url: '/assets/renderer-b.js', bytes: 100 },
    ]);
    document.getElementById(GAME_MODULES_ELEMENT_ID)?.remove();
    expect(gameModules()).toEqual([]);
  });

  it('uses the element id the build writes', () => {
    expect(GAME_MODULES_ELEMENT_ID).toBe(BUILD_ELEMENT_ID);
  });
});

describe('boot wiring', () => {
  it('boots index.html through src/boot.ts and play.html through src/main.ts', () => {
    expect(source('../index.html')).toContain('<script type="module" src="/src/boot.ts"></script>');
    expect(source('../index.html')).not.toContain('src="/src/main.ts"');
    expect(source('../play.html')).toContain('<script type="module" src="/src/main.ts"></script>');
  });

  it('links the style barrel from the boot entry and loads the client as a dynamic import', () => {
    const boot = source('../src/boot.ts');
    expect(boot.indexOf("import './styles/index.css';")).toBeGreaterThan(-1);
    expect(boot.indexOf("import './styles/index.css';")).toBeLessThan(boot.indexOf('import {'));
    expect(boot).toContain("const startClient = () => import('./main');");
    expect(boot).toContain('runLandingFirst(startClient);');
  });

  it('relies on main.ts signalling only after its start screens are wired', () => {
    // runLandingFirst replays a held click on BOOT_SPLASH_OWNED_EVENT, which
    // liftBootSplashWhenReady dispatches first thing: it must come after wireStartScreens.
    const main = source('../src/main.ts');
    const wired = main.indexOf('const localized = wireStartScreens();');
    const lift = main.indexOf('void liftBootSplashWhenReady({ landing: true, localized');
    expect(wired).toBeGreaterThan(0);
    expect(lift).toBeGreaterThan(wired);
  });
});

describe('landing artwork', () => {
  // happy-dom may not implement HTMLImageElement.decode; give the spy something to wrap.
  beforeEach(() => {
    if (!('decode' in HTMLImageElement.prototype)) {
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(),
      });
    }
  });

  it('holds the art back in index.html only, and the boot path releases it', () => {
    expect(source('../index.html')).toContain(
      `<main id="start-screen" class="${ART_DEFERRED_CLASS}">`,
    );
    expect(source('../play.html')).toContain('<main id="start-screen">');
    expect(source('../src/boot.ts')).toContain('classList.remove(ART_DEFERRED_CLASS)');
  });

  it('names every image the deferred rules hold back', () => {
    const css = source('../src/styles/shell.website.css');
    for (const url of LANDING_ART_URLS) expect(css, url).toContain(`url("${url}")`);
    expect(css).toContain('#start-screen.art-deferred');
  });

  it('drops the class once the art has decoded', async () => {
    document.body.innerHTML = `<main id="start-screen" class="${ART_DEFERRED_CLASS}"></main>`;
    const decode = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(decode);
    await revealLandingArt();
    expect(decode).toHaveBeenCalledTimes(LANDING_ART_URLS.length);
    expect(document.getElementById('start-screen')?.classList.contains(ART_DEFERRED_CLASS)).toBe(
      false,
    );
  });

  it('shows the art anyway if it will not decode', async () => {
    document.body.innerHTML = `<main id="start-screen" class="${ART_DEFERRED_CLASS}"></main>`;
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() =>
      Promise.reject(new Error('broken image')),
    );
    await revealLandingArt();
    expect(document.getElementById('start-screen')?.classList.contains(ART_DEFERRED_CLASS)).toBe(
      false,
    );
  });
});

describe('createGameDownload', () => {
  it('reports the share of listed bytes read, and finishes a module that comes up short', async () => {
    const seen: number[] = [];
    fetchMock.mockImplementation(async (url: unknown) =>
      // The second module fails outright; it still counts as done.
      String(url).includes('b.js')
        ? Promise.reject(new Error('offline'))
        : new Response('x'.repeat(30)),
    );
    const download = createGameDownload([
      { url: '/assets/a.js', bytes: 60 },
      { url: '/assets/b.js', bytes: 40 },
    ]);
    download.onProgress((fraction) => seen.push(fraction));
    expect(download.progress()).toBe(0);
    const first = download.start('high');
    expect(download.start('low')).toBe(first);
    await first;
    expect(download.progress()).toBe(1);
    expect(seen.at(-1)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is complete at once when nothing is listed', async () => {
    const download = createGameDownload([]);
    await download.start('high');
    expect(download.progress()).toBe(1);
  });
});
