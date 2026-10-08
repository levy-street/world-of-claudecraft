import { describe, expect, it } from 'vitest';
import { classifyAccountSettingsDevice } from '../src/game/account_settings_device_core';

describe('account settings physical device families', () => {
  it.each([
    ['Mozilla Windows Chrome', 'Win32', 10, 'desktop'],
    ['Mozilla Macintosh Safari', 'MacIntel', 0, 'desktop'],
    ['Mozilla Macintosh Safari', 'MacIntel', 5, 'tablet'],
    ['Mozilla iPad Safari', 'iPad', 5, 'tablet'],
    ['Mozilla iPhone Safari', 'iPhone', 5, 'phone'],
    ['Mozilla Android Mobile Chrome', 'Linux', 5, 'phone'],
    ['Mozilla Android Chrome', 'Linux', 5, 'tablet'],
  ] as const)(
    'classifies %s without orientation or chosen UI',
    (userAgent, platform, maxTouchPoints, family) => {
      for (const [screenWidth, screenHeight] of [
        [400, 900],
        [900, 400],
      ]) {
        expect(
          classifyAccountSettingsDevice({
            userAgent,
            platform,
            maxTouchPoints,
            screenWidth,
            screenHeight,
          }),
        ).toBe(family);
      }
    },
  );
});
