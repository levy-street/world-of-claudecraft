// Wire decode for the `corpseHarvestInfo` reply (Intentional Gathering PR3
// transport contract, `inspectCorpseHarvest` / `{t:'corpseHarvestInfo', id,
// rid, info}`). DOM-free, ClientWorld-free: every field is re-validated here,
// and anything malformed fails the WHOLE frame closed to null rather than
// resolving with a partial or guessed shape.

import { HARVEST_TIERS } from '../sim/professions/gathering';
import type { HarvestAdmissionReason } from '../sim/professions/harvest_admission';
import type { HarvestPreference } from '../sim/professions/harvest_preference';
import type { CorpseHarvestInfo } from '../world_api';

export interface CorpseHarvestInfoReply {
  readonly id: number;
  readonly rid: number;
  readonly info: CorpseHarvestInfo | null;
}

// Closed allowlist, restated on this side of the wire rather than trusted off
// the server's type alone. The type-level check below fails to compile if
// `HarvestAdmissionReason` ever gains a member missing from this list.
const HARVEST_ADMISSION_REASONS = [
  'malformed_input',
  'actor_dead',
  'actor_in_combat',
  'actor_busy',
  'corpse_invalid',
  'wrong_world',
  'out_of_range',
  'no_field_kit',
  'already_harvested',
  'reserved',
  'priority_protected',
  'corpse_expiring',
  'preference_malformed',
  'nothing_to_harvest',
  'material_unavailable',
  'bags_full',
] as const satisfies readonly HarvestAdmissionReason[];
type _AssertReasonsComplete =
  HarvestAdmissionReason extends (typeof HARVEST_ADMISSION_REASONS)[number] ? true : never;
const _reasonsComplete: _AssertReasonsComplete = true;
void _reasonsComplete;

// Component-tag shape bound: a documented defensive bound (short camelCase
// authored tags, e.g. 'venomSac'), not a live-content membership check, since
// this decoder must never depend on which zones are currently loaded.
const MAX_COMPONENT_TAGS = 12;
const COMPONENT_TAG_SHAPE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

// Mirrors harvest_preference.ts's private stored-id bound (printable non-space
// ASCII, capped) rather than importing it, so a retired id that no longer maps
// to any content still decodes verbatim instead of being rejected as unknown.
const MAX_MATERIAL_ID_LENGTH = 64;
const MATERIAL_ID_SHAPE = /^[\x21-\x7e]+$/;

// Mirrors server/auth.ts validCharNameShape: the actual character-name bound,
// not an arbitrary display-name limit.
const RESERVATION_NAME_SHAPE = /^[A-Za-z][A-Za-z' -]{1,15}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isBoundedTierBonus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= HARVEST_TIERS.length - 1
  );
}

function isBoundedMaterialId(value: string): boolean {
  return value.length <= MAX_MATERIAL_ID_LENGTH && MATERIAL_ID_SHAPE.test(value);
}

function isHarvestAdmissionReason(value: string): value is HarvestAdmissionReason {
  return (HARVEST_ADMISSION_REASONS as readonly string[]).includes(value);
}

function decodeComponentTags(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_COMPONENT_TAGS) return null;
  const tags: string[] = [];
  for (const tag of raw) {
    if (typeof tag !== 'string' || !COMPONENT_TAG_SHAPE.test(tag)) return null;
    tags.push(tag);
  }
  return tags;
}

// undefined return means malformed; null and a real value are both valid.
function decodePreference(raw: unknown): HarvestPreference | null | undefined {
  if (raw === null) return null;
  if (!isPlainRecord(raw)) return undefined;
  if (raw.kind === 'all') return { kind: 'all' };
  if (raw.kind === 'material') {
    const itemId = raw.itemId;
    if (typeof itemId !== 'string' || !isBoundedMaterialId(itemId)) return undefined;
    return { kind: 'material', itemId };
  }
  return undefined;
}

function decodeDenial(raw: unknown): HarvestAdmissionReason | null | undefined {
  if (raw === null) return null;
  return typeof raw === 'string' && isHarvestAdmissionReason(raw) ? raw : undefined;
}

function decodeReservation(
  raw: unknown,
): { readonly name: string; readonly self: boolean } | null | undefined {
  if (raw === null) return null;
  if (!isPlainRecord(raw)) return undefined;
  const { name, self } = raw;
  if (typeof name !== 'string' || !RESERVATION_NAME_SHAPE.test(name)) return undefined;
  if (typeof self !== 'boolean') return undefined;
  return { name, self };
}

/** Decode one non-null `info` object. `raw === null` (the valid "no usable
 *  current answer" case) is handled by the reply decoder below, never here. */
function decodeCorpseHarvestInfo(raw: unknown): CorpseHarvestInfo | null {
  if (!isPlainRecord(raw)) return null;
  if (!isPositiveSafeInteger(raw.corpseId)) return null;
  const componentTags = decodeComponentTags(raw.componentTags);
  if (componentTags === null) return null;
  const preference = decodePreference(raw.preference);
  if (preference === undefined) return null;
  const denial = decodeDenial(raw.denial);
  if (denial === undefined) return null;
  const reservation = decodeReservation(raw.reservation);
  if (reservation === undefined) return null;
  if (!isBoundedTierBonus(raw.tierBonus)) return null;
  return {
    corpseId: raw.corpseId,
    componentTags,
    preference,
    denial,
    reservation,
    tierBonus: raw.tierBonus,
  };
}

/** Decode a whole `corpseHarvestInfo` reply frame. Any malformed field fails
 *  the WHOLE frame to null; the caller (`corpse_harvest_info_request.ts`)
 *  treats a null decode as "not a match", never as a settled answer. */
export function decodeCorpseHarvestInfoReply(raw: unknown): CorpseHarvestInfoReply | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.t !== 'corpseHarvestInfo') return null;
  if (!isPositiveSafeInteger(raw.id) || !isPositiveSafeInteger(raw.rid)) return null;
  if (raw.info === null) return { id: raw.id, rid: raw.rid, info: null };
  const info = decodeCorpseHarvestInfo(raw.info);
  if (info === null) return null;
  // The nested body id must name the SAME corpse as the envelope: a frame
  // whose info answers for a different body is never rewritten to match,
  // it fails the whole reply closed (a matching id/rid must never deliver
  // another body's status).
  if (info.corpseId !== raw.id) return null;
  return { id: raw.id, rid: raw.rid, info };
}
