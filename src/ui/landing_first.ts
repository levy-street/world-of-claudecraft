// The home page's landing-first boot (src/boot.ts, mode 'landing'): the landing page
// paints from the HTML and the stylesheets alone, and the game client (src/main.ts)
// downloads in the background once the page has loaded and starts on the visitor's
// first interaction. Before this, every visit downloaded and ran the whole client
// before the landing could show, which held a cold phone's first paint for seconds.
//
// What this module owns until the client takes over:
// - painting the text first: index.html holds the landing's artwork back
//   (#start-screen.art-deferred) and this module fades it in once it has decoded;
// - what main.ts would otherwise set at boot and the landing needs from the start, from
//   the same inputs, so the client's later pass changes nothing on screen: the body
//   classes and viewport size the landing CSS keys on, its icons, the characters-created
//   counter and the Steam wishlist links;
// - the page-view bookkeeping main.ts did at load (first-touch attribution, the site
//   presence heartbeat, community link click events), so a visitor who never interacts
//   is still counted; each is safe to run again when main.ts boots;
// - lifting the boot splash once the stylesheets and fonts are ready;
// - fetching the client's modules into the HTTP cache once the landing and its art
//   have painted (no compile, no execution);
// - holding a button click or a select change made before the client is ready: the
//   control shows a busy state, and the action is replayed once main.ts has wired the
//   start screens. main.ts signals that by dispatching BOOT_SPLASH_OWNED_EVENT
//   (liftBootSplashWhenReady), which it does right after wireStartScreens().
// Links and text fields keep their native behaviour.

import { captureFirstTouch } from '../attribution';
import { apiUrl } from '../client_origin';
import {
  BROWSER_BODY_CLASSES,
  browserBodyClasses,
  cssEffectsTier,
  readBrowserEnv,
} from '../game/browser_env';
import { shouldUseStaticBackdrop } from '../game/landing_backdrop';
import { trackCommunityLinkClicks } from '../game/meta_pixel';
import { Settings } from '../game/settings';
import { loadingCurtainFadeMs } from '../game/ui_effects_profile';
import { startSitePresence } from '../site_presence';
import { liftBootSplashWhenReady } from './boot_splash';
import { BOOT_SPLASH_OWNED_EVENT } from './boot_splash_core';
import { LANDING_PHONE_TOUCH_QUERY, landingTouchInterface } from './landing_first_core';
import { loadProjectStats, type ProjectStats } from './project_stats';
import { syncSteamWishlistVisibility } from './steam_wishlist';
import { hydrateIcons } from './ui_icons';

/** On the control whose action is waiting for the client; drives its busy styling. */
export const LANDING_BOOTING_ATTR = 'data-landing-booting';
/** On body while an action waits for the client. */
export const LANDING_BOOTING_CLASS = 'landing-booting';
/** On the waiting control: 'loading' while the client downloads, 'starting' while it boots. */
export const LANDING_PHASE_ATTR = 'data-landing-phase';
/** The visually hidden live region that announces the phase (index.html). */
export const PLAY_STATUS_ID = 'play-status';
/** The build's list of the client's module URLs (vite.config.ts, woc-landing-game-modules). */
export const GAME_MODULES_ELEMENT_ID = 'woc-game-modules';
/** On #start-screen in index.html: the landing's artwork waits (src/styles/shell.website.css). */
export const ART_DEFERRED_CLASS = 'art-deferred';
/**
 * The artwork that class holds back: the backdrop key art, the panel frame and the panel
 * logo. Decoded before the class drops so each layer fades in whole; pinned to the
 * stylesheet by tests/landing_first.test.ts.
 */
export const LANDING_ART_URLS: readonly string[] = [
  '/website-hero-eastbrook-v1.webp',
  '/website-fractured-portal-v5.webp',
  '/worldofclaudecraft-logo.webp',
];
/** How long the art may take to decode before it is shown anyway. */
const ART_REVEAL_TIMEOUT_MS = 4000;
/**
 * How long after the lift the art waits for the landing's own largest paint before
 * loading anyway (browsers without largest-contentful-paint entries, or a page whose
 * largest element painted before the lift).
 */
export const LANDING_PAINT_FALLBACK_MS = 600;
/**
 * How long after the load event deferred work (the slideshow's later scenes, from
 * src/boot.ts) waits before asking for idle time: the landing's own images and fonts are
 * still decoding and painting around load, and anything competing with them would delay
 * the largest paint the visitor is waiting for.
 */
export const LOAD_SETTLE_DELAY_MS = 1500;
/**
 * Mirrors TURNSTILE_SCRIPT_URL in src/game/turnstile_gate.ts (pinned by the test): the
 * captcha script starts loading when the visitor first interacts, so the login form's
 * widget is ready sooner than if it waited for the client.
 */
