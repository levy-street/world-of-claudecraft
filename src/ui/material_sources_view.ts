// The tooltip model for a material stack's per-unit provenance: who gathered
// which units, how many units nobody recorded, and which of them carry a
// premium signature. Pure and DOM-free; item_instance_tooltip.ts renders it.
//
// The rules this leaf exists to hold, all of which a naive "group by name"
// would break:
//
//   * ONE ROW PER DESCRIPTOR, never a fold. The composition arrives already
//     coalesced by the shared algebra, and this adds no second grouping of its
//     own. Two snapshots of one person (same stable id, an older display name)
//     stay two rows, because merging them would invent a rename history nobody
//     recorded; two different people who share a display name also stay two
//     rows, because merging them would collapse distinct identities behind one
//     label. The canonical descriptor key rides along on every row so a caller
//     can act on the exact bucket it displayed.
//   * COUNTS ARE THE SURVIVING UNITS. Nothing is capped, truncated, folded into
//     an "others" bucket, or dropped for being small: a contributor list is
//     history, and a display that quietly loses part of it is wrong rather than
//     tidy. A long list is the caller's layout problem, not this model's.
//   * A GATHERER IS NOT A SIGNATURE. Recorded provenance never implies the
//     premium crafting benefit; `premium` is decided solely by the legacy
//     signer the shared algebra already isolates. Legacy signer-only stock has
//     NO gatherer, so it reads as unrecorded units that carry the marker, which
//     is exactly what it is: nobody recorded who gathered them.
//
// Names here are RAW player text (a historic display-name snapshot). They are
// never looked up, never resolved against a live profile, and carry no account
// data; the renderer escapes them.

import { isMaterialItemId } from '../sim/material_ids';
import {
  isPremiumMaterialSource,
  legacyMaterialComposition,
  type MaterialComposition,
  type MaterialSource,
  type MaterialSourceCount,
  materialSourceKey,
  totalMaterialCount,
} from '../sim/material_sources';
import type { InvSlot } from '../sim/types';

/** One displayed bucket. `kind` decides the wording, `premium` the marker. */
export interface MaterialSourceRow {
  /** `gatherer` when someone was recorded; `unrecorded` when nobody was. */
  readonly kind: 'gatherer' | 'unrecorded';
  /** The gatherer's historic display-name snapshot, or the signer's name on an
   *  unrecorded premium row. Empty when there is no name to show at all. */
  readonly name: string;
  /** Surviving units in this bucket: never rounded, never clamped. */
  readonly count: number;
  /** Carries a premium signature (the legacy crafting benefit), independent of
   *  whether a gatherer was recorded. */
  readonly premium: boolean;
  /** Signature owner when this bucket carries the premium crafting benefit. */
  readonly signer: string;
  /** The canonical descriptor key: the SELECTION identity, kept beside the
   *  display so acting on a row cannot drift from what the row showed. */
  readonly key: string;
}

export interface MaterialSourceSummary {
  /** Every bucket, in the composition's own canonical order. */
  readonly rows: readonly MaterialSourceRow[];
  /** Units the rows account for; equals the stack quantity for a valid stack. */
  readonly total: number;
  /** More than one descriptor is present, so no single whole-stack line could
   *  describe this stack truthfully. */
  readonly mixed: boolean;
  /** Units carrying a premium signature, summed across rows. */
  readonly premiumUnits: number;
}

function rowFor(source: MaterialSource, count: number): MaterialSourceRow {
  const premium = isPremiumMaterialSource(source);
  const key = materialSourceKey(source);
  if (source.gatherer !== undefined) {
    return {
      kind: 'gatherer',
      name: source.gatherer.name,
      count,
      premium,
      signer: source.signer ?? '',
      key,
    };
  }
  // No gatherer: the units are unrecorded whatever else the descriptor holds.
  // A legacy signer names the SIGNER on this row rather than pretending to name
  // a gatherer, so the premium marker lands on the right units and no
  // attribution is invented for stock nobody recorded.
  return {
    kind: 'unrecorded',
    name: premium ? (source.signer ?? '') : '',
    count,
    premium,
    signer: source.signer ?? '',
    key,
  };
}

/**
 * The tooltip model for a stack's composition, or null when there is nothing to
 * show (no composition at all, or an empty one).
 *
 * Rows are emitted for every bucket with a positive count, in the order the
 * composition already carries. Buckets are not re-sorted: the algebra's
 * canonical order is stable across machines and hosts, and a display-side
 * re-sort would be a second ordering rule to keep in step with it.
 */
