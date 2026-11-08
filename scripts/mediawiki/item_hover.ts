import { MOUNTS } from '../../src/sim/content/mounts';
import { ITEMS, QUESTS } from '../../src/sim/data';
import { isUniqueEquipped, weaponHand } from '../../src/sim/equipment_rules';
import { isMembershipArmour, isReferralArmour } from '../../src/sim/membership_armour';
import { isMembershipWeapon } from '../../src/sim/membership_weapon';
import { CONSUME_DURATION, type ItemDef, MAX_LEVEL } from '../../src/sim/types';
import { bagSlotsLineKey } from '../../src/ui/bags_view';
import { questTitle } from '../../src/ui/entity_display_core';
import {
  classDisplayName,
  itemDisplayName,
  itemSetBonusField,
  tEntity,
} from '../../src/ui/entity_i18n';
import { esc } from '../../src/ui/esc';
import { gatherToolTooltipLines } from '../../src/ui/gather_tool_tooltip';
import { factionRewardTooltipLines } from '../../src/ui/hud/faction_reward_tooltip_view';
import { cookingCatchHintKey } from '../../src/ui/hud/professions/cooking_catch_hint_view';
import { elixirTooltipLines } from '../../src/ui/hud/professions/elixir_tooltip_view';
import { feastTooltipLines } from '../../src/ui/hud/professions/feast_tooltip_view';
import { materialHintLine } from '../../src/ui/hud/professions/material_hint_view';
import { materialProfessionHintText } from '../../src/ui/hud/professions/material_profession_hint_view';
import { mobileStationTooltipLines } from '../../src/ui/hud/professions/mobile_station_tooltip';
import { recipePatternTooltipLines } from '../../src/ui/hud/professions/recipe_pattern_tooltip_view';
import { stationNameText } from '../../src/ui/hud/professions/station_name_view';
import { wellFedTooltipLines } from '../../src/ui/hud/professions/wellfed_tooltip_view';
import { skullBagTooltipLines } from '../../src/ui/hud/skull_bag/skull_bag_tooltip_view';
import { CHROME_TONE } from '../../src/ui/hud_tones';
import { t } from '../../src/ui/i18n';
import { itemArmorTypeLabelKey } from '../../src/ui/item_armor_type';
import { requiredClassesForTooltip } from '../../src/ui/item_class_restriction';
import { itemCombatTooltipLines } from '../../src/ui/item_combat_tooltip_view';
import {
  instanceTitleHtml,
  itemNumber,
  itemRequiredLevelLine,
  tooltipEffectiveQuality,
  vendorSellTooltipLine,
} from '../../src/ui/item_instance_tooltip';
import { itemQualityLabel } from '../../src/ui/item_kind_label';
import { itemLevelTooltipLines } from '../../src/ui/item_level_tooltip';
import { itemSetMemberCounts, itemSetTooltipModel } from '../../src/ui/item_set_tooltip_view';
import { itemSlotLabel } from '../../src/ui/item_slot_labels';
import { masterwroughtTooltipLines } from '../../src/ui/masterwrought_cap_view';
import { membershipItemTooltipLines } from '../../src/ui/membership_item_tooltip';
import { MOUNT_DESC_KEYS } from '../../src/ui/mount_labels';
import { potionTooltipLines } from '../../src/ui/potion_tooltip_view';
import {
  QUEST_ITEM_TOOLTIP_COLOR,
  questItemTooltipModel,
  questItemTooltipRelatedKey,
} from '../../src/ui/quest_item_tooltip_view';
import {
  seasonalItemSourceText,
  seasonalItemTooltipText,
} from '../../src/ui/seasonal_item_tooltip';
import { stackSizeTooltipLine } from '../../src/ui/stack_size_tooltip_view';
import { toolEffectTooltipLines } from '../../src/ui/tool_effect_tooltip';
import { tooltipLine } from '../../src/ui/tooltip_line_core';
import { treasureMapTooltipLine } from '../../src/ui/treasure_map_tooltip_view';
import { trinketTooltipLines } from '../../src/ui/trinket_tooltip_view';
import { weaponProcEffectText } from '../../src/ui/weapon_proc_text';
import { weaponProcLines } from '../../src/ui/weapon_proc_view';
import { weaponTypeLabelKey } from '../../src/ui/weapon_type_label';

