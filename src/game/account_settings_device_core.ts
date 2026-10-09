import type { DeviceType } from '../account_settings_contract';

export interface AccountSettingsDeviceFacts {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  screenWidth: number;
  screenHeight: number;
}

/** Physical device family, independent of orientation and the chosen HUD mode. */
export function classifyAccountSettingsDevice(facts: AccountSettingsDeviceFacts): DeviceType {
  const ua = facts.userAgent;
  if (/iPad/i.test(ua) || (facts.platform === 'MacIntel' && (facts.maxTouchPoints ?? 0) > 1)) {
    return 'tablet';
  }
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return 'phone';
  if (/Android/i.test(ua)) {
    // Android phones advertise Mobile even when their screens are unusually large.
    return /Mobile/i.test(ua) ? 'phone' : 'tablet';
  }
  if (/Tablet|Silk|PlayBook/i.test(ua)) return 'tablet';
  return 'desktop';
}
