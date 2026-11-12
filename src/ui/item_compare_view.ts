// The item comparison, drawn ON the hovered item's own card: each stat line
// carries the change the swap would make in a right-hand cell (green up, red
// down), a stat the swap changes that the card has no line for gets one muted
// row, and a set tier the swap would break or light gets a line at the foot.
// The worn item's card is never drawn. The pure-core half of the pure-core +
// thin-consumer split: Hud supplies the world's equipment reads and the
// hovered copy's payload, the stat-line renderers ask `take` for their cell,
// and the tooltip appends `restHtml` and `footerHtml`. Reads the IWorld
// equipment shapes, so it works identically offline and online.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { EquipSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import {
  type CompareStat,
  itemStatDeltas,
  type StatDelta,
  shouldCompareCopies,
} from './item_compare';
import { compareStatLabelKey } from './item_instance_tooltip';
import { type SetTierChange, setTierChangesOnSwap } from './item_set_swap_view';

/** The worn source the comparison reads: the equipment map plus the worn
 *  per-copy payloads (the IWorld `equipment` / `equipmentInstances` shapes). */
export interface CompareEquipmentSource {
  equipment: Partial<Record<EquipSlot, string>>;
  instances?: Partial<Record<EquipSlot, ItemInstancePayload>>;
}

/** What the stat-line renderers and the tooltip read off one comparison. */
export interface ItemCompareMarks {
  /** The column header row: only a ring against two worn rings has one. */
  headHtml(): string;
  /** The change cell for `stat`, leading space included, or '' when the swap
   *  leaves it alone. Each stat is handed out once: the first line to ask
   *  carries it, so a base line and an enchant line never both show it. */
  take(stat: CompareStat): string;
  /** One muted row per changed stat no line claimed (a stat the hovered item
   *  lacks, or one only a per-copy bonus line shows). */
  restHtml(): string;
  /** Set tiers the swap breaks or lights, or the "No stat changes" line. */
  footerHtml(): string;
}

/** A stat line with its change cell: the plain `<div>` when there is no cell,
 *  so a tooltip outside a comparison keeps its exact markup. `text` is
 *  already escaped. */
export function compareStatLineHtml(
  cls: string,
  text: string,
  marks: ItemCompareMarks | undefined,
  stat: CompareStat,
): string {
  const cell = marks?.take(stat) ?? '';
  return cell
    ? `<div class="${cls} tt-row"><span>${text}</span>${cell}</div>`
    : `<div class="${cls}">${text}</div>`;
}

// A hovered ring compares against every worn ring (classic behavior); every
// other slot kind is its own single equipment key.
function compareSlots(item: ItemDef): readonly EquipSlot[] {
  if (!item.slot) return [];
  return item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
}

// The slot an un-aimed equip lands in, for the set-tier check: a ring fills
// an empty ring slot first and replaces ring1 when both are worn (the
// resolveEquipSlot rule in equipment_rules.ts). Only the target slot is
// swapped: no set has a weapon or off-hand piece, so the hand a two-hander
// would bench never holds one.
function swapSlot(item: ItemDef, source: CompareEquipmentSource): EquipSlot | undefined {
  const slots = compareSlots(item);
  return slots.find((slot) => !source.equipment[slot]) ?? slots[0];
}

function deltaCellHtml(d: StatDelta | undefined): string {
  if (!d) return '<span class="tt-delta"></span>';
  const magnitude = formatNumber(Math.abs(d.delta), {
    minimumFractionDigits: d.decimals,
    maximumFractionDigits: d.decimals,
  });
  // The sign rides with the arrow the stylesheet draws, so the direction
  // never depends on color alone ('−' is the proper minus sign).
  return d.delta > 0
    ? `<span class="tt-delta tt-green">+${magnitude}</span>`
    : `<span class="tt-delta tt-red">−${magnitude}</span>`;
}

