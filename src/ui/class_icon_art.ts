// Painted class emblems, one 256px WebP per class under public/ui/classes/<id>.webp,
// normalized with `node scripts/convert_class_icons_webp.mjs`.
//
// These are the "pick a class" marks: the crossed sword and axe, the totem, the antlered
// crescent. They read at a glance in a rail of nine, which is what the class picker on the
// character screens needs, the 3D headshot it used to show was the same subject as the
// turntable standing right above it, so the rail said "pick a face" rather than "pick a
// class".
//
// The same paintings also back `class_<id>` crest identities. Unit portraits draw their
// procedural recipe synchronously, then replace it after the WebP decodes, so callers keep
// an immediate fallback without maintaining a second visual identity for each class.
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
