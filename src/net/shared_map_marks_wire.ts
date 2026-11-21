// The `mmarks` self-wire row (the raid map's shared marks, server
// src/sim/social/shared_map_marks.ts wireFor) decoded for the ClientWorld
// mirror: null or [symbol, page, x, z, wx, y, wz] rows (the map point and the
// same mark's world point on the floor). Every field is re-validated and a
// malformed row is DROPPED, so a version-skewed or hostile frame can never put
// a bad symbol or a non-finite point on the map. DOM-free, ClientWorld-free.

import {
  SHARED_MAP_MARK_PAGES,
  SHARED_MAP_MARK_SYMBOLS,
  type SharedMapMark,
} from '../sim/social/shared_map_marks';

const NONE: readonly SharedMapMark[] = Object.freeze([]);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function decodeSharedMapMarks(raw: unknown): readonly SharedMapMark[] {
  if (!Array.isArray(raw)) return NONE;
  const out: SharedMapMark[] = [];
  const seen = new Set<number>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 7 || out.length >= SHARED_MAP_MARK_SYMBOLS) continue;
    const [symbol, page, x, z, wx, y, wz] = row as unknown[];
    if (typeof symbol !== 'number' || !Number.isInteger(symbol)) continue;
    if (symbol < 0 || symbol >= SHARED_MAP_MARK_SYMBOLS || seen.has(symbol)) continue;
    if (typeof page !== 'number' || !Number.isInteger(page)) continue;
    if (page < 0 || page >= SHARED_MAP_MARK_PAGES) continue;
    if (!finite(x) || !finite(z) || !finite(wx) || !finite(y) || !finite(wz)) continue;
    seen.add(symbol);
    out.push({ symbol, page, x, z, wx, y, wz });
  }
  return out.length > 0 ? out : NONE;
}
