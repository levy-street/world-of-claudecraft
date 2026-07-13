export const X_PROFILE_URL = 'https://x.com/WoClaudecraft';
export const X_WIDGETS_SCRIPT_URL = 'https://platform.x.com/widgets.js';
export const X_WIDGETS_SCRIPT_ID = 'woc-x-widgets-script';
export const X_WIDGETS_LOAD_TIMEOUT_MS = 10_000;
export const X_TIMELINE_IFRAME_TIMEOUT_MS = 8_000;
export const X_TIMELINE_STATUS_TARGET_ID = 'news-x-status';
export const X_TIMELINE_COMPACT_QUERY = '(max-width: 899px)';
export const X_TIMELINE_EMBED_MIN_WIDTH_QUERY = '(min-width: 600px)';
export const X_TIMELINE_COMPACT_HEIGHT = 480;
export const X_TIMELINE_DEFAULT_HEIGHT = 640;

export type LandingXTimelineState = 'consent' | 'loading' | 'loaded' | 'error' | 'hidden';
export type LandingXTimelineMode = 'embed' | 'link-only';

export interface LandingXTimelineDecisionInput {
  desktopApp: boolean;
  nativeApp: boolean;
}

export function landingXTimelineDecision({
  desktopApp,
  nativeApp,
}: LandingXTimelineDecisionInput): LandingXTimelineMode {
  return desktopApp || nativeApp ? 'link-only' : 'embed';
}

export function landingXTimelineHeight(compact: boolean): number {
  return compact ? X_TIMELINE_COMPACT_HEIGHT : X_TIMELINE_DEFAULT_HEIGHT;
}

export function landingXTimelineSupportsEmbed(
  { desktopApp, nativeApp }: LandingXTimelineDecisionInput,
  viewportWideEnough: boolean,
): boolean {
  return !desktopApp && !nativeApp && viewportWideEnough;
}

interface XWidgetsApi {
  widgets: {
    load(element?: HTMLElement): Promise<unknown> | undefined;
  };
}

declare global {
  interface Window {
    twttr?: XWidgetsApi;
  }
}

interface LandingXTimelineElements {
  mount: HTMLElement;
  privacyButton: HTMLButtonElement;
  retryButton: HTMLButtonElement;
  root: HTMLElement;
  statusTarget: HTMLElement;
}

export interface LandingXTimelineOptions extends LandingXTimelineDecisionInput {
  iframeTitle: () => string;
  openPrivacyPreferences?: () => void;
  privacyAllowed?: () => boolean;
}

export interface LandingXTimelineController {
  load(): void;
}

let xWidgetsLoadPromise: Promise<XWidgetsApi> | null = null;
const initializedRoots = new WeakSet<HTMLElement>();

function readyXWidgetsApi(): XWidgetsApi | null {
  return typeof window.twttr?.widgets?.load === 'function' ? window.twttr : null;
}

function loadXWidgetsApi(): Promise<XWidgetsApi> {
  const readyApi = readyXWidgetsApi();
  if (readyApi) return Promise.resolve(readyApi);
  if (xWidgetsLoadPromise) return xWidgetsLoadPromise;

  let script = document.getElementById(X_WIDGETS_SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = X_WIDGETS_SCRIPT_ID;
    script.src = X_WIDGETS_SCRIPT_URL;
    script.async = true;
  }
  const pendingScript = script;

  xWidgetsLoadPromise = new Promise<XWidgetsApi>((resolve, reject) => {
    let timeoutId: number | undefined;
    let settled = false;

    const cleanup = (): void => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      pendingScript.removeEventListener('load', handleLoad);
      pendingScript.removeEventListener('error', handleError);
    };
    const rejectOnce = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const handleLoad = (): void => {
      if (settled) return;
      const api = readyXWidgetsApi();
      if (!api) {
        rejectOnce('X widgets script did not initialize');
        return;
      }
      settled = true;
      cleanup();
      resolve(api);
    };
    const handleError = (): void => {
      rejectOnce('X widgets script could not be loaded');
    };

    timeoutId = window.setTimeout(
      () => rejectOnce('X widgets script timed out'),
      X_WIDGETS_LOAD_TIMEOUT_MS,
    );
    pendingScript.addEventListener('load', handleLoad, { once: true });
    pendingScript.addEventListener('error', handleError, { once: true });

    if (!pendingScript.isConnected) document.head.append(pendingScript);
  }).catch((error: unknown) => {
    xWidgetsLoadPromise = null;
    if (!readyXWidgetsApi()) pendingScript.remove();
    throw error;
  });

  return xWidgetsLoadPromise;
}

function resolveTimelineElements(): LandingXTimelineElements | null {
  const root = document.getElementById('news-x-card');
  const mount = document.getElementById('news-x-mount');
  const privacyButton = document.getElementById('news-x-privacy');
  const retryButton = document.getElementById('news-x-retry');
  const statusTarget = root?.querySelector<HTMLElement>('.news-x-state-shell') ?? null;
  if (
    !root ||
    !mount ||
    !statusTarget ||
    !(privacyButton instanceof HTMLButtonElement) ||
    !(retryButton instanceof HTMLButtonElement)
  ) {
    return null;
  }
  return {
    mount,
    privacyButton,
    retryButton,
    root,
    statusTarget,
  };
}

