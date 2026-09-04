// Aura state snapshot: what a gained aura event ships beyond its identity.
//
// The sim's Aura object carries the mechanic's working state (value, value2,
// kind, school, a tether partner, ...) and the aura EVENT carries none of it,
// which is how the Ignivar Chains partner (value2) went unrecorded while the
// renderer drew it every tick. Rather than hand-pick fields (the gap simply
// moves to the next new field), the recorder snapshots EVERY scalar field on
// the live aura at application and omits a typed denylist. A field added to
// `Aura` therefore reaches the parse with no recorder change; a field that
// must NOT ship is an explicit decision here, checked against the Aura type
// so a rename cannot silently reopen the gap.
import type { Aura } from '../../src/sim/types';
import type { AuraStateSnapshot } from './contract';

/**
 * Never snapshotted: identity the enrichment already carries beside the
 * snapshot (auraId / auraSourceId / auraStacks), and per-tick countdowns or
 * accruals whose value at application is either the duration (already
 * shipped) or zero.
 */
export const AURA_STATE_OMIT: ReadonlySet<keyof Aura> = new Set<keyof Aura>([
  'id',
  'name',
  'sourceId',
  'stacks',
  'remaining',
  'tickTimer',
  'damageAccrued',
  'icd',
]);

/** Defensive bounds: an aura is a handful of scalars, never a payload. */
export const MAX_AURA_STATE_FIELDS = 32;
export const MAX_AURA_STATE_STRING = 64;

/**
 * Scalar (number / string / boolean) fields of a live aura, minus the omit
 * list, in the object's own key order (stable per construction site, which
 * keeps golden captures byte-identical). Undefined when nothing remains.
 */
export function auraStateSnapshot(aura: object): AuraStateSnapshot | undefined {
  let out: AuraStateSnapshot | undefined;
  let count = 0;
  for (const [key, value] of Object.entries(aura)) {
    if (AURA_STATE_OMIT.has(key as keyof Aura)) continue;
    let scalar: number | string | boolean;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      scalar = value;
    } else if (typeof value === 'string') {
      scalar = value.length > MAX_AURA_STATE_STRING ? value.slice(0, MAX_AURA_STATE_STRING) : value;
    } else if (typeof value === 'boolean') {
      scalar = value;
    } else {
      continue;
    }
    if (count >= MAX_AURA_STATE_FIELDS) break;
    out ??= {};
    out[key] = scalar;
    count++;
  }
  return out;
}
