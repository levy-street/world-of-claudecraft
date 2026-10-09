// Per-copy identity and provenance for tracked (epic and legendary) items:
// the pure leaf. A tracked copy carries `ItemInstancePayload.guid` (one
// canonical UUID per physical copy, minted once and never rewritten) and
// `ItemInstancePayload.provenance` (who first obtained it, when, from what
// source, where, plus the bounded chain of later holders). Nothing here reads
// game data, a clock, or the rng: the guid mint is either the host's
// randomness (`SimConfig.mintItemGuid`) or the deterministic fallback below,
// and the clock is whatever `at` the caller passes (the hub passes the
// host's `lockoutNowMs`, so offline and headless worlds stay deterministic).
//
// The grant-side rules (which defs are tracked, the mint at the inventory
// hub, the transfer stamp under `movement`) live in item_tracking.ts; the
// load bound (item_instance_load.ts) and the Rift rebuild
// (rift/progression.ts) call the validators here so a persisted record is
// judged by exactly one shape.
//
// `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net import,
// no rng, no clock; total on `unknown` so a corrupt row can never throw.

import type { ItemOwnerRecord, ItemProvenance } from './types';

/** The canonical lowercase UUID shape every tracked copy carries. Version
 *  nibble 1-8 and an RFC variant, so both a host `crypto.randomUUID()` mint
 *  and the deterministic fallback (`deterministicItemGuid`, always version
 *  8, the RFC 9562 custom-format version) pass the same gate. */
export const ITEM_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ITEM_GUID_LENGTH = 36;

/** The holder-chain ceiling: the most recent MAX_ITEM_OWNER_HISTORY hands the
 *  copy passed through stay on the payload; older ones roll off the front
 *  while `transfers` keeps the true count. Sized so a fully loaded record
 *  stays well inside the load bound's subtree JSON ceiling
 *  (item_instance_load.ts MAX_INSTANCE_SUBTREE_JSON_LENGTH). */
export const MAX_ITEM_OWNER_HISTORY = 10;

/** Ceilings for the persisted strings on a provenance record. `by` answers to
 *  the character-name shape (a display name is never longer than this);
 *  `source` and `zone` are ids composed by the sim ("mob:<templateId>",
 *  "quest:<questId>", a zone id), never player text. */
export const MAX_ITEM_PROVENANCE_NAME_LENGTH = 32;
export const MAX_ITEM_PROVENANCE_SOURCE_LENGTH = 64;
export const MAX_ITEM_PROVENANCE_ZONE_LENGTH = 64;
/** Ceiling for the short note a ledger row carries (a rank, an enchant id,
 *  the item id a copy became): sim-composed, never player text. */
export const MAX_ITEM_LEDGER_DETAIL_LENGTH = 64;

/** The closed lifecycle vocabulary of a tracked copy (the `itemTracked`
 *  event kind, mirrored by the server ledger's ITEM_LEDGER_KINDS):
 *  - mint: the copy first reaches a player (its guid is born here);
 *  - transfer: the copy changes hands;
 *  - modify: the copy changes IN PLACE and keeps its guid (Perfecting, a
 *    legendary promotion, an enchant, a Rift Forge upgrade or socket, an
 *    unbind, a Perfecting swap);
 *  - consume: the copy ends (sundered, salvaged, disenchanted, destroyed,
 *    sold off the buyback list, learned as a pattern, spent as a reagent,
 *    deleted with its character); its guid must never be seen again;
 *  - derive: a NEW copy minted from an old one (an upgrade recipe, an admin
 *    restore, a duplicate-guid split), naming its parent. */
export const ITEM_TRACKED_KINDS = ['mint', 'transfer', 'modify', 'consume', 'derive'] as const;
export type ItemTrackedKind = (typeof ITEM_TRACKED_KINDS)[number];

/** The item quality tiers whose copies are tracked. Every copy of a def (or a
 *  promoted copy, via its rolled quality) in one of these tiers gets a guid
 *  and a provenance record at the inventory hub. */
export const TRACKED_ITEM_QUALITIES: ReadonlySet<string> = new Set(['epic', 'legendary']);

/** The source a record carries when the hub cannot say where a copy came
 *  from: a plain (pre-tracking) copy first seen while changing hands. */
export const LEGACY_ITEM_SOURCE = 'legacy';

/** The source the hub records for a world-sourced grant no caller labelled
 *  (a quest reward chest, a vendor, a cache): "the world", honestly vague. */
export const WORLD_ITEM_SOURCE = 'world';

export function isItemGuid(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length === ITEM_GUID_LENGTH && ITEM_GUID_PATTERN.test(value)
  );
}

function isBoundedPrintableAscii(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalCharacterId(value: unknown): value is number | undefined {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) > 0);
}

/** A loadable holder record: `{ at, by, byId? }` and nothing else. Judged
 *  whole, like the origin it sits under. */
export function isLoadableItemOwnerRecord(value: unknown): value is ItemOwnerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'at' && key !== 'by' && key !== 'byId') return false;
  }
  return (
    isEpochMs(r.at) &&
    isBoundedPrintableAscii(r.by, MAX_ITEM_PROVENANCE_NAME_LENGTH) &&
    isOptionalCharacterId(r.byId)
  );
}

/** The load-side shape bound for a persisted provenance record, judged
 *  ATOMICALLY (the partyTrade doctrine in item_instance_load.ts): the record
 *  is one snapshot, so a corrupt half drops the whole record rather than
 *  leaving a partial residue. Unknown keys are refused here (unlike the
 *  payload's top level) because the record is owned by this leaf alone and
 *  every reader depends on its exact shape. */
