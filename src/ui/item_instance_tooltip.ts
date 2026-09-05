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
import { effectiveQuality } from '../sim/equipment_rules';
import { activeItemInstanceStats, isItemEnchantActive } from '../sim/item_instance_stats';
import { isCommissionEligibleKind } from '../sim/professions/commission';
import { isEnchantedInstance } from '../sim/professions/enchanting';
import { LEGENDARY_PROMOTION_COST, PERFECTING_RANKS } from '../sim/professions/perfecting';
import type { ItemDef, ItemInstancePayload, Stats } from '../sim/types';
import { durationText } from './duration_text';
import { esc } from './esc';
import { MASTERWORK_SEAL_IMAGE_URL } from './hud/professions/profession_art';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import { ITEM_QUALITY_LABEL_KEYS } from './item_kind_label';
import { itemNameColor } from './item_name_color';
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

/** The WORN-slot tooltip payload (Professions 2.0): the fields
 *  the public eqi wire carries (signer/enchant/rolled/name/perfected;
 *  the worn-identity trim), so the offline
 *  paperdoll and the online mirror render identical worn tooltips. Online, equippedInstances is decoded from
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
  // The player-chosen legendary name (Masterwrought phase 13): the one
  // cosmetic field to JOIN the eqi allowlist since it was written, so the
  // offline paperdoll title matches what an online inspector sees.
  if (instance.name !== undefined) worn.name = instance.name;
  // Public inspection now carries the Perfected stamp so active enchants and
  // collection item levels agree in both hosts. Partial ranks, binding and the
  // immutable Perfecting contribution remain private and are never copied here.
  if (instance.perfected !== undefined) worn.perfected = instance.perfected;
  return worn;
}

/** The tooltip's EFFECTIVE quality for a copy (Masterwrought phase 13): the
 *  copy's own rolled quality wins over its def's (the equipment_rules.ts
 *  precedence the equip caps already read), narrowed back to the def's
 *  quality when the rolled string is not a known tier, so the label lookup
 *  stays total against a hostile or future-tier wire string (the
 *  itemNameColor Object.hasOwn doctrine).
 *  DECIDED 2026-08-27, display vs equip: a LEGACY legendary-rolled copy (an
 *  old masterwork bump, no `perfected` stamp) reads legendary HERE, its
 *  honest roll, while isUniqueEquipped (src/sim/equipment_rules.ts) stays
 *  promotion-scoped and does not count it, for migration safety. The
 *  disagreement is a decision, not drift; the twin comment lives on
 *  isUniqueEquipped. */
export function tooltipEffectiveQuality(
  def: ItemDef,
  instance: ItemInstancePayload | undefined,
): ItemDef['quality'] {
  const quality = effectiveQuality(def, instance);
  return quality !== undefined && Object.hasOwn(ITEM_QUALITY_LABEL_KEYS, quality)
    ? (quality as NonNullable<ItemDef['quality']>)
    : def.quality;
}

/** The tooltip TITLE block (Masterwrought phase 13). A promoted copy's
 *  player-chosen name becomes the title, colored by the EFFECTIVE quality
 *  (legendary orange for a promoted copy), with the def's own localized name
 *  on the line below so the item's identity is never lost; an unnamed copy
 *  keeps the classic one-line title. The chosen name is PLAYER-AUTHORED text:
 *  esc'd raw (the entity-name path), never through t(). `defName` is the
 *  caller's already-localized def name (itemDisplayName), passed in so this
 *  module stays a pure string builder. */
