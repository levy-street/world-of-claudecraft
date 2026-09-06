// The player's shader warm-up option, seen from the game: a stored number
// (Settings keeps numbers and booleans only) mapped to the worker client's
// setting, and the registration that lets the client read it without
// reaching into persistence itself (src/render/shader_warm_client.ts,
// setShaderWarmStoredSettingSource). `auto` follows the GPU backend; `on` is
// the full policy (`all`: the live view waits behind its stand-in too); the
// probe-only `reveal` arm stays a query-string arm and is never a stored
// option.

import {
  noteShaderWarmSettingChanged,
  setShaderWarmStoredSettingSource,
} from '../render/shader_warm_client';
import type { ShaderWarmSetting } from '../render/shader_warm_client_core';
import { SETTINGS_CHANGE_EVENT } from './settings';

/** The stored values, in the order the options row lists them. */
export const SHADER_WARM_SETTING_VALUES = { auto: 0, off: 1, on: 2 } as const;

export type ShaderWarmStoredSetting = Exclude<ShaderWarmSetting, 'reveal'>;

export function shaderWarmSettingFromValue(value: number): ShaderWarmStoredSetting {
  const rounded = Math.round(value);
  if (rounded === SHADER_WARM_SETTING_VALUES.off) return 'off';
  if (rounded === SHADER_WARM_SETTING_VALUES.on) return 'all';
  return 'auto';
}

let subscribed = false;

/** Register the live store as the client's stored-setting source. The reader
 *  runs at the client's first policy call, so it must answer with the store
 *  that holds the player's current value.
 *
 *  The row is LIVE, and `shaderWarm` is not a graphics rebuild key, so nothing
 *  else re-reads it: the settings broadcast (Settings.save, one per persisted
 *  write) is what tells the client the player moved the row, so switching to
 *  Off retires the worker and its second WebGL2 context in the same session
 *  instead of at the next start. */
export function registerShaderWarmSetting(readValue: () => number): void {
  setShaderWarmStoredSettingSource(() => {
    try {
      return shaderWarmSettingFromValue(readValue());
    } catch {
      return null;
    }
  });
  if (subscribed) return;
  // The same object Settings.save dispatches on (window, never a bare globalThis:
  // a suite stubbing a partial window would otherwise listen on the wrong one).
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  subscribed = true;
  window.addEventListener(SETTINGS_CHANGE_EVENT, () => noteShaderWarmSettingChanged());
}
