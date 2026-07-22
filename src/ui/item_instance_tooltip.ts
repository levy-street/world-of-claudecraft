// Per-copy item-instance tooltip lines (Professions 2.0 Phase 6): the
// ItemInstancePayload additions the item tooltip composes around its def-driven
// card, as pure string builders so every instance variant is Node-testable.
// Composition order in the tooltip: badge lines (masterwork seal, enchanted
// marker) right under the soulbound line, baked bonus stat lines after the
// def's own stats, the maker's mark near the bottom. Copy rule: the seal never
// claims a quality-rank upgrade (deeds quality marks credit the DEF quality),
// so the seal keeps its own gold line instead of recoloring the title. The
// enchanted marker is generic: EnchantDef.name has no localized display
// surface, and an unlocalized string must never reach the tooltip.
import { isCommissionEligibleKind } from '../sim/professions/commission';
import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { ItemDef, ItemInstancePayload, Stats } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';

const ITEM_STAT_LABEL_KEYS: Partial<Record<keyof Stats, TranslationKey>> = {
  armor: 'itemUi.stats.armor',
  str: 'itemUi.stats.str',
  agi: 'itemUi.stats.agi',
  sta: 'itemUi.stats.sta',
  int: 'itemUi.stats.int',
  spi: 'itemUi.stats.spi',
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function itemStatName(stat: string): string {
  const key = ITEM_STAT_LABEL_KEYS[stat as keyof Stats];
  return key ? t(key) : cap(stat);
}

export function itemNumber(value: number, fractionDigits = 0): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** The WORN-slot tooltip payload (Professions 2.0 Phase 14b): exactly the
 *  fields the public eqi wire carries (signer/enchant/rolled, the Phase 12d
 *  worn-identity trim), so the offline paperdoll and the online mirror
 *  render identical worn tooltips. Online, equippedInstances is decoded from
 *  the stripped eqi allowlist and never carries bindOnTrade/boundTo/charges;
 *  offline the self entity holds the FULL payload, so without this trim the
 *  Maker's Bond lines would render on worn gear in one host only. The bond
 *  is a bag-surface fact by construction (the eqi data minimization is
 *  deliberate); both hosts now agree by sharing this one projection. */
export function wornTooltipInstance(
  instance?: ItemInstancePayload,
): ItemInstancePayload | undefined {
  if (!instance) return undefined;
  const worn: ItemInstancePayload = {};
  if (instance.signer !== undefined) worn.signer = instance.signer;
  if (instance.enchant !== undefined) worn.enchant = instance.enchant;
  if (instance.rolled !== undefined) worn.rolled = instance.rolled;
  return worn;
}

/** The Maker's Bond lines (Professions 2.0 Phase 14b), rendered in the def
 *  soulbound line's gold beside it: a commissioned-but-unbound piece warns it
 *  binds to its first trade recipient, a bound piece states the lock. Scoped
 *  to the commission-eligible equipment kinds ONLY (commission.ts), so the
 *  Phase 13 bind-on-trade reagents (kind 'junk') keep their line-free
 *  tooltips. The bound line deliberately names NO one: boundTo is an entity
 *  id, not a stable cross-session identity, so a name lookup (or a "you"
 *  compare) could silently lie after a relog; presence alone is the fact the
 *  tooltip states. Never rendered on WORN gear in either host: the paperdoll
 *  routes through wornTooltipInstance above. */
export function instanceBindingLines(
  instance?: ItemInstancePayload,
  kind?: ItemDef['kind'],
): string {
  if (!instance || !isCommissionEligibleKind(kind)) return '';
  if (instance.boundTo !== undefined) {
    return `<div class="tt-sub" style="color:#ffd100">${esc(t('hudChrome.crafting.commissionBound'))}</div>`;
  }
  if (instance.bindOnTrade === true) {
    return `<div class="tt-sub" style="color:#ffd100">${esc(t('hudChrome.crafting.commissionUnbound'))}</div>`;
  }
  return '';
}

/** The masterwork seal (gold, the soulbound line's style) and the enchanted
 *  marker (green). A legacy signed copy with neither renders nothing here;
 *  legacy enchanted copies (bare rolled.stats without the masterwork flag)
 *  read as enchanted via isEnchantedInstance. */
export function instanceBadgeLines(instance?: ItemInstancePayload): string {
  if (!instance) return '';
  let html = '';
  if (instance.rolled?.masterwork) {
    html += `<div class="tt-sub" style="color:#ffd100">${esc(t('hudChrome.crafting.masterworkSeal'))}</div>`;
  }
  if (isEnchantedInstance(instance)) {
    html += `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(t('hudChrome.crafting.enchantedLine'))}</div>`;
  }
  return html;
}

/** Baked per-copy bonus stats (masterwork tier-delta, or an enchanted copy's
 *  baked enchant stats): distinct green bonus lines after the def's own stats,
 *  reusing the localized stat-line key. */
export function instanceBonusStatLines(instance?: ItemInstancePayload): string {
  const bonusStats = instance?.rolled?.stats;
  if (!bonusStats) return '';
  let html = '';
  for (const [k, v] of Object.entries(bonusStats)) {
    if (!v) continue;
    html += `<div class="tt-green tt-instance-bonus">${esc(
      t('itemUi.tooltip.stat', { value: itemNumber(v), stat: itemStatName(k) }),
    )}</div>`;
  }
  return html;
}

/** Whether a signed copy of this item KIND reads as a gathered material
 *  (Professions 2.0 Phase 12d). Every signable gathered item (node materials,
 *  corpse components, Pristine specimens) is kind 'junk', while every crafted
 *  recipe output lands on the equip/consume kinds (weapon, armor, food,
 *  potion, elixir, tool, bag), so the signed universe partitions cleanly on
 *  the kind alone; the partition is pinned in tests/item_instance_tooltip.test.ts.
 *  Fish share kind 'food' with crafted meals but are never signed, so they
 *  never reach the provenance line at all. */
export function isGatheredProvenanceKind(kind: ItemDef['kind'] | undefined): boolean {
  return kind === 'junk';
}

/** The classic "Crafted by X" flavor line for a signed copy, or "Gathered by
 *  X" when the item's kind marks it as a gathered material (Phase 12d). No
 *  payload change: the same eqi signer field feeds both wordings. Legacy
 *  signed instances (signer without the masterwork flag) render the mark
 *  alone. */
export function instanceMakersMarkLine(
  instance?: ItemInstancePayload,
  kind?: ItemDef['kind'],
): string {
  if (!instance?.signer) return '';
  const key = isGatheredProvenanceKind(kind)
    ? 'hudChrome.crafting.gatheredBy'
    : 'hudChrome.crafting.makersMark';
  return `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
    t(key, { name: instance.signer }),
  )}</div>`;
}
