// The item tooltip's quality and kind label resolution (the "Junk" line), a
// host-agnostic sibling the HUD composes: pure key lookup plus the one
// presentation split. A fine-grade material's KIND stays 'junk' internally
// (the downward substitution and the Sell Junk sweep both key off it), but
// its tooltip line reads "Fine Material"; baseMaterialFor answers
// non-undefined for exactly the fine ids (material_grades.ts, the
// FINE_GRADE pairing). Extracted from hud.ts (the phase 14 QA): the unit is
// directly importable, so its test drives it without a prototype rig.

import { baseMaterialFor } from '../sim/professions/material_grades';
import type { ItemDef } from '../sim/types';
import { type TranslationKey, t } from './i18n';

type ItemQuality = NonNullable<ItemDef['quality']>;

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
  mount: 'itemUi.kind.mount',
};

export function itemQualityLabel(quality: ItemDef['quality']): string {
  return t(ITEM_QUALITY_LABEL_KEYS[quality ?? 'common']);
}

export function itemKindLabel(kind: ItemDef['kind'], itemId?: string): string {
  if (kind === 'junk' && itemId !== undefined && baseMaterialFor(itemId) !== undefined) {
    return t('itemUi.kind.fineMaterial');
  }
  return t(ITEM_KIND_LABEL_KEYS[kind]);
}
