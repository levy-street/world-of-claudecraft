// The player's own map pins on a raid atlas: a small, capped list of marks
// (an icon and a colour on a page point) the player places, restyles and
// removes. Client-side only (never sent to the server, never shared): the
// controller persists the list per character and per raid through the
// wrapped storage access, and this module owns the shape, the edits, the hit
// test and the defensive parse of whatever storage hands back.
//
// DOM-free and deterministic.

import type { RaidAtlasFloorId } from './raid_atlas_plan_core';

export const RAID_ATLAS_PIN_ICONS = [
  'star',
  'flag',
  'skull',
  'swords',
  'shield',
  'diamond',
] as const;
export type RaidAtlasPinIcon = (typeof RAID_ATLAS_PIN_ICONS)[number];

export const RAID_ATLAS_PIN_COLORS = ['gold', 'red', 'blue', 'green', 'purple', 'white'] as const;
export type RaidAtlasPinColor = (typeof RAID_ATLAS_PIN_COLORS)[number];

/** Most pins one character keeps on one raid's atlas. */
export const RAID_ATLAS_MAX_PINS = 24;

/** The storage format version (a bump drops older lists cleanly). */
const PIN_FORMAT = 1;

export interface RaidAtlasPin {
  /** Stable within the list (the next free integer). */
  id: number;
  floor: RaidAtlasFloorId;
  /** Instance-local yards. */
  x: number;
  z: number;
  icon: RaidAtlasPinIcon;
  color: RaidAtlasPinColor;
}

export interface RaidAtlasPinStyle {
  icon: RaidAtlasPinIcon;
  color: RaidAtlasPinColor;
}

export const DEFAULT_PIN_STYLE: RaidAtlasPinStyle = { icon: 'star', color: 'gold' };

const FLOORS: readonly RaidAtlasFloorId[] = ['veins', 'heart'];

/** The storage key of one character's pins on one raid. The character key is
 *  the character's name (unique per realm; offline and online keep their own
 *  lists, which is correct: they are different characters). */
export function raidAtlasPinKey(dungeonId: string, characterKey: string): string {
  return `woc.raidAtlas.pins.${dungeonId}.${characterKey}`;
}

export function isPinIcon(v: unknown): v is RaidAtlasPinIcon {
  return typeof v === 'string' && (RAID_ATLAS_PIN_ICONS as readonly string[]).includes(v);
}

export function isPinColor(v: unknown): v is RaidAtlasPinColor {
  return typeof v === 'string' && (RAID_ATLAS_PIN_COLORS as readonly string[]).includes(v);
}

/** Add a pin. At the cap the OLDEST pin makes room (placing never fails). */
export function addPin(
  pins: readonly RaidAtlasPin[],
  floor: RaidAtlasFloorId,
  x: number,
  z: number,
  style: RaidAtlasPinStyle,
): RaidAtlasPin[] {
  const id = pins.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const next = [...pins, { id, floor, x, z, icon: style.icon, color: style.color }];
  return next.length > RAID_ATLAS_MAX_PINS ? next.slice(next.length - RAID_ATLAS_MAX_PINS) : next;
}

export function removePin(pins: readonly RaidAtlasPin[], id: number): RaidAtlasPin[] {
  return pins.filter((p) => p.id !== id);
}

export function restylePin(
  pins: readonly RaidAtlasPin[],
  id: number,
  style: Partial<RaidAtlasPinStyle>,
): RaidAtlasPin[] {
  return pins.map((p) =>
    p.id === id
      ? {
          ...p,
          icon: style.icon && isPinIcon(style.icon) ? style.icon : p.icon,
          color: style.color && isPinColor(style.color) ? style.color : p.color,
        }
      : p,
  );
}

/** The topmost pin (the last drawn) on `floor` whose head is within `radius`
 *  screen pixels of (sx, sy), given a projection; null when none. The head
 *  sits `lift` px above the pin's point (a map pin stands on its tip). */
export function pinAtScreen(
  pins: readonly RaidAtlasPin[],
  floor: RaidAtlasFloorId,
  project: (x: number, z: number) => { sx: number; sy: number },
  sx: number,
  sy: number,
  radius: number,
  lift: number,
): RaidAtlasPin | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (p.floor !== floor) continue;
    const at = project(p.x, p.z);
    if (Math.hypot(at.sx - sx, at.sy - lift - sy) <= radius) return p;
  }
  return null;
}

export function serializePins(pins: readonly RaidAtlasPin[]): string {
  return JSON.stringify({
    v: PIN_FORMAT,
    pins: pins.map((p) => [
      p.id,
      p.floor,
      Math.round(p.x * 10) / 10,
      Math.round(p.z * 10) / 10,
      p.icon,
      p.color,
    ]),
  });
}

/** Parse a stored list. Anything malformed (a foreign value, an old format,
 *  a hand-edited row) is dropped row by row; never throws. */
export function parsePins(raw: string | null): RaidAtlasPin[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const rec = data as { v?: unknown; pins?: unknown };
  if (rec.v !== PIN_FORMAT || !Array.isArray(rec.pins)) return [];
  const out: RaidAtlasPin[] = [];
  const seen = new Set<number>();
  for (const row of rec.pins) {
    if (!Array.isArray(row) || row.length !== 6) continue;
    const [id, floor, x, z, icon, color] = row as unknown[];
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    if (typeof floor !== 'string' || !(FLOORS as readonly string[]).includes(floor)) continue;
    if (typeof x !== 'number' || typeof z !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 2000 || Math.abs(z) > 2000)
      continue;
    if (!isPinIcon(icon) || !isPinColor(color)) continue;
    seen.add(id);
    out.push({ id, floor: floor as RaidAtlasFloorId, x, z, icon, color });
  }
  return out.slice(-RAID_ATLAS_MAX_PINS);
}
