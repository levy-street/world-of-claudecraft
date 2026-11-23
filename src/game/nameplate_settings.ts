// Apply nameplate row scales and selection preferences through one settings seam.
import { setNameplateCooldownScale } from '../render/nameplate_cooldown_scale';
import { setNameplateDotScale } from '../render/nameplate_dot_scale';
import {
  type TargetHighlightFlags,
  type TargetHighlightSettingKey,
  targetHighlightFlagFor,
} from '../render/target_highlight_core';
import type { Settings } from './settings';

export interface NameplateSettingsRenderer {
  showDevBadges: boolean;
  showOwnNameplate: boolean;
  showPlayerNameplates: boolean;
  targetHighlight: TargetHighlightFlags;
}

export function applyNameplateSetting(
  settings: Pick<Settings, 'set' | 'nameplateDotRenderScale' | 'nameplateCooldownRenderScale'>,
  renderer: NameplateSettingsRenderer,
  key: string,
  value: number | boolean,
): boolean {
  if (key === 'showNameplateDots' || key === 'showNameplateCooldowns') {
    settings.set(key, !!value);
    applyNameplateRowScales(settings);
    return true;
  }
  if (key === 'nameplateDotScale' || key === 'nameplateCooldownScale') {
    settings.set(key, Number(value));
    applyNameplateRowScales(settings);
    return true;
  }
  if (key === 'showDevBadges' || key === 'showOwnNameplate' || key === 'showPlayerNameplates') {
    renderer[key] = settings.set(key, !!value);
    return true;
  }
  const flag = targetHighlightFlagFor(key);
  if (!flag) return false;
  renderer.targetHighlight[flag] = settings.set(key as TargetHighlightSettingKey, !!value);
  return true;
}

/** Boot and renderer rebuild consume the same persisted fold as setting changes. */
export function applyNameplateRowScales(
  settings: Pick<Settings, 'nameplateDotRenderScale' | 'nameplateCooldownRenderScale'>,
): void {
  setNameplateDotScale(settings.nameplateDotRenderScale());
  setNameplateCooldownScale(settings.nameplateCooldownRenderScale());
}