export function isLoadableItemProvenance(value: unknown): value is ItemProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (
      key !== 'at' &&
      key !== 'by' &&
      key !== 'byId' &&
      key !== 'source' &&
      key !== 'zone' &&
      key !== 'derivedFrom' &&
      key !== 'owners' &&
      key !== 'transfers'
    )
      return false;
  }
  if (!isEpochMs(r.at)) return false;
  if (!isBoundedPrintableAscii(r.by, MAX_ITEM_PROVENANCE_NAME_LENGTH)) return false;
  if (!isOptionalCharacterId(r.byId)) return false;
  if (!isBoundedPrintableAscii(r.source, MAX_ITEM_PROVENANCE_SOURCE_LENGTH)) return false;
  if (r.zone !== undefined && !isBoundedPrintableAscii(r.zone, MAX_ITEM_PROVENANCE_ZONE_LENGTH))
    return false;
  if (r.derivedFrom !== undefined && !isItemGuid(r.derivedFrom)) return false;
  if (r.owners !== undefined) {
    if (!Array.isArray(r.owners) || r.owners.length > MAX_ITEM_OWNER_HISTORY) return false;
    for (const o of r.owners) if (!isLoadableItemOwnerRecord(o)) return false;
  }
  if (r.transfers !== undefined) {
    const transfers = r.transfers;
    if (typeof transfers !== 'number' || !Number.isSafeInteger(transfers) || transfers < 0)
      return false;
  }
  return true;
}

/** Deep copy: the owner chain is a mutable array on a mutable record, so a
 *  shallow spread would alias it between a live payload and its saved or
 *  loaded twin (the cloneItemInstancePayload doctrine, types.ts). Total over
 *  malformed data: a non-array `owners` copies through untouched for the
 *  load bound to drop. */
export function cloneItemProvenance(src: ItemProvenance): ItemProvenance {
  return {
    ...src,
    ...(Array.isArray(src.owners) ? { owners: src.owners.map((o) => ({ ...o })) } : {}),
  };
}

/** The character currently recorded as holding the copy: the last transfer,
 *  else the origin. */
export function currentItemHolder(provenance: ItemProvenance): ItemOwnerRecord {
  const owners = provenance.owners;
  if (Array.isArray(owners) && owners.length > 0) return owners[owners.length - 1];
  return {
    at: provenance.at,
    by: provenance.by,
    ...(provenance.byId !== undefined && { byId: provenance.byId }),
  };
}

/** Whether `holder` is the same character the record last saw. Stable ids
 *  win when both sides have one (rename-proof); names decide otherwise. */
export function isSameItemHolder(a: ItemOwnerRecord, b: ItemOwnerRecord): boolean {
  if (a.byId !== undefined && b.byId !== undefined) return a.byId === b.byId;
  return a.by === b.by;
}

/** Append `holder` to the copy's owner chain when the copy is changing hands.
 *  A grant back to the character the record last saw (a trade rollback, an
 *  enchant re-mint, a buyback, a bank withdraw) is not a transfer and records
 *  nothing. Mutates the record in place and returns true when a transfer was
 *  recorded. Beyond MAX_ITEM_OWNER_HISTORY the oldest hand rolls off while
 *  `transfers` keeps counting. */
export function recordItemTransfer(provenance: ItemProvenance, holder: ItemOwnerRecord): boolean {
  if (isSameItemHolder(currentItemHolder(provenance), holder)) return false;
  const owners = Array.isArray(provenance.owners) ? provenance.owners : [];
  owners.push({
    at: holder.at,
    by: holder.by,
    ...(holder.byId !== undefined && { byId: holder.byId }),
  });
  while (owners.length > MAX_ITEM_OWNER_HISTORY) owners.shift();
  provenance.owners = owners;
  provenance.transfers = (provenance.transfers ?? 0) + 1;
  return true;
}

/** FNV-1a over a string, 32-bit, with a salt folded into the offset basis so
 *  four salted passes over one input give four independent words. */
function fnv1a32(input: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The host-less guid mint: a UUID-shaped id derived from stable sim inputs
 * (the world seed, the tick, a per-Sim mint ordinal, the item and the
 * recipient), so an offline or headless world with no host randomness still
 * stamps a distinct, replay-stable id per copy without touching the shared
 * rng stream (a draw here would shift every later roll's order). Version 8
 * (RFC 9562 custom), RFC variant, so it passes `isItemGuid` like a host mint.
 * Never used online: the server supplies `crypto.randomUUID`.
 */
export function deterministicItemGuid(
  seed: number,
  tick: number,
  ordinal: number,
  itemId: string,
  pid: number,
): string {
  const input = `${seed}|${tick}|${ordinal}|${itemId}|${pid}`;
  const words = [
    fnv1a32(input, 0x9e3779b9),
    fnv1a32(input, 0x85ebca6b),
    fnv1a32(input, 0xc2b2ae35),
    fnv1a32(input, 0x27d4eb2f),
  ];
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');
  // Stamp the version and variant nibbles on the hex, not the words, so the
  // layout matches formatUuidV4's byte positions (octet 6 high nibble, octet 8
  // high bits).
  const bytes = hex.slice(0, 12) + '8' + hex.slice(13, 16) + '8' + hex.slice(17, 32);
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 32)}`;
}
