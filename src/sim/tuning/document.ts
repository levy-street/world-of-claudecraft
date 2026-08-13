// The class power tuning DOCUMENT: the sparse, per-realm record of which
// ability channels an operator has moved off neutral, plus the one validator
// every write and every load runs through.
//
// The document is the only thing persisted. It is sparse on purpose: an
// untouched channel carries no row, so a realm that has never been tuned stores
// `{}` and the apply path is a no-op that returns the shipped ability table
// unchanged.
//
// Pure leaf: no SimContext, no rng, no clock, no IO.

import {
  clampTuningFactor,
  isNeutralFactor,
  isTuningChannel,
  type TuningChannel,
  WEAPON_TUNING_CHANNELS,
} from './channels';

export const CLASS_TUNING_VERSION = 1;

export type AbilityTuning = Partial<Record<TuningChannel, number>>;
/** Same shape; separate name because the WEAPON scope only ever uses the two swing channels. */
export type WeaponTuning = Partial<Record<TuningChannel, number>>;

export interface ClassTuningDocument {
  version: number;
  /** ability id -> the channels moved off neutral for it */
  abilities: Record<string, AbilityTuning>;
  /**
   * Weapon id -> its auto-attack ("white") channels. Keyed by ITEM id for a
   * carried weapon, and by `class_<cls>_ranged` for the per-class ranged
   * profile a hunter's Auto Shot and a caster's wand swing with.
   */
  weapons: Record<string, WeaponTuning>;
}

// Bounds on a stored document. Both are far above any real tuning pass; they
// exist so a malformed or hostile body cannot grow the realm's JSONB row
// without limit.
export const MAX_TUNED_ABILITIES = 2000;
export const MAX_TUNED_WEAPONS = 2000;
const ENTRY_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

// Ids that collide with Object.prototype members. The content tables are plain
// objects, so a lookup like `ABILITIES['constructor']` answers TRUTHY through
// the prototype chain: a stored row keyed on one would read as "shipped" at
// install time and then detonate inside the walker at every boot until someone
// hand-edited the database row. The install path also guards its lookups with
// Object.hasOwn, but a document must never be able to store one at all.
const RESERVED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  'constructor',
  '__proto__',
  'prototype',
]);

/**
 * Whether an ability or weapon id can be STORED in a document at all.
 *
 * Exported because it is a real constraint on content, not just on input: an id
 * this rejects would get a slider in the catalog that could never persist, so
 * the coverage guard walks every live id through it.
 */
export function isTunableEntryId(entryId: string): boolean {
  return ENTRY_ID_PATTERN.test(entryId) && !RESERVED_ENTRY_IDS.has(entryId);
}

export function emptyClassTuningDocument(): ClassTuningDocument {
  return { version: CLASS_TUNING_VERSION, abilities: {}, weapons: {} };
}

export function isEmptyClassTuningDocument(doc: ClassTuningDocument): boolean {
  return Object.keys(doc.abilities).length === 0 && Object.keys(doc.weapons).length === 0;
}

/**
 * Normalize any untrusted value into a document the apply path can run.
 *
 * Never throws and never rejects the whole document over one bad row: an
 * unknown channel, an unparseable factor, or a malformed ability id is dropped
 * and the rest is kept. A stored document that has rotted (an ability retired
 * since it was written) must not be able to keep a realm from booting, and a
 * dashboard save must not be able to smuggle an unbounded blob into Postgres.
 *
 * Neutral factors are dropped rather than stored, so "has this ability been
 * tuned" is answerable by key presence alone.
 */
export function sanitizeClassTuningDocument(input: unknown): ClassTuningDocument {
  const doc = emptyClassTuningDocument();
  const root = asRecord(input);
  if (!root) return doc;

  doc.abilities = sanitizeScope(root.abilities, MAX_TUNED_ABILITIES);
  // The weapon walker applies exactly the two swing channels, so the weapon
  // scope stores nothing else: any other channel on a weapon row would be an
  // inert factor that inflates the tuned counts while moving nothing.
  doc.weapons = sanitizeScope(root.weapons, MAX_TUNED_WEAPONS, WEAPON_TUNING_CHANNELS);
  return doc;
}

/** One scope's id-to-channel map, dropping every row it cannot trust. */
function sanitizeScope(
  input: unknown,
  maxEntries: number,
  allowedChannels?: ReadonlySet<TuningChannel>,
): Record<string, AbilityTuning> {
  const out: Record<string, AbilityTuning> = {};
  const entries = asRecord(input);
  if (!entries) return out;

  let kept = 0;
  for (const entryId of Object.keys(entries).sort()) {
    if (kept >= maxEntries) break;
    if (!isTunableEntryId(entryId)) continue;
    const channels = asRecord(entries[entryId]);
    if (!channels) continue;

    const tuning: AbilityTuning = {};
    let any = false;
    for (const channel of Object.keys(channels).sort()) {
      if (!isTuningChannel(channel)) continue;
      if (allowedChannels !== undefined && !allowedChannels.has(channel)) continue;
      const raw = channels[channel];
      if (typeof raw !== 'number' && typeof raw !== 'string') continue;
      const factor = clampTuningFactor(raw);
      if (isNeutralFactor(factor)) continue;
      tuning[channel] = factor;
      any = true;
    }
    if (!any) continue;
    out[entryId] = tuning;
    kept++;
  }
  return out;
}

/** Stable serialization, so an unchanged save is detectable as unchanged. */
export function classTuningDocumentKey(doc: ClassTuningDocument): string {
  return JSON.stringify({
    version: doc.version,
    abilities: orderedScope(doc.abilities),
    weapons: orderedScope(doc.weapons),
  });
}

function orderedScope(scope: Record<string, AbilityTuning>): Record<string, AbilityTuning> {
  const out: Record<string, AbilityTuning> = {};
  for (const entryId of Object.keys(scope).sort()) {
    const tuning = scope[entryId];
    const ordered: AbilityTuning = {};
    for (const channel of Object.keys(tuning).sort() as TuningChannel[]) {
      ordered[channel] = tuning[channel];
    }
    out[entryId] = ordered;
  }
  return out;
}

/** How many individual channel knobs the document moves, across both scopes. */
export function countTunedChannels(doc: ClassTuningDocument): number {
  let total = 0;
  for (const tuning of Object.values(doc.abilities)) total += Object.keys(tuning).length;
  for (const tuning of Object.values(doc.weapons)) total += Object.keys(tuning).length;
  return total;
}

/** The stable document id for a class's own ranged (Auto Shot / wand) profile. */
export function classRangedWeaponId(cls: string): string {
  return `class_${cls}_ranged`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