export function instanceTitleHtml(
  def: ItemDef,
  instance: ItemInstancePayload | undefined,
  defName: string,
): string {
  const color = itemNameColor({ kind: def.kind, quality: tooltipEffectiveQuality(def, instance) });
  if (instance?.name === undefined) {
    return `<div class="tt-title" style="color:${color}">${esc(defName)}</div>`;
  }
  return (
    `<div class="tt-title" style="color:${color}">${esc(instance.name)}</div>` +
    `<div class="tt-sub">${esc(defName)}</div>`
  );
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

/** The bind-on-pickup party trade window line (src/sim/loot/bop_trade_window.ts),
 *  rendered right under the def's Soulbound line it qualifies: while the
 *  copy's window is unexpired, the piece can still be traded to the players
 *  who shared its drop, and equipping it ends that early. `msRemainingFor` is
 *  IWorld.partyTradeMsRemaining, injected because only the world knows which
 *  clock `untilMs` was stamped from (tick-derived offline, epoch online);
 *  this builder stays a Node-testable pure string function. Renders nothing
 *  for an absent, malformed, or expired window, and never on WORN gear
 *  (equip strips the payload field, and wornTooltipInstance would trim it
 *  anyway). */
export function instancePartyTradeLine(
  instance: ItemInstancePayload | undefined,
  msRemainingFor: (untilMs: number) => number,
): string {
  const untilMs = instance?.partyTrade?.untilMs;
  if (untilMs === undefined || !Number.isFinite(untilMs)) return '';
  const remainingMs = msRemainingFor(untilMs);
  if (remainingMs <= 0) return '';
  return `<div class="tt-sub" style="color:var(--gold)">${esc(
    t('hudChrome.itemTooltip.partyTradeWindow', { time: durationText(remainingMs / 1000) }),
  )}</div>`;
}

/** The player item lock line (issue 3042, src/sim/item_lock.ts): unlike the
 *  Maker's Bond lines above, not scoped to commission-eligible equipment
 *  kinds, since a player can lock any bag copy. The toggle itself only ever
 *  targets a bag slot (src/sim/item_lock.ts setItemLocked), so this renders
 *  on bag/bank tooltips; a worn item's projection (wornTooltipInstance above)
 *  never carries `locked`, so this is naturally a no-op on the paperdoll. */
export function instanceLockLine(instance?: ItemInstancePayload): string {
  if (!instance?.locked) return '';
  return `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.bags.itemLockedLine'))}</div>`;
}

/** The masterwork seal (gold, the soulbound line's style). A legacy signed copy
 *  renders nothing here. There is deliberately NO standalone enchanted marker:
 *  a bare "Enchanted" badge told a player their copy was enchanted but not what
 *  the enchant DID or which of the listed bonuses it accounted for, so the fact
 *  now rides the bonus stat lines themselves (instanceBonusStatLines below).
 *
 *  Phase 14, the Perfecting badges, both DATA-DRIVEN off the payload alone so
 *  every trim stays authoritative about what shows where:
 *   - a `perfected` copy states it in one gold line. The worn projection
 *     (wornTooltipInstance) and the peer inspect card's public eqi mirror both
 *     carry `perfected`, so the badge and active enchant facts agree.
 *   - a HEAD-STARTED copy (rank-walk `perfecting` in [1, PERFECTING_RANKS-1],
 *     not yet perfected) states its rank on the owner's own full-payload
 *     surfaces (bags, the market sell staging, returned listings). The
 *     anonymous browse pipe's display trim drops `perfecting`, so a
 *     head-started listing stays blind there by the standing decision; this
 *     renderer never re-derives it. Out-of-range values (a hostile wire, a
 *     future widening) render nothing rather than a wrong rank. */
export function instanceBadgeLines(instance?: ItemInstancePayload): string {
  if (!instance) return '';
  let html = '';
  if (instance.rolled?.masterwork) {
    html += `<div class="tt-sub tt-masterwork-seal" style="color:var(--gold)"><img class="tt-masterwork-seal-icon" src="${MASTERWORK_SEAL_IMAGE_URL}" alt="" aria-hidden="true" draggable="false"><span>${esc(t('hudChrome.crafting.masterworkSeal'))}</span></div>`;
  }
  if (instance.perfected === true) {
    html += `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.itemTooltip.perfectedBadge'))}</div>`;
  } else if (
    typeof instance.perfecting === 'number' &&
    Number.isInteger(instance.perfecting) &&
    instance.perfecting >= 1 &&
    instance.perfecting < PERFECTING_RANKS
  ) {
    html += `<div class="tt-sub" style="color:var(--gold)">${esc(
      t('hudChrome.itemTooltip.perfectingRank', {
        rank: itemNumber(instance.perfecting),
        ranks: itemNumber(PERFECTING_RANKS),
      }),
    )}</div>`;
  }
  return html;
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
  const bonusStats = activeItemInstanceStats(instance);
  const active = isItemEnchantActive(instance);
  const enchant = instance.enchant ? ENCHANTS[instance.enchant] : undefined;
  const enchantShare = active ? enchant?.statBonus : undefined;
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
  // A weapon proc describes its temporary effect, never a permanent stat gain.
  // Unknown or incomplete enchanted payloads retain the marker fallback when
  // no stat could be attributed. A dormant enchant instead states its gate.
  if (!active) {
    html += `<div class="tt-sub">${esc(t('hudChrome.perfecting.enchantInactive'))}</div>`;
  } else if (enchant?.weaponProc) {
    html += `<div class="tt-green tt-instance-bonus">${esc(
      t(`hudChrome.enchantDescription.${enchant.id}` as TranslationKey),
    )}</div>`;
  } else if (!attributed && isEnchantedInstance(instance)) {
    html += `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
      t('hudChrome.itemTooltip.enchantedFallback'),
    )}</div>`;
  }
  return html;
}

/** Whether a signed copy of this item KIND reads as a gathered material
 *  (Professions 2.0). Every signable gathered item (node materials,
 *  corpse components, Pristine specimens) is kind 'junk', while a CRAFTED
 *  copy gains its signer only through the #1149 def-QUALITY rule
 *  (isSignableMaterialRarity: rare and up, professions/crafting.ts) or the
 *  masterwork proc arm, which needs a slot; commission NEVER adds a signer
 *  (it mints bindOnTrade only). Crafted junk-kind outputs DO exist since
 *  the Masterwrought phase 07 intermediates, but all ten are quality
 *  common and slot-less, so neither signing arm can stamp them today, and
 *  the pinned sweep in tests/item_instance_tooltip.test.ts holds every
 *  crafted junk-kind output BELOW signable rarity: the day a retune bumps
 *  one to rare, that sweep reds instead of this kind-only read silently
 *  calling a crafted copy "Gathered by" (grow a real crafted-provenance
 *  channel first). Recipe patterns (kind 'recipe') sit outside the signed
 *  universe entirely, and raw fishing catches (also kind 'junk') are never
 *  signed either, so neither reaches this line. */
export function isGatheredProvenanceKind(kind: ItemDef['kind'] | undefined): boolean {
  return kind === 'junk';
}

/** THE PLACEABLE-FEAST CARVE-OUT (masterwrought Phase 11k), and it fixes a live
 *  mislabel rather than making room for new content. The kind-only read above
 *  reasoned that every crafted junk-kind output sits BELOW signable rarity, and
 *  that stopped being true the day the shared feast shipped: `harvest_feast` is
 *  kind 'junk' AND quality 'rare', so `mintsSignerPayload` (professions/
 *  crafting.ts: signable rarity and not a bag) really does stamp a crafted copy,
 *  and this line has been calling a cook's own feast "Gathered by" ever since.
 *  The sweep that was supposed to catch it had the feast on an exception list
 *  whose stated proof covered only the MASTERWORK signing arm, so the rarity arm
 *  went unexamined. Phase 11k's three apex feasts are the same shape one rung
 *  up, which is what surfaced it.
 *
 *  A feast is never gathered: the ONLY way to hold one is to craft it or to
 *  take a crafted copy through trade, so its provenance is a craft by
 *  construction. Keyed on the `feast` payload rather than on an id list, so
 *  every rung past and future is covered without an edit. */
function isCraftedPlaceable(def: ItemDef | undefined): boolean {
  return !!def && 'feast' in def && def.feast !== undefined;
}

/** THE PROMOTION-BILL CARVE-OUT (masterwrought phase 13), the feast lesson's
 *  exact sibling one phase on: the Deed of Making is kind 'junk' at quality
 *  'rare' ON PURPOSE (the tradable-writ arm; rare keeps it out of the Sell
 *  Junk sweep), so mintsSignerPayload's rarity arm signs a scribed copy, and
 *  the kind-only read would call an inscriptionist's own writ "Gathered by".
 *  A promotion-bill consumable is only ever CRAFTED (inscription's 125 rung)
 *  or traded for, so its provenance is a craft by construction. Keyed on the
 *  promotion bill itself (perfecting.ts LEGENDARY_PROMOTION_COST), never an
 *  id list here, so a future bill line is covered without an edit (the
 *  feast-payload doctrine: derive from the owning mechanic). */
function isPromotionBillItem(def: ItemDef | undefined): boolean {
  return !!def && LEGENDARY_PROMOTION_COST.some((c) => c.itemId === def.id);
}

/** Does this DEF read as gathered provenance? The kind-level rule above, minus
 *  the crafted placeables and the promotion-bill writs. Prefer this over the
 *  kind-only predicate at any call site that has the def in hand. */
export function isGatheredProvenance(def: ItemDef | undefined): boolean {
  return (
    isGatheredProvenanceKind(def?.kind) && !isCraftedPlaceable(def) && !isPromotionBillItem(def)
  );
}

/** The classic "Crafted by X" flavor line for a signed copy, or "Gathered by
 *  X" when the item reads as a gathered material. No
 *  payload change: the same eqi signer field feeds both wordings. Legacy
 *  signed instances (signer without the masterwork flag) render the mark
 *  alone. Takes the DEF rather than the bare kind since masterwrought Phase
 *  11k, because the crafted-placeable carve-out above cannot be decided from
 *  the kind alone. */
export function instanceMakersMarkLine(instance?: ItemInstancePayload, def?: ItemDef): string {
  if (!instance?.signer) return '';
  if (isGatheredProvenance(def)) {
    return `<div class="tt-sub" style="color:${QUALITY_COLOR.uncommon}">${esc(
      t('hudChrome.crafting.gatheredBy', { name: instance.signer }),
    )}</div>`;
  }
  return `<div class="tt-sub tt-makers-mark" style="color:${QUALITY_COLOR.uncommon}">${svgIcon('makers-mark', { cls: 'tt-makers-mark-icon' })}<span>${esc(
    t('hudChrome.crafting.makersMark', { name: instance.signer }),
  )}</span></div>`;
}