export const LANDING_TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
/** sessionStorage mark of a reload after the client failed to load (see runLandingFirst). */
const RELOAD_MARK_KEY = 'woc_landing_reload';
const RELOAD_MARK_WINDOW_MS = 60_000;

/** Interactions that start the client. Scrolling with a wheel or trackpad does not. */
const START_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;
/** A click on one of these waits for the client and is replayed; anything else is native. */
const CLIENT_CONTROL_SELECTOR = 'button, [role="button"]';

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

function saveDataHint(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The classes main.ts stamps before its first paint (syncPhoneTouchClass, the landing
 * engine/effects stamp, applyLandingBackdrop's static decision), from the same inputs.
 */
export function stampLandingBody(settings: Settings): void {
  const body = document.body.classList;
  const phone = matches(LANDING_PHONE_TOUCH_QUERY);
  const touch = landingTouchInterface(settings.get('interfaceMode'), phone);
  body.toggle('mobile-touch', touch);
  const community = document.getElementById('community-menu') as HTMLDetailsElement | null;
  if (community) community.open = !touch;

  const env = readBrowserEnv();
  const tier = cssEffectsTier({
    engine: env.engine,
    version: env.engineVersion,
    mobile: env.mobile,
    renderTier: 'high',
    override: settings.get('browserEffects'),
  });
  body.remove(...BROWSER_BODY_CLASSES);
  body.add(...browserBodyClasses(env, tier));

  const reducedMotion = matches('(prefers-reduced-motion: reduce)') || settings.get('reduceMotion');
  document.getElementById('start-screen-backdrop')?.classList.toggle(
    'backdrop-static',
    shouldUseStaticBackdrop({
      phone,
      saveData: saveDataHint(),
      reducedMotion,
      highContrast: settings.get('landingHighContrast'),
    }),
  );
}

/**
 * syncAppViewport's landing branch (src/game/app_viewport.ts, body not game-active),
 * which html/body size from. That module imports the touch controls and with them the
 * i18n runtime, so it cannot load first; tests/landing_first.test.ts pins the two equal.
 */
export function syncLandingViewport(win: Window = window): void {
  const vv = win.visualViewport;
  const scale = vv?.scale ?? 1;
  const width = Math.max(1, Math.round((vv?.width ?? win.innerWidth) * scale));
  const height = Math.max(1, Math.round((vv?.height ?? win.innerHeight) * scale));
  win.document.documentElement.style.setProperty('--app-vw', `${width}px`);
  win.document.documentElement.style.setProperty('--app-vh', `${height}px`);
}

async function fetchProjectStats(): Promise<ProjectStats> {
  const res = await fetch(apiUrl('/api/project-stats'), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`project stats ${res.status}`);
  return (await res.json()) as ProjectStats;
}

/** One client module the build listed: its URL and its size as served uncompressed. */
export interface GameModule {
  url: string;
  bytes: number;
}

/** The client's modules the build listed, or none (dev, or a build without the list). */
export function gameModules(doc: Document = document): GameModule[] {
  const el = doc.getElementById(GAME_MODULES_ELEMENT_ID);
  if (!el?.textContent) return [];
  try {
    const listed: unknown = JSON.parse(el.textContent);
    if (!Array.isArray(listed)) return [];
    return listed.flatMap((entry): GameModule[] => {
      const { url, bytes } = (entry ?? {}) as Partial<GameModule>;
      return typeof url === 'string' ? [{ url, bytes: Number(bytes) > 0 ? Number(bytes) : 0 }] : [];
    });
  } catch {
    return [];
  }
}

export interface GameDownload {
  /** Start, or join, the download; settles once every module is cached or has failed. */
  start(priority: 'low' | 'high'): Promise<void>;
  /** The share of the listed bytes read so far, 0 to 1 (1 when nothing is listed). */
  progress(): number;
  /** Called with the new share on every change. */
  onProgress(listener: (fraction: number) => void): void;
}

/**
 * Fetch the client's modules into the HTTP cache, counting the body bytes read against
 * the sizes the build listed. A plain fetch, not a link: modulepreload would also
 * compile each module on the main thread, Safari ignores rel=prefetch, and a <link> with
 * the module's URL stops Vite's own preload of it when the client is imported. Reading
 * the whole body is also what puts the whole response in the cache.
 */
export function createGameDownload(modules: readonly GameModule[]): GameDownload {
  const total = modules.reduce((sum, module) => sum + module.bytes, 0);
  const listeners: ((fraction: number) => void)[] = [];
  let loaded = 0;
  let running: Promise<void> | null = null;
  const progress = () => (total > 0 ? Math.min(1, loaded / total) : 1);
  const add = (bytes: number) => {
    loaded += bytes;
    const fraction = progress();
    for (const listener of listeners) listener(fraction);
  };
  const fetchOne = async (module: GameModule, priority: 'low' | 'high') => {
    let read = 0;
    try {
      const init: RequestInit & { priority?: 'low' | 'high' } = {
        credentials: 'same-origin',
        priority,
      };
      const res = await fetch(module.url, init);
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          read += value.byteLength;
          add(value.byteLength);
        }
      } else {
        await res.blob();
      }
    } catch {
      // The client's own import fetches it again.
    }
    // Count the module as finished either way, so the bar never stalls short of full.
    if (read < module.bytes) add(module.bytes - read);
  };
  return {
    start(priority) {
      running ??= Promise.all(modules.map((module) => fetchOne(module, priority))).then(
        () => undefined,
      );
      return running;
    },
    progress,
    onProgress(listener) {
      listeners.push(listener);
    },
  };
}

