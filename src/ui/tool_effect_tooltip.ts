// Tool-effect charm tooltip lines: what Gatherer's Cache / Artisan's Eye (and
// the catalog Springback Charm) do, how a player slots them, and that a slot
// burns the charm. Pure string-builder composed inside Hud.itemTooltip (the
// gather_tool_tooltip.ts / material_hint_view.ts pattern): t() + esc here, no
// DOM, no Hud state, so tests/tool_effect_tooltip.test.ts drives it directly.
//
// Numbers come from the sim catalog and charge ladder, never re-invented copy:
// TOOL_EFFECTS.startingDurability and RARITY_DURABILITY_BONUS (tools.ts). The
// bonus prose tracks applyEffectBonus kinds (quantity / quality / respawnSpeed);
// the "+1" the English spells out as prose is pinned back to TOOL_EFFECTS[*].bonus
// by the test file, so a rebalance forces the copy to move with it.
// Fishing is never advertised as a slot target: slotToolEffectRefused refuses
// every effect on fishing until an arm has real fishing behavior.

import { TOOL_EFFECTS, type ToolEffectId } from '../sim/content/professions';
import { ITEMS } from '../sim/data';
import { RARITY_DURABILITY_BONUS } from '../sim/professions/tools';
import type { ItemDef, ItemUse } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import { itemNameColor } from './item_name_color';
import { toolEffectNameKey } from './tool_effect_name';

/** Effect id -> bonus-description key. Mirrors TOOL_EFFECTS; an id absent here
 *  has no honest bonus line (a retired or unknown id renders no tooltip). */
const BONUS_KEYS: Record<ToolEffectId, TranslationKey> = {
  gatherers_cache: 'hudChrome.professions.toolEffectTooltip.bonus.gatherersCache',
  artisans_eye: 'hudChrome.professions.toolEffectTooltip.bonus.artisansEye',
  quickening_charm: 'hudChrome.professions.toolEffectTooltip.bonus.quickeningCharm',
};

function line(cls: 'tt-sub' | 'tt-desc' | 'tt-green', text: string): string {
  return `<div class="${cls}">${esc(text)}</div>`;
}

type ToolEffectUse = Extract<ItemUse, { type: 'toolEffect' }>;

/** True when the def is a tool-effect charm (use.type 'toolEffect'). Generic so
 *  the guarded branch keeps the caller's full item type, not just the pick. */
export function isToolEffectItem<T extends Pick<ItemDef, 'use'>>(
  item: T,
): item is T & { use: ToolEffectUse } {
  return item.use?.type === 'toolEffect';
}

/** hasOwn-safe bonus key for one effect id, or undefined when the id is not a
 *  live catalog entry with copy. */
export function toolEffectBonusKey(effectId: string): TranslationKey | undefined {
  return Object.hasOwn(BONUS_KEYS, effectId) ? BONUS_KEYS[effectId as ToolEffectId] : undefined;
}

/** True when `effectId` has a full card to show (a display name, bonus copy,
 *  and a live catalog entry). The Professions painter gates its data-effect-tip
 *  mint and hover attaches on this, so the marker, the cursor cue, the tab
 *  stop, and the tooltip can never disagree. */
export function hasToolEffectCard(effectId: string): boolean {
  return (
    toolEffectNameKey(effectId) !== undefined &&
    toolEffectBonusKey(effectId) !== undefined &&
    Object.hasOwn(TOOL_EFFECTS, effectId)
  );
}

/** Effect id -> charm ItemDef, built once from static content on first use.
 *  The first catalog entry wins a duplicate effect id (today ids map 1:1).
 *  Undefined for a catalog-only effect that mints no item (Springback Charm). */
let charmItems: Map<string, ItemDef> | undefined;
function charmItemFor(effectId: string): ItemDef | undefined {
  if (charmItems === undefined) {
    charmItems = new Map();
    for (const def of Object.values(ITEMS)) {
      if (def.use?.type === 'toolEffect' && !charmItems.has(def.use.effectId)) {
        charmItems.set(def.use.effectId, def);
      }
    }
  }
  return charmItems.get(effectId);
}

/** The card body both surfaces agree on: kind, bonus, how to slot, the charge
 *  ladder, and the land-only scope. One builder so the item card and the
 *  Professions hover card can never drift line by line. Empty string when the
 *  id has no bonus copy or no live catalog entry (a retired effect). */
function toolEffectBodyLines(effectId: string): string {
  const bonusKey = toolEffectBonusKey(effectId);
  if (bonusKey === undefined) return '';
  const def = Object.hasOwn(TOOL_EFFECTS, effectId)
    ? TOOL_EFFECTS[effectId as ToolEffectId]
    : undefined;
  if (!def) return '';
  const baseCharges = formatNumber(def.startingDurability, { maximumFractionDigits: 0 });
  const rarityBonus = formatNumber(RARITY_DURABILITY_BONUS, { maximumFractionDigits: 0 });
  return (
    line('tt-sub', t('hudChrome.professions.toolEffectTooltip.kind')) +
    line('tt-green', t(bonusKey)) +
    line('tt-desc', t('hudChrome.professions.toolEffectTooltip.howToSlot')) +
    line(
      'tt-desc',
      t('hudChrome.professions.toolEffectTooltip.charges', {
        base: baseCharges,
        bonus: rarityBonus,
      }),
    ) +
    line('tt-sub', t('hudChrome.professions.toolEffectTooltip.landOnly'))
  );
}

/**
 * Standalone tooltip body for one tool-effect id (title + the shared body),
 * used by the Professions window on slot buttons and live effect rows. Empty
 * string when the id has no display name or bonus copy (a retired effect).
 * No "open Professions" cue: the player is already there.
 */
export function toolEffectStandaloneTooltip(effectId: string): string {
  const nameKey = toolEffectNameKey(effectId);
  if (nameKey === undefined) return '';
  const body = toolEffectBodyLines(effectId);
  if (body === '') return '';
  // Title color follows the charm item's own rarity (the itemNameColor idiom
  // Hud.itemTooltip uses for item titles); a catalog-only effect with no item
  // keeps the charm family's rare tint.
  const item = charmItemFor(effectId);
  const color = item ? itemNameColor(item) : QUALITY_COLOR.rare;
  return `<div class="tt-title" style="color:${color}">${esc(t(nameKey))}</div>${body}`;
}

/** The tooltip lines for one tool-effect charm item, or '' for any other item.
 *  Composed into Hud.itemTooltip so bags, bank, crafting, market, and every
 *  other surface that reuses itemTooltip show the same card. No title (the
 *  item tooltip already prints the name) and no "open Professions" line: the
 *  howToSlot line names the window, and the bag hover appends the
 *  openProfessions affordance hint (bagTooltipHintKey), which would double
 *  the sentence if repeated here. */
export function toolEffectTooltipLines(item: ItemDef): string {
  if (!isToolEffectItem(item)) return '';
  return toolEffectBodyLines(item.use.effectId);
}
