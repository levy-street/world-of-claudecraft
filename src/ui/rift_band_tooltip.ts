// Riftbound band tooltip lines, the thin painter over rift/band_ladder.ts.
//
// A band is priced by its COPY (the rift record), not its stat-free ItemDef
// shell, so the item-level readout that hud.ts derives per definition for
// every other piece is derived per instance here, and the rank / upgrade /
// socket lines that explain the copy live beside it. The gem line tells a
// player what a bag gem will do before they walk it to the forge.
import type { RiftGemId } from '../sim/content/rift/items';
import { PRIMARY_STATS } from '../sim/item_budget';
import { itemLevel, itemScore } from '../sim/item_level';
import { RIFT_GEM_RATING, RIFT_GEM_RATING_STAT, riftBandItemLevel } from '../sim/rift/band_ladder';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import { itemNumber } from './item_instance_tooltip';
import { statNameKey } from './stat_tooltip_view';

export interface ItemLevelReadout {
  level: number;
  score: number;
}

/** The "Item Level N" / "Score S" pair for a tooltip: per definition for an
 *  authored piece (item_level.ts), per copy for a Riftbound band, whose level
 *  is its rank base plus essence upgrades and whose score is the rolled
 *  primary line the ladder priced onto it. Undefined when the piece has no
 *  derivable level (the caller omits the lines). */
export function itemLevelReadout(
  item: ItemDef,
  instance?: ItemInstancePayload,
): ItemLevelReadout | undefined {
  const rift = instance?.rift;
  if (rift) {
    const rolled = instance?.rolled?.stats ?? {};
    let score = itemScore(item);
    for (const stat of PRIMARY_STATS) score += rolled[stat] ?? 0;
    return { level: riftBandItemLevel(rift.tier, rift.upgradeLevel), score };
  }
  const level = itemLevel(item);
  return level === undefined ? undefined : { level, score: itemScore(item) };
}

function subLine(text: string): string {
  return `<div class="tt-sub">${esc(text)}</div>`;
}

/** The bind, rank, upgrade, and socket lines of a band copy ('' for any other
 *  copy). A band is owner-bound personal reward gear, stated with the classic
 *  Soulbound line here rather than the commission bond line. */
export function riftBandTooltipLines(instance?: ItemInstancePayload): string {
  const rift = instance?.rift;
  if (!rift) return '';
  return (
    `<div class="tt-sub" style="color:var(--gold)">${esc(t('hudChrome.itemAccountBound'))}</div>` +
    subLine(t('hudChrome.itemTooltip.riftTier', { tier: rift.tier })) +
    subLine(
      t('hudChrome.itemTooltip.riftUpgrade', {
        level: itemNumber(rift.upgradeLevel),
        max: itemNumber(rift.maxUpgradeLevel),
      }),
    ) +
    subLine(
      t('hudChrome.itemTooltip.riftSockets', {
        used: itemNumber(rift.gems.length),
        total: itemNumber(rift.gemSlots),
      }),
    )
  );
}

/** What a Rift gem grants once socketed: the colour's rating line, stated on
 *  the gem itself so the choice is legible in the bag ('' for a non-gem). */
export function riftGemTooltipLines(item: ItemDef): string {
  const stat = RIFT_GEM_RATING_STAT[item.id as RiftGemId];
  if (!stat) return '';
  return (
    subLine(t('hudChrome.itemTooltip.riftGemSocket')) +
    `<div class="tt-green">${esc(
      t('itemUi.tooltip.stat', {
        value: itemNumber(RIFT_GEM_RATING),
        stat: t(statNameKey(stat) as TranslationKey),
      }),
    )}</div>`
  );
}
