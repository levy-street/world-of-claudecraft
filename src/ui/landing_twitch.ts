export const TWITCH_CHANNEL = 'claudeplaysclaudecraft';
// Phone and desktop layouts use Twitch's approved inline player; responsive CSS
// changes only the surrounding presentation.
export const TWITCH_MIN_WIDTH = 621;

export type LandingStreamState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'online'
  | 'offline'
  | 'compact'
  | 'blocked'
  | 'unavailable'
  | 'hidden';

interface TwitchPlayerInstance {
  addEventListener(event: string, listener: () => void): void;
}

interface TwitchPlayerConstructor {
  new (
    elementId: string,
    options: {
      autoplay: boolean;
      channel: string;
      height: string;
      muted: boolean;
      parent: string[];
      width: string;
    },
  ): TwitchPlayerInstance;
  OFFLINE: string;
  ONLINE: string;
  PLAYBACK_BLOCKED: string;
  PLAYING: string;
  READY: string;
}

interface TwitchGlobal {
  Player: TwitchPlayerConstructor;
}

declare global {
  interface Window {
    Twitch?: TwitchGlobal;
  }
}

export interface LandingTwitchDecisionInput {
  desktopApp: boolean;
  hostname: string;
  nativeApp: boolean;
  width: number;
}
export type LandingTwitchDecision = 'mount' | 'compact' | 'unavailable' | 'hidden';
export type LandingTwitchMountMode = 'inline' | 'none';

export function twitchParentForHostname(rawHostname: string): string | null {
  const hostname = rawHostname.trim().toLowerCase().replace(/\.$/, '');
  if (hostname === '[::1]') return 'localhost';
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) return null;
  return hostname;
}

export function landingTwitchDecision({
  desktopApp,
  hostname,
  nativeApp,
  width,
}: LandingTwitchDecisionInput): LandingTwitchDecision {
  if (nativeApp || desktopApp) return 'hidden';
  if (!twitchParentForHostname(hostname)) return 'unavailable';
  if (width < TWITCH_MIN_WIDTH) return 'compact';
  return 'mount';
}

export function landingTwitchMountMode(decision: LandingTwitchDecision): LandingTwitchMountMode {
  if (decision === 'mount' || decision === 'compact') return 'inline';
  return 'none';
}

const TWITCH_SCRIPT_ID = 'woc-twitch-player-api';
const TWITCH_SCRIPT_URL = 'https://player.twitch.tv/js/embed/v1.js';
const TWITCH_LOAD_TIMEOUT_MS = 12000;
let twitchLoadPromise: Promise<TwitchGlobal> | null = null;
interface LandingTwitchController {
  updatePrivacyAllowed(allowed: boolean): void;
}

interface LandingTwitchRoot extends HTMLElement {
  __wocLandingTwitchController?: LandingTwitchController;
}

function setStreamState(root: HTMLElement, state: LandingStreamState): void {
  root.dataset.streamState = state;
}

function loadTwitchApi(): Promise<TwitchGlobal> {
  if (window.Twitch?.Player) return Promise.resolve(window.Twitch);
  if (twitchLoadPromise) return twitchLoadPromise;

  twitchLoadPromise = new Promise<TwitchGlobal>((resolve, reject) => {
    const existing = document.getElementById(TWITCH_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (window.Twitch?.Player) resolve(window.Twitch);
      else reject(new Error('Twitch player API did not initialize'));
    };

    const fail = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(new Error('Twitch player API could not be loaded'));
    };

    const timeoutId = window.setTimeout(fail, TWITCH_LOAD_TIMEOUT_MS);
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });

    if (!existing) {
      script.id = TWITCH_SCRIPT_ID;
      script.src = TWITCH_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    twitchLoadPromise = null;
    throw error;
  });

  return twitchLoadPromise;
}

export interface LandingTwitchOptions {
  desktopApp: boolean;
  nativeApp: boolean;
  privacyAllowed?: boolean;
  requestPrivacyConsent?: () => boolean;
}

