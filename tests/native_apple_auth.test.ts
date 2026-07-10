import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppleAuthorizationCancellation, isNativeIos } from '../src/net/native_apple_auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native Apple login visibility', () => {
  it('is enabled only on the Capacitor iOS platform', () => {
    vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'ios' } });
    expect(isNativeIos()).toBe(true);
    vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'android' } });
    expect(isNativeIos()).toBe(false);
  });

  it('distinguishes cancellation from an authorization failure', () => {
    expect(isAppleAuthorizationCancellation({ code: 'APPLE_CANCELED' })).toBe(true);
    expect(isAppleAuthorizationCancellation({ code: 'APPLE_AUTH_FAILED' })).toBe(false);
  });
});
