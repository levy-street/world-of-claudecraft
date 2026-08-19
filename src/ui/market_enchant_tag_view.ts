// Pure, host-agnostic core for the market row's enchant tag.
//
// When the "Lowest list price only" toggle folds a book, copies that differ ONLY by
// enchant TYPE correctly stay as separate rows (market_collapse.ts): a Might sword and an
// Agility sword are not interchangeable goods. But two such rows share the same item name,
// so the shopper cannot tell them apart at a glance. The old generic "enchanted" corner
// glyph did not help: it said THAT a copy is enchanted, never WHICH enchant.
//
// This resolves an instance payload to a compact, buyer-facing tag naming the enchant's
// effect, e.g. "+2 Int", so each enchanted row is self-explanatory in the narrow column
// with no hover. It reads the enchant's own statBonus (content/enchants.ts) rather than
// re-deriving numbers, so the tag can never disagree with the enchant it names. Legacy
// enchanted copies (bare rolled.stats without the masterwork flag, predating the enchant
// id field) fall back to their baked stats so they still tag.
//
// It is a STAT tag, not the enchant's marketing name: enchant_weapon_intellect is named
// "Enchant Weapon - Spellpower" but grants int, so "+2 Int" states the real stat the
// buyer gets. The short stat labels are their own i18n keys (itemUi.stats.short.*) so each
// locale abbreviates independently; the number goes through formatNumber for locale-safe
// digits. Masterwork copies are intentionally NOT tagged here (their seal is their marker,
// and their stats are a tier delta, not an enchant); a signer-only copy has no tag.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../sim/content/enchants';
import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { ItemInstancePayload, Stats } from '../sim/types';
import { formatNumber, type TranslationKey, t } from './i18n';

const SHORT_STAT_KEYS: Partial<Record<keyof Stats, TranslationKey>> = {
  armor: 'itemUi.stats.short.armor',
  str: 'itemUi.stats.short.str',
  agi: 'itemUi.stats.short.agi',
  sta: 'itemUi.stats.short.sta',
  int: 'itemUi.stats.short.int',
  spi: 'itemUi.stats.short.spi',
};

/** The stat+value pairs an enchanted copy grants, or [] if this copy is not enchanted
 *  (or is a masterwork/signer-only copy that carries no enchant tag). Reads the enchant
 *  def's statBonus for a marker copy; falls back to a legacy copy's baked rolled.stats. */
export function enchantTagStats(
  instance?: ItemInstancePayload,
): { stat: keyof Stats; value: number }[] {
  if (!instance || !isEnchantedInstance(instance)) return [];
  // Marker copies name their enchant id; read the authoritative bonus from the def.
  if (instance.enchant !== undefined) {
    const def = ENCHANTS[instance.enchant];
    if (!def) return [];
    return statPairs(def.statBonus);
  }
  // Legacy enchanted copy: no id, but isEnchantedInstance was true, so it has bare
  // rolled.stats without the masterwork flag. Tag from those baked stats.
  return statPairs(instance.rolled?.stats);
}

function statPairs(
  bonus: Partial<Record<string, number>> | undefined,
): { stat: keyof Stats; value: number }[] {
  if (!bonus) return [];
  return Object.keys(bonus)
    .sort()
    .filter((k) => (bonus[k] ?? 0) !== 0 && k in SHORT_STAT_KEYS)
    .map((k) => ({ stat: k as keyof Stats, value: bonus[k] as number }));
}

/** One localized short label for a stat key ("Int"), or the raw key if unmapped. */
function shortStatLabel(stat: keyof Stats): string {
  const key = SHORT_STAT_KEYS[stat];
  return key ? t(key) : String(stat);
}

/** The compact enchant tag text for a market row, e.g. "+2 Int", or the empty string
 *  when the copy carries no enchant to tag. Multiple bonuses join with a thin separator
 *  (no enchant in content grants more than one today; the join is future-proofing). The
 *  sign is always shown because every enchant bonus is positive. */
export function marketEnchantTagText(instance?: ItemInstancePayload): string {
  const pairs = enchantTagStats(instance);
  if (pairs.length === 0) return '';
  return pairs
    .map((p) => `+${formatNumber(p.value, { maximumFractionDigits: 0 })} ${shortStatLabel(p.stat)}`)
    .join(' ');
}
