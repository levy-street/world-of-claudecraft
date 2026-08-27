// The ONE authority for how an item cell describes the COPY it holds
// (Masterwrought phase 13 QA, the rule of three): the character sheet's
// paperdoll row, the inspect card's row, and the player card's gear rows all
// grew the same triple in the same change (instance-effective quality, the
// color that quality maps to, and the player-chosen legendary name replacing
// the def name), and two more surfaces (the mail chip, the trade row) were
// found still reading the def alone. Every item cell reads this instead, so a
// missed surface becomes a call-site edit rather than a rediscovery.
//
// A pure core (UI_PURE_CORES, tests/architecture.test.ts): no DOM, no host
// state. The chosen name is player-authored text and leaves here RAW; the
// painter esc()s it at its sink (D13-2: a VALUE, never a key). The icon is
// deliberately NOT built here: the painter asks its PainterHost `itemIcon`
// dep with the quality this returns, so the icon seam stays injected.
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { QUALITY_COLOR } from './icons';
import { tooltipEffectiveQuality } from './item_instance_tooltip';

/** The name color for a quality the map does not carry (the styles token the
 *  character sheet and the mailbox chips carried as private copies). */
export const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

export interface WornItemCellParts {
  /** The chosen legendary name when the copy carries one, else the def's
   *  localized display name. Player-authored when it is the former: esc it. */
  name: string;
  /** The copy's effective quality (the rolled override narrowed to a known
   *  tier, else the def's), the value the icon rim and the label share. */
  quality: ItemDef['quality'];
  /** The name color that quality maps to. */
  color: string;
}

export function wornItemCellParts(
  item: ItemDef,
  instance: ItemInstancePayload | null | undefined,
): WornItemCellParts {
  const quality = tooltipEffectiveQuality(item, instance ?? undefined);
  return {
    name: instance?.name ?? itemDisplayName(item),
    quality,
    color: QUALITY_COLOR[quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR,
  };
}
