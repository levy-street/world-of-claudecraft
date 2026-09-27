import { type GameSettings, Settings } from '../game/settings';
import { FRAME_PRESET_SETTINGS, framePresetGeometryKey } from './frame_presets_core';
import type { InterfaceUnlock } from './interface_unlock';

interface LayoutOwners {
  frames: Pick<InterfaceUnlock, 'restoreSavedLayout' | 'reapplyAll' | 'refreshSettings'>;
  chat: { restoreSavedLayout(): void; reapply(): void };
  meters: { restoreSavedLayout(): void; reapplyFrames(): void };
  auras: { restoreSavedLayout(): void; reapplyFrame(): void };
  settle(): void;
}
/** Replace every cached frame owner after loading a preset, or just reclamp on scale changes. */
export function applySavedFrameLayout(
  hooks: { settings: Settings; onSettingChange(key: string, value: number | boolean): void } | null,
  replace: boolean,
  owners: LayoutOwners,
): void {
  if (!replace || !hooks) {
    owners.chat.reapply();
    owners.frames.reapplyAll();
    owners.meters.reapplyFrames();
    owners.auras.reapplyFrame();
    return;
  }
  const keys = () =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
      (key): key is string => key !== null && framePresetGeometryKey(key),
    );
  const geometry = new Map(keys().map((key) => [key, localStorage.getItem(key)!]));
  const loaded = new Settings().all();
  const patch = Object.fromEntries(
    [...FRAME_PRESET_SETTINGS].map((key) => [key, loaded[key]]),
  ) as Partial<GameSettings>;
  hooks.settings.patch(patch);
  for (const key of FRAME_PRESET_SETTINGS) hooks.onSettingChange(key, hooks.settings.get(key));
  // Normal settings application can reanchor and persist old live geometry. The preset wins.
  for (const key of keys()) if (!geometry.has(key)) localStorage.removeItem(key);
  for (const [key, value] of geometry) localStorage.setItem(key, value);
  owners.frames.restoreSavedLayout();
  owners.chat.restoreSavedLayout();
  owners.meters.restoreSavedLayout();
  owners.auras.restoreSavedLayout();
  owners.settle();
  owners.frames.refreshSettings();
}
