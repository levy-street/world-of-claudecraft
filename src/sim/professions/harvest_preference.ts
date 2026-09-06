// The remembered corpse-harvest preference (Intentional Gathering, PR3): ONE
// per-character setting saying which material a harvest concentrates on, and
// the resolution of that setting against one body's tags.
//
// Pure leaf in the shape of gathering_materials.ts: it reads the canonical
// HARVEST_COMPONENT_ITEMS content table and imports nothing from gathering.ts,
// so a picker, a command boundary or a load path can consult a preference
// without pulling the gather command body into its module graph. No rng, no
// clock, no I/O, no state; it never mutates a caller's array or preference.
//
// Two contracts hold everything else together:
//  - A preference names an ordinary MATERIAL ITEM ID, never a tag, a display
//    label, a specimen id or a subset of tags. That is what makes horn and tusk
//    (both curved_tusk) one choice, and what lets one choice resolve to every
//    tag on a body that yields it.
//  - This module decides NO yield. A resolution returns the `chosen` argument
//    the canonical path already takes (effectiveFocusComponents,
//    yieldingFocusComponents, harvestConcentrationBonus,
//    resolveCorpseFocusHarvest in gathering.ts), and All resolves to the EMPTY
//    pick, which is that path's existing spread. Tier, quantity and the
//    concentration tradeoff stay where they are.

import { HARVEST_COMPONENT_ITEMS } from '../content/professions';

/** The wire/command token for "All materials"; no material id can collide. */
export const HARVEST_PREFERENCE_ALL_TOKEN = 'all';

export type HarvestPreference =
  | { readonly kind: 'all' }
  | { readonly kind: 'material'; readonly itemId: string };

/** The default for new and existing characters. */
export const HARVEST_PREFERENCE_ALL: HarvestPreference = Object.freeze({ kind: 'all' as const });

/** One displayed choice: the material item id a preference stores, plus every
 *  supported tag on that side of it (horn and tusk share one row). */
export interface HarvestMaterialOption {
  readonly itemId: string;
  readonly components: readonly string[];
}

export type HarvestPreferenceOption =
  | { readonly kind: 'all' }
  | ({ readonly kind: 'material' } & HarvestMaterialOption);

export type HarvestPreferenceResolution =
  /** Spread across the body: the empty pick, the canonical default. */
  | { readonly kind: 'all'; readonly chosenComponents: readonly string[] }
  /** Concentrate on one material: every tag on THIS body yielding it. */
  | {
      readonly kind: 'material';
      readonly itemId: string;
      readonly chosenComponents: readonly string[];
    }
  /** The stored material is not on this body (or is no longer supported at
   *  all). Explicit, and never widened to All: an unavailable selection
   *  refuses before any cast, claim, spend or rng draw. `available` is what
   *  this body does offer, so the refusal can name it. */
  | {
      readonly kind: 'unavailable';
      readonly itemId: string;
      readonly available: readonly HarvestMaterialOption[];
    };

/** `malformed`: not a string. `unsupported`: a string naming no supported
 *  material (a tag, a specimen id, an unknown id, an inherited Object key).
 *  Both refuse; neither becomes All, so a bad command leaves the stored
 *  preference where the player left it. */
export type HarvestPreferenceCommand =
  | { readonly ok: true; readonly preference: HarvestPreference }
  | { readonly ok: false; readonly reason: 'malformed' | 'unsupported' };

/** A load either yields the preference to act on, or refuses. There is no
 *  third state: a refusal must NOT hand back an active All, because acting on
 *  All gathers exactly the materials the player chose to leave behind. */
export type LoadedHarvestPreference =
  | { readonly ok: true; readonly preference: HarvestPreference }
  | { readonly ok: false; readonly reason: 'malformed' };

/** The stored-id shape bound, the `MAX_INSTANCE_STRING_LENGTH` rule of
 *  item_instance_load.ts restated locally rather than imported, so this leaf
 *  keeps its light module graph: no real item id approaches 64 characters, so
 *  anything longer, empty, or outside printable non-space ASCII had no legal
 *  writer. Checked, never truncated: a bounded id is kept verbatim. */
const MAX_STORED_MATERIAL_ID_LENGTH = 64;
const STORED_MATERIAL_ID_SHAPE = /^[\x21-\x7e]+$/;

/** Shared by the All arm and by a body with no yielding tag, so no caller can
 *  mutate an empty pick into somebody else's answer. */
const NO_COMPONENTS: readonly string[] = Object.freeze([]);

/** The one read of the yield table: `Object.hasOwn` (an inherited key is not a
 *  family) then TRUTHINESS (a family mapped to '' yields nothing anywhere),
 *  the rule gathering.ts's harvestItemForFamily states. */
function materialIdFor(component: string): string | undefined {
  const itemId = Object.hasOwn(HARVEST_COMPONENT_ITEMS, component)
    ? HARVEST_COMPONENT_ITEMS[component]
    : undefined;
  return itemId ? itemId : undefined;
}

/** Deduplicated material rows for a component list, in the list's own order,
 *  first occurrence winning. Tags are deduped (a repeated tag must never be a
 *  second row, nor downstream a second grant off one single-use claim) and a
 *  family with no item behind it is dropped. */
