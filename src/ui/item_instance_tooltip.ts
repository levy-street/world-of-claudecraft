// Per-copy item-instance tooltip lines (Professions 2.0): the
// ItemInstancePayload additions the item tooltip composes around its def-driven
// card, as pure string builders so every instance variant is Node-testable.
// Composition order in the tooltip: the badge line (the masterwork seal) right
// under the soulbound line, baked bonus stat lines after the def's own stats,
// the maker's mark near the bottom. Copy rule: the seal never claims a
// quality-rank upgrade (deeds quality marks credit the DEF quality), so the
// seal keeps its own gold line instead of recoloring the title. The enchanted
// state is NOT a badge of its own: it is attributed inline on the bonus stat
// lines it actually caused (instanceBonusStatLines), which is the fact a player
// is reading the tooltip for.
import { ENCHANTS } from '../sim/content/enchants';
import { isCommissionEligibleKind } from '../sim/professions/commission';
import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { ItemDef, ItemInstancePayload, Stats } from '../sim/types';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import { MASTERWORK_SEAL_IMAGE_URL } from './profession_art';
import { svgIcon } from './ui_icons';

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

/** The WORN-slot tooltip payload (Professions 2.0): exactly the
 *  fields the public eqi wire carries (signer/enchant/rolled, the
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

/** The Maker's Bond lines (Professions 2.0), rendered in the def
 *  soulbound line's gold beside it: a commissioned-but-unbound piece warns it
 *  binds to its first trade recipient, a bound piece states the lock. Scoped
 *  to the commission-eligible equipment kinds ONLY (commission.ts), so the
 *  bind-on-trade reagents (kind 'junk') keep their line-free
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
    return `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.crafting.commissionBound'))}</div>`;
  }
  if (instance.bindOnTrade === true) {
    return `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.crafting.commissionUnbound'))}</div>`;
  }
  return '';
}

/** The masterwork seal (gold, the soulbound line's style). A legacy signed copy
 *  renders nothing here. There is deliberately NO standalone enchanted marker:
 *  a bare "Enchanted" badge told a player their copy was enchanted but not what
 *  the enchant DID or which of the listed bonuses it accounted for, so the fact
 *  now rides the bonus stat lines themselves (instanceBonusStatLines below). */
export function instanceBadgeLines(instance?: ItemInstancePayload): string {
  if (!instance) return '';
  if (!instance.rolled?.masterwork) return '';
  return `<div class="tt-sub tt-masterwork-seal" style="color:var(--gold)"><img class="tt-masterwork-seal-icon" src="${MASTERWORK_SEAL_IMAGE_URL}" alt="" aria-hidden="true" draggable="false"><span>${esc(t('hudChrome.crafting.masterworkSeal'))}</span></div>`;
}

function statLine(key: TranslationKey, value: number, stat: string): string {
  return `<div class="tt-green tt-instance-bonus">${esc(
    t(key, { value: itemNumber(value), stat: itemStatName(stat) }),
  )}</div>`;
}

/** Baked per-copy bonus stats (a masterwork tier-delta, an enchant's baked
 *  bonus, or BOTH on one copy), as distinct green lines after the def's own
 *  stats, each ATTRIBUTED to where it came from:
 *   - a marker-carrying enchanted copy (instance.enchant set) splits each stat
 *     into the enchant's own share (ENCHANTS[id].statBonus, the suffixed
 *     "(Enchanted)" key) and whatever remains (the plain key, i.e. the
 *     masterwork bake resolveApplyEnchant summed underneath it). A zero
 *     remainder renders no second line.
 *   - a LEGACY enchanted copy (isEnchantedInstance's bare-rolled.stats arm, no
 *     enchant field) attributes EVERY line to the enchant: before the marker
 *     existed, applyEnchant was the only writer of bare rolled.stats.
 *   - a masterwork-only copy renders exactly what it rendered before.
 *  The suffix is its own key with its own fills, never concatenated onto the
 *  plain line's output. */
export function instanceBonusStatLines(instance?: ItemInstancePayload): string {
  if (!instance) return '';
  const bonusStats = instance.rolled?.stats;
  const enchantShare = instance.enchant ? ENCHANTS[instance.enchant]?.statBonus : undefined;
  const legacyEnchanted = instance.enchant === undefined && isEnchantedInstance(instance);
  let html = '';
  let attributed = false;
  for (const [stat, value] of Object.entries(bonusStats ?? {})) {
    if (!value) continue;
    if (legacyEnchanted) {
      html += statLine('hudChrome.itemTooltip.statEnchanted', value, stat);
      attributed = true;
      continue;
    }
    // Clamp the attributed share into what this copy actually carries. The
    // magnitudes are frozen once applied (resolveApplyEnchant bakes them), but a
    // later ENCHANTS retune would otherwise make an old copy render a NEGATIVE
    // remainder ("+-2 Stamina") beside its suffixed line.
    const raw = enchantShare?.[stat as keyof typeof enchantShare] ?? 0;
    const share = value > 0 ? Math.min(Math.max(raw, 0), value) : 0;
    if (share !== 0) {
      html += statLine('hudChrome.itemTooltip.statEnchanted', share, stat);
      attributed = true;
    }
    const remainder = value - share;
    if (remainder !== 0) html += statLine('itemUi.tooltip.stat', remainder, stat);
  }
  // Safety net: attribution can only speak through a stat line, so a copy that
  // IS enchanted but produced none (an enchant id this client cannot resolve, or
  // a payload carrying the marker without rolled.stats) still states the fact.
  // Its bag corner already paints the enchant glyph, so silence here would be a
  // real information loss, not just a missing flourish.
  if (!attributed && isEnchantedInstance(instance)) {
    html += `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
      t('hudChrome.itemTooltip.enchantedFallback'),
    )}</div>`;
  }
  return html;
}

/** Whether a signed copy of this item KIND reads as a gathered material
 *  (Professions 2.0). Every signable gathered item (node materials,
 *  corpse components, Pristine specimens) is kind 'junk', while every crafted
 *  recipe output lands on the equip/consume kinds (weapon, armor, food,
 *  potion, elixir, tool, bag), so the signed universe partitions cleanly on
 *  the kind alone; the partition is pinned in tests/item_instance_tooltip.test.ts.
 *  Raw fishing catches are also kind 'junk' (cooking reagents) but fishing never
 *  signs a catch, so they never reach the provenance line either. */
export function isGatheredProvenanceKind(kind: ItemDef['kind'] | undefined): boolean {
  return kind === 'junk';
}

/** The classic "Crafted by X" flavor line for a signed copy, or "Gathered by
 *  X" when the item's kind marks it as a gathered material. No
 *  payload change: the same eqi signer field feeds both wordings. Legacy
 *  signed instances (signer without the masterwork flag) render the mark
 *  alone. */
export function instanceMakersMarkLine(
  instance?: ItemInstancePayload,
  kind?: ItemDef['kind'],
): string {
  if (!instance?.signer) return '';
  if (isGatheredProvenanceKind(kind)) {
    return `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
      t('hudChrome.crafting.gatheredBy', { name: instance.signer }),
    )}</div>`;
  }
  return `<div class="tt-sub tt-makers-mark" style="color:${QUALITY_COLOR.uncommon}">${svgIcon('makers-mark', { cls: 'tt-makers-mark-icon' })}<span>${esc(
    t('hudChrome.crafting.makersMark', { name: instance.signer }),
  )}</span></div>`;
}