function setTimelineState(
  { mount, privacyButton, retryButton, root }: LandingXTimelineElements,
  state: LandingXTimelineState,
): void {
  root.dataset.xState = state;
  mount.setAttribute('aria-busy', String(state === 'loading'));
  if (state === 'loaded') {
    mount.removeAttribute('inert');
    mount.removeAttribute('aria-hidden');
  } else {
    mount.setAttribute('inert', '');
    mount.setAttribute('aria-hidden', 'true');
  }

  privacyButton.hidden = state !== 'consent';
  privacyButton.disabled = state !== 'consent';
  retryButton.hidden = state !== 'error';
  retryButton.disabled = state !== 'error';
}

function timelineIframes(mount: HTMLElement): HTMLIFrameElement[] {
  return Array.from(mount.querySelectorAll<HTMLIFrameElement>('iframe'));
}

function isUsableTimelineIframe(frame: HTMLIFrameElement): boolean {
  const style = window.getComputedStyle(frame);
  return (
    frame.getBoundingClientRect().height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse'
  );
}

function usableTimelineIframes(mount: HTMLElement): HTMLIFrameElement[] {
  return timelineIframes(mount).filter(isUsableTimelineIframe);
}

function waitForUsableTimelineIframes(mount: HTMLElement): Promise<readonly HTMLIFrameElement[]> {
  const existingFrames = usableTimelineIframes(mount);
  if (existingFrames.length > 0) return Promise.resolve(existingFrames);

  return new Promise<readonly HTMLIFrameElement[]>((resolve, reject) => {
    let mutationObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const resizeObservedFrames = new Set<HTMLIFrameElement>();
    let settled = false;
    let timeoutId: number | undefined;

    const cleanup = (): void => {
      mutationObserver?.disconnect();
      mutationObserver = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      resizeObservedFrames.clear();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    const resolveOnce = (frames: readonly HTMLIFrameElement[]): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(frames);
    };
    const rejectOnce = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('X timeline iframe timed out'));
    };
    const checkForFrames = (): void => {
      const frames = timelineIframes(mount);
      if (resizeObserver) {
        for (const frame of frames) {
          if (resizeObservedFrames.has(frame)) continue;
          resizeObservedFrames.add(frame);
          resizeObserver.observe(frame);
        }
      }
      const usableFrames = frames.filter(isUsableTimelineIframe);
      if (usableFrames.length > 0) resolveOnce(usableFrames);
    };

    mutationObserver = new MutationObserver(checkForFrames);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(checkForFrames);
    }
    timeoutId = window.setTimeout(rejectOnce, X_TIMELINE_IFRAME_TIMEOUT_MS);
    mutationObserver.observe(mount, {
      attributes: true,
      attributeFilter: ['class', 'height', 'hidden', 'style', 'width'],
      childList: true,
      subtree: true,
    });
    checkForFrames();
  });
}

function titleTimelineIframes(frames: readonly HTMLIFrameElement[], title: string): void {
  for (const frame of frames) {
    frame.title = title;
  }
}

export function initLandingXTimeline(
  options: LandingXTimelineOptions,
): LandingXTimelineController | null {
  const elements = resolveTimelineElements();
  if (!elements || initializedRoots.has(elements.root)) return null;
  initializedRoots.add(elements.root);
  elements.statusTarget.id = X_TIMELINE_STATUS_TARGET_ID;
  elements.statusTarget.tabIndex = -1;

  if (
    !landingXTimelineSupportsEmbed(
      options,
      window.matchMedia(X_TIMELINE_EMBED_MIN_WIDTH_QUERY).matches,
    )
  ) {
    setTimelineState(elements, 'hidden');
    return null;
  }

  let loading = false;
  let activated = false;

  const retitleMountedFrames = (): void => {
    const frames = usableTimelineIframes(elements.mount);
    if (frames.length === 0) return;
    titleTimelineIframes(frames, options.iframeTitle());
  };
  document.addEventListener('woc:languagechange', retitleMountedFrames);

  const activate = (moveFocus: boolean): void => {
    if (loading || activated) return;
    if (options.privacyAllowed?.() === false) {
      setTimelineState(elements, 'consent');
      return;
    }
    activated = true;
    loading = true;
    setTimelineState(elements, 'loading');
    if (moveFocus) elements.statusTarget.focus();

    const timelineAnchor = elements.mount.querySelector<HTMLAnchorElement>('.twitter-timeline');
    if (timelineAnchor) {
      timelineAnchor.dataset.height = String(
        landingXTimelineHeight(window.matchMedia(X_TIMELINE_COMPACT_QUERY).matches),
      );
    }

    void loadXWidgetsApi()
      .then(async (api) => {
        await api.widgets.load(elements.mount);
        const frames = await waitForUsableTimelineIframes(elements.mount);
        titleTimelineIframes(frames, options.iframeTitle());
        setTimelineState(elements, 'loaded');
      })
      .catch(() => {
        setTimelineState(elements, 'error');
        activated = false;
      })
      .finally(() => {
        loading = false;
      });
  };

  elements.privacyButton.addEventListener('click', () => options.openPrivacyPreferences?.());
  elements.retryButton.addEventListener('click', () => activate(true));
  setTimelineState(elements, 'consent');
  return { load: () => activate(document.activeElement === elements.privacyButton) };
}