function materialOptionsFor(components: readonly string[]): HarvestMaterialOption[] {
  const byItemId = new Map<string, string[]>();
  for (const component of new Set(components)) {
    const itemId = materialIdFor(component);
    if (!itemId) continue;
    const row = byItemId.get(itemId);
    if (row) row.push(component);
    else byItemId.set(itemId, [component]);
  }
  return [...byItemId].map(([itemId, tags]) => ({ itemId, components: tags }));
}

function isSupportedMaterialId(itemId: string): boolean {
  for (const component of Object.keys(HARVEST_COMPONENT_ITEMS)) {
    if (materialIdFor(component) === itemId) return true;
  }
  return false;
}

function isBoundedMaterialId(value: string): boolean {
  return value.length <= MAX_STORED_MATERIAL_ID_LENGTH && STORED_MATERIAL_ID_SHAPE.test(value);
}

/** Every material a corpse harvest can be pointed at, one row per material item
 *  id: the general picker's list, fresh per call. */
export function generalHarvestMaterialOptions(): readonly HarvestMaterialOption[] {
  return materialOptionsFor(Object.keys(HARVEST_COMPONENT_ITEMS));
}

/** This body's picker: All, then just the families it supports. A
 *  carried-but-unmapped family is no choice (it extracts nothing); refusing an
 *  unharvestable corpse outright stays isHarvestableCorpse's job. */
export function corpseHarvestPreferenceOptions(
  taggedComponents: readonly string[],
): readonly HarvestPreferenceOption[] {
  const materials = materialOptionsFor(taggedComponents).map((option) => ({
    kind: 'material' as const,
    ...option,
  }));
  return [{ kind: 'all' }, ...materials];
}

/** Validate a preference arriving as a COMMAND: strict, because this is where a
 *  new choice is made. Prototype-safe by construction (the supported set is
 *  built from the table's own values). */
export function parseHarvestPreferenceCommand(raw: unknown): HarvestPreferenceCommand {
  if (typeof raw !== 'string') return { ok: false, reason: 'malformed' };
  if (raw === HARVEST_PREFERENCE_ALL_TOKEN) {
    return { ok: true, preference: HARVEST_PREFERENCE_ALL };
  }
  if (!isSupportedMaterialId(raw)) return { ok: false, reason: 'unsupported' };
  return { ok: true, preference: { kind: 'material', itemId: raw } };
}

/**
 * Load a persisted preference. Absent alone (or the explicit All token) is
 * the legacy default, All: a pre-feature save has no key at all, which is
 * what `undefined` means here. JSON `null` is NOT the legacy case: it is
 * what `savedHarvestPreference` writes back for an already-malformed live
 * preference, so a load must refuse it exactly like any other malformed
 * value rather than reviving it into an active All (that would silently
 * gather the materials a refused, unresolved preference was withholding).
 * A stored material id that satisfies the shape bound is KEPT as the choice
 * even when current content no longer supports it: resolution then refuses
 * on every body (`unavailable`) and the save writes the same id back, so the
 * player's choice survives an update or a reconnect until they change it.
 * Anything else refuses, and the refusal carries no copy of the offending
 * value.
 */
export function loadHarvestPreference(saved: unknown): LoadedHarvestPreference {
  if (saved === undefined) {
    return { ok: true, preference: HARVEST_PREFERENCE_ALL };
  }
  if (typeof saved !== 'string') return { ok: false, reason: 'malformed' };
  if (saved === HARVEST_PREFERENCE_ALL_TOKEN) {
    return { ok: true, preference: HARVEST_PREFERENCE_ALL };
  }
  if (!isBoundedMaterialId(saved)) return { ok: false, reason: 'malformed' };
  return { ok: true, preference: { kind: 'material', itemId: saved } };
}

/** The save form: sparse, so the default costs no bytes and a pre-feature save
 *  and an explicit All read the same. `null` in, `null` out: there is no live
 *  `HarvestPreference` value for "malformed", so a caller holding a refused
 *  load's `null` in place of an active preference must be able to save it
 *  back verbatim, which is what keeps a malformed preference refused across
 *  repeated saves until an explicit valid command replaces it. Paired with
 *  loadHarvestPreference; a second encoding at a call site is the drift this
 *  pair prevents. */
export function savedHarvestPreference(
  preference: HarvestPreference | null,
): string | null | undefined {
  if (preference === null) return null;
  return preference.kind === 'material' ? preference.itemId : undefined;
}

/**
 * Resolve a preference against one body's tags into the pick the canonical
 * harvest path takes. All spreads (the empty pick). A material resolves to
 * every tag on this body that yields it, in the body's tag order, which is the
 * order the yields, grants and ledger entries land in. A material this body
 * does not carry is refused, never spread: spreading a harvest the player asked
 * to concentrate would spend the corpse's single-use claim on materials they
 * deliberately declined.
 */
export function resolveHarvestPreferenceOnCorpse(
  taggedComponents: readonly string[],
  preference: HarvestPreference,
): HarvestPreferenceResolution {
  if (preference.kind === 'all') return { kind: 'all', chosenComponents: NO_COMPONENTS };
  const available = materialOptionsFor(taggedComponents);
  const match = available.find((option) => option.itemId === preference.itemId);
  if (!match) return { kind: 'unavailable', itemId: preference.itemId, available };
  return { kind: 'material', itemId: match.itemId, chosenComponents: match.components };
}
