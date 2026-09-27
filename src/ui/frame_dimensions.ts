import { type NumericSettingKey, SETTING_RANGES } from '../game/settings';
import type { FramesMenuSettingsHooks } from './interface_unlock_menu_core';
import type { FrameDimension, MovableFrameConfig } from './movable_frame';
import { frameScales, parseTargetFramePos, serializeTargetFramePos } from './target_frame_pos';

export function frameDimension(
  options: () => FramesMenuSettingsHooks | null,
  key: NumericSettingKey,
  factor?: () => number,
): FrameDimension {
  const range = SETTING_RANGES[key];
  return {
    get: () => Number(options()?.settings.get(key) ?? range.def),
    set: (value) => {
      const hooks = options();
      if (hooks) hooks.onSettingChange(key, hooks.settings.set(key, value));
    },
    min: range.min,
    max: range.max,
    factor,
  };
}

const UNIT_KEYS = {
  petFrame: ['petFrameWidth', 'petFrameHeight'],
  focusTarget1: ['focusTarget1Width', 'focusTarget1Height'],
  focusTarget2: ['focusTarget2Width', 'focusTarget2Height'],
  focusTarget3: ['focusTarget3Width', 'focusTarget3Height'],
} as const;

/** Pet and focus frames resize their bars without stretching text or portraits. */
export function additionalUnitDimensions(
  id: string,
  options: () => FramesMenuSettingsHooks | null,
): MovableFrameConfig['dimensions'] {
  const keys = UNIT_KEYS[id as keyof typeof UNIT_KEYS];
  if (!keys) return undefined;
  const zoom = () =>
    id === 'petFrame' ? 0.8 * Number(options()?.settings.get('playerFrameScale') ?? 1) : 1;
  return {
    width: frameDimension(options, keys[0], zoom),
    height: frameDimension(options, keys[1], () => 2 * zoom()),
  };
}

/** Convert the old pet zoom once, after the settings owner is available. */
export function migratePetFrameSize(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  options: () => FramesMenuSettingsHooks | null,
): boolean {
  if (!options()) return false;
  try {
    const pos = parseTargetFramePos(storage.getItem(key));
    if (!pos || (pos.scale === undefined && pos.scaleX === undefined && pos.scaleY === undefined))
      return false;
    const { sx, sy } = frameScales(pos);
    const dims = additionalUnitDimensions('petFrame', options)!;
    // Legacy pet zoom was relative to the stock bar dimensions.
    dims.width!.set(SETTING_RANGES.petFrameWidth.def * sx);
    dims.height!.set(SETTING_RANGES.petFrameHeight.def * sy);
    storage.setItem(
      key,
      serializeTargetFramePos({ left: pos.left, top: pos.top, vw: pos.vw, vh: pos.vh }),
    );
    return true;
  } catch {
    /* Leave the durable legacy value available for a later attempt. */
    return false;
  }
}
