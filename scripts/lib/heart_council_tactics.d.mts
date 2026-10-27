export interface Point {
  x: number;
  z: number;
}

export interface Circle extends Point {
  r: number;
}

export interface PillarState {
  integrity: number;
  risen: boolean;
  soul: 'guardian' | 'slabwright' | 'singer' | null;
  r: number;
}

export interface FloorEllipse extends Point {
  rx: number;
  rz: number;
}

export const COUNCIL_REACH: {
  readonly columnR: number;
  readonly risenR: number;
  readonly rock: number;
  readonly soulRock: number;
  readonly resonance: number;
  readonly pulse: number;
  readonly riseGap: number;
  readonly riseClearOfBodies: number;
  readonly riseKnock: number;
  readonly slabCrush: number;
  readonly slabGrind: number;
  readonly wrath: number;
};

export function parsePillar(tid: unknown): PillarState | null;

export function pillarBetween<P extends Circle>(
  pillars: readonly P[],
  from: Point,
  to: Point,
  pad?: number,
): P | null;

export function hiddenFrom(
  cover: readonly Circle[],
  sources: readonly Point[],
  spot: Point,
  margin?: number,
): boolean;

export function faceDistance(p: Circle, at: Point): number;

export function onFloor(at: Point, floor: FloorEllipse, margin?: number): boolean;

export function coverSpots<P extends Circle>(
  pillar: P,
  cover: readonly Circle[],
  sources: readonly Point[],
  minFace: number,
  depth?: number,
): Array<Point & { pillar: P }>;

export function steer(from: Point, goal: Point, circles: readonly Circle[], clear?: number): Point;

export function rockSpot(o: {
  from: Point;
  cover: readonly Circle[];
  soul?: (Circle & { soul: string | null }) | null;
  hazards?: readonly Circle[];
  floor: FloorEllipse;
  home?: Point | null;
  homeWeight?: number;
  range?: number;
  margin?: number;
}): Point | null;

export function riseClear(
  at: Point,
  pillars: readonly Point[],
  bodies: readonly Point[],
  floor: FloorEllipse,
  margin?: number,
): boolean;

export function wakeSpot(o: {
  holder: Point;
  raid: Point;
  pillars: readonly Point[];
  bodies: readonly Point[];
  floor: FloorEllipse;
  others?: readonly Point[];
  lane?: number;
  near?: number;
  far?: number;
}): Point | null;
