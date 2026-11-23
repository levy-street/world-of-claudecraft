// The display name of one COPY or stack of an item, where it can be named for
// something its definition cannot know: a promoted legendary's player-chosen
// `instance.name` (raw, player-authored), or a World PvP trophy skull whose
// provenance names exactly one victim (src/sim/pvp/world_pvp_trophy.ts):
// "Bet's Skull" on the loser's body in the loot window. A skull stack holding
// several victims reads as its definition ("Trophy Skull") and lists who is in
// it on the tooltip's provenance rows, the way a material lists its gatherers.
//
// Pure: no DOM; i18n only for the label.

import type { MaterialComposition } from '../sim/material_sources';
import { WORLD_PVP_SKULL_ITEM_ID } from '../sim/pvp/world_pvp_trophy';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { t } from './i18n';

/** The one victim a skull stack names, or null when it names none or several. */
export function soleSkullVictim(sources: MaterialComposition | undefined): string | null {
  if (sources === undefined || sources.length !== 1) return null;
  const name = sources[0].source.gatherer?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/** The copy-specific name, or null when it reads as its definition. A chosen
 *  legendary name wins; a single-victim skull slots its victim's (raw) name
 *  into a translated frame. */
export function itemCopyOwnName(
  def: ItemDef,
  instance?: ItemInstancePayload,
  sources?: MaterialComposition,
): string | null {
  if (instance?.name !== undefined) return instance.name;
  if (def.id === WORLD_PVP_SKULL_ITEM_ID) {
    const victim = soleSkullVictim(sources);
    if (victim !== null) return t('hudChrome.worldPvp.skullName', { name: victim });
  }
  return null;
}

/** The name to show: its own name when it has one, else the definition's. */
export function itemCopyDisplayName(
  def: ItemDef,
  instance?: ItemInstancePayload,
  sources?: MaterialComposition,
): string {
  return itemCopyOwnName(def, instance, sources) ?? itemDisplayName(def);
}
