// Painted crest art shared by icon URLs and canvas-backed unit portraits.
// Class crests reuse the established class emblems. Family and status crests
// live in their own closed directories so missing or untrusted IDs never turn
// into arbitrary asset paths.

import type { PlayerClass } from '../sim/types';
import { classIconUrl } from './class_icon_art';

export const FAMILY_CREST_ART_IDS: ReadonlySet<string> = new Set([
  'beast',
  'humanoid',
  'mudfin',
  'spider',
  'burrower',
  'undead',
  'troll',
  'ogre',
  'elemental',
  'dragonkin',
  'reptile',
  'demon',
  'sheep',
]);

export const STATUS_CREST_ART_IDS: ReadonlySet<string> = new Set(['npc', 'boss', 'dead', 'combat']);

export function classCrestId(cls: PlayerClass): `class_${PlayerClass}` {
  return `class_${cls}`;
}

/** Return committed painted art for a known class, family, or status crest. */
export function crestIconUrl(id: string): string | null {
  if (id.startsWith('class_')) return classIconUrl(id.slice('class_'.length));

  if (id.startsWith('family_')) {
    const family = id.slice('family_'.length);
    return FAMILY_CREST_ART_IDS.has(family) ? `/ui/crests/families/${family}.webp` : null;
  }

  if (id.startsWith('status_')) {
    const status = id.slice('status_'.length);
    return STATUS_CREST_ART_IDS.has(status) ? `/ui/crests/status/${status}.webp` : null;
  }

  return null;
}
