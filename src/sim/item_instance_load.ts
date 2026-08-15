// The load-side shape bound for a persisted per-instance item payload
// (`ItemInstancePayload`, types.ts). ONE sanitizer, six call sites: the
// equipment map, the carried bags and the vendor buyback rows (all in
// Sim.addPlayer), the bank inventory (bank.ts sanitizeBankState), and the
// two persisted escrow books (item_instance_transfer.ts sanitizeEscrowSlot
// for mail attachments and market collections, plus market.ts's listing
// arm). Phase 16's first cut clamped only `signer`, and only on two of the
// character containers, so a signed copy loaded through the bank or the
// buyback list kept an unbounded name, and every OTHER payload string
// stayed unbounded everywhere. A
// payload is JSONB this process wrote rather than something a client sent,
// but a hand-edited or corrupted row rides every autosave whole, forever:
// that is the growth this bound exists to stop, and it is the same
// shape-bound doctrine the recipe-id ceiling states
// (professions/training.ts MAX_KNOWN_RECIPE_ID_LENGTH).
//
// DROP-ONLY, never truncate and never rewrite: a truncated prefix can equal
// a DIFFERENT real value (the misattribution case the craftedBy rule in
// professions/tools.ts spells out), while an absent field is merely absent.
// Every junk key drops ALONE, so one corrupt field never takes the legal
// payload around it with it.
//
// NOT A WHITELIST, deliberately: an unknown key inside the size bounds
// SURVIVES. The payload is an ADDITIVE shape that has grown a field at a
// time since #1165, and the merge predicate (item_instance_merge.ts)
// compares EVERY present key on purpose, so a load that silently dropped a
// field this binary happens not to know about would let an older binary
// strip identity off a live copy.
//
// `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net import,
// no rng, no clock. Total on `unknown`, so a corrupt row can never throw
// inside a character load.

import { isLegalCrafterName } from './professions/tools';
import { MAX_KNOWN_RECIPE_ID_LENGTH } from './professions/training';
import type { ItemInstancePayload } from './types';

/**
 * The ceiling for every payload string EXCEPT `signer` (which answers to the
 * stricter name shape below). Ids, enchant ids and recipe ids are the real
 * population here and none of them approaches 64 characters, so anything
 * longer has no legal writer.
 */
export const MAX_INSTANCE_STRING_LENGTH = 64;

/**
 * The own-key ceiling for one payload. Sized well above the declared shape
 * because the forward-compatibility rule above admits unknown keys too, so
 * this catches only a row that has stopped being a payload at all rather
 * than one written by a newer binary.
 */
export const MAX_INSTANCE_PAYLOAD_KEYS = 24;

/** The sub-objects whose own keys are scanned one level down. Both are
 *  deep-copied by `cloneItemInstancePayload`, which is what makes it safe to
 *  delete keys inside them (see the ownership contract below); `rift` is
 *  deliberately NOT scanned, because its strings are already validated by
 *  the progression rebuild (rift/progression.ts). */
const SCANNED_SUB_OBJECT_KEYS: readonly string[] = ['rolled', 'charges'];

/**
 * The serialized-size ceiling for a NON-STRING value nested inside a scanned
 * sub-object (rolled.stats is the real population: a small record of stat
 * numbers, far under this). Bounds what the per-string rule cannot see: an
 * object smuggling unbounded bytes through nesting (rolled.stats.x.y...),
 * where each level individually passes every key and string arm. Measured on
 * the JSON the save path would write, so the ceiling bounds exactly the
 * growth the module exists to stop.
 */
export const MAX_INSTANCE_SUBTREE_JSON_LENGTH = 1024;

/**
 * The slot-LEVEL sibling of the payload bound: `InvSlot.craftedRecipeId` is a
 * persisted string on the same rows, kept on load by a bare typeof check, so
 * a hand-edited row could ride an unbounded marker forever (the round 4
 * finder). Same drop-only doctrine, same ceiling as every other recipe id
 * (MAX_KNOWN_RECIPE_ID_LENGTH); a dropped marker only costs the crafted
 * provenance the corrupt row could never legally have carried. Mutates the
 * caller-owned clone in place and reports through the same dropped-path
 * channel as the payload bound.
 */