/**
 * Run once the page has loaded, settled for LOAD_SETTLE_DELAY_MS and gone idle.
 * Returns a cancel function.
 */
export function afterLoadSettles(run: () => void): () => void {
  let cancelled = false;
  let timer: number | undefined;
  const fire = () => {
    if (!cancelled) run();
  };
  const idle = () => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fire, { timeout: 2000 });
    } else {
      timer = window.setTimeout(fire, 0);
    }
  };
  const later = () => {
    timer = window.setTimeout(idle, LOAD_SETTLE_DELAY_MS);
  };
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', later);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/**
 * Fetch and decode the landing's artwork, then let it fade in. Called once the landing's
 * text has painted, so the art never competes with it.
 */
export function revealLandingArt(): Promise<void> {
  const start = document.getElementById('start-screen');
  if (!start?.classList.contains(ART_DEFERRED_CLASS)) return Promise.resolve();
  const decoded = LANDING_ART_URLS.map((url) => {
    const img = new Image();
    img.src = url;
    return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined;
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, ART_REVEAL_TIMEOUT_MS));
  return Promise.race([Promise.all(decoded).then(() => undefined), timeout]).then(() => {
    start.classList.remove(ART_DEFERRED_CLASS);
  });
}

/**
 * Run once the landing's largest element has painted after the splash lifted at
 * `liftedAt`, so whatever `run` fetches cannot delay that paint. Returns a cancel
 * function.
 */
export function afterLandingPainted(liftedAt: number, run: () => void): () => void {
  let done = false;
  let observer: PerformanceObserver | undefined;
  const go = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    setTimeout(run, 0);
  };
  if (
    typeof PerformanceObserver === 'function' &&
    PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')
  ) {
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.startTime >= liftedAt)) go();
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  }
  const fallback = setTimeout(go, LANDING_PAINT_FALLBACK_MS);
  return () => {
    done = true;
    observer?.disconnect();
    clearTimeout(fallback);
  };
}

