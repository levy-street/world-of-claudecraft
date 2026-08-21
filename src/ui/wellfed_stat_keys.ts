// The well-fed stat-label map, a PURE LEAF on purpose (Phase 14, C10): the
// stat-buff kinds a well-fed dish plausibly carries, each mapped to the item
// tooltip's own stat label so "Stamina" reads identically on the dish
// tooltip, the feast tooltip, the elixir line, a gear stat line, AND the
// wiki's dish effect prose. Moved whole from wellfed_tooltip_view.ts because
// the guide bundle consumes it too and the tooltip view's import graph
// reaches sim_i18n -> sim.ts -> the deeds catalog, which the guide's
// spoiler-containment pin forbids; every consumer imports THIS leaf directly
// (the old view re-export was dropped in 11c once its last importer moved).
// Kinds outside this map take each consumer's aura-name fallback.

import type { AuraKind } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

export const WELLFED_STAT_KEYS: Partial<Record<AuraKind, TranslationKey>> = {
  buff_sta: 'itemUi.stats.sta',
  buff_int: 'itemUi.stats.int',
  buff_agi: 'itemUi.stats.agi',
  buff_armor: 'itemUi.stats.armor',
  buff_ap: 'itemUi.stats.attackPower',
};
