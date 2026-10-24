// Per-material texture overrides on a placed model: a building's walls,
// roof and trim can each wear a different library (or imported) texture,
// tiled in world space and tinted, without touching the shared GLB.
//
// A placement carries `materialFinishes`, keyed by MATERIAL SLOT: the model
// material's own name, or `<mesh>#<index>` for an unnamed one (the render
// side derives the same keys, render/material_finishes.ts materialSlotKey).
// Each value is the same finish record the wall-finish painter stores
// (sim/wall_finishes.ts WallFinish), so textures, imports, tiling and color
// share one sanitizer. Pure data: the server validates stored documents with
// this same code (sim/map_doc.ts).

import { sanitizeWallFinish, type WallFinish, wallFinishTextureRefs } from './wall_finishes';

export type MaterialFinishes = Record<string, WallFinish>;

/** Slots one placement may override (a model rarely has more than a dozen). */
export const MAX_MATERIAL_FINISHES = 32;
/** Longest slot key kept (GLB material names are short in practice). */
const MAX_SLOT_KEY = 96;

/** A slot key: a GLB material name or `<mesh>#<index>`, printable, bounded. */
function validSlotKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_SLOT_KEY || key === '__proto__') return false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** A clean copy, or undefined when nothing valid remains. */
export function sanitizeMaterialFinishes(value: unknown): MaterialFinishes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: MaterialFinishes = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_MATERIAL_FINISHES) break;
    if (!validSlotKey(key)) continue;
    const finish = sanitizeWallFinish(raw);
    if (!finish || (finish.texture === undefined && finish.color === undefined)) continue;
    out[key] = finish;
    count++;
  }
  return count > 0 ? out : undefined;
}

/** Each undo/document copy owns its nested finish records. */
export function cloneMaterialFinishes(
  value: MaterialFinishes | undefined,
): MaterialFinishes | undefined {
  return sanitizeMaterialFinishes(value);
}

/** Imported image dependencies for portable map bundles, without duplicates. */
export function materialFinishTextureRefs(value: MaterialFinishes | undefined): string[] {
  const refs: string[] = [];
  for (const finish of Object.values(value ?? {})) {
    for (const sha of wallFinishTextureRefs({ front: finish })) {
      if (!refs.includes(sha)) refs.push(sha);
    }
  }
  return refs;
}

/** Set (or with null, clear) one slot's finish, returning the new record or
 *  undefined once no slot is overridden. Never mutates the input. */
export function withMaterialFinish(
  value: MaterialFinishes | undefined,
  key: string,
  finish: WallFinish | null,
): MaterialFinishes | undefined {
  const next: Record<string, unknown> = { ...(value ?? {}) };
  if (finish) next[key] = finish;
  else delete next[key];
  return sanitizeMaterialFinishes(next);
}
