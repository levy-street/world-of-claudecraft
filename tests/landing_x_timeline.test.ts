import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  landingXTimelineDecision,
  landingXTimelineHeight,
  landingXTimelineSupportsEmbed,
  X_PROFILE_URL,
  X_TIMELINE_COMPACT_HEIGHT,
  X_TIMELINE_COMPACT_QUERY,
  X_TIMELINE_DEFAULT_HEIGHT,
  X_TIMELINE_EMBED_MIN_WIDTH_QUERY,
  X_TIMELINE_IFRAME_TIMEOUT_MS,
  X_TIMELINE_STATUS_TARGET_ID,
  X_WIDGETS_LOAD_TIMEOUT_MS,
  X_WIDGETS_SCRIPT_ID,
  X_WIDGETS_SCRIPT_URL,
} from '../src/ui/landing_x_timeline';

const moduleSource = readFileSync(
  fileURLToPath(new URL('../src/ui/landing_x_timeline.ts', import.meta.url)),
  'utf8',
);

describe('landing X timeline policy', () => {
  it('pins the approved profile, official script, and ten-second timeout', () => {
    expect(X_PROFILE_URL).toBe('https://x.com/WoClaudecraft');
    expect(X_WIDGETS_SCRIPT_URL).toBe('https://platform.x.com/widgets.js');
    expect(X_WIDGETS_SCRIPT_ID).toBe('woc-x-widgets-script');
    expect(X_WIDGETS_LOAD_TIMEOUT_MS).toBe(10_000);
    expect(X_TIMELINE_IFRAME_TIMEOUT_MS).toBe(8_000);
    expect(X_TIMELINE_STATUS_TARGET_ID).toBe('news-x-status');
    expect(X_TIMELINE_COMPACT_QUERY).toBe('(max-width: 899px)');
    expect(X_TIMELINE_EMBED_MIN_WIDTH_QUERY).toBe('(min-width: 600px)');
    expect(X_TIMELINE_COMPACT_HEIGHT).toBe(480);
    expect(X_TIMELINE_DEFAULT_HEIGHT).toBe(640);
  });

  it('selects the responsive timeline height without reading browser state', () => {
    expect(landingXTimelineHeight(true)).toBe(480);
    expect(landingXTimelineHeight(false)).toBe(640);
  });

  it('allows embeds only on the web and keeps packaged clients link-only', () => {
    expect(landingXTimelineDecision({ desktopApp: false, nativeApp: false })).toBe('embed');
    expect(landingXTimelineDecision({ desktopApp: true, nativeApp: false })).toBe('link-only');
    expect(landingXTimelineDecision({ desktopApp: false, nativeApp: true })).toBe('link-only');
    expect(landingXTimelineDecision({ desktopApp: true, nativeApp: true })).toBe('link-only');
  });
  it('uses the direct X profile instead of an iframe when the feed cannot fit comfortably', () => {
    expect(landingXTimelineSupportsEmbed({ desktopApp: false, nativeApp: false }, true)).toBe(true);
    expect(landingXTimelineSupportsEmbed({ desktopApp: false, nativeApp: false }, false)).toBe(
      false,
    );
    expect(landingXTimelineSupportsEmbed({ desktopApp: true, nativeApp: false }, true)).toBe(false);
  });

  it('keeps third-party script creation inside one reusable activation path', () => {
    const loaderStart = moduleSource.indexOf('function loadXWidgetsApi()');
    const resolverStart = moduleSource.indexOf('function resolveTimelineElements()');
    const scriptCreation = moduleSource.indexOf("document.createElement('script')");
    const activateStart = moduleSource.indexOf('const activate = (moveFocus: boolean): void =>');
    const listenerStart = moduleSource.indexOf("elements.retryButton.addEventListener('click'");
    const heightWrite = moduleSource.indexOf('timelineAnchor.dataset.height', activateStart);
    const loaderCall = moduleSource.indexOf('void loadXWidgetsApi()', activateStart);

    expect(loaderStart).toBeGreaterThan(-1);
    expect(scriptCreation).toBeGreaterThan(loaderStart);
    expect(scriptCreation).toBeLessThan(resolverStart);
    expect(heightWrite).toBeGreaterThan(activateStart);
    expect(loaderCall).toBeGreaterThan(heightWrite);
    expect(loaderCall).toBeLessThan(listenerStart);
    expect(moduleSource).toContain("querySelector<HTMLAnchorElement>('.twitter-timeline')");
    expect(moduleSource).toContain('window.matchMedia(X_TIMELINE_COMPACT_QUERY).matches');
    expect(moduleSource).not.toContain('elements.loadButton');
    expect(moduleSource).toContain(
      "elements.privacyButton.addEventListener('click', () => options.openPrivacyPreferences?.())",
    );
    expect(moduleSource).toContain(
      "elements.retryButton.addEventListener('click', () => activate(true))",
    );
    expect(moduleSource).toContain('if (loading || activated) return');
    expect(moduleSource).toContain(
      'return { load: () => activate(document.activeElement === elements.privacyButton) }',
    );
    expect(moduleSource.match(/document\.createElement\('script'\)/g)).toHaveLength(1);
    expect(moduleSource).not.toContain("document.createElement('a')");
    expect(moduleSource).not.toContain('innerHTML');
  });

  it('uses one retryable script promise and removes a failed or timed-out script', () => {
    expect(moduleSource).toContain('if (xWidgetsLoadPromise) return xWidgetsLoadPromise;');
    expect(moduleSource).toContain('xWidgetsLoadPromise = null;');
    expect(moduleSource).toContain('pendingScript.remove();');
    expect(moduleSource).toContain('X_WIDGETS_LOAD_TIMEOUT_MS,');
    expect(moduleSource).toContain("rejectOnce('X widgets script timed out')");
    expect(moduleSource).toContain("pendingScript.addEventListener('error', handleError");
    expect(moduleSource.match(/document\.head\.append\(pendingScript\)/g)).toHaveLength(1);
  });

  it('waits boundedly for a rendered, visible iframe and cleans every observer exit', () => {
    const usableStart = moduleSource.indexOf('function isUsableTimelineIframe(');
    const waitStart = moduleSource.indexOf('function waitForUsableTimelineIframes(');
    const titleStart = moduleSource.indexOf('function titleTimelineIframes(', waitStart);
    const usableSource = moduleSource.slice(usableStart, waitStart);
    const waitSource = moduleSource.slice(waitStart, titleStart);
    const immediateCheck = waitSource.indexOf(
      'const existingFrames = usableTimelineIframes(mount);',
    );
    const promiseStart = waitSource.indexOf('return new Promise');

    expect(usableStart).toBeGreaterThan(-1);
    expect(waitStart).toBeGreaterThan(usableStart);
    expect(usableSource).toContain('window.getComputedStyle(frame)');
    expect(usableSource).toContain('frame.getBoundingClientRect().height > 0');
    expect(usableSource).toContain("style.display !== 'none'");
    expect(usableSource).toContain("style.visibility !== 'hidden'");
    expect(immediateCheck).toBeGreaterThan(-1);
    expect(immediateCheck).toBeLessThan(promiseStart);
    expect(waitSource).toContain('mutationObserver = new MutationObserver(checkForFrames);');
    expect(waitSource).toContain('resizeObserver = new ResizeObserver(checkForFrames);');
    expect(waitSource).toContain('attributes: true');
    expect(waitSource).toContain(
      "attributeFilter: ['class', 'height', 'hidden', 'style', 'width']",
    );
    expect(waitSource).toContain('childList: true');
    expect(waitSource).toContain('subtree: true');
    expect(waitSource).toContain('mutationObserver?.disconnect();');
    expect(waitSource).toContain('resizeObserver?.disconnect();');
    expect(waitSource).toContain('window.clearTimeout(timeoutId);');
    expect(waitSource).toContain('window.setTimeout(rejectOnce, X_TIMELINE_IFRAME_TIMEOUT_MS)');
    expect(waitSource).toContain("reject(new Error('X timeline iframe timed out'))");
    expect(waitSource.match(/cleanup\(\);/g)).toHaveLength(2);
  });

  it('wires every planned control and exposes only the five approved states', () => {
    for (const id of ['news-x-card', 'news-x-mount', 'news-x-privacy', 'news-x-retry']) {
      expect(moduleSource).toContain(`'${id}'`);
    }

    expect(moduleSource).toContain("'consent' | 'loading' | 'loaded' | 'error' | 'hidden'");
    expect(moduleSource).toContain("privacyButton.hidden = state !== 'consent'");
    expect(moduleSource).toContain("retryButton.hidden = state !== 'error'");
    expect(moduleSource).not.toContain('news-x-load');
    expect(moduleSource).not.toContain('news-x-hide');
    expect(moduleSource).toContain("setTimelineState(elements, 'hidden')");
    expect(moduleSource).toContain("setTimelineState(elements, 'loading')");
    expect(moduleSource).toContain("setTimelineState(elements, 'loaded')");
    expect(moduleSource).toContain("setTimelineState(elements, 'error')");
    expect(moduleSource).toContain("setTimelineState(elements, 'consent')");

    const linkOnlyBranch = moduleSource.indexOf('!landingXTimelineSupportsEmbed(');
    const retryListener = moduleSource.indexOf("elements.retryButton.addEventListener('click'");
    expect(linkOnlyBranch).toBeGreaterThan(-1);
    expect(linkOnlyBranch).toBeLessThan(retryListener);
  });

  it('resolves the localized iframe title only after the widget frame is usable', () => {
    const widgetLoad = moduleSource.indexOf('await api.widgets.load(elements.mount);');
    const iframeWait = moduleSource.indexOf(
      'await waitForUsableTimelineIframes(elements.mount);',
      widgetLoad,
    );
    const titleCallback = moduleSource.indexOf('options.iframeTitle()', iframeWait);
    const loadedState = moduleSource.indexOf("setTimelineState(elements, 'loaded')", titleCallback);

    expect(moduleSource).toContain('iframeTitle: () => string;');
    expect(widgetLoad).toBeGreaterThan(-1);
    expect(iframeWait).toBeGreaterThan(widgetLoad);
    expect(titleCallback).toBeGreaterThan(iframeWait);
    expect(loadedState).toBeGreaterThan(titleCallback);
    expect(moduleSource).toContain('frame.title = title;');
    expect(moduleSource).not.toContain("setAttribute('title'");
    expect(moduleSource).not.toContain('replaceChildren');
  });
});

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  className = '';
  computedDisplay = 'block';
  computedVisibility = 'visible';
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  id = '';
  isConnected = true;
  rectHeight = 1;
  tabIndex = 0;
  title = '';

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {
    super();
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  click(): void {
    if (!this.disabled) this.dispatchEvent(new Event('click'));
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  getBoundingClientRect(): { height: number } {
    return { height: this.rectHeight };
  }

  querySelector<T>(selector: string): T | null {
    return (this.querySelectorAll<FakeElement>(selector)[0] as T | undefined) ?? null;
  }

  querySelectorAll<T>(selector: string): T[] {
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches as T[];
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
}

class FakeButtonElement extends FakeElement {}
class FakeAnchorElement extends FakeElement {}
class FakeIFrameElement extends FakeElement {}

class FakeDocument extends EventTarget {
  activeElement: FakeElement | null = null;
  readonly body = new FakeElement(this, 'body');
  readonly head = new FakeElement(this, 'head');

  getElementById(id: string): FakeElement | null {
    const find = (element: FakeElement): FakeElement | null => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    };
    return find(this.body) ?? find(this.head);
  }
}

type WidgetLoad = (element?: HTMLElement) => Promise<unknown> | undefined;

interface TimelineFixture {
  document: FakeDocument;
  frame: FakeIFrameElement;
  mount: FakeElement;
  privacy: FakeButtonElement;
  retry: FakeButtonElement;
  root: FakeElement;
  setWidgetLoad(load: WidgetLoad): void;
  status: FakeElement;
}

function timelineFixture(initialLoad: WidgetLoad = () => Promise.resolve()): TimelineFixture {
  const document = new FakeDocument();
  const root = new FakeElement(document, 'section');
  const status = new FakeElement(document, 'div');
  const mount = new FakeElement(document, 'div');
  const timelineAnchor = new FakeAnchorElement(document, 'a');
  const frame = new FakeIFrameElement(document, 'iframe');
  const privacy = new FakeButtonElement(document, 'button');
  const retry = new FakeButtonElement(document, 'button');
  let widgetLoad = initialLoad;

  root.id = 'news-x-card';
  status.className = 'news-x-state-shell';
  mount.id = 'news-x-mount';
  timelineAnchor.className = 'twitter-timeline';
  frame.rectHeight = 640;
  frame.title = 'Twitter Timeline';
  privacy.id = 'news-x-privacy';
  retry.id = 'news-x-retry';
  mount.append(timelineAnchor, frame);
  root.append(status, mount, privacy, retry);
  document.body.append(root);

  const window = {
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getComputedStyle: (element: FakeElement) => ({
      display: element.computedDisplay,
      visibility: element.computedVisibility,
    }),
    matchMedia: (query: string) => ({ matches: query === '(min-width: 600px)' }),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    twttr: {
      widgets: {
        load: (element?: HTMLElement) => widgetLoad(element),
      },
    },
  };

  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLButtonElement', FakeButtonElement);
  vi.stubGlobal('HTMLAnchorElement', FakeAnchorElement);
  vi.stubGlobal('HTMLIFrameElement', FakeIFrameElement);

  return {
    document,
    frame,
    mount,
    privacy,
    retry,
    root,
    setWidgetLoad(nextLoad: WidgetLoad): void {
      widgetLoad = nextLoad;
    },
    status,
  };
}

async function freshTimelineModule(): Promise<typeof import('../src/ui/landing_x_timeline')> {
  vi.resetModules();
  return import('../src/ui/landing_x_timeline');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('landing X timeline DOM behavior', () => {
  it('loads the web feed automatically on reveal without moving focus or reloading it twice', async () => {
    const widgetLoad = vi.fn(() => Promise.resolve());
    const fixture = timelineFixture(widgetLoad);
    fixture.retry.focus();
    const timeline = await freshTimelineModule();

    const controller = timeline.initLandingXTimeline({
      desktopApp: false,
      iframeTitle: () => 'Localized title',
      nativeApp: false,
    });

    expect(fixture.root.dataset.xState).toBe('consent');
    expect(fixture.document.activeElement).toBe(fixture.retry);

    controller?.load();
    controller?.load();
    expect(fixture.root.dataset.xState).toBe('loading');
    expect(fixture.document.activeElement).toBe(fixture.retry);

    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('loaded'));
    expect(fixture.frame.title).toBe('Localized title');
    expect(fixture.document.activeElement).toBe(fixture.retry);
    expect(widgetLoad).toHaveBeenCalledTimes(1);
  });

  it('opens Privacy Choices while consent is blocked and never creates a manual load path', async () => {
    let xAllowed = false;
    const openPrivacyPreferences = vi.fn();
    const widgetLoad = vi.fn(() => Promise.resolve());
    const fixture = timelineFixture(widgetLoad);
    const timeline = await freshTimelineModule();
    const controller = timeline.initLandingXTimeline({
      desktopApp: false,
      iframeTitle: () => 'Localized title',
      nativeApp: false,
      openPrivacyPreferences,
      privacyAllowed: () => xAllowed,
    });

    expect(fixture.root.dataset.xState).toBe('consent');
    expect(fixture.privacy.hidden).toBe(false);
    fixture.privacy.click();
    expect(openPrivacyPreferences).toHaveBeenCalledTimes(1);

    controller?.load();
    expect(fixture.root.dataset.xState).toBe('consent');
    expect(widgetLoad).not.toHaveBeenCalled();

    xAllowed = true;
    fixture.privacy.focus();
    controller?.load();
    expect(fixture.root.dataset.xState).toBe('loading');
    expect(fixture.document.activeElement).toBe(fixture.status);
    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('loaded'));
    expect(widgetLoad).toHaveBeenCalledTimes(1);
  });

  it('exposes the mount only after loaded and makes every fallback state inert', async () => {
    let rejectLoad = true;
    const fixture = timelineFixture(() =>
      rejectLoad ? Promise.reject(new Error('blocked')) : Promise.resolve(),
    );
    const timeline = await freshTimelineModule();
    const controller = timeline.initLandingXTimeline({
      desktopApp: false,
      iframeTitle: () => 'Localized title',
      nativeApp: false,
    });

    expect(fixture.root.dataset.xState).toBe('consent');
    expect(fixture.mount.hasAttribute('inert')).toBe(true);
    expect(fixture.mount.getAttribute('aria-hidden')).toBe('true');

    controller?.load();
    expect(fixture.root.dataset.xState).toBe('loading');
    expect(fixture.mount.hasAttribute('inert')).toBe(true);
    expect(fixture.mount.getAttribute('aria-hidden')).toBe('true');

    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('error'));
    expect(fixture.mount.hasAttribute('inert')).toBe(true);
    expect(fixture.mount.getAttribute('aria-hidden')).toBe('true');

    await Promise.resolve();
    rejectLoad = false;
    fixture.retry.click();
    expect(fixture.root.dataset.xState).toBe('loading');
    expect(fixture.mount.hasAttribute('inert')).toBe(true);
    expect(fixture.mount.getAttribute('aria-hidden')).toBe('true');

    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('loaded'));
    expect(fixture.mount.hasAttribute('inert')).toBe(false);
    expect(fixture.mount.getAttribute('aria-hidden')).toBeNull();
  });

  it('moves focus to the stable status target after consent and retry activation', async () => {
    let rejectLoad = true;
    const fixture = timelineFixture(() =>
      rejectLoad ? Promise.reject(new Error('blocked')) : Promise.resolve(),
    );
    const timeline = await freshTimelineModule();
    const controller = timeline.initLandingXTimeline({
      desktopApp: false,
      iframeTitle: () => 'Localized title',
      nativeApp: false,
    });

    expect(fixture.status.id).toBe(X_TIMELINE_STATUS_TARGET_ID);
    expect(fixture.status.tabIndex).toBe(-1);
    fixture.privacy.focus();
    controller?.load();
    expect(fixture.document.activeElement).toBe(fixture.status);

    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('error'));
    await Promise.resolve();
    rejectLoad = false;
    fixture.retry.focus();
    fixture.retry.click();
    expect(fixture.document.activeElement).toBe(fixture.status);
    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('loaded'));
  });

  it('re-titles every currently usable iframe when the document language changes', async () => {
    let localizedTitle = 'Latest posts in English';
    const title = vi.fn(() => localizedTitle);
    const fixture = timelineFixture();
    const timeline = await freshTimelineModule();
    const controller = timeline.initLandingXTimeline({
      desktopApp: false,
      iframeTitle: title,
      nativeApp: false,
    });

    controller?.load();
    await vi.waitFor(() => expect(fixture.root.dataset.xState).toBe('loaded'));
    expect(fixture.frame.title).toBe('Latest posts in English');

    const secondUsableFrame = new FakeIFrameElement(fixture.document, 'iframe');
    const hiddenFrame = new FakeIFrameElement(fixture.document, 'iframe');
    secondUsableFrame.rectHeight = 480;
    secondUsableFrame.title = 'Twitter Timeline';
    hiddenFrame.rectHeight = 480;
    hiddenFrame.computedVisibility = 'hidden';
    hiddenFrame.title = 'Twitter Timeline';
    fixture.mount.append(secondUsableFrame, hiddenFrame);

    localizedTitle = 'Latest posts in the selected language';
    fixture.document.dispatchEvent(new Event('woc:languagechange'));

    expect(fixture.frame.title).toBe(localizedTitle);
    expect(secondUsableFrame.title).toBe(localizedTitle);
    expect(hiddenFrame.title).toBe('Twitter Timeline');
    expect(title).toHaveBeenCalledTimes(2);
  });
});
