import type { Settings } from './settings';

export interface MouseCameraSettingsInput {
  setMouseCameraEnabled(on: boolean): void;
  setLockCursorOnRotate(on: boolean): void;
  setRawMouseInput(on: boolean): void;
}

/** Boot and live options changes share the same persisted camera input settings. */
export function applyMouseCameraSetting(
  settings: Pick<Settings, 'set'>,
  input: MouseCameraSettingsInput,
  key: string,
  value: number | boolean,
): boolean {
  if (key === 'mouseCamera') {
    input.setMouseCameraEnabled(settings.set(key, !!value));
  } else if (key === 'lockCursorOnRotate') {
    input.setLockCursorOnRotate(settings.set(key, !!value));
  } else if (key === 'rawMouseInput') {
    input.setRawMouseInput(settings.set(key, !!value));
  } else {
    return false;
  }
  return true;
}