function setChangeHtml(change: SetTierChange): string {
  const count = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
  const line = t(change.gained ? 'itemUi.tooltip.setBonusGained' : 'itemUi.tooltip.setBonusLost', {
    pieces: count(change.pieces),
  });
  const header = t('hudChrome.itemSet.header', {
    name: tEntity({ kind: 'itemSet', id: change.setId, field: 'name' }),
    have: count(change.have),
    total: count(change.total),
  });
  return (
    `<div class="tt-set-change ${change.gained ? 'tt-green' : 'tt-red'}">${esc(line)}</div>` +
    `<div class="tt-sub">${esc(header)}</div>`
  );
}

/** The comparison for a hovered `item`, or undefined when it has no slot.
 *  `candidateInstance` is the hovered COPY's own payload (the bag cell's
 *  instance) when the caller has one: the deltas then compare merged def +
 *  rolled stats on BOTH sides, so a per-copy bake on either copy moves the
 *  numbers the way the swap really would. */
export function itemCompareMarks(
  item: ItemDef,
  source: CompareEquipmentSource,
  lookup: (id: string) => ItemDef | undefined,
  candidateInstance?: ItemInstancePayload,
): ItemCompareMarks | undefined {
  if (!item.slot) return undefined;
  // One column per worn piece the hovered copy would replace.
  const columns: Array<{ slot: EquipSlot; deltas: Map<CompareStat, StatDelta> }> = [];
  for (const slot of compareSlots(item)) {
    const equippedId = source.equipment[slot];
    const equipped = equippedId ? lookup(equippedId) : undefined;
    if (!equippedId || !equipped) continue;
    // Never compare a copy against itself (the paperdoll hovering the worn
    // slot): a different item id always compares, and a same-id Rift copy
    // only compares when it genuinely differs from the worn one.
    const worn = source.instances?.[slot];
    if (!shouldCompareCopies(item.id, equippedId, candidateInstance, worn)) continue;
    const deltas = itemStatDeltas(item, equipped, candidateInstance, worn);
    columns.push({ slot, deltas: new Map(deltas.map((d) => [d.stat, d])) });
  }
  const pending = new Set<CompareStat>(columns.flatMap((c) => [...c.deltas.keys()]));
  const wrap = columns.length > 1 ? 'tt-deltas tt-deltas-2' : 'tt-deltas';
  const cells = (stat: CompareStat) =>
    ` <span class="${wrap}">${columns.map((c) => deltaCellHtml(c.deltas.get(stat))).join('')}</span>`;
  const target = swapSlot(item, source);
  const setChanges = target ? setTierChangesOnSwap(source.equipment, target, item.id) : [];
  return {
    headHtml() {
      if (columns.length < 2) return '';
      const heads = columns
        .map((c) => {
          const n = formatNumber(c.slot === 'ring1' ? 1 : 2, { maximumFractionDigits: 0 });
          return `<span class="tt-delta">${esc(t('itemUi.tooltip.compareRingColumn', { n }))}</span>`;
        })
        .join('');
      return `<div class="tt-sub tt-row tt-delta-head"><span></span> <span class="${wrap}">${heads}</span></div>`;
    },
    take(stat) {
      return pending.delete(stat) ? cells(stat) : '';
    },
    restHtml() {
      let html = '';
      for (const stat of [...pending]) {
        const label = esc(t(compareStatLabelKey(stat) as TranslationKey));
        html += `<div class="tt-sub tt-row"><span>${label}</span>${cells(stat)}</div>`;
        pending.delete(stat);
      }
      return html;
    },
    footerHtml() {
      let html = setChanges.map(setChangeHtml).join('');
      // A same-for-same swap says so instead of looking like no comparison ran.
      if (!html && columns.length > 0 && columns.every((c) => c.deltas.size === 0)) {
        html = `<div class="tt-sub">${esc(t('itemUi.tooltip.noStatChanges'))}</div>`;
      }
      return html;
    },
  };
}