export function materialSourceSummary(
  sources: MaterialComposition | undefined,
): MaterialSourceSummary | null {
  if (sources === undefined || sources.length === 0) return null;
  const rows: MaterialSourceRow[] = [];
  let premiumUnits = 0;
  for (const bucket of sources) {
    if (!Number.isFinite(bucket.count) || bucket.count <= 0) continue;
    const row = rowFor(bucket.source, bucket.count);
    rows.push(row);
    if (row.premium) premiumUnits += row.count;
  }
  if (rows.length === 0) return null;
  return {
    rows,
    total: totalMaterialCount(sources),
    mixed: rows.length > 1,
    premiumUnits,
  };
}

/** The slot fields this projection reads. Every owned-stack surface has these,
 *  whatever else its row model carries. */
export interface MaterialSourceSlot {
  readonly itemId: string;
  readonly count: number;
  readonly instance?: InvSlot['instance'];
  readonly materialSources?: MaterialComposition;
}

/**
 * The composition a tooltip should DISPLAY for a slot: the recorded one when it
 * has one, and otherwise a lossless projection of a LEGACY material stack.
 *
 * This is the one place the legacy shape is read, so every surface answers
 * identically. A material stack saved before provenance existed carries its
 * signer on the payload and no composition at all; projecting it through the
 * shared `legacyMaterialComposition` turns it into what it truthfully is, units
 * whose gatherer nobody recorded, which then render as "No gatherer recorded"
 * with the signer named as the signer. Reading the payload signer as a GATHERER
 * instead would invent an attribution the save never held, and that is exactly
 * the misleading whole-stack line this replaces.
 *
 * The signer is read on PRESENCE of a non-empty string, never on the payload's
 * truthiness: the anonymous-pipe display trim (`publicInstanceView`) can hand a
 * surface an EMPTY payload object, which is truthy and carries nothing, and an
 * empty-string signer is a legal legacy value that conveys nothing either.
 *
 * NON-MATERIAL items return undefined and keep their old behavior exactly: the
 * classic maker's mark still renders for them, unchanged.
 */
export function materialSourcesForDisplay(
  slot: MaterialSourceSlot | undefined,
): MaterialComposition | undefined {
  if (slot === undefined) return undefined;
  if (slot.materialSources !== undefined && slot.materialSources.length > 0) {
    return slot.materialSources;
  }
  if (!isMaterialItemId(slot.itemId)) return undefined;
  const signer = slot.instance?.signer;
  if (typeof signer !== 'string' || signer.length === 0) return undefined;
  const projected = legacyMaterialComposition(slot.count, signer);
  // A refusal (a count the algebra will not read) shows nothing rather than a
  // wrong line; the stack still renders every other tooltip fact it carries.
  return projected.ok ? projected.value : undefined;
}

/**
 * Should the legacy whole-stack maker's mark be suppressed for this stack?
 *
 * Yes whenever a composition renders. On a MIXED stack the old line is actively
 * misleading (it names one signer for units that came from several people); on
 * a single-bucket stack it is merely a second, less precise copy of the row
 * already shown. Either way the per-unit rows are the truth, so the caller
 * drops the old line rather than printing both.
 */
export function suppressesLegacyGatheredLine(summary: MaterialSourceSummary | null): boolean {
  return summary !== null;
}

/**
 * How many descriptor rows a hover TOOLTIP prints before it summarizes the
 * rest. A tooltip is a fixed box a player reads at a glance, and a stack that
 * passed through a guild bank can legitimately carry dozens of contributors, so
 * an unbounded list would grow past the viewport and bury every other line the
 * item carries.
 *
 * This bounds a DISPLAY, never the data: the rows it leaves out are counted
 * exactly (both the descriptors and their units), and the full list is one
 * action away in the source picker, which caps nothing. Nothing is ever folded
 * into an "others" bucket, rounded, or dropped.
 */
export const TOOLTIP_SOURCE_ROW_LIMIT = 5;

export interface BoundedMaterialSourceView {
  /** The rows to print, in the composition's canonical order. */
  readonly rows: readonly MaterialSourceRow[];
  /** Descriptors the bound left out. Zero when every row is printed. */
  readonly hiddenSources: number;
  /** Units those left-out descriptors hold, summed exactly. */
  readonly hiddenUnits: number;
}

/**
 * The first `limit` rows of a summary plus the EXACT tally of what the bound
 * left out, for a surface that cannot grow (the hover tooltip).
 *
 * A non-positive or non-integer limit prints everything rather than inventing a
 * bound: a caller that cannot say how much room it has gets the truth, and the
 * one thing this must never do is silently hide rows nobody counted.
 */
