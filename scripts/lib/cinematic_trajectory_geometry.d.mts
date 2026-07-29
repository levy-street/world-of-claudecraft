export interface TrajectoryPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FlatPoint {
  readonly x: number;
  readonly z: number;
}

export interface TrajectoryRect extends FlatPoint {
  readonly hw: number;
  readonly hd: number;
}

export interface SegmentMetrics {
  readonly start: TrajectoryPoint;
  readonly end: TrajectoryPoint;
  readonly maximumSpeed: number;
}

export interface ArrivalApproachMetrics {
  readonly seawardStart: number;
  readonly towardBerth: number;
  readonly bowFirst: number;
  readonly berthDistance: number;
}

export function pointDistance(a: TrajectoryPoint, b: TrajectoryPoint): number;

export function signedRectDistance(point: FlatPoint, rect: TrajectoryRect): number;

export function measureSegment(
  sampleWorld: (elapsed: number) => TrajectoryPoint,
  duration: number,
  sampleRateHz: number,
): SegmentMetrics;

export function measureArrivalApproach(input: {
  readonly berth: FlatPoint;
  readonly landward: FlatPoint;
  readonly start: FlatPoint;
  readonly end: FlatPoint;
  readonly bow: FlatPoint;
}): ArrivalApproachMetrics;