export function boundCraftedRecipeIdOnLoad(
  slot: { itemId: string; craftedRecipeId?: unknown },
  dropped: string[],
  containerLabel: string,
): void {
  if (slot.craftedRecipeId === undefined) return;
  if (
    typeof slot.craftedRecipeId !== 'string' ||
    slot.craftedRecipeId === '' ||
    slot.craftedRecipeId.length > MAX_KNOWN_RECIPE_ID_LENGTH
  ) {
    delete slot.craftedRecipeId;
    dropped.push(`${containerLabel}.${slot.itemId}.craftedRecipeId`);
  }
}

export interface SanitizedItemInstancePayload {
  /** The cleaned payload, or undefined when nothing usable survives (the
   *  caller then removes the field entirely: an empty `{}` payload is worse
   *  than none, since it can never stack with a plain stack of the same item
   *  again, which strands the row in its slot forever). */
  payload: ItemInstancePayload | undefined;
  /** Key paths this call removed ('signer', 'rolled.quality', ...), plus the
   *  literal 'payload' when the whole payload was dropped. For the caller's
   *  dev-channel log only: nothing reads it as a value. */
  dropped: string[];
}

/**
 * The ONE dev-channel line per CHARACTER LOAD (never per row: a
 * systematically corrupt blob would otherwise log once per affected stack,
 * unbounded, since over-capacity inventories are tolerated). The call sites
 * aggregate every container's drops into one sink and emit here once, so the
 * spelling cannot drift apart. English by rule (a developer log, never
 * player text: see the i18n split in CLAUDE.md), and a no-op when nothing
 * dropped, so the call is safe to place unconditionally. These bounds are
 * otherwise entirely silent, which is what the phase 16 review objected to:
 * a corrupt blob has to leave a trace an operator can find, and this fires
 * only for blobs no legal writer could have produced.
 */
export function warnDroppedInstanceKeys(owner: string, dropped: readonly string[]): void {
  if (dropped.length === 0) return;
  console.warn(`[load] dropped item-instance junk for ${owner}: ${dropped.join(',')}`);
}

/**
 * Bound one persisted instance payload on the way IN.
 *
 * OWNERSHIP CONTRACT: the caller passes a payload IT OWNS (a fresh
 * `cloneItemInstancePayload`/`cloneInvSlot` copy, or a fresh
 * `sanitizeRiftGearInstance` rebuild). This function DELETES keys in place
 * and never rebuilds the object, because a rebuild would re-order keys and
 * the save path is JSON, so a legal payload has to come back out of here
 * byte-identical. It touches the top-level object and its own `rolled` /
 * `charges` sub-objects, which are exactly the parts the clone deep-copies.
 *
 * The arms, each one drop-only:
 *  - anything that is not a plain object (null, a primitive, an array): the
 *    whole payload drops;
 *  - more own keys than MAX_INSTANCE_PAYLOAD_KEYS: the whole payload drops
 *    as corrupt, since no legal writer comes near that count;
 *  - a KEY NAME past MAX_INSTANCE_STRING_LENGTH: that key drops with its
 *    value (no legal key is longer than a short identifier, and the key
 *    count arm alone would let one megabyte-long key through);
 *  - `signer`: kept only when it is a name a legal mint could have stamped
 *    (`isLegalCrafterName`), else dropped;
 *  - any other own string value past MAX_INSTANCE_STRING_LENGTH: dropped;
 *  - the same key and string rules one level into `rolled` and `charges`,
 *    each of which also takes the own-key COUNT ceiling (a flat ten-thousand
 *    short-key record passed every per-key arm and carried 188 KB whole, the
 *    fix-round counterexample) plus the subtree JSON ceiling on any
 *    non-string value nested there (rolled.stats and any deeper smuggling),
 *    so neither width nor depth can carry what the flat rules bound. `rift`
 *    is deliberately not scanned: its payloads are REBUILT from bounded
 *    progression inputs (sanitizeRiftGearInstance) on every load arm before
 *    this bound runs;
 *  - a payload left with no own keys at all: dropped whole.
 *
 * What this deliberately does NOT bound: string values at depth 3+ outside
 * the scanned sub-objects (an unknown TOP-LEVEL object key is bounded by the
 * key count and key length arms only). The subtree ceiling inside the
 * scanned pair is the growth backstop; widening it to unknown top-level
 * objects would size-police the forward-compatibility surface this module
 * promises to admit.
 */
