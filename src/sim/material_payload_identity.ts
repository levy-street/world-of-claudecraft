// The canonical PAYLOAD identity of a normalized material slot (the stable key a
// source ledger groups, orders and journals by) plus the ONE safe payload clone
// this and material_stack.ts share.
//
// Identity is the item id, the plain-stack `craftedRecipeId` marker and the whole
// instance payload, unknown persisted fields included. Never `count`,
// `materialSources`, `materialSeparated` or the bag cell: those are what a ledger
// sums, not what it groups by.
//
// The key agrees with item_instance_merge's structural equality (key order
// independent, an explicitly `undefined` key reads as absent, an absent payload
// never equals a present one, an array reads as its index map), so a ledger entry
// and a stacking decision can never disagree.
//
// Scoped to the acyclic JSON data JSONB round-trips; `NaN` and cycles are out of
// contract. Pure: no rng, clock, DOM or player-facing text.

import type { ItemInstancePayload } from './types';

/**
 * The identity half of a normalized material slot. A `MaterialStackSlot`
 * satisfies it structurally, so callers pass the slot itself.
 */
export interface MaterialPayloadIdentity {
  readonly itemId: string;
  readonly instance?: ItemInstancePayload;
  readonly craftedRecipeId?: string;
}

// Length-prefixed so no field boundary is ambiguous (the material_sources.ts
// convention): an id of 'a' with name 'bc' cannot encode as 'ab' with 'c'.
const part = (text: string): string => `${text.length}:${text}`;

/** Binary lexical order; never localeCompare, which would reorder journals
 *  between machines. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Type-tagged, so a string never encodes as the number that spells it. */
function encodeValue(value: unknown): string {
  if (value === null) return 'z';
  if (value === undefined) return 'u';
  switch (typeof value) {
    case 'string':
      return `s${part(value)}`;
    case 'number':
      return `n${part(String(value))}`;
    case 'boolean':
      return value ? 'b1' : 'b0';
    case 'object':
      return `o${part(encodeRecord(value as Record<string, unknown>))}`;
    default:
      // Not JSON-shaped data (function, symbol, bigint): out of contract, tagged
      // rather than silently read as an empty object.
      return `x${part(typeof value)}`;
  }
}

/** OWN enumerable keys only, sorted, undefined-valued keys dropped: property
 *  order cannot change the key and an explicit `undefined` reads as absent.
 *  Arrays take this path too (their own keys are their indices), which keeps
 *  order identity while matching structurallyEqual. */
function encodeRecord(record: Record<string, unknown>): string {
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  keys.sort(compare);
  let out = '';
  for (const key of keys) out += `${part(key)}${encodeValue(record[key])}`;
  return out;
}

/**
 * The canonical identity of a NORMALIZED material slot: two slots share a key
 * exactly when they carry the same item, the same crafted-recipe marker and
 * structurally equal payloads, whatever their quantity, composition, grouping
 * choice or bag cell.
 */
export function materialPayloadKey(identity: MaterialPayloadIdentity): string {
  const crafted = identity.craftedRecipeId === undefined ? '-' : part(identity.craftedRecipeId);
  const payload = identity.instance === undefined ? '-' : encodeValue(identity.instance);
  return `${part(identity.itemId)}${crafted}${payload}`;
}

function cloneData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneData(entry));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    // Object.fromEntries DEFINES each key as an own data property. Assigning
    // `out[key] = ...` would SET it, so an own '__proto__' key (JSON.parse mints
    // one, an object literal never does) would hit Object.prototype's accessor:
    // the key would vanish from the copy and the copy's prototype would move
    // with it. Nothing is dropped, renamed or special-cased.
    return Object.fromEntries(
      Object.keys(record).map((key): [string, unknown] => [key, cloneData(record[key])]),
    );
  }
  return value;
}

/**
 * A structural copy of payload DATA, unknown fields included, so no consumer
 * aliases the slot it read from. The shared `cloneItemInstancePayload` deep
 * copies only the fields it knows, which is what this walk closes.
 */
export function cloneMaterialData<T>(value: T): T {
  return cloneData(value) as T;
}

export const cloneMaterialPayload = (payload: ItemInstancePayload): ItemInstancePayload =>
  cloneMaterialData(payload);