function loadTurnstileEarly(): void {
  if (!String(import.meta.env.VITE_TURNSTILE_SITEKEY ?? '')) return;
  if (document.querySelector(`script[src="${LANDING_TURNSTILE_SCRIPT_URL}"]`)) return;
  const script = document.createElement('script');
  script.src = LANDING_TURNSTILE_SCRIPT_URL;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Whether to reload after the client failed to load. A failed dynamic import stays
 * failed for the life of the page (the module map keeps the error), and the usual cause
 * is a deploy that replaced the hashed chunks mid-visit, which a reload fixes. Once a
 * minute at most, so a client that keeps failing (offline) cannot loop.
 */
export function shouldReloadAfterFailure(
  now = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
): boolean {
  try {
    const last = Number(storage.getItem(RELOAD_MARK_KEY) ?? 0);
    if (now - last < RELOAD_MARK_WINDOW_MS) return false;
    storage.setItem(RELOAD_MARK_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

type HeldAction =
  | { kind: 'click'; el: HTMLElement }
  | { kind: 'change'; el: HTMLSelectElement; value: string };

/** Start the landing-first boot. Returns a function that tears it down (for tests). */
export function runLandingFirst(startGame: () => Promise<unknown>): () => void {
  const settings = new Settings();
  stampLandingBody(settings);
  syncLandingViewport();
  const onResize = () => syncLandingViewport();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  // The landing's own icons only: the hidden in-world controls carry painted art the
  // client hydrates later, and fetching it now would compete with the first paint.
  const startScreen = document.getElementById('start-screen');
  if (startScreen) hydrateIcons(startScreen);
  void loadProjectStats(fetchProjectStats);
  // Landing mode only runs on the website, which has no Steam bridge to ask.
  void syncSteamWishlistVisibility(false);
  captureFirstTouch();
  startSitePresence('home');
  trackCommunityLinkClicks();

  let disposed = false;
  let started = false;
  let cancelArt: (() => void) | undefined;
  const download = createGameDownload(gameModules());
  const osReducedMotion = matches('(prefers-reduced-motion: reduce)');
  // The art stays held back (art-deferred) so the lift waits only for the stylesheets and
  // fonts; once the landing has painted, the art loads and fades in.
  void liftBootSplashWhenReady({
    landing: true,
    fadeMs: loadingCurtainFadeMs(settings.get('reduceMotion') || osReducedMotion),
  }).then(() => {
    if (disposed) return;
    // Then the client, so a visitor who taps Play a few seconds in finds most of it
    // downloaded; after the art, so it never competes with the landing itself.
    cancelArt = afterLandingPainted(performance.now(), () => {
      void revealLandingArt().then(() => {
        if (!disposed && !started && !saveDataHint()) void download.start('low');
      });
    });
  });

  // The lift above dispatched BOOT_SPLASH_OWNED_EVENT synchronously; the next one is
  // main.ts, once its start screens are wired.
  let ready = false;
  let held: HeldAction | null = null;

  let phase: 'loading' | 'starting' | null = null;
  const status = document.getElementById(PLAY_STATUS_ID);

  // The held control shows the phase (Play swaps its label for Loading, then Starting,
  // over a bar that fills with the download), and the live region announces it.
  const paintPhase = () => {
    const el = held?.el;
    if (!el) return;
    if (phase) el.setAttribute(LANDING_PHASE_ATTR, phase);
    el.style.setProperty('--landing-progress', String(download.progress()));
    const label = document.querySelector(`#btn-play .btn-play-status-${phase}`)?.textContent;
    if (status && label && status.textContent !== label) status.textContent = label;
  };
  download.onProgress((fraction) => {
    held?.el.style.setProperty('--landing-progress', String(fraction));
  });

  const markBusy = (next: HeldAction | null) => {
    held?.el.removeAttribute(LANDING_BOOTING_ATTR);
    held?.el.removeAttribute(LANDING_PHASE_ATTR);
    held?.el.removeAttribute('aria-busy');
    held?.el.style.removeProperty('--landing-progress');
    held = next;
    held?.el.setAttribute(LANDING_BOOTING_ATTR, '');
    held?.el.setAttribute('aria-busy', 'true');
    document.body.classList.toggle(LANDING_BOOTING_CLASS, held !== null);
    if (held) paintPhase();
    else if (status) status.textContent = '';
  };
  const setPhase = (next: 'loading' | 'starting') => {
    phase = next;
    paintPhase();
  };

  const stopHolding = () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
  };

  const start = () => {
    if (started) return;
    started = true;
    for (const type of START_EVENTS) document.removeEventListener(type, start, true);
    loadTurnstileEarly();
    // Download first (joining a prefetch already under way), then import: the import then
    // reads every module from the cache, and the bar can show the download's real progress.
    setPhase('loading');
    download
      .start('high')
      .then(() => {
        if (disposed) return;
        setPhase('starting');
        return startGame();
      })
      .catch((err: unknown) => {
        console.error('game client failed to load:', err);
        ready = true;
        stopHolding();
        markBusy(null);
        if (shouldReloadAfterFailure()) location.reload();
      });
  };

  const onClick = (event: MouseEvent) => {
    if (ready) return;
    start();
    const control = (event.target as Element | null)?.closest?.(CLIENT_CONTROL_SELECTOR);
    if (!(control instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    markBusy({ kind: 'click', el: control });
  };

  // A select's change (the language and graphics pickers) has no listener until the
  // client loads, and main.ts resets each picker to the stored value when it wires them,
  // so the visitor's pick is held and re-applied.
  const onChange = (event: Event) => {
    if (ready || !(event.target instanceof HTMLSelectElement)) return;
    start();
    markBusy({ kind: 'change', el: event.target, value: event.target.value });
  };

  const onReady = () => {
    ready = true;
    stopHolding();
    const action = held;
    markBusy(null);
    if (!action?.el.isConnected) return;
    if (action.kind === 'click') {
      action.el.click();
    } else {
      action.el.value = action.value;
      action.el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  for (const type of START_EVENTS) {
    document.addEventListener(type, start, { capture: true, passive: true });
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener(BOOT_SPLASH_OWNED_EVENT, onReady, { once: true });

  return () => {
    disposed = true;
    stopHolding();
    cancelArt?.();
    for (const type of START_EVENTS) document.removeEventListener(type, start, true);
    document.removeEventListener(BOOT_SPLASH_OWNED_EVENT, onReady);
  };
}
