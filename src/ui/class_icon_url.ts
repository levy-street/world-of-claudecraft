// Painted class portrait art (CraftPix RPG icon set): public/ui/class-icons/<class>.webp.
// Provenance in CREDITS.md; existence pinned by tests/class_icons.test.ts.
//
// Its own module rather than a helper on portrait_chip.ts, which is where it used to
// live: portrait_chip registers an onPortraitsReady listener at module scope to
// hydrate 3D headshots, so importing it just to build a URL drags that subscription
// into the importer. That is what broke tests/unit_portrait_painter.test.ts, whose
// portrait mock has no onPortraitsReady. Four consumers now (main.ts, portrait_chip,
// unit_portrait_painter, the icon test) and nothing here has a side effect.

import type { PlayerClass } from '../sim/types';

const CLASS_ICON_DIR = '/ui/class-icons';

/** URL of the painted class portrait for `cls`. Every playable class ships one. */
export function classIconUrl(cls: PlayerClass): string {
  return `${CLASS_ICON_DIR}/${cls}.webp`;
}
