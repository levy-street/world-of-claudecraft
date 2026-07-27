import { keyCapLabel } from '../game/keybinds';
import { MAX_ACTIVE_LEGENDARY_POWERS } from '../sim/equipment/equipment_effect_types';
import { resolvedItemStats } from '../sim/equipment/resolved_item';
import { canEquipItem, weaponHand } from '../sim/equipment_rules';
import { isItemLevelEligible, itemLevel, itemScore } from '../sim/item_level';
import { requiredLevelForItemInstance } from '../sim/procedural_item_level';
import { itemVendorSellValue } from '../sim/procedural_vendor_value';
import {
  CONSUME_DURATION,
  type EquipSlot,
  type ItemDef,
  type ItemInstancePayload,
  type ItemSlot,
  type PlayerClass,
} from '../sim/types';
import { classDisplayName, itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { gatherToolTooltipLines } from './gather_tool_tooltip';
import {
  formatList,
  formatMoney as formatLocalizedMoney,
  formatNumber,
  type TranslationKey,
  t,
  tOptional,
} from './i18n';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import { itemArmorTypeLabelKey } from './item_armor_type';
import { requiredClassesForTooltip } from './item_class_restriction';
import {
  instanceBadgeLines,
  instanceBindingLines,
  instanceBonusStatLines,
  instanceMakersMarkLine,
  itemAdaptiveNumber,
  itemNumber,
  itemStatName,
} from './item_instance_tooltip';
import { itemSetMemberCounts, itemSetTooltipModel } from './item_set_tooltip_view';
import { materialHintLine } from './material_hint_view';
import { resolveProceduralItemIcon } from './procedural_item_art';
import {
  type ItemPresentationInstance,
  itemPresentationName,
  itemPresentationQuality,
  proceduralAffixPresentations,
  proceduralLegendaryPresentation,
  proceduralRarityLabel,
} from './procedural_item_presentation';
import { resolvedItemDeltas } from './procedural_item_view';
import { legendaryPowerRuneSvg } from './procedural_loot_icons';
import { statNameKey } from './stat_tooltip_view';
import { type WeaponProcEffectDesc, weaponProcLines } from './weapon_proc_view';
import { weaponTypeLabelKey } from './weapon_type_label';

type ItemQuality = NonNullable<ItemDef['quality']>;

const ITEM_SLOT_LABEL_KEYS: Record<ItemSlot, TranslationKey> = {
  mainhand: 'itemUi.slots.mainhand',
  offhand: 'itemUi.slots.offhand',
  helmet: 'itemUi.slots.helmet',
  neck: 'itemUi.slots.neck',
  shoulder: 'itemUi.slots.shoulder',
  chest: 'itemUi.slots.chest',
  waist: 'itemUi.slots.waist',
  legs: 'itemUi.slots.legs',
  gloves: 'itemUi.slots.gloves',
  feet: 'itemUi.slots.feet',
  ring: 'itemUi.slots.ring',
  ring1: 'itemUi.slots.ring',
  ring2: 'itemUi.slots.ring',
};

const ITEM_QUALITY_LABEL_KEYS: Record<ItemQuality, TranslationKey> = {
  poor: 'itemUi.quality.poor',
  common: 'itemUi.quality.common',
  uncommon: 'itemUi.quality.uncommon',
  rare: 'itemUi.quality.rare',
  epic: 'itemUi.quality.epic',
  legendary: 'itemUi.quality.legendary',
};

const ITEM_KIND_LABEL_KEYS: Record<ItemDef['kind'], TranslationKey> = {
  weapon: 'itemUi.kind.weapon',
  armor: 'itemUi.kind.armor',
  held_offhand: 'itemUi.kind.armor',
  quest: 'itemUi.kind.quest',
  junk: 'itemUi.kind.junk',
  food: 'itemUi.kind.food',
  drink: 'itemUi.kind.drink',
  tool: 'itemUi.kind.tool',
  potion: 'itemUi.kind.potion',
  elixir: 'itemUi.kind.elixir',
  bag: 'itemUi.kind.bag',
};

export interface ItemPresentationControllerDeps {
  items: Record<string, ItemDef>;
  playerClass(): PlayerClass;
  playerLevel(): number;
  showItemLevel(): boolean;
  equippedItemId(slot: EquipSlot): string | null | undefined;
  equippedInstance(slot: EquipSlot): ItemInstancePayload | undefined;
  equippedItemIds(): readonly (string | null | undefined)[];
}

/**
 * Executable item-presentation boundary shared by every Hud item surface.
 * Procedural art, generated copy, rolled stats, set/proc blocks, and recursive
 * equipment comparison live here instead of growing the root coordinator.
 */
export class ItemPresentationController {
  constructor(private readonly deps: ItemPresentationControllerDeps) {}

  icon(item: ItemDef, instance?: ItemPresentationInstance): string {
    const quality = itemPresentationQuality(item, instance);
    const src = resolveProceduralItemIcon(item.id, instance)?.url ?? iconDataUrl('item', item.id);
    return `<img class="item-icon q-${quality}" src="${src}" alt="" draggable="false">`;
  }

  tooltip(item: ItemDef, compare = true, instance?: ItemPresentationInstance): string {
    // Public roll/inspect views omit UID and seed. The stat/level resolvers only
    // consume the shared rolled fields, so this projection does not expose them.
    const resolverInstance = instance as ItemInstancePayload | undefined;
    const quality = itemPresentationQuality(item, instance);
    const displayName = itemPresentationName({ name: itemDisplayName(item) }, instance);
    let html = `<div class="tt-title" style="color:${QUALITY_COLOR[quality]}">${esc(displayName)}</div>`;
    let qualityKindHtml = esc(
      t('itemUi.tooltip.qualityKind', {
        quality: proceduralRarityLabel(instance) ?? itemQualityLabel(item.quality),
        kind: itemKindLabel(item.kind),
      }),
    );
    if (item.heroicOf || item.heroic) {
      qualityKindHtml += ` <span style="color:#e5cc80">${esc(t('hudChrome.itemHeroicTag'))}</span>`;
    }
    html += `<div class="tt-sub">${qualityKindHtml}</div>`;

    if (item.kind === 'weapon') {
      const weaponTypeKey = weaponTypeLabelKey(item.id);
      if (weaponTypeKey)
        html += `<div class="tt-sub tt-weapon-type">${esc(t(weaponTypeKey))}</div>`;
    }
    if (item.slot) {
      const slotName =
        item.kind === 'weapon' && weaponHand(item) === 'twohand'
          ? t('itemUi.slots.twoHand')
          : itemSlotName(item.slot);
      const armorTypeKey = itemArmorTypeLabelKey(item);
      if (armorTypeKey) {
        const badClass = canEquipItem(this.deps.playerClass(), item) ? '' : ' tt-armor-bad';
        html += `<div class="tt-sub tt-row"><span>${esc(slotName)}</span><span class="tt-armor${badClass}">${esc(t(armorTypeKey))}</span></div>`;
      } else {
        html += `<div class="tt-sub">${esc(slotName)}</div>`;
      }
    }

    if (instance?.procedural) {
      html += `<div class="tt-stat tt-item-level" style="color:var(--gold)">${esc(
        t('hudChrome.options.itemLevelLine', { level: itemNumber(instance.procedural.itemLevel) }),
      )}</div>`;
    } else if (isItemLevelEligible(item) && this.deps.showItemLevel()) {
      const level = itemLevel(item);
      if (level !== undefined) {
        html += `<div class="tt-stat" style="color:var(--gold)">${esc(
          t('hudChrome.options.itemLevelLine', { level: itemNumber(level) }),
        )}</div>`;
        html += `<div class="tt-sub">${esc(
          t('hudChrome.options.itemScoreLine', { score: itemNumber(itemScore(item), 1) }),
        )}</div>`;
      }
    }
    if (item.soulbound) {
      html += `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.itemSoulbound'))}</div>`;
    }
    html += instanceBindingLines(resolverInstance, item.kind);
    html += instanceBadgeLines(resolverInstance);

    const tooltipStats = resolvedItemStats(item, resolverInstance);
    const tooltipWeapon = instance?.procedural ? tooltipStats.weapon : item.weapon;
    if (tooltipWeapon) {
      const dps = (tooltipWeapon.min + tooltipWeapon.max) / 2 / tooltipWeapon.speed;
      html += `<div class="tt-stat">${esc(
        t('itemUi.tooltip.damageSpeed', {
          min: itemNumber(tooltipWeapon.min),
          max: itemNumber(tooltipWeapon.max),
          speed: itemNumber(tooltipWeapon.speed, 1),
        }),
      )}</div>`;
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.dps', { dps: itemNumber(dps, 1) }))}</div>`;
    }
    if (instance?.procedural && tooltipStats.stats.armor > 0) {
      html += `<div class="tt-stat">${esc(
        t('itemUi.tooltip.armorStat', { value: itemNumber(tooltipStats.stats.armor) }),
      )}</div>`;
    } else if (item.stats) {
      for (const [stat, value] of Object.entries(item.stats)) {
        if (value === undefined) continue;
        if (stat === 'armor') {
          html += `<div class="tt-stat">${esc(t('itemUi.tooltip.armorStat', { value: itemNumber(value) }))}</div>`;
        } else {
          html += `<div class="tt-green">${esc(
            t('itemUi.tooltip.stat', { value: itemNumber(value), stat: itemStatName(stat) }),
          )}</div>`;
        }
      }
    }
    html += instanceBonusStatLines(resolverInstance);
    html += this.proceduralAffixBlock(instance);
    html += this.legendaryPowerBlock(instance);

    const warfareRating = Math.min(item.pvpOffenseRating ?? 0, item.pvpDefenseRating ?? 0);
    if (warfareRating > 0) {
      html += `<div class="tt-green">${esc(
        t('itemUi.tooltip.stat', {
          value: itemNumber(warfareRating),
          stat: t(statNameKey('warfare') as TranslationKey),
        }),
      )}</div>`;
    }
    for (const ratingStat of ['hitRating', 'critRating', 'hasteRating'] as const) {
      const value = item[ratingStat] ?? 0;
      if (value <= 0) continue;
      html += `<div class="tt-green">${esc(
        t('itemUi.tooltip.stat', {
          value: itemNumber(value),
          stat: t(statNameKey(ratingStat) as TranslationKey),
        }),
      )}</div>`;
    }
    if (item.foodHp) {
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useFood', { amount: itemNumber(item.foodHp), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    }
    if (item.drinkMana) {
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useDrink', { amount: itemNumber(item.drinkMana), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    }
    html += gatherToolTooltipLines(item);
    html += materialHintLine(item.id);
    if (item.potionHp) {
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useHealingPotion', { amount: itemNumber(item.potionHp) }))}</div>`;
    }
    if (item.potionMana) {
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useManaPotion', { amount: itemNumber(item.potionMana) }))}</div>`;
    }
    if (item.kind === 'quest') {
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.questItem'))}</div>`;
    }
    if (item.kind === 'bag' && item.bagSlots) {
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.bagSlots', { slots: itemNumber(item.bagSlots) }))}</div>`;
    }
    const requiredClasses = requiredClassesForTooltip(item);
    if (requiredClasses) {
      html += `<div class="tt-sub">${esc(
        t('itemUi.tooltip.classes', { classes: formatList(requiredClasses.map(classDisplayName)) }),
      )}</div>`;
    }
    const requiredLevel = requiredLevelForItemInstance(item, resolverInstance);
    if ((item.kind === 'weapon' || item.kind === 'armor') && requiredLevel > 1) {
      const meets = this.deps.playerLevel() >= requiredLevel;
      html += `<div class="${meets ? 'tt-sub' : 'tt-red'}">${esc(
        t('hudChrome.itemTooltip.requiresLevel', { level: itemNumber(requiredLevel) }),
      )}</div>`;
    }
    html += this.itemProcBlock(item);
    html += this.itemSetBlock(item);
    html += instanceMakersMarkLine(resolverInstance, item.kind);
    const vendorSellValue = itemVendorSellValue(item, instance);
    if (vendorSellValue > 0) {
      html += `<div class="tt-sub">${esc(
        t('itemUi.tooltip.sellPrice', { money: formatLocalizedMoney(vendorSellValue) }),
      )}</div>`;
    }
    if (compare) html += this.itemCompareBlock(item, instance);
    return html;
  }

  private proceduralAffixBlock(instance?: ItemPresentationInstance): string {
    const affixes = proceduralAffixPresentations(instance);
    let html = '';
    for (const line of affixes) {
      const range = `<span class="tt-roll-range" aria-label="${esc(
        t('itemUi.procedural.rollRangeAria', {
          min: itemNumber(line.min),
          max: itemNumber(line.max),
        }),
      )}"> [${itemNumber(line.min)}-${itemNumber(line.max)}]</span>`;
      html += `<div class="${line.implicit ? 'tt-stat tt-procedural-implicit' : 'tt-green tt-procedural-affix'}">${esc(
        t('itemUi.tooltip.stat', {
          value: itemNumber(line.value),
          stat: proceduralItemStatName(line.stat),
        }),
      )}${range}</div>`;
    }
    if (affixes.length > 0) {
      html += `<div class="tt-sub tt-advanced-detail-hint">${esc(
        t('itemUi.procedural.advancedDetailsHint', { key: keyCapLabel('Alt') }),
      )}</div>`;
    }
    return html;
  }

  private legendaryPowerBlock(instance?: ItemPresentationInstance): string {
    const legendary = proceduralLegendaryPresentation(instance);
    if (!legendary) return '';
    const rollLines = legendary.rollDetails
      .map((roll) => {
        const key =
          roll.unit === 'percent'
            ? 'itemUi.procedural.powerRollPercent'
            : roll.unit === 'milliseconds'
              ? 'itemUi.procedural.powerRollMilliseconds'
              : roll.unit === 'resource'
                ? 'itemUi.procedural.powerRollResource'
                : 'itemUi.procedural.powerRollNumber';
        const suffix = roll.unit === 'percent' ? '%' : roll.unit === 'milliseconds' ? ' ms' : '';
        const range = `<span class="tt-roll-range" aria-label="${esc(
          t('itemUi.procedural.rollRangeAria', {
            min: itemAdaptiveNumber(roll.min),
            max: itemAdaptiveNumber(roll.max),
          }),
        )}"> [${itemAdaptiveNumber(roll.min)}-${itemAdaptiveNumber(roll.max)}${suffix}]</span>`;
        return `<span class="tt-legendary-roll">${esc(
          t(key, { value: itemAdaptiveNumber(roll.value) }),
        )}${range}</span>`;
      })
      .join('');
    return `<div class="tt-legendary-power"><span class="tt-legendary-rune">${legendaryPowerRuneSvg()}</span><span class="tt-legendary-copy"><span>${esc(
      legendary.description,
    )}</span>${rollLines}<span class="tt-legendary-limit">${esc(
      t('itemUi.procedural.legendaryLimit', {
        count: itemNumber(MAX_ACTIVE_LEGENDARY_POWERS),
      }),
    )}</span></span></div>`;
  }

  private itemProcBlock(item: ItemDef): string {
    const lines = weaponProcLines(item.kind === 'weapon' ? item.weaponProcs : undefined);
    let html = '';
    for (const line of lines) {
      const effect = line.effects.map((entry) => procEffectText(entry)).join(' ');
      const triggerKey =
        line.trigger === 'weaponHit'
          ? 'hudChrome.itemProc.onMeleeHit'
          : line.trigger === 'spellDamage'
            ? 'hudChrome.itemProc.onSpellDamage'
            : 'hudChrome.itemProc.onHeal';
      html += `<div class="tt-green">${esc(
        t(triggerKey, {
          chance: formatNumber(line.chancePct, { maximumFractionDigits: 0 }),
          effect,
        }),
      )}</div>`;
    }
    return html;
  }

  private itemSetBlock(item: ItemDef): string {
    if (!item.set) return '';
    const equippedPieces = this.deps
      .equippedItemIds()
      .filter((itemId) => itemId && this.deps.items[itemId]?.set === item.set).length;
    const model = itemSetTooltipModel({
      itemSetId: item.set,
      equippedPieces,
      itemSetMembers: itemSetMemberCounts(),
    });
    if (!model) return '';
    const name = tEntity({ kind: 'itemSet', id: model.setId, field: 'name' });
    let html = `<div class="tt-set-name">${esc(
      t('hudChrome.itemSet.header', {
        name,
        have: formatNumber(model.equippedPieces, { maximumFractionDigits: 0 }),
        total: formatNumber(model.totalPieces, { maximumFractionDigits: 0 }),
      }),
    )}</div>`;
    for (const tier of model.bonusTiers) {
      const field = tier.pieces === 2 ? 'bonus2' : tier.pieces === 3 ? 'bonus3' : 'bonus4';
      const bonus = tEntity({ kind: 'itemSet', id: model.setId, field });
      html += `<div class="tt-set-bonus${tier.active ? ' active' : ''}">${esc(
        t('hudChrome.itemSet.bonusLine', {
          pieces: formatNumber(tier.pieces, { maximumFractionDigits: 0 }),
          bonus,
        }),
      )}</div>`;
    }
    return html;
  }

  private itemCompareBlock(item: ItemDef, instance?: ItemPresentationInstance): string {
    if (!item.slot) return '';
    const slots: readonly EquipSlot[] = item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
    return slots.map((slot) => this.itemCompareBlockForSlot(item, instance, slot)).join('');
  }

  private itemCompareBlockForSlot(
    item: ItemDef,
    instance: ItemPresentationInstance | undefined,
    slot: EquipSlot,
  ): string {
    const equippedId = this.deps.equippedItemId(slot);
    const equippedInstance = this.deps.equippedInstance(slot);
    if (!equippedId || (equippedId === item.id && !instance && !equippedInstance)) return '';
    const equipped = this.deps.items[equippedId];
    if (!equipped) return '';
    const deltas = resolvedItemDeltas(
      item,
      instance as ItemInstancePayload | undefined,
      equipped,
      equippedInstance,
    )
      .map((delta) => {
        const decimals = delta.stat === 'weaponDps' ? 1 : 0;
        const magnitude = formatNumber(Math.abs(delta.delta), {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        return `<div class="${delta.delta > 0 ? 'tt-green' : 'tt-red'}">${
          delta.delta > 0 ? '+' : '&minus;'
        }${magnitude} ${esc(proceduralItemStatName(delta.stat))}</div>`;
      })
      .join('');
    let html = `<div class="tt-cmp"><div class="tt-cmp-head">${esc(t('itemUi.tooltip.currentlyEquipped'))}</div>`;
    html += `<div class="tt-cmp-body">${this.tooltip(equipped, false, equippedInstance)}</div>`;
    if (deltas) {
      html += `<div class="tt-cmp-head">${esc(t('itemUi.tooltip.ifYouEquip'))}</div>${deltas}`;
    }
    return `${html}</div>`;
  }
}

function procEffectText(effect: WeaponProcEffectDesc): string {
  const number = (value: number | undefined): string =>
    formatNumber(value ?? 0, { maximumFractionDigits: 0 });
  switch (effect.kind) {
    case 'chainArc':
      return t('hudChrome.itemProc.chainArc', {
        school: effect.school ?? '',
        name: effect.name ?? '',
        damage: number(effect.damage),
        jumps: number(effect.jumps),
      });
    case 'attackSlow':
      return t('hudChrome.itemProc.attackSlow', {
        pct: number(effect.slowPct),
        duration: number(effect.duration),
      });
    case 'dot':
      return t('hudChrome.itemProc.dot', {
        name: effect.name ?? '',
        school: effect.school ?? '',
        total: number(effect.total),
        duration: number(effect.duration),
      });
    case 'hot':
      return t('hudChrome.itemProc.hot', {
        name: effect.name ?? '',
        total: number(effect.total),
        duration: number(effect.duration),
      });
  }
}

export function itemSlotName(slot: ItemSlot): string {
  return t(ITEM_SLOT_LABEL_KEYS[slot]);
}

function itemQualityLabel(quality: ItemDef['quality']): string {
  return t(ITEM_QUALITY_LABEL_KEYS[quality ?? 'common']);
}

function itemKindLabel(kind: ItemDef['kind']): string {
  return t(ITEM_KIND_LABEL_KEYS[kind]);
}

function proceduralItemStatName(stat: string): string {
  if (
    stat === 'spellPower' ||
    stat === 'critRating' ||
    stat === 'hasteRating' ||
    stat === 'hitRating'
  ) {
    return t(statNameKey(stat) as TranslationKey);
  }
  return tOptional(`itemUi.stats.${stat}`) ?? itemStatName(stat);
}
