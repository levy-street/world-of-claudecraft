// The texture choices the per-material finish picker offers (the Materials
// section of the Select inspector): the same library ground textures the
// building workspace's wall finishes use, labelled by their catalog names.

import { modelMaterialOptions } from '../render/model_materials';
import { type TranslationKey, t } from '../ui/i18n';

/** Library groups that read as building surfaces (the wall-finish set). */
const BUILDING_GROUPS: ReadonlySet<string> = new Set([
  'stone',
  'brick',
  'plaster',
  'wood',
  'paving',
  'metal',
]);

export interface FinishTextureOption {
  value: string;
  label: string;
}

/** Library textures for a material finish, in the library's own order. */
export function finishTextureOptions(): FinishTextureOption[] {
  return modelMaterialOptions()
    .filter((m) => BUILDING_GROUPS.has(m.group))
    .map((m) => ({
      value: m.key,
      label: t(`editor.buildMode.materialNames.${m.key}` as TranslationKey),
    }));
}
