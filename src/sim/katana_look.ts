// The per-copy katana record (ItemInstancePayload.katana): pure shape rules
// shared by the live writer (katana_forge.ts) and the load bound
// (item_instance_load.ts), so both agree on what a legal record is. No ctx,
// no rng.
import { KATANA_KANJI, KATANA_PALETTES, type KatanaPart } from './content/katana_forge';

export interface KatanaLook {
  /** Enemies slain while this copy was the equipped main hand. */
  kills?: number;
  blade?: string;
  guard?: string;
  wrap?: string;
  saya?: string;
  /** An engraved kanji id from KATANA_KANJI. */
  kanji?: string;
}

/** Highest kill count a record may carry (a corrupt huge number drops). */
export const MAX_KATANA_KILLS = 10_000_000;

export function isKatanaColor(part: KatanaPart, color: unknown): color is string {
  return typeof color === 'string' && Object.hasOwn(KATANA_PALETTES[part], color);
}

export function isKatanaKanji(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(KATANA_KANJI, id);
}

/** True when `value` is a well-formed katana record (every key known and legal). */
export function isValidKatanaLook(value: unknown): value is KatanaLook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'kills') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_KATANA_KILLS) {
        return false;
      }
    } else if (key === 'kanji') {
      if (!isKatanaKanji(v)) return false;
    } else if (key === 'blade' || key === 'guard' || key === 'wrap' || key === 'saya') {
      if (!isKatanaColor(key, v)) return false;
    } else {
      return false;
    }
  }
  return true;
}
