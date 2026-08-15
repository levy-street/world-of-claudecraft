export interface PlanRect {
  x: number;
  z: number;
  hw: number;
  hd: number;
  kind: string;
}

export interface PlanPoint {
  x: number;
  z: number;
}

export interface PlanBase {
  team: 0 | 1;
  flag: PlanPoint;
  spawns: PlanPoint[];
  banner: PlanPoint;
}

export interface PlanPlot extends PlanPoint {
  hw: number;
  hd: number;
}

export interface PlanGate extends PlanPoint {
  half: number;
}

export interface PlanRoom extends PlanPoint {
  hw: number;
  hd: number;
}

export interface PlanRubble extends PlanPoint {
  kind: 'large' | 'small';
}

export interface PlanLocation {
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const HALF_X: number;
export const HALF_Z: number;
export const WALL_T: number;
export const FLAG_Z: number;
export const KEEP_HALF_X: number;
export const KEEP_BACK_DZ: number;
export const KEEP_SIDE_HD: number;
export const KEEP_MOUTH_DZ: number;
export const CURTAIN_Z: number;
export const GRAVEYARD_FENCE_TOP: number;
export const RUBBLE_RADIUS: { large: number; small: number };

export const BASES: PlanBase[];
export const POWER_RUNES: PlanPoint[];
export const SPEED_RUNES: PlanPoint[];
export const GRAVEYARDS: PlanPlot[];

export const PERIMETER_WALLS: PlanRect[];
export const CURTAIN_WALLS: PlanRect[];
export const GATEHOUSE_WALLS: PlanRect[];
export const GATEHOUSE_ROOMS: PlanRoom[];
export const KEEP_BARRICADES: PlanRect[];
export const HEART_RUIN: PlanRect;
export const COVER_WALLS: PlanRect[];
export const COVER_PILLARS: PlanPoint[];
export const COVER_CRATES: PlanPoint[];
export const RUBBLE_PILES: PlanRubble[];
export const GRAVEYARD_FENCES: PlanRect[];
export const MAIN_GATES: PlanGate[];
export const LOCATIONS: PlanLocation[];
export const ROUTE_LINES: PlanPoint[][];

export function keepWallSegments(team: 0 | 1): PlanRect[];
export function keepInteriorBounds(team: 0 | 1): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
export function planWalls(): PlanRect[];
export function insideAnyWall(x: number, z: number, pad?: number): boolean;
