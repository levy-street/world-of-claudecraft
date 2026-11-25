import type { ReliquarySourceHint } from '../../src/sim/content/reliquary';
import type { ItemDef } from '../../src/sim/types';
import { craftNameKey } from '../../src/ui/hud/professions/craft_name_view';
import { gatheringProfessionNameKey } from '../../src/ui/hud/professions/gathering_profession_name';
import { type TranslationKey, t } from '../../src/ui/i18n';
import { itemKindLabel, itemQualityLabel } from '../../src/ui/item_kind_label';
import { reliquarySourceLineText } from '../../src/ui/reliquary_labels';
import { reliquarySourceLinePlan } from '../../src/ui/reliquary_view';

// The older item-kind catalog still calls cosmetic companions buddies.
export function wikiItemKind(item: Pick<ItemDef, 'kind' | 'id'>): string {
  if (item.kind === 'buddy') return 'Companion';
  if (item.kind === 'buddy_cosmetic') return 'Companion cosmetic';
  return itemKindLabel(item.kind, item.id);
}

// Player-facing names for the ids that item pages mention. Each one reads the label the
// game's own HUD uses, so the wiki never prints a raw id.

const label = (key: string): string => t(key as TranslationKey);

/** Plain title-cased words, for ids the game has no label for. */
export function titleWords(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A craft or gathering profession, such as "Armorcrafting" or "Mining". */
export function wikiProfessionName(id: string): string {
  const key = craftNameKey(id) ?? gatheringProfessionNameKey(id);
  return key ? t(key) : titleWords(id);
}

/** A crafting station, such as "Forge" or "Toolworks". */
export function wikiStationName(type: string): string {
  return label('hudChrome.crafting.stationName.' + type);
}

/** The item quality shown on the tooltip, such as "Epic". */
export function wikiQualityName(quality: ItemDef['quality']): string {
  return itemQualityLabel(quality);
}

/** The armor class on the tooltip, such as "Cloth" or "Mail". */
export function wikiArmorTypeName(armorType: string): string {
  return label('hudChrome.itemArmorType.' + armorType);
}

/** A stat the character sheet names, such as "Crit Rating". */
export function wikiRatingName(rating: string): string {
  return label('hudChrome.statInfo.names.' + rating);
}

/** A faction standing tier, such as "Champion". */
export function wikiStandingTierName(tier: string): string {
  return label('hudChrome.reputation.tier.' + tier);
}

/** A Combat Mech color scheme, such as "Amber Crimson". */
export function wikiChromaName(id: string): string {
  return label('skinEvent.mech.' + id);
}

/** One Reliquary source line, written the way the Reliquary window writes it. */
export function wikiReliquarySource(hint: ReliquarySourceHint): string {
  const [plan] = reliquarySourceLinePlan([hint], undefined);
  return plan ? reliquarySourceLineText(plan) : '';
}

const EVENT_NAMES: Record<string, string> = { gourdlight_eve: 'Gourdlight Eve' };

/** A seasonal event, such as "Gourdlight Eve". */
export function wikiEventName(id: string): string {
  return EVENT_NAMES[id] ?? titleWords(id);
}

/** A guild contract type as the contract board names it: Bounty, Heroic Clear, Execution. */
export function guildContractKindName(kind: string): string {
  return label('hudChrome.guildHall.kinds.' + kind);
}