import { wikiItemKind } from './wiki_item_kind';

const setSizes = itemSetMemberCounts();
const trinketExample = { attackPower: 0, rangedPower: 0, spellPower: 0, healPower: 0, maxHp: 1000 };
const gold = (text: string) =>
  '<div class="tt-sub" style="color:var(--gold)">' + esc(text) + '</div>';

function setBonuses(item: ItemDef) {
  if (!item.set) return '';
  const model = itemSetTooltipModel({
    itemSetId: item.set,
    equippedPieces: 0,
    itemSetMembers: setSizes,
  });
  if (!model) return '';
  let html =
    '<div class="tt-set-name">' +
    esc(tEntity({ kind: 'itemSet', id: model.setId, field: 'name' })) +
    '</div>';
  for (const tier of model.bonusTiers) {
    const bonus = tEntity({
      kind: 'itemSet',
      id: model.setId,
      field: itemSetBonusField(tier.pieces),
    });
    html +=
      '<div class="tt-set-bonus">' +
      esc(t('hudChrome.itemSet.bonusLine', { pieces: itemNumber(tier.pieces), bonus })) +
      '</div>';
  }
  return html;
}

function chanceOnAction(item: ItemDef) {
  let html = '';
  for (const row of weaponProcLines(item.kind === 'weapon' ? item.weaponProcs : undefined)) {
    const key =
      row.trigger === 'weaponHit'
        ? 'hudChrome.itemProc.onMeleeHit'
        : row.trigger === 'spellDamage'
          ? 'hudChrome.itemProc.onSpellDamage'
          : 'hudChrome.itemProc.onHeal';
    html += tooltipLine(
      'tt-green',
      t(key, {
        chance: itemNumber(row.chancePct),
        effect: row.effects.map(weaponProcEffectText).join(' '),
      }),
    );
  }
  return html;
}

