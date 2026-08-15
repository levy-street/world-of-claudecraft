// Max-stack item tooltip line: how many copies of the item share one bag
// slot, as a pure string-builder composed inside Hud.itemTooltip (the
// elixir_tooltip_view.ts pattern: t() + esc here, no DOM, no Hud state, so
// tests/stack_size_tooltip_view.test.ts drives it directly). The NUMBER
// always comes from the one stacking rule every inventory site consumes
// (sim/bags.ts stackSizeOf), never a re-typed copy; what this module owns is
// only WHEN the line is worth stating. It stays silent in three cases:
// 1-per-slot kinds (gear, bags, tools: saying "Max stack: 1" on every sword
// is noise), mount reins (their 20-per-slot cap is real in the bags, but a
// second copy of a collectible is pure waste, so advertising the cap teaches
// hoarding), and a non-mergeable instance payload (charges mutate in place,
// so bags.ts instancedCountCap holds such a slot to ONE copy regardless of
// the def cap, and quoting the def cap there would lie). The line exists to
// answer the question a player with ONE potion cannot answer any other way:
// there is no stack badge at quantity 1, so the tooltip is how they find out
// more copies will share the slot.

import { stackSizeOf } from '../sim/bags';
import { isMergeableInstancePayload } from '../sim/item_instance_merge';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** The "Max stack: N" sub-line for a stackable item, or '' when the line
 *  would be noise or wrong (1-per-slot kinds, mounts, charge payloads). */
export function stackSizeTooltipLine(item: ItemDef, instance?: ItemInstancePayload): string {
  if (item.kind === 'mount') return '';
  if (!isMergeableInstancePayload(instance)) return '';
  const size = stackSizeOf(item);
  if (size <= 1) return '';
  const text = t('itemUi.tooltip.maxStack', {
    count: formatNumber(size, { maximumFractionDigits: 0 }),
  });
  return `<div class="tt-sub">${esc(text)}</div>`;
}
