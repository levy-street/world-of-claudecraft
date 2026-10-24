// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notificationSoundEnabled,
  setNotificationSound,
} from '../src/ui/hud/expeditions/notification_sound';

afterEach(() => vi.restoreAllMocks());

// The Node storage shim owns its methods instead of inheriting Storage.prototype.
// Spy on the storage instance so the same assertions cover both environments.
describe('Groups sound preference', () => {
  it('hydrates a saved opt-in once when the module first reads the preference', async () => {
    localStorage.setItem('woc_expedition_sound', '1');
    const reads = vi.spyOn(localStorage, 'getItem');
    expect(notificationSoundEnabled()).toBe(true);
    expect(notificationSoundEnabled()).toBe(true);
    expect(reads).toHaveBeenCalledExactlyOnceWith('woc_expedition_sound');
  });
  it('uses the live cached value when storage is unavailable', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    setNotificationSound(true);
    expect(notificationSoundEnabled()).toBe(true);
    setNotificationSound(false);
    expect(notificationSoundEnabled()).toBe(false);
  });
  it('does not read storage again during unchanged HUD polls', () => {
    setNotificationSound(true);
    const reads = vi.spyOn(localStorage, 'getItem');
    for (let n = 0; n < 20; n++) expect(notificationSoundEnabled()).toBe(true);
    expect(reads).not.toHaveBeenCalled();
  });
  it('accepts a preference changed in another tab', () => {
    setNotificationSound(false);
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'woc_expedition_sound', newValue: '1' }),
    );
    expect(notificationSoundEnabled()).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(notificationSoundEnabled()).toBe(false);
  });
});
