import { describe, expect, it } from 'vitest';
import {
  isSupportedBrowser,
  persistBrowserSupportNoticeDismissed,
  readBrowserSupportNoticeDismissed,
  readHasBraveApi,
  shouldShowBrowserSupportNotice,
} from '../src/game/browser_support_notice';

const UA = {
  chromeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  edgeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  safariDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  operaDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  unknown: 'SomeOddBrowser/1.0',
};

describe('isSupportedBrowser', () => {
  it('accepts real Chrome, Firefox, and Safari', () => {
    expect(isSupportedBrowser(UA.chromeDesktop, false)).toBe(true);
    expect(isSupportedBrowser(UA.firefoxDesktop, false)).toBe(true);
    expect(isSupportedBrowser(UA.safariDesktop, false)).toBe(true);
  });

  it('rejects Brave even though its UA reports plain Chrome', () => {
    expect(isSupportedBrowser(UA.chromeDesktop, true)).toBe(false);
  });

  it('rejects Chromium-based Edge via its Edg/ token', () => {
    expect(isSupportedBrowser(UA.edgeDesktop, false)).toBe(false);
  });

  it('rejects Opera via its OPR/ token', () => {
    expect(isSupportedBrowser(UA.operaDesktop, false)).toBe(false);
  });

  it('defaults an unrecognized UA to supported so a real Chrome user is never misflagged', () => {
    expect(isSupportedBrowser(UA.unknown, false)).toBe(true);
  });
});

describe('readHasBraveApi', () => {
  it('reads true only when navigator.brave is a real object', () => {
    expect(readHasBraveApi({ brave: {} })).toBe(true);
    expect(readHasBraveApi({})).toBe(false);
    expect(readHasBraveApi({ brave: undefined })).toBe(false);
  });
});

describe('shouldShowBrowserSupportNotice', () => {
  const base = {
    isSupportedBrowser: false,
    isDesktopApp: false,
    isNativeShell: false,
    dismissed: false,
  };

  it('shows on a genuinely unsupported, non-desktop, non-native, undismissed session', () => {
    expect(shouldShowBrowserSupportNotice(base)).toBe(true);
  });

  it('never shows on a supported browser', () => {
    expect(shouldShowBrowserSupportNotice({ ...base, isSupportedBrowser: true })).toBe(false);
  });

  it('never shows in the desktop app', () => {
    expect(shouldShowBrowserSupportNotice({ ...base, isDesktopApp: true })).toBe(false);
  });

  it('never shows in a native mobile shell', () => {
    expect(shouldShowBrowserSupportNotice({ ...base, isNativeShell: true })).toBe(false);
  });

  it('never shows once dismissed', () => {
    expect(shouldShowBrowserSupportNotice({ ...base, dismissed: true })).toBe(false);
  });
});

class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('browser support notice dismissal persistence', () => {
  it('defaults to not-dismissed and persists across reads', () => {
    const storage = new FakeStorage();
    expect(readBrowserSupportNoticeDismissed(storage)).toBe(false);
    persistBrowserSupportNoticeDismissed(storage);
    expect(readBrowserSupportNoticeDismissed(storage)).toBe(true);
  });

  it('never throws when storage access fails (private mode)', () => {
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => {
        throw new Error('blocked');
      },
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => readBrowserSupportNoticeDismissed(throwing)).not.toThrow();
    expect(readBrowserSupportNoticeDismissed(throwing)).toBe(false);
    expect(() => persistBrowserSupportNoticeDismissed(throwing)).not.toThrow();
  });
});
