// Shared Deed Heraldry plaque silhouette authority. CSS hardcodes these clip
// paths and the tests pin each selector to this mirror, while the world canvas
// consumes the same fixed-pixel tip and notch measurements. Keeping the compact
// ends in pixels prevents a long localized player name from stretching the
// forged hardware into a giant wedge.

export type DeedHeraldryPlaqueShape = 'compact' | 'mirror' | 'ceremonial' | 'tab';

export const DEED_HERALDRY_PLAQUE_TIP_PX = 8;
export const DEED_HERALDRY_PLAQUE_NOTCH_PX = 4;
export const DEED_HERALDRY_CEREMONIAL_TIP_PX = 16;
export const DEED_HERALDRY_TAB_TIP_PX = 10;

export const DEED_HERALDRY_PLAQUE_CLIP_PATHS: Readonly<Record<DeedHeraldryPlaqueShape, string>> =
  Object.freeze({
    compact: 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 4px 50%)',
    mirror: 'polygon(8px 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 8px 100%, 0 50%)',
    ceremonial:
      'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)',
    tab: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)',
  });