export function boundedMaterialSourceRows(
  summary: MaterialSourceSummary | null,
  limit: number = TOOLTIP_SOURCE_ROW_LIMIT,
): BoundedMaterialSourceView | null {
  if (summary === null) return null;
  if (!Number.isSafeInteger(limit) || limit <= 0 || summary.rows.length <= limit) {
    return { rows: summary.rows, hiddenSources: 0, hiddenUnits: 0 };
  }
  const rows = summary.rows.slice(0, limit);
  const hidden = summary.rows.slice(limit);
  let hiddenUnits = 0;
  for (const row of hidden) hiddenUnits += row.count;
  return { rows, hiddenSources: hidden.length, hiddenUnits };
}

/** One bucket a player can inspect and, on a surface that offers it, choose
 *  units from: the displayed row beside the DESCRIPTOR it was built from, so a
 *  chosen quantity names the exact bucket the row showed. */
export interface MaterialSourceChoice {
  readonly row: MaterialSourceRow;
  readonly source: MaterialSource;
  /** Position in normalizeMaterialStack's canonical source array. This is the
   * compact command identity used by storage transfers. */
  readonly sourceIndex: number;
}

/**
 * Every bucket of a composition as an inspectable choice, in canonical order.
 * The full list, always: this is what the picker renders, and it caps nothing.
 */
export function materialSourceChoices(
  sources: MaterialComposition | undefined,
): readonly MaterialSourceChoice[] {
  if (sources === undefined) return [];
  const out: MaterialSourceChoice[] = [];
  for (const [sourceIndex, bucket] of sources.entries()) {
    if (!Number.isFinite(bucket.count) || bucket.count <= 0) continue;
    out.push({ row: rowFor(bucket.source, bucket.count), source: bucket.source, sourceIndex });
  }
  return out;
}

export interface SelectedMaterialSources {
  /** Descriptor-preserving composition for the bags-only separation command. */
  readonly sources: MaterialComposition;
  /** Canonical indexes for bank, guild bank, and vault transfer commands. */
  readonly quantities: readonly { readonly sourceIndex: number; readonly count: number }[];
  readonly count: number;
}

/**
 * The composition a player's per-row quantities describe, or null when the
 * request is not one this may send.
 *
 * Refuses rather than clamps, on every dimension: a quantity that is not a safe
 * integer, a negative one, one past the units that row actually holds, a key
 * naming no displayed row, and a request that selects nothing at all. A clamp
 * would send a command the player did not ask for, and the whole point of an
 * explicit selection is that the units taken are exactly the units chosen.
 *
 * Zero-quantity rows are simply absent from the result (a row nobody asked for
 * is not a selection of zero units, which the algebra refuses as a bucket).
 * The authoritative host revalidates the whole request against its own bags.
 */
export function selectedMaterialComposition(
  choices: readonly MaterialSourceChoice[],
  quantities: ReadonlyMap<number, number>,
): SelectedMaterialSources | null {
  const knownIndexes = new Set(choices.map((choice) => choice.sourceIndex));
  for (const sourceIndex of quantities.keys()) {
    if (!knownIndexes.has(sourceIndex)) return null;
  }
  const out: MaterialSourceCount[] = [];
  const selected: { sourceIndex: number; count: number }[] = [];
  let total = 0;
  for (const choice of choices) {
    const count = quantities.get(choice.sourceIndex) ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > choice.row.count) return null;
    if (count === 0) continue;
    out.push({ source: choice.source, count });
    selected.push({ sourceIndex: choice.sourceIndex, count });
    total += count;
  }
  if (out.length === 0) return null;
  return { sources: out, quantities: selected, count: total };
}

/**
 * How many distinct PEOPLE a composition records, counting every unrecorded
 * bucket as one shared group.
 *
 * Mirrors the grouping key the authoritative separation uses
 * (`src/sim/material_stack_separation.ts` gathererGroups: the gatherer's
 * namespace plus its stable id, never the display-name snapshot), so the menu
 * offers the action exactly when the command would produce more than one stack.
 * This is an ELIGIBILITY hint only; the host regroups and refuses on its own.
 */
export function materialSourceGroupCount(sources: MaterialComposition | undefined): number {
  if (sources === undefined) return 0;
  const groups = new Set<string>();
  for (const bucket of sources) {
    if (!Number.isFinite(bucket.count) || bucket.count <= 0) continue;
    const gatherer = bucket.source.gatherer;
    groups.add(gatherer === undefined ? '' : JSON.stringify([gatherer.kind, String(gatherer.id)]));
  }
  return groups.size;
}

/** Would separating this stack by gatherer actually produce more than one
 *  stack? False for a single-contributor stack, where the command is a no-op
 *  the menu should not offer. */
export function separableMaterialSources(sources: MaterialComposition | undefined): boolean {
  return materialSourceGroupCount(sources) > 1;
}
