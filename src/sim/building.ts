// Building metadata is shared by editor saves and every map consumer. The
// geometry remains ordinary placements, so older maps need no migration.

export interface BuildingDef {
  id: string;
  baseY: number;
  floorHeight: number;
  levels: number;
}

export interface BuildingMembership {
  id: string;
  level: number;
  kind: 'wall' | 'floor' | 'object';
  /** Local normal axis of the wall's broad paintable faces. Absent means Z. */
  wallAxis?: 'x' | 'z';
}

export const MAX_BUILDINGS = 128;
export const MAX_BUILDING_LEVELS = 16;
export const MIN_BUILDING_FLOOR_HEIGHT = 2;
export const MAX_BUILDING_FLOOR_HEIGHT = 30;
// Same coordinate envelope as map_doc. Kept here to avoid a sanitizer cycle.
export const MAX_BUILDING_Y = 10_000;
const MAX_BUILDING_ID_LENGTH = 64;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_BUILDING_ID_LENGTH;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeBuilding(value: unknown): BuildingDef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (!validId(row.id) || !finite(row.baseY) || !finite(row.floorHeight) || !finite(row.levels)) {
    return undefined;
  }
  const floorHeight = clamp(row.floorHeight, MIN_BUILDING_FLOOR_HEIGHT, MAX_BUILDING_FLOOR_HEIGHT);
  const levels = Math.floor(clamp(row.levels, 1, MAX_BUILDING_LEVELS));
  return {
    id: row.id,
    baseY: clamp(row.baseY, -MAX_BUILDING_Y, MAX_BUILDING_Y - levels * floorHeight),
    floorHeight,
    levels,
  };
}

/** Bound work before inspecting records; duplicates never create ambiguous ownership. */
export function sanitizeBuildings(value: unknown): BuildingDef[] {
  if (!Array.isArray(value)) return [];
  const result: BuildingDef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(value.length, MAX_BUILDINGS); i++) {
    const building = sanitizeBuilding(value[i]);
    if (!building || seen.has(building.id)) continue;
    seen.add(building.id);
    result.push(building);
  }
  return result;
}

export function sanitizeBuildingMembership(value: unknown): BuildingMembership | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (
    !validId(row.id) ||
    !finite(row.level) ||
    !Number.isInteger(row.level) ||
    row.level < 0 ||
    row.level >= MAX_BUILDING_LEVELS ||
    (row.kind !== 'wall' && row.kind !== 'floor' && row.kind !== 'object')
  ) {
    return undefined;
  }
  const membership: BuildingMembership = { id: row.id, level: row.level, kind: row.kind };
  if (row.kind === 'wall' && (row.wallAxis === 'x' || row.wallAxis === 'z')) {
    membership.wallAxis = row.wallAxis;
  }
  return membership;
}
