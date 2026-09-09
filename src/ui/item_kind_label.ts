// The item tooltip's quality and kind label resolution (the "Junk" line), a
// host-agnostic sibling the HUD composes: pure key lookup plus presentation
// splits for honest materials. A fine-grade material's KIND stays 'junk'
// internally (the downward substitution and the Sell Junk sweep both key off
// it), but its tooltip line reads "Fine Material"; baseMaterialFor answers
// non-undefined for exactly the fine ids (material_grades.ts, the FINE_GRADE
// pairing), and FARM_FINE_PRODUCE_ITEM_IDS names the twelve farm twins, which
// are fine grades of the same kind but are not MATERIAL_GRADES rows.
// Honest materials (recipe reagents, ores, raw cooking catches, etc.)
// that are still kind 'junk' read "Material" via MATERIAL_ITEM_IDS. Grey junk
// that is not in the honest set keeps "Junk". Extracted from hud.ts (the phase
// 14 QA): the unit is directly importable, so its test drives it without a
// prototype rig.

import { FARM_FINE_PRODUCE_ITEM_IDS } from '../sim/content/farm_crops';
import { MATERIAL_ITEM_IDS } from '../sim/material_taxonomy';
import { baseMaterialFor } from '../sim/professions/material_grades';
import type { ItemDef } from '../sim/types';
import { type TranslationKey, t } from './i18n';

type ItemQuality = NonNullable<ItemDef['quality']>;

/** Exported so vocabulary consumers (the Exchange sell caption's floor
 *  screen) derive from THIS exhaustive record: a new quality reds the
 *  Record type here and flows everywhere, instead of drifting a hand-kept
 *  copy. */
export const ITEM_QUALITY_LABEL_KEYS: Record<ItemQuality, TranslationKey> = {
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
  flask: 'itemUi.kind.flask',
  scroll: 'itemUi.kind.scroll',
  bag: 'itemUi.kind.bag',
  mount: 'itemUi.kind.mount',
  recipe: 'itemUi.kind.recipe',
};

export function itemQualityLabel(quality: ItemDef['quality']): string {
  return t(ITEM_QUALITY_LABEL_KEYS[quality ?? 'common']);
}

export function itemKindLabel(kind: ItemDef['kind'], itemId?: string): string {
  if (kind === 'junk' && itemId !== undefined) {
    // Fine grades first: they are also honest materials, but the line must
    // stay "Fine Material" (not the broader Material label).
    if (baseMaterialFor(itemId) !== undefined) {
      return t('itemUi.kind.fineMaterial');
    }
    // The twelve farm fine twins read the same, one table over. Farming mints
    // them through its own harvest roll rather than a node yield, so they are
    // not MATERIAL_GRADES rows and baseMaterialFor cannot see them. Named
    // here rather than widened into that table on purpose: materialGradeIds
    // walks MATERIAL_GRADES alone, so a twin added there would start
    // satisfying a recipe asking for base produce. Label only
    // (qr-19-farm-fine-produce-kind-label).
    if (FARM_FINE_PRODUCE_ITEM_IDS.has(itemId)) {
      return t('itemUi.kind.fineMaterial');
    }
    if (MATERIAL_ITEM_IDS.has(itemId)) {
      return t('itemUi.kind.material');
    }
  }
  return t(ITEM_KIND_LABEL_KEYS[kind]);
}