export function initLandingTwitch({
  desktopApp,
  nativeApp,
  privacyAllowed = true,
  requestPrivacyConsent,
}: LandingTwitchOptions): void {
  const root = document.getElementById('yuumiii-stream') as LandingTwitchRoot | null;
  const mount = document.getElementById('yuumiii-player');
  const consoleShell = root?.querySelector<HTMLElement>('.site-stream-console') ?? null;
  const mobilePortal = root?.querySelector<HTMLButtonElement>('.site-stream-mobile-portal') ?? null;
  if (!root || !mount) return;
  const initialized = root.__wocLandingTwitchController;
  if (initialized) {
    initialized.updatePrivacyAllowed(privacyAllowed);
    return;
  }

  let privacyGranted = privacyAllowed;
  let reachedViewport = false;
  let mounting = false;
  let mounted = false;
  let resizeObserver: ResizeObserver | null = null;
  let observedMountWidth = window.innerWidth;

  const currentDecision = (): LandingTwitchDecision =>
    landingTwitchDecision({
      desktopApp,
      hostname: window.location.hostname,
      nativeApp,
      // ResizeObserver keeps this geometry current without a synchronous layout read.
      width: Math.min(window.innerWidth, observedMountWidth),
    });

  const attemptMount = (): void => {
    if (!reachedViewport || mounting || mounted) return;
    if (!privacyGranted) {
      setStreamState(root, 'blocked');
      return;
    }
    const decision = currentDecision();
    const mountMode = landingTwitchMountMode(decision);

    if (mountMode === 'none') {
      if (decision === 'unavailable' || decision === 'hidden') setStreamState(root, decision);
      return;
    }

    mounting = true;
    root.dataset.streamInline = 'true';
    setStreamState(root, 'loading');
    void loadTwitchApi()
      .then((twitch) => {
        const parent = twitchParentForHostname(window.location.hostname);
        if (!parent) throw new Error('Twitch parent hostname is unavailable');

        const player = new twitch.Player(mount.id, {
          autoplay: false,
          channel: TWITCH_CHANNEL,
          height: '100%',
          muted: true,
          parent: [parent],
          width: '100%',
        });
        mounted = true;
        resizeObserver?.disconnect();
        player.addEventListener(twitch.Player.READY, () => {
          root.dataset.streamPlayerReady = 'true';
          setStreamState(root, 'ready');
        });
        player.addEventListener(twitch.Player.PLAYING, () => {
          root.dataset.streamInline = 'true';
          root.dataset.streamPlayback = 'playing';
          setStreamState(root, 'online');
        });
        player.addEventListener(twitch.Player.ONLINE, () => setStreamState(root, 'online'));
        player.addEventListener(twitch.Player.OFFLINE, () => {
          delete root.dataset.streamPlayback;
          setStreamState(root, 'offline');
        });
        player.addEventListener(twitch.Player.PLAYBACK_BLOCKED, () => {
          delete root.dataset.streamPlayback;
          setStreamState(root, 'ready');
        });
      })
      .catch(() => {
        delete root.dataset.streamInline;
        delete root.dataset.streamPlayback;
        delete root.dataset.streamPlayerReady;
        setStreamState(root, 'unavailable');
      })
      .finally(() => {
        mounting = false;
      });
  };

  const updatePrivacyAllowed = (allowed: boolean): void => {
    privacyGranted = allowed;
    if (!allowed) {
      if (!mounted && !mounting) setStreamState(root, 'blocked');
      return;
    }
    if (root.dataset.streamState === 'blocked') setStreamState(root, 'idle');
    attemptMount();
  };

  // Keep the guard on the DOM node so Vite HMR cannot remount Twitch into the same root.
  root.__wocLandingTwitchController = { updatePrivacyAllowed };

  if (consoleShell) {
    const setConsoleHeight = (height: number): void => {
      root.style.setProperty('--stream-console-height', `${Math.round(height)}px`);
    };
    if (typeof ResizeObserver !== 'undefined') {
      const consoleResizeObserver = new ResizeObserver((entries) => {
        const height = entries[0]?.contentRect.height;
        if (height) setConsoleHeight(height);
      });
      consoleResizeObserver.observe(consoleShell);
    } else {
      const syncConsoleHeight = (): void => setConsoleHeight(consoleShell.offsetHeight);
      syncConsoleHeight();
      window.addEventListener('resize', syncConsoleHeight, { passive: true });
    }
  }
  const reveal = (): void => {
    reachedViewport = true;
    attemptMount();
  };

  mobilePortal?.addEventListener('click', (event) => {
    event.preventDefault();
    const decision = currentDecision();
    const mountMode = landingTwitchMountMode(decision);
    if (mountMode === 'none') {
      if (decision === 'unavailable' || decision === 'hidden') setStreamState(root, decision);
      return;
    }

    if (!privacyGranted) {
      if (requestPrivacyConsent?.() !== true) {
        setStreamState(root, 'blocked');
        return;
      }
      privacyGranted = true;
    }

    reachedViewport = true;
    attemptMount();
  });
  if (!privacyGranted) setStreamState(root, 'blocked');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        reveal();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(root);
  } else {
    reveal();
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) observedMountWidth = width;
      attemptMount();
    });
    resizeObserver.observe(mount);
  } else {
    window.addEventListener(
      'resize',
      () => {
        observedMountWidth = window.innerWidth;
        attemptMount();
      },
      { passive: true },
    );
  }
}
