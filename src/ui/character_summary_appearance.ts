import type { CharacterSummary } from '../net/online';
import type { PreviewAppearance } from '../render/characters';

/** Convert a persisted roster row into the complete character turntable appearance. */
export function characterSummaryAppearance(c: CharacterSummary): PreviewAppearance {
  return {
    cls: c.class,
    skin: c.skin ?? 0,
    skinCatalog: c.skinCatalog ?? 'class',
    mainhandItemId: c.mainhandItemId ?? null,
    offhandItemId: c.offhandItemId ?? null,
    weaponSkinId: c.weaponSkinId ?? null,
    face: c.face,
    hairStyle: c.hairStyle,
    beard: c.beard,
    hairColor: c.hairColor,
    faceColor: c.faceColor,
  };
}
