import { describe, expect, it } from 'vitest';
import {
  initLandingTwitch,
  landingTwitchDecision,
  landingTwitchMountMode,
  TWITCH_CHANNEL,
  TWITCH_MIN_WIDTH,
  twitchParentForHostname,
} from '../src/ui/landing_twitch';

describe('landing Twitch embed policy', () => {
  it('uses the current page hostname as the required Twitch parent', () => {
    expect(twitchParentForHostname('worldofclaudecraft.com')).toBe('worldofclaudecraft.com');
    expect(twitchParentForHostname('www.worldofclaudecraft.com.')).toBe(
      'www.worldofclaudecraft.com',
    );
    expect(twitchParentForHostname('127.0.0.1')).toBe('127.0.0.1');
    expect(twitchParentForHostname('[::1]')).toBe('localhost');
    expect(twitchParentForHostname('https://example.com')).toBeNull();
    expect(TWITCH_CHANNEL).toBe('claudeplaysclaudecraft');
  });

  it('mounts only when the approved player can meet Twitch minimum dimensions', () => {
    const base = {
      desktopApp: false,
      hostname: 'worldofclaudecraft.com',
      nativeApp: false,
    };
    expect(landingTwitchDecision({ ...base, width: TWITCH_MIN_WIDTH })).toBe('mount');
    expect(landingTwitchDecision({ ...base, width: TWITCH_MIN_WIDTH - 1 })).toBe('compact');
  });

  it('uses the desktop inline mount for compact mobile players', () => {
    expect(landingTwitchMountMode('compact')).toBe('inline');
    expect(landingTwitchMountMode('mount')).toBe('inline');
    expect(landingTwitchMountMode('unavailable')).toBe('none');
  });

  it('keeps the third-party player out of packaged native and desktop shells', () => {
    const base = { hostname: 'worldofclaudecraft.com', width: 900 };
    expect(landingTwitchDecision({ ...base, desktopApp: true, nativeApp: false })).toBe('hidden');
    expect(landingTwitchDecision({ ...base, desktopApp: false, nativeApp: true })).toBe('hidden');
  });

  it('fails closed when a usable parent hostname is unavailable', () => {
    expect(
      landingTwitchDecision({
        desktopApp: false,
        hostname: '',
        nativeApp: false,
        width: 900,
      }),
    ).toBe('unavailable');
  });

  it('keeps the desktop native inline player lifecycle unchanged', async () => {
    let autoplayOption: boolean | null = null;
    const playerListeners = new Map<string, () => void>();

    class FakeTwitchPlayer {
      static readonly OFFLINE = 'offline';
      static readonly ONLINE = 'online';
      static readonly PLAY = 'play';
      static readonly PLAYBACK_BLOCKED = 'playback-blocked';
      static readonly PLAYING = 'playing';
      static readonly READY = 'ready';
      readonly listeners = playerListeners;

      constructor(_elementId: string, options: { autoplay: boolean }) {
        autoplayOption = options.autoplay;
      }

      addEventListener(event: string, listener: () => void): void {
        this.listeners.set(event, listener);
      }

      play(): void {}
    }

    const root = {
      dataset: { streamState: 'idle' } as Record<string, string>,
      querySelector: () => null,
      style: { setProperty: () => {} },
    } as unknown as HTMLElement;
    const mount = {
      getBoundingClientRect: () => ({ height: 300, left: 0, top: 0, width: 900 }),
      id: 'yuumiii-player',
    } as unknown as HTMLElement;
    const fakeDocument = {
      getElementById: (id: string) => {
        if (id === 'yuumiii-stream') return root;
        if (id === 'yuumiii-player') return mount;
        return null;
      },
    };
    const fakeWindow = {
      Twitch: { Player: FakeTwitchPlayer },
      addEventListener: () => {},
      innerWidth: 900,
      location: { hostname: '127.0.0.1' },
    };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    try {
      initLandingTwitch({ desktopApp: false, nativeApp: false, privacyAllowed: false });
      expect(root.dataset.streamState).toBe('blocked');

      initLandingTwitch({ desktopApp: false, nativeApp: false, privacyAllowed: true });
      await Promise.resolve();
      await Promise.resolve();

      expect(root.dataset.streamInline).toBe('true');
      expect(root.dataset.streamState).toBe('loading');
      expect(autoplayOption).toBe(false);

      playerListeners.get(FakeTwitchPlayer.READY)?.();
      expect(root.dataset.streamState).toBe('ready');

      playerListeners.get(FakeTwitchPlayer.PLAYING)?.();
      expect(root.dataset.streamState).toBe('online');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
  it('mounts compact mobile with the same native player options as desktop', async () => {
    let autoplayOption: boolean | null = null;
    let constructorCalls = 0;
    const playerListeners = new Map<string, () => void>();

    class FakeTwitchPlayer {
      static readonly OFFLINE = 'offline';
      static readonly ONLINE = 'online';
      static readonly PLAYBACK_BLOCKED = 'playback-blocked';
      static readonly PLAYING = 'playing';
      static readonly READY = 'ready';

      constructor(_elementId: string, options: { autoplay: boolean }) {
        autoplayOption = options.autoplay;
        constructorCalls += 1;
      }

      addEventListener(event: string, listener: () => void): void {
        playerListeners.set(event, listener);
      }
    }

    const root = {
      dataset: { streamState: 'idle' } as Record<string, string>,
      querySelector: () => null,
      style: { setProperty: () => {} },
    } as unknown as HTMLElement;
    const mount = {
      getBoundingClientRect: () => ({ height: 300, left: 0, top: 0, width: 390 }),
      id: 'yuumiii-player',
    } as unknown as HTMLElement;
    const fakeDocument = {
      getElementById: (id: string) => {
        if (id === 'yuumiii-stream') return root;
        if (id === 'yuumiii-player') return mount;
        return null;
      },
    };
    const fakeWindow = {
      Twitch: { Player: FakeTwitchPlayer },
      addEventListener: () => {},
      innerWidth: 390,
      location: { hostname: '127.0.0.1' },
    };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    try {
      initLandingTwitch({ desktopApp: false, nativeApp: false, privacyAllowed: true });
      await Promise.resolve();
      await Promise.resolve();

      expect(constructorCalls).toBe(1);
      expect(autoplayOption).toBe(false);
      expect(root.dataset.streamInline).toBe('true');
      expect(root.dataset.streamState).toBe('loading');

      playerListeners.get(FakeTwitchPlayer.READY)?.();
      expect(root.dataset.streamPlayerReady).toBe('true');
      expect(root.dataset.streamState).toBe('ready');

      playerListeners.get(FakeTwitchPlayer.ONLINE)?.();
      expect(root.dataset.streamPlayback).toBeUndefined();

      playerListeners.get(FakeTwitchPlayer.PLAYING)?.();
      expect(root.dataset.streamPlayback).toBe('playing');

      playerListeners.get(FakeTwitchPlayer.PLAYBACK_BLOCKED)?.();
      expect(root.dataset.streamPlayback).toBeUndefined();
      expect(root.dataset.streamState).toBe('ready');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
