// Painted class emblems, one 256px WebP per class under public/ui/classes/<id>.webp,
// normalized by scripts/convert_class_icons_webp.mjs (`npm run assets:classes`).
//
// These are the "pick a class" marks: the crossed sword and axe, the totem, the antlered
// crescent. They read at a glance in a rail of nine, which is what the class picker on the
// character screens needs, the 3D headshot it used to show was the same subject as the
// turntable standing right above it, so the rail said "pick a face" rather than "pick a
// class".
//
// Deliberately NOT the same thing as the procedural class CREST (icons.ts
// CREST_RECIPES.class_<id>). The crest is a tiny generated badge, drawn onto a canvas
// synchronously by unit_portrait_painter.ts for unit-frame portraits and used at ~16px as
// the corner badge on a portrait chip; it stays procedural precisely because that path
// cannot wait on an image decode. This art is for the surfaces that draw an <img> and can
// afford the bytes.
//
// The id set is CLOSED, it is exactly PlayerClass, so this is a plain literal Set with no
// fs at runtime, mirroring chrome_icon_art.ts. tests/class_icons.test.ts gates it against
// the committed .webp files in both directions and against ALL_CLASSES, so a dropped file,
// a new class, or a typo reds the suite.

import type { PlayerClass } from '../sim/types';

const CLASS_ICON_DIR = '/ui/classes';

export const CLASS_ART_IDS: ReadonlySet<PlayerClass> = new Set<PlayerClass>([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);

/** True when `id` is a class that ships painted emblem art. */
export function hasClassIconArt(id: string): id is PlayerClass {
  return CLASS_ART_IDS.has(id as PlayerClass);
}

/** Static URL of a class's painted emblem, or null when `id` is not a class. */
export function classIconUrl(id: string): string | null {
  return hasClassIconArt(id) ? `${CLASS_ICON_DIR}/${id}.webp` : null;
}
