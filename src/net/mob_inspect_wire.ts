// Wire decode for the `mobInspectInfo` reply (`inspectMob` /
// `{t:'mobInspectInfo', id, rid, info}`), the mob inspect window's live stat
// read. DOM-free, ClientWorld-free: every field is re-validated here, and
// anything malformed fails the WHOLE frame closed to null rather than
// resolving with a partial or guessed shape.

import type { MobInspectInfo } from '../world_api';

export interface MobInspectInfoReply {
  readonly id: number;
  readonly rid: number;
  readonly info: MobInspectInfo | null;
}

// Mirrors the authored template id shape (short snake_case ids), a defensive
// bound only: the decoder never checks membership in the loaded content.
const TEMPLATE_ID_SHAPE = /^[A-Za-z0-9_:-]{1,64}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function decodeMobInspectInfo(raw: unknown): MobInspectInfo | null {
  if (!isPlainRecord(raw)) return null;
  if (!isPositiveSafeInteger(raw.mobId)) return null;
  if (typeof raw.templateId !== 'string' || !TEMPLATE_ID_SHAPE.test(raw.templateId)) return null;
  if (!isPositiveSafeInteger(raw.level)) return null;
  if (!isNonNegativeFinite(raw.maxHp)) return null;
  if (!isNonNegativeFinite(raw.weaponMin) || !isNonNegativeFinite(raw.weaponMax)) return null;
  if (raw.weaponMax < raw.weaponMin) return null;
  if (!isNonNegativeFinite(raw.attackSpeed)) return null;
  if (!isNonNegativeFinite(raw.armor)) return null;
  if (typeof raw.ccImmune !== 'boolean' || typeof raw.slowImmune !== 'boolean') return null;
  return {
    mobId: raw.mobId,
    templateId: raw.templateId,
    level: raw.level,
    maxHp: raw.maxHp,
    weaponMin: raw.weaponMin,
    weaponMax: raw.weaponMax,
    attackSpeed: raw.attackSpeed,
    armor: raw.armor,
    ccImmune: raw.ccImmune,
    slowImmune: raw.slowImmune,
  };
}

/** Decode a whole `mobInspectInfo` reply frame. Any malformed field fails the
 *  WHOLE frame to null; the caller (`mob_inspect_request.ts`) treats a null
 *  decode as "not a match", never as a settled answer. */
export function decodeMobInspectInfoReply(raw: unknown): MobInspectInfoReply | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.t !== 'mobInspectInfo') return null;
  if (!isPositiveSafeInteger(raw.id) || !isPositiveSafeInteger(raw.rid)) return null;
  if (raw.info === null) return { id: raw.id, rid: raw.rid, info: null };
  const info = decodeMobInspectInfo(raw.info);
  // The body must answer for the SAME mob as the envelope, never rewritten.
  if (info === null || info.mobId !== raw.id) return null;
  return { id: raw.id, rid: raw.rid, info };
}