// The definition-only form of the HUD card. Player comparisons, individual rolls,
// equipment counts and quest progress cannot be inferred from an encyclopedia entry.
function card(item: ItemDef, mode: 'full' | 'embedded' | 'noset'): string {
  const questId = item.kind === 'quest' ? item.questId : undefined;
  const quest = questItemTooltipModel({
    kind: item.kind,
    itemId: item.id,
    questId,
    questKnown: !!(questId && QUESTS[questId]),
  });
  const quality = tooltipEffectiveQuality(item, undefined);
  let html = instanceTitleHtml(item, undefined, itemDisplayName(item));
  if (quest) {
    html +=
      '<div class="tt-sub" style="color:' +
      QUEST_ITEM_TOOLTIP_COLOR +
      '">' +
      esc(t(quest.kindLineKey)) +
      '</div>';
  } else {
    const kind = esc(
      t('itemUi.tooltip.qualityKind', {
        quality: itemQualityLabel(quality),
        kind: wikiItemKind(item),
      }),
    );
    const heroic =
      item.heroicOf || item.heroic
        ? ' <span style="color:' +
          CHROME_TONE.HEROIC_TAG +
          '">' +
          esc(t('hudChrome.itemHeroicTag')) +
          '</span>'
        : '';
    html += '<div class="tt-sub">' + kind + heroic + '</div>';
  }
  const adaptive =
    isMembershipArmour(item.id) || isMembershipWeapon(item.id) || isReferralArmour(item.id);
  if (item.kind === 'weapon' && !adaptive) {
    const type = weaponTypeLabelKey(item.id);
    if (type) html += tooltipLine('tt-sub', t(type));
  }
  if (item.slot) {
    const slot =
      item.kind === 'weapon' && weaponHand(item) === 'twohand'
        ? t('itemUi.slots.twoHand')
        : itemSlotLabel(item.slot);
    const weight = adaptive ? null : itemArmorTypeLabelKey(item);
    html += weight
      ? '<div class="tt-sub tt-row"><span>' +
        esc(slot) +
        '</span><span class="tt-armor">' +
        esc(t(weight)) +
        '</span></div>'
      : tooltipLine('tt-sub', slot);
    if (isUniqueEquipped(item)) html += gold(t('hudChrome.itemUniqueEquipped'));
    if (item.masterwrought)
      for (const row of masterwroughtTooltipLines({}, ITEMS, quality))
        html += gold(t(row.key, row.values));
  }
  if (!adaptive) html += itemLevelTooltipLines(item, undefined, true, MAX_LEVEL);
  if (item.soulbound) html += gold(t('hudChrome.itemSoulbound'));
  if (!adaptive) html += itemCombatTooltipLines(item);
  if (adaptive)
    html += tooltipLine(
      'tt-sub',
      'Scaling example at level ' + MAX_LEVEL + ' with the account benefit active.',
    );
  html += membershipItemTooltipLines(item, {
    level: MAX_LEVEL,
    membershipActive: true,
    referralInviterName: isReferralArmour(item.id)
      ? t('itemUi.tooltip.referralInviter')
      : undefined,
  });
  if (item.foodHp)
    html += tooltipLine(
      'tt-desc',
      t('itemUi.tooltip.useFood', {
        amount: itemNumber(item.foodHp),
        seconds: itemNumber(CONSUME_DURATION),
      }),
    );
  if (item.drinkMana)
    html += tooltipLine(
      'tt-desc',
      t('itemUi.tooltip.useDrink', {
        amount: itemNumber(item.drinkMana),
        seconds: itemNumber(CONSUME_DURATION),
      }),
    );
  html +=
    wellFedTooltipLines(item) +
    gatherToolTooltipLines(item) +
    toolEffectTooltipLines(item) +
    mobileStationTooltipLines(item, stationNameText) +
    materialHintLine(item.id);
  const catchKey = cookingCatchHintKey(item.id);
  if (catchKey) html += tooltipLine('tt-desc', t(catchKey));
  const materialUse = materialProfessionHintText(item.id);
  if (materialUse) html += tooltipLine('tt-desc', materialUse);
  html += potionTooltipLines(item) + elixirTooltipLines(item);
  html +=
    item.id === 'allied_hearthstone'
      ? tooltipLine('tt-desc', t('hudChrome.factionRewards.alliedHearthstoneUse'))
      : factionRewardTooltipLines(item);
  if (item.kind === 'recipe')
    html += recipePatternTooltipLines(item, null, (product, noSet) =>
      card(product, noSet ? 'noset' : 'embedded'),
    );
  html += feastTooltipLines(item) + skullBagTooltipLines(item);
  for (const text of [seasonalItemTooltipText(item), seasonalItemSourceText(item)])
    if (text) html += tooltipLine('tt-desc', text);
  if (quest) {
    if (quest.relatedQuestId)
      html += gold(t(questItemTooltipRelatedKey(), { quest: questTitle(quest.relatedQuestId) }));
    html += tooltipLine('tt-desc', t(quest.rulesKey));
  }
  const bag = bagSlotsLineKey(item);
  if (bag && item.bagSlots)
    html += '<div class="tt-stat">' + esc(t(bag, { slots: itemNumber(item.bagSlots) })) + '</div>';
  if (item.kind === 'mount' && MOUNTS[item.mount]) {
    const desc = MOUNT_DESC_KEYS[item.mount];
    if (desc) html += tooltipLine('tt-desc', t(desc));
    html += tooltipLine('tt-sub', t('hudChrome.mounts.useToRide'));
  }
  const classes = requiredClassesForTooltip(item);
  if (classes)
    html += tooltipLine(
      'tt-sub',
      t('itemUi.tooltip.classes', { classes: classes.map(classDisplayName).join(', ') }),
    );
  html += itemRequiredLevelLine(item) + treasureMapTooltipLine(item) + chanceOnAction(item);
  const trinket = trinketTooltipLines(item, trinketExample);
  if (trinket) {
    html += trinket;
    if (
      trinket !==
      trinketTooltipLines(item, {
        attackPower: 100,
        rangedPower: 100,
        spellPower: 100,
        healPower: 100,
        maxHp: 2000,
      })
    ) {
      html += tooltipLine(
        'tt-sub',
        'These trinket values use 1,000 maximum health and zero Attack Power, Ranged Attack Power, Spell Power and Healing Power.',
      );
    }
  }
  if (mode !== 'noset') html += setBonuses(item);
  if (mode === 'full') html += stackSizeTooltipLine(item) + vendorSellTooltipLine(item);
  return html;
}

export function itemHover(item: ItemDef): string {
  return card(item, 'full');
}
