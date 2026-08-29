import type { GamepadManager } from './gamepad';
import { gamepadKindOverride } from './gamepad_map';
import type { GameSettings, Settings } from './settings';

export type GamepadSettingApplier = (key: keyof GameSettings, value: number | boolean) => boolean;

/** Build the controller-owned arm of main's settings dispatcher. Keeping these
 *  writes together makes a glyph-family change follow the same persisted/live
 *  path as the rest of the controller panel without growing the main firewall. */
export function createGamepadSettingApplier(
  pad: GamepadManager,
  settings: Settings,
  syncPadMode: () => void,
): GamepadSettingApplier {
  return (key, value) => {
    switch (key) {
      case 'gamepadEnabled': {
        const enabled = settings.set(key, Boolean(value));
        if (enabled) pad.start();
        else pad.stop();
        syncPadMode();
        return true;
      }
      case 'gamepadInvertY':
        pad.setInvertY(settings.set(key, Boolean(value)));
        return true;
      case 'gamepadStickDeadzone':
        pad.setDeadzone(settings.set(key, Number(value)));
        return true;
      case 'gamepadCameraSpeed':
        pad.setCameraSpeed(settings.set(key, Number(value)));
        return true;
      case 'gamepadReticleSpeed':
        settings.set(key, Number(value));
        return true;
      case 'gamepadVibration':
        pad.setVibration(settings.set(key, Number(value)));
        return true;
      case 'gamepadGlyphStyle':
        pad.setKindOverride(gamepadKindOverride(settings.set(key, Number(value))));
        return true;
      default:
        return false;
    }
  };
}
