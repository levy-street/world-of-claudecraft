// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('keeps Groups sound usable when its initial storage read fails', async () => {
  const storage = {
    getItem: vi.fn(() => {
      throw new Error('disabled');
    }),
    setItem: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage);
  const sound = await import('../src/ui/hud/expeditions/notification_sound');
  expect(sound.notificationSoundEnabled()).toBe(false);
  sound.setNotificationSound(true);
  expect(sound.notificationSoundEnabled()).toBe(true);
  expect(storage.getItem).toHaveBeenCalledOnce();
});