export function sanitizeItemInstancePayloadOnLoad(payload: unknown): SanitizedItemInstancePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { payload: undefined, dropped: ['payload'] };
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_INSTANCE_PAYLOAD_KEYS) {
    return { payload: undefined, dropped: ['payload'] };
  }
  // A clone-mangled container: every call site deep-clones the STORED value
  // first, and a `{ ...src }` spread turns an array or a string into an
  // object of decimal-numeric keys before the plain-object arm above can see
  // the original shape (the fix-round review measured `[1,2,3]` surviving as
  // `{"0":1,"1":2,"2":3}`). No legal payload key is numeric, so an
  // all-numeric-keyed payload is array or string junk wearing an object
  // costume: drop it whole.
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
    return { payload: undefined, dropped: ['payload'] };
  }
  const dropped: string[] = [];
  for (const key of keys) {
    const value = record[key];
    // Key-name bound BEFORE any value rule: the key count arm alone would
    // pass one megabyte-long key carrying a short value. Reported under a
    // fixed label because echoing a corrupt key into the log is the same
    // unbounded-bytes problem wearing a log costume.
    if (key.length > MAX_INSTANCE_STRING_LENGTH) {
      delete record[key];
      dropped.push('(overlong-key)');
      continue;
    }
    if (key === 'signer') {
      // The signer is a character NAME, so it answers to the name shape
      // rather than to the generic string ceiling: the whole signer
      // ecosystem compares it against live player names, and a value no
      // account can hold is corruption by definition.
      if (!isLegalCrafterName(value)) {
        delete record[key];
        dropped.push(key);
      }
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_INSTANCE_STRING_LENGTH) {
        delete record[key];
        dropped.push(key);
      }
      continue;
    }
    if (!SCANNED_SUB_OBJECT_KEYS.includes(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const sub = value as Record<string, unknown>;
    // The sub-object takes the SAME own-key ceiling as the payload (the
    // fix-round review ran the counterexample: ten thousand short keys with
    // short string values passed every per-key and per-value arm and carried
    // 188 KB whole). No legal writer puts more than a handful of keys in
    // rolled or charges; a wider record is corrupt, and it drops WHOLE, the
    // key-count doctrine of the top level.
    if (Object.keys(sub).length > MAX_INSTANCE_PAYLOAD_KEYS) {
      delete record[key];
      dropped.push(key);
      continue;
    }
    for (const subKey of Object.keys(sub)) {
      if (subKey.length > MAX_INSTANCE_STRING_LENGTH) {
        delete sub[subKey];
        dropped.push(`${key}.(overlong-key)`);
        continue;
      }
      const subValue = sub[subKey];
      if (typeof subValue === 'string' && subValue.length > MAX_INSTANCE_STRING_LENGTH) {
        delete sub[subKey];
        dropped.push(`${key}.${subKey}`);
        continue;
      }
      // The nesting backstop: a non-string value here (rolled.stats is the
      // legal case, a small record of numbers) answers to the subtree JSON
      // ceiling, so unbounded bytes cannot ride depth the flat rules never
      // reach. Total on unknown: a value JSON cannot serialize is corrupt by
      // definition on a JSONB row and drops.
      if (subValue !== null && typeof subValue === 'object') {
        let size = Number.POSITIVE_INFINITY;
        try {
          size = JSON.stringify(subValue)?.length ?? Number.POSITIVE_INFINITY;
        } catch {
          // fall through with the infinite size: drop below.
        }
        if (size > MAX_INSTANCE_SUBTREE_JSON_LENGTH) {
          delete sub[subKey];
          dropped.push(`${key}.${subKey}`);
        }
      }
    }
  }
  if (Object.keys(record).length === 0) {
    // Reported as a drop of the payload itself so the caller's dev log names
    // it: an already-empty stored `{}` reaches here having lost nothing, and
    // it is still the stranding case above.
    dropped.push('payload');
    return { payload: undefined, dropped };
  }
  return { payload: record as ItemInstancePayload, dropped };
}
