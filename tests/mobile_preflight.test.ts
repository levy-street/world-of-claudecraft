import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isStandaloneDisplay,
  mobilePlatform,
  mobilePreflightCopy,
} from '../src/game/mobile_preflight';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubNavigator = (nav: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone?: boolean;
}) => vi.stubGlobal('navigator', nav);

const stubWindow = (standaloneDisplayMode: boolean) =>
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query === '(display-mode: standalone)' ? standaloneDisplayMode : false,
    }),
  });

describe('mobilePlatform', () => {
  it('detects iPhone/iPad/iPod user agents as ios', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(mobilePlatform()).toBe('ios');
  });

  it('detects a touch-capable Mac (iPad reporting desktop Safari) as ios', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(mobilePlatform()).toBe('ios');
  });

  it('never flags a real Intel Mac with no touch points as ios', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    });
    expect(mobilePlatform()).toBe('other');
  });

  it('detects Android user agents as android', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Linux; Android 16)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    expect(mobilePlatform()).toBe('android');
  });

  it('falls back to other for a desktop browser', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 0,
    });
    expect(mobilePlatform()).toBe('other');
  });
});

describe('isStandaloneDisplay', () => {
  it('is true when the display-mode media query matches (installed PWA)', () => {
    stubNavigator({ userAgent: '', platform: '', maxTouchPoints: 0 });
    stubWindow(true);
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('is true for iOS Safari home-screen apps via navigator.standalone', () => {
    stubNavigator({ userAgent: '', platform: '', maxTouchPoints: 0, standalone: true });
    stubWindow(false);
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('is false in an ordinary browser tab', () => {
    stubNavigator({ userAgent: '', platform: '', maxTouchPoints: 0 });
    stubWindow(false);
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe('mobilePreflightCopy', () => {
  it('gives iOS install steps (share, then open) when not yet standalone', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    stubWindow(false);
    const copy = mobilePreflightCopy();
    expect(copy.steps[0]).not.toBe(copy.steps[copy.steps.length - 1]);
    expect(copy.steps).toHaveLength(4);
  });

  it('drops the install steps once already standalone on iOS', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: true,
    });
    stubWindow(false);
    const copy = mobilePreflightCopy();
    expect(copy.steps).toHaveLength(2);
  });

  it('gives Android install steps when not yet standalone', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Linux; Android 16)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    stubWindow(false);
    const copy = mobilePreflightCopy();
    expect(copy.steps).toHaveLength(4);
  });

  it('drops the install steps once already standalone on Android', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Linux; Android 16)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    stubWindow(true);
    const copy = mobilePreflightCopy();
    expect(copy.steps).toHaveLength(2);
  });

  it('falls back to the generic copy with only the base steps on an unrecognized platform', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 0,
    });
    stubWindow(false);
    const copy = mobilePreflightCopy();
    expect(copy.steps).toHaveLength(2);
  });

  it('every branch returns a non-empty detail string', () => {
    for (const nav of [
      { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
      { userAgent: 'Android', platform: 'Linux armv8l', maxTouchPoints: 5 },
      { userAgent: 'other', platform: 'Win32', maxTouchPoints: 0 },
    ]) {
      stubNavigator(nav);
      stubWindow(false);
      expect(mobilePreflightCopy().detail.length).toBeGreaterThan(0);
    }
  });
});
